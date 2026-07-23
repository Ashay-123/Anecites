import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { Router } from "express";
import { Prisma, type PrismaClient } from "@anecites/db";

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
  executionMode: CodeExecutionMode;
  sessionId: string | null;
  documentId: string | null;
  participantId: string | null;
}

interface CodeExecutionPersistenceContext {
  sessionId: string;
  documentId: string;
  participantId: string;
  problem: CodeExecutionProblemContext | null;
}

type CodeExecutionMode = "run" | "submit";

interface CodeExecutionProblemContext {
  id: string;
  functionName: string;
  languageId: number;
  testcases: Array<{
    input: Prisma.JsonValue;
    expected: Prisma.JsonValue;
  }>;
}

type CodeExecutionRouteLocals = {
  authenticatedPrincipal?: AuthenticatedPrincipal;
};

interface CodeExecutionListQuery {
  sessionId: string;
  documentId: string | null;
  limit: number;
}

export function createCodeExecutionRouter(
  prisma: PrismaClient,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
) {
  const router = Router();
  const allowedLanguageIds = new Set(config.codeExecutionAllowedLanguageIds);
  const provider = createCodeExecutionProvider(config, fetchImpl);

  router.get("/", async (request, response, next) => {
    try {
      const query = parseCodeExecutionListQuery(request.query);
      await validateSubmissionListAccess(prisma, response.locals as CodeExecutionRouteLocals, query.sessionId);
      const submissions = await prisma.codeSubmission.findMany({
        where: {
          sessionId: query.sessionId,
          ...(query.documentId
            ? {
                documentId: query.documentId,
              }
            : {}),
        },
        orderBy: {
          createdAt: "desc",
        },
        take: query.limit,
        select: {
          id: true,
          sessionId: true,
          problemId: true,
          participantId: true,
          documentId: true,
          languageId: true,
          executionMode: true,
          status: true,
          stdout: true,
          stderr: true,
          timeMs: true,
          memoryKb: true,
          createdAt: true,
        },
      });

      response.status(200).json({
        submissions: submissions.map((submission) => ({
          id: submission.id,
          sessionId: submission.sessionId,
          problemId: submission.problemId,
          participantId: submission.participantId,
          documentId: submission.documentId,
          languageId: submission.languageId,
          executionMode: submission.executionMode === "SUBMIT" ? "submit" : "run",
          status: toSubmissionStatusLabel(submission.status),
          stdout: submission.stdout,
          stderr: submission.stderr,
          timeMs: submission.timeMs,
          memoryKb: submission.memoryKb,
          createdAt: submission.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const submission = parseCodeExecutionRequest(request.body, config, allowedLanguageIds);
      const persistenceContext = await validatePersistenceContext(
        prisma,
        response.locals as CodeExecutionRouteLocals,
        submission,
      );
      const executableSourceCode = createExecutableSourceCode(config, submission, persistenceContext);
      const execution = normalizeProblemSubmissionResult(
        submission,
        await executeCode(config, provider, submission, executableSourceCode),
      );
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

function parseCodeExecutionListQuery(query: Record<string, unknown>): CodeExecutionListQuery {
  const sessionId = parseRequiredQueryString(query.sessionId, "sessionId");
  const documentId = parseOptionalQueryString(query.documentId, "documentId");
  const limit = parseLimit(query.limit);

  return {
    sessionId,
    documentId,
    limit,
  };
}

function parseRequiredQueryString(value: unknown, fieldName: string): string {
  const normalized = parseOptionalQueryString(value, fieldName);

  if (!normalized) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} is required`);
  }

  return normalized;
}

function parseOptionalQueryString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return 20;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new HttpError(400, "BAD_REQUEST", "limit must be a positive integer");
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, "BAD_REQUEST", "limit must be between 1 and 50");
  }

  return limit;
}

async function validateSubmissionListAccess(
  prisma: PrismaClient,
  locals: CodeExecutionRouteLocals,
  sessionId: string,
): Promise<void> {
  const principal = locals.authenticatedPrincipal;
  if (!principal) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token");
  }

  const participant = await prisma.participant.findFirst({
    where: {
      sessionId,
      userId: principal.subject,
    },
    select: {
      id: true,
    },
  });

  if (!participant) {
    throw new HttpError(403, "FORBIDDEN", "Authenticated user is not part of this session");
  }
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
    executionMode: parseExecutionMode(body.executionMode),
    ...parseOptionalPersistenceFields(body),
  };
}

function parseExecutionMode(value: unknown): CodeExecutionMode {
  if (value === undefined || value === null) {
    return "run";
  }

  if (value === "run" || value === "submit") {
    return value;
  }

  throw new HttpError(400, "INVALID_CODE_EXECUTION_REQUEST", "executionMode must be one of: run, submit");
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

  const [document, participant, session] = await Promise.all([
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
    prisma.session.findUnique({
      where: {
        id: submission.sessionId,
      },
      select: {
        problem: {
          select: {
            id: true,
            functionName: true,
            languageId: true,
            testcases: {
              orderBy: {
                ordinal: "asc",
              },
              select: {
                input: true,
                expected: true,
              },
            },
          },
        },
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
    problem: session?.problem ?? null,
  };
}

function createExecutableSourceCode(
  config: ServerConfig,
  submission: CodeExecutionSubmission,
  context: CodeExecutionPersistenceContext | null,
): string {
  if (submission.executionMode === "run") {
    return submission.sourceCode;
  }

  if (!context) {
    throw new HttpError(
      400,
      "INVALID_CODE_EXECUTION_REQUEST",
      "Submitted code requires sessionId, documentId, and participantId",
    );
  }

  if (!context.problem) {
    throw new HttpError(400, "PROBLEM_NOT_CONFIGURED", "Submitted code requires an interview problem");
  }

  if (context.problem.languageId !== submission.languageId) {
    throw new HttpError(400, "LANGUAGE_NOT_ALLOWED", "Submitted code language does not match the interview problem");
  }

  if (submission.languageId !== 63) {
    throw new HttpError(400, "LANGUAGE_NOT_ALLOWED", "Submit judging is not available for this language");
  }

  const executableSourceCode = createJavaScriptProblemSubmissionSource(
    submission.sourceCode,
    context.problem.functionName,
    context.problem.testcases,
  );

  if (byteLength(executableSourceCode) > config.codeExecutionSourceLimitBytes) {
    throw new HttpError(400, "SOURCE_CODE_TOO_LARGE", "sourceCode exceeds the configured limit");
  }

  return executableSourceCode;
}

function createJavaScriptProblemSubmissionSource(
  sourceCode: string,
  functionName: string,
  testcases: CodeExecutionProblemContext["testcases"],
): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(functionName)) {
    throw new HttpError(500, "PROBLEM_INVALID", "Interview problem function name is invalid");
  }

  const normalizedTestcases = testcases.map((testcase) => {
    if (
      !isRecord(testcase.input) ||
      !isNumberArray(testcase.input.nums) ||
      typeof testcase.input.target !== "number" ||
      !isNumberArray(testcase.expected)
    ) {
      throw new HttpError(500, "PROBLEM_INVALID", "Interview problem testcases are invalid");
    }

    return {
      nums: testcase.input.nums,
      target: testcase.input.target,
      expected: testcase.expected,
    };
  });

  return `${sourceCode}

;(() => {
  const testcases = ${JSON.stringify(normalizedTestcases)};
  let candidateFunction = null;

  try {
    candidateFunction = eval(${JSON.stringify(functionName)});
  } catch {
    candidateFunction = null;
  }

  if (typeof candidateFunction !== "function") {
    throw new Error("Expected a ${functionName} function for the interview problem");
  }

  let failed = 0;
  for (let index = 0; index < testcases.length; index += 1) {
    const testcase = testcases[index];
    const actual = candidateFunction([...testcase.nums], testcase.target);
    const expected = testcase.expected;
    const passed = JSON.stringify(actual) === JSON.stringify(expected);

    if (passed) {
      console.log(\`Case \${index + 1}: passed\`);
    } else {
      failed += 1;
      console.error(\`Case \${index + 1}: expected \${JSON.stringify(expected)}, received \${JSON.stringify(actual)}\`);
    }
  }

  if (failed > 0) {
    console.error(\`ANECITES_SUBMIT:FAIL \${failed}/\${testcases.length}\`);
    process.exitCode = 1;
    return;
  }

  console.log("ANECITES_SUBMIT:PASS");
})();
`;
}

function normalizeProblemSubmissionResult(
  submission: CodeExecutionSubmission,
  execution: CodeExecutionResult,
): CodeExecutionResult {
  if (submission.executionMode !== "submit") {
    return execution;
  }

  const output = `${execution.stdout ?? ""}\n${execution.stderr ?? ""}`;
  if (output.includes("ANECITES_SUBMIT:PASS")) {
    return {
      ...execution,
      status: {
        id: 3,
        description: "Accepted",
      },
      message: "All interview problem testcases passed",
    };
  }

  if (output.includes("ANECITES_SUBMIT:FAIL")) {
    return {
      ...execution,
      status: {
        id: 4,
        description: "Wrong Answer",
      },
      message: "One or more interview problem testcases failed",
    };
  }

  return execution;
}

async function executeCode(
  config: ServerConfig,
  provider: ReturnType<typeof createCodeExecutionProvider>,
  submission: CodeExecutionSubmission,
  sourceCode: string,
): Promise<CodeExecutionResult> {
  return provider.execute({
    languageId: submission.languageId,
    sourceCode,
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
      problemId: context.problem?.id ?? null,
      documentId: context.documentId,
      participantId: context.participantId,
      languageId: submission.languageId,
      executionMode: submission.executionMode === "submit" ? "SUBMIT" : "RUN",
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
    case 4:
      return "WRONG_ANSWER";
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

function toSubmissionStatusLabel(status: string): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "RUNNING":
      return "Running";
    case "ACCEPTED":
      return "Accepted";
    case "WRONG_ANSWER":
      return "Wrong Answer";
    case "COMPILE_ERROR":
      return "Compile Error";
    case "RUNTIME_ERROR":
      return "Runtime Error";
    case "TIME_LIMIT_EXCEEDED":
      return "Time Limit Exceeded";
    case "MEMORY_LIMIT_EXCEEDED":
      return "Memory Limit Exceeded";
    case "INTERNAL_ERROR":
      return "Internal Error";
    default:
      return "Unknown";
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
