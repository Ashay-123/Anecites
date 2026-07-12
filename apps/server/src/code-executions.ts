import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { Router } from "express";
import { type PrismaClient } from "@anecites/db";

import { type AuthenticatedPrincipal } from "./auth.js";
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
  sessionId: string | null;
  documentId: string | null;
  participantId: string | null;
}

interface CodeExecutionPersistenceContext {
  sessionId: string;
  documentId: string;
  participantId: string;
}

type CodeExecutionRouteLocals = {
  authenticatedPrincipal?: AuthenticatedPrincipal;
};

export function createCodeExecutionRouter(
  prisma: PrismaClient,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
) {
  const router = Router();
  const allowedLanguageIds = new Set(config.codeExecutionAllowedLanguageIds);
  const provider = createCodeExecutionProvider(config, fetchImpl);

  router.post("/", async (request, response, next) => {
    try {
      const submission = parseCodeExecutionRequest(request.body, config, allowedLanguageIds);
      const persistenceContext = await validatePersistenceContext(
        prisma,
        response.locals as CodeExecutionRouteLocals,
        submission,
      );
      const execution = await executeCode(config, provider, submission);
      if (persistenceContext) {
        await persistCodeSubmission(prisma, persistenceContext, submission, execution);
      }

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
    ...parseOptionalPersistenceFields(body),
  };
}

function parseOptionalPersistenceFields(body: Record<string, unknown>): {
  sessionId: string | null;
  documentId: string | null;
  participantId: string | null;
} {
  const sessionId = parseOptionalNonEmptyString(body.sessionId, "sessionId");
  const documentId = parseOptionalNonEmptyString(body.documentId, "documentId");
  const participantId = parseOptionalNonEmptyString(body.participantId, "participantId");
  const providedCount = [sessionId, documentId, participantId].filter((value) => value !== null).length;

  if (providedCount > 0 && providedCount < 3) {
    throw new HttpError(
      400,
      "INVALID_CODE_EXECUTION_REQUEST",
      "sessionId, documentId, and participantId must be provided together",
    );
  }

  return {
    sessionId,
    documentId,
    participantId,
  };
}

function parseOptionalNonEmptyString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", `${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

async function validatePersistenceContext(
  prisma: PrismaClient,
  locals: CodeExecutionRouteLocals,
  submission: CodeExecutionSubmission,
): Promise<CodeExecutionPersistenceContext | null> {
  if (!submission.sessionId || !submission.documentId || !submission.participantId) {
    return null;
  }

  const principal = locals.authenticatedPrincipal;
  if (!principal) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token");
  }

  const [document, participant] = await Promise.all([
    prisma.editorDocument.findFirst({
      where: {
        id: submission.documentId,
        sessionId: submission.sessionId,
      },
      select: {
        id: true,
      },
    }),
    prisma.participant.findFirst({
      where: {
        id: submission.participantId,
        sessionId: submission.sessionId,
        userId: principal.subject,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!document) {
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Editor document not found");
  }

  if (!participant) {
    throw new HttpError(403, "FORBIDDEN", "Participant does not belong to the authenticated user");
  }

  return {
    sessionId: submission.sessionId,
    documentId: submission.documentId,
    participantId: submission.participantId,
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

async function persistCodeSubmission(
  prisma: PrismaClient,
  context: CodeExecutionPersistenceContext,
  submission: CodeExecutionSubmission,
  execution: CodeExecutionResult,
): Promise<void> {
  await prisma.codeSubmission.create({
    data: {
      sessionId: context.sessionId,
      documentId: context.documentId,
      participantId: context.participantId,
      languageId: submission.languageId,
      sourceHashSha256: createHash("sha256").update(submission.sourceCode).digest("hex"),
      stdin: submission.stdin || null,
      stdout: execution.stdout,
      stderr: execution.stderr,
      status: toDatabaseSubmissionStatus(execution),
      judge0Token: execution.token,
      timeMs: execution.timeSeconds === null ? null : Math.round(execution.timeSeconds * 1000),
      memoryKb: execution.memoryKb,
    },
  });
}

function toDatabaseSubmissionStatus(execution: CodeExecutionResult) {
  switch (execution.status.id) {
    case 3:
      return "ACCEPTED";
    case 5:
      return "TIME_LIMIT_EXCEEDED";
    case 6:
      return "COMPILE_ERROR";
    case 11:
      return "RUNTIME_ERROR";
    case 13:
      return "INTERNAL_ERROR";
    default:
      if (/memory/i.test(execution.status.description)) {
        return "MEMORY_LIMIT_EXCEEDED";
      }
      if (/time/i.test(execution.status.description)) {
        return "TIME_LIMIT_EXCEEDED";
      }
      if (/compil/i.test(execution.status.description)) {
        return "COMPILE_ERROR";
      }
      if (/runtime|signal|error/i.test(execution.status.description)) {
        return "RUNTIME_ERROR";
      }
      return "INTERNAL_ERROR";
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
