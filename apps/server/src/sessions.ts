import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient } from "@anecites/db";
import {
  isSessionState,
  isValidSessionTransition,
  type ParticipantRole,
  type SessionState,
} from "@anecites/shared";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import {
  createLiveKitJoinToken,
  startLiveKitRoomRecording,
  stopLiveKitRoomRecording,
  type LiveKitEgressClient,
} from "./livekit.js";

type SessionWithParticipants = Prisma.SessionGetPayload<{
  include: {
    participants: {
      include: {
        user: true;
      };
    };
  };
}>;

type ParticipantWithUser = Prisma.ParticipantGetPayload<{
  include: {
    user: true;
  };
}>;

const API_TO_DB_SESSION_STATE = {
  created: "CREATED",
  scheduled: "SCHEDULED",
  lobby: "LOBBY",
  active: "ACTIVE",
  ended: "ENDED",
  cancelled: "CANCELLED",
} as const satisfies Record<SessionState, string>;

const DB_TO_API_SESSION_STATE = {
  CREATED: "created",
  SCHEDULED: "scheduled",
  LOBBY: "lobby",
  ACTIVE: "active",
  ENDED: "ended",
  CANCELLED: "cancelled",
} as const;

const API_TO_DB_PARTICIPANT_ROLE = {
  candidate: "CANDIDATE",
  interviewer: "INTERVIEWER",
} as const satisfies Record<ParticipantRole, string>;

const DB_TO_API_PARTICIPANT_ROLE = {
  CANDIDATE: "candidate",
  INTERVIEWER: "interviewer",
} as const;

const API_ROLE_TO_DB_USER_ROLE = {
  candidate: "CANDIDATE",
  interviewer: "INTERVIEWER",
} as const satisfies Record<ParticipantRole, string>;

