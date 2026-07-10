import { Buffer } from "node:buffer";

import { Router } from "express";

import {
  createCodeExecutionProvider,
  type CodeExecutionResult,
  type FetchLike,
} from "./code-execution-provider.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

interface CodeExecutionSubmission {
  languageId: number;
  sourceCode: string;
  stdin: string;
}

export function createCodeExecutionRouter(config: ServerConfig, fetchImpl: FetchLike = fetch) {
  const router = Router();
  const allowedLanguageIds = new Set(config.codeExecutionAllowedLanguageIds);
  const provider = createCodeExecutionProvider(config, fetchImpl);

  router.post("/", async (request, response, next) => {
    try {
      const submission = parseCodeExecutionRequest(request.body, config, allowedLanguageIds);
      const execution = await executeCode(config, provider, submission);

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

async function executeCode(
  config: ServerConfig,
  provider: ReturnType<typeof createCodeExecutionProvider>,
  submission: CodeExecutionSubmission,
): Promise<CodeExecutionResult> {
  return provider.execute({
    languageId: submission.languageId,
    sourceCode: submission.sourceCode,
    stdin: submission.stdin,
    cpuTimeLimitSeconds: config.codeExecutionCpuTimeLimitSeconds,
    wallTimeLimitSeconds: config.codeExecutionWallTimeLimitSeconds,
    memoryLimitKb: config.codeExecutionMemoryLimitKb,
    stackLimitKb: config.codeExecutionStackLimitKb,
    outputLimitBytes: config.codeExecutionOutputLimitBytes,
  });
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
