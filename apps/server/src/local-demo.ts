import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { Router } from "express";
import { type PrismaClient } from "@anecites/db";
import { localDemoProblem, localDemoStarterCode } from "@anecites/shared";

import { issueAuthToken, requireAuth, type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

const DEMO_MEETING_TTL_MS = 4 * 60 * 60 * 1_000;
const DEMO_TOKEN_TTL_SECONDS = DEMO_MEETING_TTL_MS / 1_000;
const DEMO_STORE_LIMIT = 100;
const DEMO_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEMO_CODE_PATTERN = /^\d{6}$/;
const DEMO_PASSWORD_PATTERN = /^[A-Z2-9]{8}$/;

interface LocalDemoMeetingRecord {
  code: string;
  passwordDigest: Buffer;
  sessionId: string;
  documentId: string;
  expiresAt: Date;
  codeEditorOpen: boolean;
}

interface LocalDemoJoinBody {
  code: string;
  password: string;
}

interface LocalDemoWorkspaceStateBody {
  sessionId: string;
  codeEditorOpen: boolean;
}

export function createLocalDemoRouter(prisma: PrismaClient, config: ServerConfig): Router {
  const router = Router();
  const meetings = new Map<string, LocalDemoMeetingRecord>();

  router.post("/meetings", async (_request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      enforceStoreLimit(meetings);

      const code = createUniqueMeetingCode(meetings);
      const password = createMeetingPassword();
      const expiresAt = new Date(Date.now() + DEMO_MEETING_TTL_MS);
      const hostUserId = randomUUID();
      const session = await prisma.session.create({
        data: {
          title: `Local demo ${code}`,
          editorDocuments: {
            create: {
              language: "javascript",
              initialContent: localDemoStarterCode,
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
        documentId: document.id,
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
        },
        connection: {
          sessionId: session.id,
          documentId: document.id,
          participantId: participant.id,
          authToken,
          role: "interviewer",
          languageId: 63,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/join", async (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const body = parseJoinBody(request.body);
      const meeting = meetings.get(body.code);

      if (!meeting || !passwordMatches(body.password, meeting.passwordDigest)) {
        throw new HttpError(401, "LOCAL_DEMO_ACCESS_DENIED", "Meeting code or password is incorrect");
      }

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
          documentId: meeting.documentId,
          participantId: participant.id,
          authToken,
          role: "candidate",
          languageId: 63,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meetings/state", requireAuth(config), (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const sessionId = parseSessionIdQuery(request.query.sessionId);
      const meeting = findMeetingBySessionId(meetings, sessionId);

      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }

      response.status(200).json({
        state: {
          codeEditorOpen: meeting.codeEditorOpen,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meetings/problem", requireAuth(config), (request, response, next) => {
    try {
      removeExpiredMeetings(meetings);
      const sessionId = parseSessionIdQuery(request.query.sessionId);
      const meeting = findMeetingBySessionId(meetings, sessionId);

      if (!meeting) {
        throw new HttpError(404, "LOCAL_DEMO_NOT_FOUND", "Local demo meeting was not found");
      }

      response.status(200).json({
        problem: localDemoProblem,
        starterCode: localDemoStarterCode,
        languageId: 63,
        documentId: meeting.documentId,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/meetings/state", requireAuth(config), (request, response, next) => {
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

      meeting.codeEditorOpen = body.codeEditorOpen;

      response.status(200).json({
        state: {
          codeEditorOpen: meeting.codeEditorOpen,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
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