export function createSessionRouter(
  prisma: PrismaClient,
  config: ServerConfig,
  liveKitEgressClient?: LiveKitEgressClient,
): Router {
  const router = Router();

  router.post("/", async (request, response, next) => {
    try {
      const body = parseCreateSessionBody(request.body);
      const createdSession = await prisma.session.create({
        data: {
          title: body.title,
          ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}),
        },
      });
      const session = await findSessionOrThrow(prisma, createdSession.id);

      response.status(201).json({
        session: serializeSession(session),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sessionId", async (request, response, next) => {
    try {
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      response.status(200).json({
        session: serializeSession(session),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/participants", async (request, response, next) => {
    try {
      const body = parseJoinSessionBody(request.body);
      await ensureSessionExists(prisma, request.params.sessionId);

      const user = await prisma.user.upsert({
        where: {
          email: body.user.email,
        },
        create: {
          email: body.user.email,
          displayName: body.user.displayName,
          role: API_ROLE_TO_DB_USER_ROLE[body.role],
        },
        update: {
          displayName: body.user.displayName,
        },
      });

      const participant = await prisma.participant.upsert({
        where: {
          sessionId_userId_role: {
            sessionId: request.params.sessionId,
            userId: user.id,
            role: API_TO_DB_PARTICIPANT_ROLE[body.role],
          },
        },
        create: {
          sessionId: request.params.sessionId,
          userId: user.id,
          role: API_TO_DB_PARTICIPANT_ROLE[body.role],
          joinedAt: new Date(),
        },
        update: {
          joinedAt: new Date(),
          leftAt: null,
        },
        include: {
          user: true,
        },
      });

      response.status(201).json({
        participant: serializeParticipant(participant),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/livekit-token", async (request, response, next) => {
    try {
      const body = parseLiveKitTokenBody(request.body);
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      const participant = session.participants.find((candidate) => candidate.id === body.participantId && !candidate.leftAt);

      if (!participant) {
        throw new HttpError(404, "PARTICIPANT_NOT_FOUND", "Participant not found");
      }

      const livekit = await createLiveKitJoinToken(config, {
        sessionId: session.id,
        participantId: participant.id,
        participantName: participant.user.displayName,
      });

      response.status(201).json({
        livekit,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/livekit-recording", async (request, response, next) => {
    try {
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      const recording = await startLiveKitRoomRecording(
        config,
        {
          sessionId: session.id,
        },
        liveKitEgressClient,
      );

      response.status(201).json({
        recording,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/livekit-recording/:egressId/stop", async (request, response, next) => {
    try {
      await ensureSessionExists(prisma, request.params.sessionId);
      const egressId = requireParam(request.params.egressId, "egressId");
      const recording = await stopLiveKitRoomRecording(config, egressId, liveKitEgressClient);

      response.status(200).json({
        recording,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:sessionId/state", async (request, response, next) => {
    try {
      const requestedState = parseTransitionBody(request.body).state;
      const existingSession = await findSessionOrThrow(prisma, request.params.sessionId);
      const currentState = toApiSessionState(existingSession.state);

      if (!isValidSessionTransition(currentState, requestedState)) {
        throw new HttpError(
          409,
          "INVALID_SESSION_TRANSITION",
          `Cannot transition session from ${currentState} to ${requestedState}`,
        );
      }

      const session = await prisma.session.update({
        where: {
          id: request.params.sessionId,
        },
        data: transitionUpdateData(requestedState),
        include: sessionInclude,
      });

      response.status(200).json({
        session: serializeSession(session),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const sessionInclude = {
  participants: {
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

async function findSessionOrThrow(
  prisma: PrismaClient,
  sessionId: string | undefined,
): Promise<SessionWithParticipants> {
  if (!sessionId) {
    throw new HttpError(400, "BAD_REQUEST", "sessionId is required");
  }

  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    include: sessionInclude,
  });

  if (!session) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }

  return session;
}

async function ensureSessionExists(prisma: PrismaClient, sessionId: string | undefined): Promise<void> {
  await findSessionOrThrow(prisma, sessionId);
}

function parseCreateSessionBody(body: unknown) {
  const record = requireRecord(body);
  const title = requireNonEmptyString(record, "title");
  const scheduledAt = optionalDate(record, "scheduledAt");

  return {
    title,
    scheduledAt,
  };
}

function parseJoinSessionBody(body: unknown) {
  const record = requireRecord(body);
  const role = requireParticipantRole(record, "role");
  const user = requireRecord(record.user);
  const email = requireEmail(user, "email");
  const displayName = requireNonEmptyString(user, "displayName");

  return {
    role,
    user: {
      email,
      displayName,
    },
  };
}

function parseTransitionBody(body: unknown): { state: SessionState } {
  const record = requireRecord(body);
  const state = requireNonEmptyString(record, "state");

  if (!isSessionState(state)) {
    throw new HttpError(400, "BAD_REQUEST", "state must be a valid session state");
  }

  return {
    state,
  };
}

function parseLiveKitTokenBody(body: unknown): { participantId: string } {
  const record = requireRecord(body);
  const participantId = requireNonEmptyString(record, "participantId");

  return {
    participantId,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireParam(value: string | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} is required`);
  }

  return value.trim();
}

function requireEmail(record: Record<string, unknown>, fieldName: string): string {
  const value = requireNonEmptyString(record, fieldName).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a valid email address`);
  }
  return value;
}

function requireParticipantRole(record: Record<string, unknown>, fieldName: string): ParticipantRole {
  const value = requireNonEmptyString(record, fieldName);
  if (value !== "candidate" && value !== "interviewer") {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be candidate or interviewer`);
  }
  return value;
}

function optionalDate(record: Record<string, unknown>, fieldName: string): Date | undefined {
  const value = record[fieldName];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an ISO timestamp`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an ISO timestamp`);
  }

  return date;
}

function transitionUpdateData(state: SessionState) {
  const now = new Date();

  return {
    state: API_TO_DB_SESSION_STATE[state],
    ...(state === "active" ? { startedAt: now } : {}),
    ...(state === "ended" || state === "cancelled" ? { endedAt: now } : {}),
  };
}

function serializeSession(session: SessionWithParticipants) {
  return {
    id: session.id,
    title: session.title,
    state: toApiSessionState(session.state),
    scheduledAt: serializeDate(session.scheduledAt),
    startedAt: serializeDate(session.startedAt),
    endedAt: serializeDate(session.endedAt),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    participants: session.participants.map(serializeParticipant),
  };
}

function serializeParticipant(participant: ParticipantWithUser) {
  return {
    id: participant.id,
    role: toApiParticipantRole(participant.role),
    joinedAt: serializeDate(participant.joinedAt),
    leftAt: serializeDate(participant.leftAt),
    user: {
      id: participant.user.id,
      email: participant.user.email,
      displayName: participant.user.displayName,
      role: participant.user.role.toLowerCase(),
    },
  };
}

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toApiSessionState(state: keyof typeof DB_TO_API_SESSION_STATE): SessionState {
  return DB_TO_API_SESSION_STATE[state];
}

function toApiParticipantRole(state: keyof typeof DB_TO_API_PARTICIPANT_ROLE): ParticipantRole {
  return DB_TO_API_PARTICIPANT_ROLE[state];
}
