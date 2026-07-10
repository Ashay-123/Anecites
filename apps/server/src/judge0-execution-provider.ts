import { Buffer } from "node:buffer";

import {
  type CodeExecutionProvider,
  type CodeExecutionRequest,
  type CodeExecutionResult,
  type ExecutionProviderHealth,
  type ExecutionRuntime,
  type FetchLike,
} from "./code-execution-provider.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

export class Judge0ExecutionProvider implements CodeExecutionProvider {
  constructor(
    private readonly config: ServerConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async healthCheck(): Promise<ExecutionProviderHealth> {
    const response = await this.fetchImpl(new URL(`${this.config.judge0BaseUrl}/about`), {
      headers: this.createHeaders(),
      signal: AbortSignal.timeout(this.config.judge0RequestTimeoutMs),
    });

    return {
      ok: response.ok,
      provider: "judge0",
    };
  }

  async listRuntimes(): Promise<ExecutionRuntime[]> {
    const response = await this.fetchImpl(new URL(`${this.config.judge0BaseUrl}/languages`), {
      headers: this.createHeaders(),
      signal: AbortSignal.timeout(this.config.judge0RequestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpError(502, "CODE_EXECUTION_UPSTREAM_ERROR", "Code execution service failed");
    }

    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid response");
    }

    return body
      .filter((runtime): runtime is { name: string } => isRecord(runtime) && typeof runtime.name === "string")
      .map((runtime) => ({
        language: runtime.name,
        version: "",
        aliases: [],
      }));
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const url = new URL(`${this.config.judge0BaseUrl}/submissions`);
    url.searchParams.set("base64_encoded", "false");
    url.searchParams.set("wait", "true");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify(createJudge0SubmissionPayload(request)),
        signal: AbortSignal.timeout(this.config.judge0RequestTimeoutMs),
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

    return normalizeJudge0Response(responseBody, request.outputLimitBytes);
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.judge0AuthHeader && this.config.judge0AuthToken) {
      headers[this.config.judge0AuthHeader] = this.config.judge0AuthToken;
    }

    return headers;
  }
}

function createJudge0SubmissionPayload(request: CodeExecutionRequest) {
  return {
    source_code: request.sourceCode,
    language_id: request.languageId,
    stdin: request.stdin,
    cpu_time_limit: request.cpuTimeLimitSeconds,
    cpu_extra_time: 0,
    wall_time_limit: request.wallTimeLimitSeconds,
    memory_limit: request.memoryLimitKb,
    stack_limit: request.stackLimitKb,
    max_processes_and_or_threads: 32,
    enable_per_process_and_thread_time_limit: false,
    enable_per_process_and_thread_memory_limit: false,
    enable_network: false,
    max_file_size: Math.ceil(request.outputLimitBytes / 1024),
    number_of_runs: 1,
  };
}

function normalizeJudge0Response(body: unknown, outputLimitBytes: number): CodeExecutionResult {
  if (!isRecord(body)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid response");
  }

  const token = parseRequiredString(body.token, "token");
  const stdout = parseNullableString(body.stdout, "stdout");
  const stderr = parseNullableString(body.stderr, "stderr");
  const compileOutput = parseNullableString(body.compile_output, "compile_output");
  const message = parseNullableString(body.message, "message");
  const outputBytes = [stdout, stderr, compileOutput, message].reduce((totalBytes, value) => totalBytes + byteLength(value ?? ""), 0);

  if (outputBytes > outputLimitBytes) {
    throw new HttpError(502, "CODE_EXECUTION_OUTPUT_TOO_LARGE", "Code execution output exceeded the configured limit");
  }

  return {
    token,
    status: parseStatus(body.status),
    stdout,
    stderr,
    compileOutput,
    message,
    timeSeconds: parseNullableNumber(body.time, "time"),
    memoryKb: parseNullableNumber(body.memory, "memory"),
  };
}

function parseStatus(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid status");
  }

  const id = value.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", "Code execution service returned an invalid status id");
  }

  return {
    id,
    description: parseRequiredString(value.description, "status.description"),
  };
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new HttpError(502, "CODE_EXECUTION_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return parsed;
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

