import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient } from "@anecites/db";
import {
  createNativeRiskSignals,
  isPrivilegedUserRole,
  isSessionState,
  isValidSessionTransition,
  type NativeCaptureAffinityReport,
  type NativeRiskSignalReport,
  type NativeVirtualizationReport,
  type NativeVirtualizationSignal,
  type ParticipantRole,
  type SessionState,
} from "@anecites/shared";

import { type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import {
  createLiveKitJoinToken,
  startLiveKitRoomRecording,
  stopLiveKitRoomRecording,
  type LiveKitEgressClient,
} from "./livekit.js";
import {
  createRiskSummary,
  isRiskSummaryReviewStatus,
  listRiskSummaries,
  RISK_SUMMARY_REVIEW_STATUSES,
  type RiskSummaryReviewStatus,
  updateRiskSummaryReview,
} from "./risk-summaries.js";

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

type SessionRouteLocals = {
  authenticatedPrincipal?: AuthenticatedPrincipal;
};

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

  router.get("/:sessionId/risk-summaries", async (request, response, next) => {
    try {
      requireReviewerAccess(response);
      const reviewStatus = parseOptionalReviewStatus(request.query.reviewStatus);
      const riskSummaries = await listRiskSummaries(prisma, {
        sessionId: requireParam(request.params.sessionId, "sessionId"),
        ...(reviewStatus ? { reviewStatus } : {}),
      });

      response.status(200).json({
        riskSummaries,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:sessionId/risk-summaries/:riskSummaryId/review", async (request, response, next) => {
    try {
      const principal = requireReviewerAccess(response);
      const body = parseRiskSummaryReviewBody(request.body);
      const riskSummary = await updateRiskSummaryReview(prisma, {
        sessionId: requireParam(request.params.sessionId, "sessionId"),
        riskSummaryId: requireParam(request.params.riskSummaryId, "riskSummaryId"),
        reviewerId: principal.subject,
        reviewStatus: body.reviewStatus,
      });

      response.status(200).json({
        riskSummary,
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
      const evidenceObject = await createRecordingEvidenceObject(prisma, config, {
        sessionId: session.id,
        recording,
      });

      response.status(201).json({
        recording: {
          ...recording,
          evidenceObjectId: evidenceObject.id,
          storageKey: evidenceObject.storageKey,
        },
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

  router.post("/:sessionId/native-risk-report", async (request, response, next) => {
    try {
      const body = parseNativeRiskReportBody(request.body);
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      const participant = session.participants.find((candidate) => candidate.id === body.participantId && !candidate.leftAt);

      if (!participant) {
        throw new HttpError(404, "PARTICIPANT_NOT_FOUND", "Participant not found");
      }

      const signals = createNativeRiskSignals(body.nativeReport);

      if (signals.length === 0) {
        response.status(202).json({
          signalCount: 0,
          riskSummary: null,
        });
        return;
      }

      const riskSummary = await createRiskSummary(prisma, {
        sessionId: session.id,
        windowStartedAt: body.windowStartedAt,
        windowEndedAt: body.windowEndedAt,
        signals,
        rationale: "Native monitoring snapshot",
      });

      response.status(201).json({
        signalCount: signals.length,
        riskSummary,
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

function parseNativeRiskReportBody(body: unknown): {
  participantId: string;
  windowStartedAt: string;
  windowEndedAt: string;
  nativeReport: NativeRiskSignalReport;
} {
  const record = requireRecord(body);
  const participantId = requireNonEmptyString(record, "participantId");
  const windowStartedAt = requireIsoTimestamp(record, "windowStartedAt");
  const windowEndedAt = requireIsoTimestamp(record, "windowEndedAt");
  const nativeReport = parseNativeRiskSignalReport(record.nativeReport);

  return {
    participantId,
    windowStartedAt,
    windowEndedAt,
    nativeReport,
  };
}

function parseRiskSummaryReviewBody(body: unknown): { reviewStatus: RiskSummaryReviewStatus } {
  const record = requireRecord(body);

  return {
    reviewStatus: parseRequiredReviewStatus(record.reviewStatus),
  };
}

function requireReviewerAccess(response: Response): AuthenticatedPrincipal {
  const principal = (response.locals as SessionRouteLocals).authenticatedPrincipal;

  if (!principal || !isPrivilegedUserRole(principal.role)) {
    throw new HttpError(403, "FORBIDDEN", "Reviewer access is required");
  }

  return principal;
}

function parseOptionalReviewStatus(value: unknown): RiskSummaryReviewStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0 || !isRiskSummaryReviewStatus(value.trim())) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      `reviewStatus must be one of: ${RISK_SUMMARY_REVIEW_STATUSES.join(", ")}`,
    );
  }

  return value.trim() as RiskSummaryReviewStatus;
}

function parseRequiredReviewStatus(value: unknown): RiskSummaryReviewStatus {
  if (typeof value !== "string" || value.trim().length === 0 || !isRiskSummaryReviewStatus(value.trim())) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      `reviewStatus must be one of: ${RISK_SUMMARY_REVIEW_STATUSES.join(", ")}`,
    );
  }

  return value.trim() as RiskSummaryReviewStatus;
}

function parseNativeRiskSignalReport(value: unknown): NativeRiskSignalReport {
  const record = requireRecord(value);

  return {
    occurredAt: requireIsoTimestamp(record, "occurredAt"),
    captureAffinityReports: optionalArray(record.captureAffinityReports).map(parseCaptureAffinityReport),
    virtualizationReports: optionalArray(record.virtualizationReports).map(parseVirtualizationReport),
  };
}

function parseCaptureAffinityReport(value: unknown): NativeCaptureAffinityReport {
  const record = requireRecord(value);

  return {
    platform: requireNonEmptyString(record, "platform"),
    windowId: requireNonEmptyString(record, "windowId"),
    protectedFromCapture: requireBoolean(record, "protectedFromCapture"),
  };
}

function parseVirtualizationReport(value: unknown): NativeVirtualizationReport {
  const record = requireRecord(value);

  return {
    platform: requireNonEmptyString(record, "platform"),
    signals: requireArray(record.signals, "signals").map(parseVirtualizationSignal),
  };
}

function parseVirtualizationSignal(value: unknown): NativeVirtualizationSignal {
  const record = requireRecord(value);
  const detail = record.detail;

  if (detail !== undefined && detail !== null && typeof detail !== "string") {
    throw new HttpError(400, "BAD_REQUEST", "detail must be a string");
  }

  return {
    name: requireNonEmptyString(record, "name"),
    detected: requireBoolean(record, "detected"),
    ...(typeof detail === "string" && detail.trim().length > 0 ? { detail: detail.trim() } : {}),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an array`);
  }

  return value;
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Native report field must be an array");
  }

  return value;
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

function requireBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const value = record[fieldName];

  if (typeof value !== "boolean") {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a boolean`);
  }

  return value;
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

function requireIsoTimestamp(record: Record<string, unknown>, fieldName: string): string {
  const value = requireNonEmptyString(record, fieldName);
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an ISO timestamp`);
  }

  return date.toISOString();
}

function transitionUpdateData(state: SessionState) {
  const now = new Date();

  return {
    state: API_TO_DB_SESSION_STATE[state],
    ...(state === "active" ? { startedAt: now } : {}),
    ...(state === "ended" || state === "cancelled" ? { endedAt: now } : {}),
  };
}

async function createRecordingEvidenceObject(
  prisma: PrismaClient,
  config: ServerConfig,
  request: {
    sessionId: string;
    recording: {
      egressId: string;
      roomName: string;
      status: number;
      filepath?: string;
    };
  },
) {
  const storageBucket = requireConfiguredRecordingValue(config.livekitRecordingS3Bucket, "S3_BUCKET");
  const storageKey = requireConfiguredRecordingValue(request.recording.filepath, "recording filepath");

  return prisma.evidenceObject.create({
    data: {
      sessionId: request.sessionId,
      kind: "SESSION_RECORDING",
      storageBucket,
      storageKey,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          egressId: request.recording.egressId,
          roomName: request.recording.roomName,
          status: request.recording.status,
        },
      } satisfies Prisma.InputJsonValue,
    },
  });
}

function requireConfiguredRecordingValue(value: string | null | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new HttpError(503, "LIVEKIT_RECORDING_NOT_CONFIGURED", `${fieldName} is required for LiveKit recording`);
  }

  return value.trim();
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
