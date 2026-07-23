import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { Router, type RequestHandler } from "express";
import { Prisma, type PrismaClient } from "@anecites/db";
import {
  type LocalDemoProblem,
  type LocalDemoProblemExample,
  type LocalDemoProblemTestcase,
} from "@anecites/shared";

import { issueAuthToken, requireAuth, type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import { assertSessionAllowsParticipantJoin } from "./recording-lifecycle.js";
import {
  defaultLocalDemoProblemSlug,
  localDemoProblemSeeds,
  type LocalDemoProblemSeed,
  type LocalDemoProblemSeedTestcase,
} from "./local-demo-problems.js";

const DEMO_MEETING_TTL_MS = 4 * 60 * 60 * 1_000;
const DEMO_TOKEN_TTL_SECONDS = DEMO_MEETING_TTL_MS / 1_000;
const DEMO_STORE_LIMIT = 100;
const DEMO_EDITOR_DOCUMENT_LIMIT = 10;
const DEMO_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEMO_CODE_PATTERN = /^\d{6}$/;
const DEMO_PASSWORD_PATTERN = /^[A-Z2-9]{8}$/;
const DEMO_RATE_LIMIT_WINDOW_MS = 60_000;
const DEMO_HOST_RATE_LIMIT = 10;
const DEMO_JOIN_RATE_LIMIT = 30;
const DEMO_RATE_LIMIT_BUCKET_CAPACITY = 1_000;

interface LocalDemoMeetingRecord {
  code: string;
  passwordDigest: Buffer;
  sessionId: string;
  activeDocumentId: string;
  languageId: number;
  expiresAt: Date;
  codeEditorOpen: boolean;
}

interface LocalDemoHostBody {
  problemSlug: string;
}

interface LocalDemoJoinBody {
  code: string;
  password: string;
}

interface LocalDemoWorkspaceStateBody {
  sessionId: string;
  codeEditorOpen: boolean;
}

interface LocalDemoDocumentBody {
  sessionId: string;
}

interface LocalDemoActiveDocumentBody extends LocalDemoDocumentBody {
  documentId: string;
}

export function createLocalDemoRouter(prisma: PrismaClient, config: ServerConfig): Router {
  const router = Router();
  const meetings = new Map<string, LocalDemoMeetingRecord>();
  const hostRateLimit = createFixedWindowRateLimit(DEMO_HOST_RATE_LIMIT);
  const joinRateLimit = createFixedWindowRateLimit(DEMO_JOIN_RATE_LIMIT);

  router.get("/problems", async (_request, response, next) => {
    try {
      const problems = await ensureLocalDemoProblems(prisma);

      response.status(200).json({
        problems: problems.map((problem) => ({
          slug: problem.slug,
          title: problem.title,
          difficulty: problem.difficulty,
          languageId: problem.languageId,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings", hostRateLimit, async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      enforceStoreLimit(meetings);

      const body = parseHostBody(request.body);
      const problems = await ensureLocalDemoProblems(prisma);
      const problem = findSeededProblem(problems, body.problemSlug);
      const code = createUniqueMeetingCode(meetings);
      const password = createMeetingPassword();
      const expiresAt = new Date(Date.now() + DEMO_MEETING_TTL_MS);
      const hostUserId = randomUUID();
      const session = await prisma.session.create({
        data: {
          title: `Local demo ${code}`,
          problem: {
            connect: {
              id: problem.id,
            },
          },
          editorDocuments: {
            create: {
              language: "javascript",
              initialContent: problem.starterCode,
            },
          },
          participants: {
            create: {
              role: "INTERVIEWER",
              joinedAt: new Date(),
              user: {
                create: {
                  id: hostUserId,
                  email: `demo-interviewer-${hostUserId}@local.invalid`,
                  displayName: "Demo interviewer",
                  role: "INTERVIEWER",
                },
              },
            },
          },
        },
        include: {
          editorDocuments: true,
          participants: true,
        },
      });
      const document = session.editorDocuments[0];
      const participant = session.participants[0];

      if (!document || !participant) {
        throw new Error("Local demo bootstrap records were not created");
      }

      meetings.set(code, {
        code,
        passwordDigest: digestPassword(password),
        sessionId: session.id,
        activeDocumentId: document.id,
        languageId: problem.languageId,
        expiresAt,
        codeEditorOpen: false,
      });

      const authToken = await issueAuthToken(
        config,
        {
          subject: hostUserId,
          role: "interviewer",
        },
        DEMO_TOKEN_TTL_SECONDS,
      );

      response.status(201).json({
        meeting: {
          code,
          password,
          expiresAt: expiresAt.toISOString(),
          joinUrl: createPublicJoinUrl(config.localDemoPublicBaseUrl, code),
        },
        connection: {
          sessionId: session.id,
          documentId: document.id,
          participantId: participant.id,
          authToken,
          role: "interviewer",
          languageId: problem.languageId,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/join", joinRateLimit, async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const body = parseJoinBody(request.body);
      const meeting = meetings.get(body.code);

      if (!meeting || !passwordMatches(body.password, meeting.passwordDigest)) {
        throw new HttpError(401, "LOCAL_DEMO_ACCESS_DENIED", "Meeting code or password is incorrect");
      }

      await assertSessionAllowsParticipantJoin(prisma, meeting.sessionId);

      const candidateUserId = randomUUID();
      const participant = await prisma.participant.create({
        data: {
          role: "CANDIDATE",
          joinedAt: new Date(),
          session: {
            connect: {
              id: meeting.sessionId,
            },
          },
          user: {
            create: {
              id: candidateUserId,
              email: `demo-candidate-${candidateUserId}@local.invalid`,
              displayName: "Demo candidate",
              role: "CANDIDATE" as const,
            },
          },
        },
      });
      const authToken = await issueAuthToken(
        config,
        {
          subject: candidateUserId,
          role: "candidate",
        },
        DEMO_TOKEN_TTL_SECONDS,
      );

      response.status(201).json({
        connection: {
          sessionId: meeting.sessionId,
          documentId: meeting.activeDocumentId,
          participantId: participant.id,
          authToken,
          role: "candidate",
          languageId: meeting.languageId,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meetings/state", requireAuth(config), async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const sessionId = parseSessionIdQuery(request.query.sessionId);
      const meeting = findMeetingBySessionId(meetings, sessionId);

      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }

      await requireActiveMeetingParticipant(prisma, response.locals.authenticatedPrincipal, meeting.sessionId);

      response.status(200).json({
        state: await serializeWorkspaceState(prisma, meeting),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meetings/problem", requireAuth(config), async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const sessionId = parseSessionIdQuery(request.query.sessionId);
      const meeting = findMeetingBySessionId(meetings, sessionId);

      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }

      const session = await prisma.session.findUnique({
        where: {
          id: meeting.sessionId,
        },
        select: {
          problem: {
            include: {
              testcases: {
                where: {
                  hidden: false,
                },
                orderBy: {
                  ordinal: "asc",
                },
              },
            },
          },
        },
      });

      if (!session?.problem) {
        throw new HttpError(404, "LOCAL_DEMO_PROBLEM_NOT_FOUND", "Local demo problem was not found");
      }

      response.status(200).json({
        problem: toLocalDemoProblem(session.problem),
        starterCode: session.problem.starterCode,
        languageId: session.problem.languageId,
        documentId: meeting.activeDocumentId,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/meetings/state", requireAuth(config), async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const principal = response.locals.authenticatedPrincipal as AuthenticatedPrincipal | undefined;

      if (principal?.role !== "interviewer") {
        throw new HttpError(403, "FORBIDDEN", "Only the interviewer can update local demo workspace state");
      }

      const body = parseWorkspaceStateBody(request.body);
      const meeting = findMeetingBySessionId(meetings, body.sessionId);

      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }

      await requireActiveMeetingParticipant(prisma, principal, meeting.sessionId);

      meeting.codeEditorOpen = body.codeEditorOpen;

      response.status(200).json({
        state: await serializeWorkspaceState(prisma, meeting),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/documents", requireAuth(config), async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const body = parseDocumentBody(request.body);
      const meeting = findMeetingBySessionId(meetings, body.sessionId);
      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }
      await requireActiveMeetingParticipant(
        prisma,
        response.locals.authenticatedPrincipal,
        meeting.sessionId,
      );

      const documentCount = await prisma.editorDocument.count({
        where: { sessionId: meeting.sessionId },
      });
      if (documentCount >= DEMO_EDITOR_DOCUMENT_LIMIT) {
        throw new HttpError(
          409,
          "LOCAL_DEMO_DOCUMENT_LIMIT",
          `Local demo cannot contain more than ${DEMO_EDITOR_DOCUMENT_LIMIT} editor tabs`,
        );
      }

      const document = await prisma.editorDocument.create({
        data: {
          sessionId: meeting.sessionId,
          language: meeting.languageId === 71 ? "python" : "javascript",
          initialContent: "",
        },
      });
      meeting.activeDocumentId = document.id;

      response.status(201).json({
        state: await serializeWorkspaceState(prisma, meeting),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/meetings/documents/active", requireAuth(config), async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const body = parseActiveDocumentBody(request.body);
      const meeting = findMeetingBySessionId(meetings, body.sessionId);
      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }
      await requireActiveMeetingParticipant(
        prisma,
        response.locals.authenticatedPrincipal,
        meeting.sessionId,
      );

      const document = await prisma.editorDocument.findFirst({
        where: {
          id: body.documentId,
          sessionId: meeting.sessionId,
        },
        select: { id: true },
      });
      if (!document) {
        throw new HttpError(404, "LOCAL_DEMO_DOCUMENT_NOT_FOUND", "Editor tab was not found");
      }
      meeting.activeDocumentId = document.id;

      response.status(200).json({
        state: await serializeWorkspaceState(prisma, meeting),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

function createFixedWindowRateLimit(limit: number): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();

  return (request, response, next) => {
    const now = Date.now();
    pruneExpiredRateLimitBuckets(buckets, now);
    const key = readRateLimitKey(request.header("cf-connecting-ip"), request.socket.remoteAddress);
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + DEMO_RATE_LIMIT_WINDOW_MS };

    if (bucket.count >= limit) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))));
      response.status(429).json({
        error: {
          code: "LOCAL_DEMO_RATE_LIMITED",
          message: "Too many local demo requests. Try again shortly.",
        },
      });
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    next();
  };
}

function pruneExpiredRateLimitBuckets(buckets: Map<string, RateLimitBucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size < DEMO_RATE_LIMIT_BUCKET_CAPACITY) {
    return;
  }

  const oldestKey = buckets.keys().next().value;
  if (typeof oldestKey === "string") {
    buckets.delete(oldestKey);
  }
}

function readRateLimitKey(cloudflareAddress: string | undefined, remoteAddress: string | undefined): string {
  const candidate = cloudflareAddress?.split(",", 1)[0]?.trim() || remoteAddress?.trim() || "unknown";
  return candidate.slice(0, 128);
}

function createPublicJoinUrl(publicBaseUrl: string | null, code: string): string | null {
  if (!publicBaseUrl) {
    return null;
  }

  const url = new URL(publicBaseUrl);
  url.hash = `join?${new URLSearchParams({ code }).toString()}`;
  return url.toString();
}

async function ensureLocalDemoProblems(prisma: PrismaClient) {
  const problems = await Promise.all(localDemoProblemSeeds.map((seed) => ensureLocalDemoProblem(prisma, seed)));

  return problems;
}

async function ensureLocalDemoProblem(prisma: PrismaClient, seed: LocalDemoProblemSeed) {
  assertSafeFunctionName(seed.functionName);
  const problem = await prisma.interviewProblem.upsert({
    where: {
      slug: seed.slug,
    },
    update: {
      title: seed.title,
      difficulty: seed.difficulty,
      prompt: seed.prompt,
      starterCode: seed.starterCode,
      functionName: seed.functionName,
      languageId: seed.languageId,
      examples: toProblemExamplesJson(seed.examples),
      constraints: toStringJsonArray(seed.constraints),
    },
    create: {
      slug: seed.slug,
      title: seed.title,
      difficulty: seed.difficulty,
      prompt: seed.prompt,
      starterCode: seed.starterCode,
      functionName: seed.functionName,
      languageId: seed.languageId,
      examples: toProblemExamplesJson(seed.examples),
      constraints: toStringJsonArray(seed.constraints),
    },
    select: {
      id: true,
      slug: true,
      title: true,
      difficulty: true,
      starterCode: true,
      functionName: true,
      languageId: true,
    },
  });

  await Promise.all(seed.testcases.map((testcase, index) => upsertLocalDemoTestcase(prisma, problem.id, testcase, index)));

  await prisma.interviewProblemTestcase.deleteMany({
    where: {
      problemId: problem.id,
      ordinal: {
        gt: seed.testcases.length,
      },
    },
  });

  return problem;
}

async function upsertLocalDemoTestcase(
  prisma: PrismaClient,
  problemId: string,
  testcase: LocalDemoProblemSeedTestcase,
  index: number,
): Promise<void> {
  await prisma.interviewProblemTestcase.upsert({
    where: {
      problemId_ordinal: {
        problemId,
        ordinal: index + 1,
      },
    },
    update: {
      input: toTestcaseInput(testcase),
      expected: testcase.expected,
      hidden: testcase.hidden ?? false,
    },
    create: {
      problemId,
      ordinal: index + 1,
      input: toTestcaseInput(testcase),
      expected: testcase.expected,
      hidden: testcase.hidden ?? false,
    },
  });
}

function findSeededProblem(
  problems: readonly Awaited<ReturnType<typeof ensureLocalDemoProblem>>[],
  slug: string,
) {
  const problem = problems.find((candidate) => candidate.slug === slug);

  if (!problem) {
    throw new HttpError(400, "LOCAL_DEMO_PROBLEM_NOT_FOUND", "Selected local demo problem was not found");
  }

  return problem;
}

function toTestcaseInput(testcase: LocalDemoProblemSeedTestcase): Prisma.InputJsonObject {
  return {
    nums: testcase.nums,
    target: testcase.target,
  };
}

function toProblemExamplesJson(examples: readonly LocalDemoProblemExample[]): Prisma.InputJsonArray {
  return examples.map((example) => ({
    input: example.input,
    output: example.output,
  }));
}

function toStringJsonArray(values: readonly string[]): Prisma.InputJsonArray {
  return values.map((value) => value);
}

function assertSafeFunctionName(functionName: string): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(functionName)) {
    throw new Error("Local demo problem function name is invalid");
  }
}

function toLocalDemoProblem(problem: {
  title: string;
  difficulty: string;
  prompt: string;
  examples: Prisma.JsonValue;
  constraints: Prisma.JsonValue;
  testcases: Array<{
    input: Prisma.JsonValue;
    expected: Prisma.JsonValue;
  }>;
}): LocalDemoProblem {
  return {
    title: problem.title,
    difficulty: problem.difficulty,
    prompt: problem.prompt,
    examples: parseProblemExamples(problem.examples),
    constraints: parseStringArray(problem.constraints, "constraints"),
    testcases: problem.testcases.map(parseProblemTestcase),
  };
}

function parseProblemExamples(value: Prisma.JsonValue): LocalDemoProblemExample[] {
  if (!Array.isArray(value)) {
    throw new Error("Local demo problem examples are invalid");
  }

  return value.map((example) => {
    if (!isRecord(example) || typeof example.input !== "string" || typeof example.output !== "string") {
      throw new Error("Local demo problem examples are invalid");
    }

    return {
      input: example.input,
      output: example.output,
    };
  });
}

function parseProblemTestcase(testcase: {
  input: Prisma.JsonValue;
  expected: Prisma.JsonValue;
}): LocalDemoProblemTestcase {
  if (
    !isRecord(testcase.input) ||
    !isNumberArray(testcase.input.nums) ||
    typeof testcase.input.target !== "number" ||
    !isNumberArray(testcase.expected)
  ) {
    throw new Error("Local demo problem testcases are invalid");
  }

  return {
    nums: testcase.input.nums,
    target: testcase.input.target,
    expected: testcase.expected,
  };
}

function parseStringArray(value: Prisma.JsonValue, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Local demo problem ${fieldName} are invalid`);
  }

  return value.map((item) => String(item));
}

function parseSessionIdQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "sessionId is required");
  }

  return value.trim();
}

function parseWorkspaceStateBody(value: unknown): LocalDemoWorkspaceStateBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "sessionId and codeEditorOpen are required");
  }

  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const codeEditorOpen = record.codeEditorOpen;

  if (!sessionId || typeof codeEditorOpen !== "boolean") {
    throw new HttpError(400, "BAD_REQUEST", "sessionId and codeEditorOpen are required");
  }

  return {
    sessionId,
    codeEditorOpen,
  };
}

function parseDocumentBody(value: unknown): LocalDemoDocumentBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "sessionId is required");
  }
  const sessionId = typeof (value as Record<string, unknown>).sessionId === "string"
    ? String((value as Record<string, unknown>).sessionId).trim()
    : "";
  if (!sessionId) {
    throw new HttpError(400, "BAD_REQUEST", "sessionId is required");
  }
  return { sessionId };
}

function parseActiveDocumentBody(value: unknown): LocalDemoActiveDocumentBody {
  const body = parseDocumentBody(value);
  const documentId = typeof (value as Record<string, unknown>).documentId === "string"
    ? String((value as Record<string, unknown>).documentId).trim()
    : "";
  if (!documentId) {
    throw new HttpError(400, "BAD_REQUEST", "documentId is required");
  }
  return { ...body, documentId };
}

async function requireActiveMeetingParticipant(
  prisma: PrismaClient,
  principalValue: unknown,
  sessionId: string,
): Promise<void> {
  const principal = principalValue as AuthenticatedPrincipal | undefined;
  if (!principal) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token");
  }
  const participant = await prisma.participant.findFirst({
    where: {
      sessionId,
      userId: principal.subject,
      leftAt: null,
    },
    select: { id: true },
  });
  if (!participant) {
    throw new HttpError(403, "FORBIDDEN", "Participant cannot access this local demo meeting");
  }
}

async function serializeWorkspaceState(
  prisma: PrismaClient,
  meeting: LocalDemoMeetingRecord,
) {
  const documents = await prisma.editorDocument.findMany({
    where: { sessionId: meeting.sessionId },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: { id: true },
  });
  if (!documents.some((document) => document.id === meeting.activeDocumentId)) {
    throw new HttpError(409, "LOCAL_DEMO_DOCUMENT_NOT_FOUND", "Active editor tab was not found");
  }
  return {
    codeEditorOpen: meeting.codeEditorOpen,
    activeDocumentId: meeting.activeDocumentId,
    documents: documents.map((document, index) => ({
      id: document.id,
      label: `Solution ${index + 1}`,
    })),
  };
}

function findMeetingBySessionId(
  meetings: ReadonlyMap<string, LocalDemoMeetingRecord>,
  sessionId: string,
): LocalDemoMeetingRecord | null {
  for (const meeting of meetings.values()) {
    if (meeting.sessionId === sessionId) {
      return meeting;
    }
  }

  return null;
}

function parseHostBody(value: unknown): LocalDemoHostBody {
  if (value === undefined || value === null) {
    return {
      problemSlug: defaultLocalDemoProblemSlug,
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Host request body is invalid");
  }

  const record = value as Record<string, unknown>;
  const problemSlug = record.problemSlug;

  if (problemSlug === undefined || problemSlug === null || problemSlug === "") {
    return {
      problemSlug: defaultLocalDemoProblemSlug,
    };
  }

  if (typeof problemSlug !== "string" || problemSlug.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "problemSlug must be a non-empty string");
  }

  return {
    problemSlug: problemSlug.trim(),
  };
}

function parseJoinBody(value: unknown): LocalDemoJoinBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Meeting code and password are required");
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const password = typeof record.password === "string" ? record.password.trim().toUpperCase() : "";

  if (!DEMO_CODE_PATTERN.test(code) || !DEMO_PASSWORD_PATTERN.test(password)) {
    throw new HttpError(400, "BAD_REQUEST", "Meeting code and password are invalid");
  }

  return { code, password };
}

function createUniqueMeetingCode(meetings: ReadonlyMap<string, LocalDemoMeetingRecord>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(randomInt(100_000, 1_000_000));
    if (!meetings.has(code)) {
      return code;
    }
  }

  throw new Error("Unable to allocate a local demo meeting code");
}

function createMeetingPassword(): string {
  let password = "";
  for (let index = 0; index < 8; index += 1) {
    password += DEMO_PASSWORD_ALPHABET.charAt(randomInt(0, DEMO_PASSWORD_ALPHABET.length));
  }
  return password;
}

function digestPassword(password: string): Buffer {
  return createHash("sha256").update(password).digest();
}

function passwordMatches(password: string, expectedDigest: Buffer): boolean {
  const actualDigest = digestPassword(password);
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

function removeExpiredMeetings(meetings: Map<string, LocalDemoMeetingRecord>): void {
  const now = Date.now();
  for (const [code, meeting] of meetings) {
    if (meeting.expiresAt.getTime() <= now) {
      meetings.delete(code);
    }
  }
}

function enforceStoreLimit(meetings: Map<string, LocalDemoMeetingRecord>): void {
  while (meetings.size >= DEMO_STORE_LIMIT) {
    const oldestCode = meetings.keys().next().value as string | undefined;
    if (!oldestCode) {
      return;
    }
    meetings.delete(oldestCode);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
