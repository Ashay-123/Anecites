import { Buffer } from "node:buffer";

import {
  type CodeExecutionProvider,
  type CodeExecutionRequest,
  type CodeExecutionResult,
  type ExecutionProviderHealth,
  type ExecutionRuntime,
  type FetchLike,
} from "./code-execution-provider.js";
import { resolveExecutionRuntime } from "./code-execution-language-map.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

interface PistonRunStage {
  stdout?: unknown;
  stderr?: unknown;
  output?: unknown;
  code?: unknown;
  signal?: unknown;
}

export class PistonExecutionProvider implements CodeExecutionProvider {
  constructor(
    private readonly config: ServerConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async healthCheck(): Promise<ExecutionProviderHealth> {
    const response = await this.fetchImpl(new URL(`${this.config.pistonBaseUrl}/api/v2/runtimes`), {
      signal: AbortSignal.timeout(this.config.pistonRequestTimeoutMs),
    });

    return {
      ok: response.ok,
      provider: "piston",
    };
  }

  async listRuntimes(): Promise<ExecutionRuntime[]> {
    const response = await this.fetchImpl(new URL(`${this.config.pistonBaseUrl}/api/v2/runtimes`), {
      signal: AbortSignal.timeout(this.config.pistonRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpError(502, "CODE_EXECUTION_UPSTREAM_ERROR", "Code execution service failed");
    }

    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid response");
    }

    return body.map(parsePistonRuntime);
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const runtime = resolveExecutionRuntime("piston", request.languageId);
    if (!runtime) {
      throw new HttpError(400, "LANGUAGE_NOT_ALLOWED", "Language is not allowed for code execution");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(`${this.config.pistonBaseUrl}/api/v2/execute`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(createPistonExecutionPayload(request, runtime)),
        signal: AbortSignal.timeout(this.config.pistonRequestTimeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new HttpError(504, "CODE_EXECUTION_TIMEOUT", "Code execution timed out");
      }

      throw new HttpError(502, "CODE_EXECUTION_UPSTREAM_ERROR", "Code execution service unreachable");
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid response");
    }

    if (!response.ok) {
      throw new HttpError(502, "CODE_EXECUTION_UPSTREAM_ERROR", "Code execution service failed");
    }

    return normalizePistonResponse(responseBody, request.outputLimitBytes);
  }
}

function createPistonExecutionPayload(request: CodeExecutionRequest, runtime: { providerLanguage: string; providerVersion: string; sourceFileName: string }) {
  return {
    language: runtime.providerLanguage,
    version: runtime.providerVersion,
    files: [
      {
        name: runtime.sourceFileName,
        content: request.sourceCode,
      },
    ],
    stdin: request.stdin,
    compile_timeout: Math.ceil(request.wallTimeLimitSeconds * 1000),
    run_timeout: Math.ceil(request.wallTimeLimitSeconds * 1000),
    compile_memory_limit: request.memoryLimitKb * 1024,
    run_memory_limit: request.memoryLimitKb * 1024,
  };
}

function normalizePistonResponse(body: unknown, outputLimitBytes: number): CodeExecutionResult {
  if (!isRecord(body) || !isRecord(body.run)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid response");
  }

  const run = parsePistonStage(body.run, "run");
  const compile = body.compile === undefined ? null : parsePistonStage(body.compile, "compile");
  const stdout = run.stdout;
  const stderr = run.stderr;
  const compileOutput = compile ? compile.output || compile.stderr || compile.stdout : null;
  const message = run.signal;
  const outputBytes = [stdout, stderr, compileOutput, message].reduce((totalBytes, value) => totalBytes + byteLength(value ?? ""), 0);

  if (outputBytes > outputLimitBytes) {
    throw new HttpError(502, "CODE_EXECUTION_OUTPUT_TOO_LARGE", "Code execution output exceeded the configured limit");
  }

  return {
    token: null,
    status: normalizePistonStatus(compile, run),
    stdout,
    stderr,
    compileOutput,
    message,
    timeSeconds: null,
    memoryKb: null,
  };
}

function normalizePistonStatus(compile: ParsedPistonStage | null, run: ParsedPistonStage) {
  if (compile && compile.code !== null && compile.code !== 0) {
    return {
      id: 6,
      description: "Compilation Error",
    };
  }

  if (run.signal) {
    return {
      id: 5,
      description: "Runtime Signal",
    };
  }

  if (run.code === 0) {
    return {
      id: 3,
      description: "Accepted",
    };
  }

  return {
    id: 11,
    description: "Runtime Error",
  };
}

interface ParsedPistonStage {
  stdout: string | null;
  stderr: string | null;
  output: string | null;
  code: number | null;
  signal: string | null;
}

function parsePistonStage(value: unknown, fieldName: string): ParsedPistonStage {
  if (!isRecord(value)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  const stage = value as PistonRunStage;
  return {
    stdout: parseOptionalString(stage.stdout, `${fieldName}.stdout`),
    stderr: parseOptionalString(stage.stderr, `${fieldName}.stderr`),
    output: parseOptionalString(stage.output, `${fieldName}.output`),
    code: parseOptionalNumber(stage.code, `${fieldName}.code`),
    signal: parseOptionalString(stage.signal, `${fieldName}.signal`),
  };
}

function parsePistonRuntime(value: unknown): ExecutionRuntime {
  if (!isRecord(value)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid runtime");
  }

  return {
    language: parseRequiredString(value.language, "runtime.language"),
    version: parseRequiredString(value.version, "runtime.version"),
    aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : [],
  };
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseOptionalString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

