import { Buffer } from "node:buffer";

import { Router } from "express";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

export type FetchLike = typeof fetch;

interface CodeExecutionSubmission {
  languageId: number;
  sourceCode: string;
  stdin: string;
}

interface NormalizedExecutionResult {
  token: string;
  status: {
    id: number;
    description: string;
  };
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
  timeSeconds: number | null;
  memoryKb: number | null;
}

export function createCodeExecutionRouter(config: ServerConfig, fetchImpl: FetchLike = fetch) {
  const router = Router();
  const allowedLanguageIds = new Set(config.judge0AllowedLanguageIds);

  router.post("/", async (request, response, next) => {
    try {
      const submission = parseCodeExecutionRequest(request.body, config, allowedLanguageIds);
      const execution = await submitToJudge0(config, fetchImpl, submission);

      response.status(201).json({ execution });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseCodeExecutionRequest(body: unknown, config: ServerConfig, allowedLanguageIds: ReadonlySet<number>): CodeExecutionSubmission {
  if (!isRecord(body)) {
    throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", "Code execution request body must be an object");
  }

  const languageId = body.languageId;
  if (typeof languageId !== "number" || !Number.isSafeInteger(languageId) || languageId < 1) {
    throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", "languageId must be a positive integer");
  }

  if (!allowedLanguageIds.has(languageId)) {
    throw new HttpError(400, "LANGUAGE_NOT_ALLOWED", "Language is not allowed for code execution");
  }

  if (typeof body.sourceCode !== "string" || body.sourceCode.length === 0) {
    throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", "sourceCode must be a non-empty string");
  }

  if (byteLength(body.sourceCode) > config.codeExecutionSourceLimitBytes) {
    throw new HttpError(400, "SOURCE_CODE_TOO_LARGE", "sourceCode exceeds the configured limit");
  }

  const stdin = body.stdin ?? "";
  if (typeof stdin !== "string") {
    throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", "stdin must be a string when provided");
  }

  if (byteLength(stdin) > config.codeExecutionStdinLimitBytes) {
    throw new HttpError(400, "STDIN_TOO_LARGE", "stdin exceeds the configured limit");
  }

  return {
    languageId,
    sourceCode: body.sourceCode,
    stdin,
  };
}

async function submitToJudge0(
  config: ServerConfig,
  fetchImpl: FetchLike,
  submission: CodeExecutionSubmission,
): Promise<NormalizedExecutionResult> {
  const url = new URL(`${config.judge0BaseUrl}/submissions`);
  url.searchParams.set("base64_encoded", "false");
  url.searchParams.set("wait", "true");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.judge0AuthHeader && config.judge0AuthToken) {
    headers[config.judge0AuthHeader] = config.judge0AuthToken;
  }

  if (config.judge0Provider === "remote" && config.judge0RapidApiHost) {
    headers["X-RapidAPI-Host"] = config.judge0RapidApiHost;
  }

  let judge0Response: Response;
  try {
    judge0Response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(createJudge0SubmissionPayload(config, submission)),
      signal: AbortSignal.timeout(config.judge0RequestTimeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new HttpError(504, "JUDGE0_TIMEOUT", "Code execution timed out");
    }

    throw new HttpError(502, "JUDGE0_UPSTREAM_ERROR", "Code execution service unreachable");
  }

  let responseBody: unknown;
  try {
    responseBody = await judge0Response.json();
  } catch {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", "Code execution service returned an invalid response");
  }

  if (!judge0Response.ok) {
    throw new HttpError(502, "JUDGE0_UPSTREAM_ERROR", "Code execution service failed");
  }

  return normalizeJudge0Response(responseBody, config);
}

function createJudge0SubmissionPayload(config: ServerConfig, submission: CodeExecutionSubmission) {
  return {
    source_code: submission.sourceCode,
    language_id: submission.languageId,
    stdin: submission.stdin,
    cpu_time_limit: config.codeExecutionCpuTimeLimitSeconds,
    cpu_extra_time: 0,
    wall_time_limit: config.codeExecutionWallTimeLimitSeconds,
    memory_limit: config.codeExecutionMemoryLimitKb,
    stack_limit: config.codeExecutionStackLimitKb,
    max_processes_and_or_threads: 32,
    enable_per_process_and_thread_time_limit: false,
    enable_per_process_and_thread_memory_limit: false,
    enable_network: false,
    max_file_size: Math.ceil(config.codeExecutionOutputLimitBytes / 1024),
    number_of_runs: 1,
  };
}

function normalizeJudge0Response(body: unknown, config: ServerConfig): NormalizedExecutionResult {
  if (!isRecord(body)) {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", "Code execution service returned an invalid response");
  }

  const token = parseRequiredString(body.token, "token");
  const stdout = parseNullableString(body.stdout, "stdout");
  const stderr = parseNullableString(body.stderr, "stderr");
  const compileOutput = parseNullableString(body.compile_output, "compile_output");
  const message = parseNullableString(body.message, "message");
  const outputBytes = [stdout, stderr, compileOutput, message].reduce((totalBytes, value) => totalBytes + byteLength(value ?? ""), 0);

  if (outputBytes > config.codeExecutionOutputLimitBytes) {
    throw new HttpError(502, "JUDGE0_OUTPUT_TOO_LARGE", "Code execution output exceeded the configured limit");
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
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", "Code execution service returned an invalid status");
  }

  const id = value.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", "Code execution service returned an invalid status id");
  }

  return {
    id,
    description: parseRequiredString(value.description, "status.description"),
  };
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return value;
}

function parseNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new HttpError(502, "JUDGE0_INVALID_RESPONSE", `Code execution service returned an invalid ${fieldName}`);
  }

  return parsed;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
