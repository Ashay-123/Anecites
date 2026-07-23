import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient } from "@anecites/db";
import {
  createNativeRiskSignals,
  createNativeProhibitedApplicationMatch,
  createGazeCalibrationStep,
  createMediaConsentScopes,
  isPrivilegedUserRole,
  isSessionState,
  isValidSessionTransition,
  type NativeCaptureAffinityReport,
  type NativeEnvironmentReport,
  type NativeProhibitedApplicationMatch,
  type NativeRiskSignalReport,
  type NativeVirtualizationReport,
  type NativeVirtualizationSignal,
  type MediaConsentScope,
  type ParticipantRole,
  type SessionState,
} from "@anecites/shared";

import { type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { createReviewerEvidencePlayback } from "./evidence-playback.js";
import { type EvidenceStorage } from "./evidence-storage.js";
import { HttpError } from "./http-error.js";
import {
  createLiveKitJoinToken,
  type LiveKitEgressClient,
} from "./livekit.js";
import {
  listMonitoringTimeline,
  recordCandidateMonitoringHeartbeat,
  recordCandidateRiskEvent,
  requireBoundNativeMonitoringPolicy,
  startCandidateMonitoring,
  stopCandidateMonitoring,
} from "./monitoring.js";
import { type MediaAnalysisPublisher } from "./media-analysis-publisher.js";
import {
  getMediaConsentRequirements,
  getActiveSessionParticipantRole,
  grantMediaConsent,
  requireActiveInterviewerRecordingAccess,
  requireActiveRecordingConsents,
  revokeMediaConsent,
} from "./media-consent.js";
import {
  acknowledgeGazeCalibrationStep,
  startGazeCalibration,
} from "./gaze-calibrations.js";
import {
  assertSessionAllowsParticipantJoin,
  getLatestSessionRecording,
  startSessionRecording,
  stopActiveSessionRecording,
  stopSessionRecording,
  toSessionRecordingStatus,
} from "./recording-lifecycle.js";
import { buildNativeMonitoringPolicyManifest } from "./native-monitoring-policy.js";
import {
  LIVEKIT_EGRESS_COMPLETE,
  publishRecordingMediaAnalysisJob,
} from "./recording-analysis.js";
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
  mediaAnalysisPublisher?: MediaAnalysisPublisher,
  evidenceStorage?: EvidenceStorage | null,
): Router {
  const router = Router();
  const nativeMonitoringPolicy = buildNativeMonitoringPolicyManifest(config);

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

  router.get("/:sessionId/evidence/:clipId", async (request, response, next) => {
    try {
      const principal = requireReviewerAccess(response);
      const riskSummaryId = typeof request.query.riskSummaryId === "string"
        ? request.query.riskSummaryId.trim()
        : "";
      const playback = await createReviewerEvidencePlayback(prisma, config, evidenceStorage ?? null, {
        sessionId: requireParam(request.params.sessionId, "sessionId"),
        evidenceObjectId: requireParam(request.params.clipId, "clipId"),
        principalRole: principal.role,
        ...(riskSummaryId ? { riskSummaryId } : {}),
      });
      response.status(200).json(playback);
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

  router.get("/:sessionId/monitoring-timeline", async (request, response, next) => {
    try {
      requireReviewerAccess(response);
      const result = await listMonitoringTimeline(
        prisma,
        requireParam(request.params.sessionId, "sessionId"),
        request.query.limit,
      );
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/monitoring/start", async (request, response, next) => {
    try {
      const monitoring = await startCandidateMonitoring(
        prisma,
        requireAuthenticatedPrincipal(response),
        requireParam(request.params.sessionId, "sessionId"),
        request.body,
        nativeMonitoringPolicy,
      );
      response.status(201).json(monitoring);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/monitoring/:monitoringConsentId/heartbeat", async (request, response, next) => {
    try {
      const heartbeat = await recordCandidateMonitoringHeartbeat(
        prisma,
        requireAuthenticatedPrincipal(response),
        requireParam(request.params.sessionId, "sessionId"),
        requireParam(request.params.monitoringConsentId, "monitoringConsentId"),
        request.body,
      );
      response.status(201).json({ heartbeat });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/monitoring/:monitoringConsentId/events", async (request, response, next) => {
    try {
      const riskEvent = await recordCandidateRiskEvent(
        prisma,
        requireAuthenticatedPrincipal(response),
        requireParam(request.params.sessionId, "sessionId"),
        requireParam(request.params.monitoringConsentId, "monitoringConsentId"),
        request.body,
      );
      response.status(201).json({ riskEvent });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/monitoring/:monitoringConsentId/stop", async (request, response, next) => {
    try {
      const monitoringConsent = await stopCandidateMonitoring(
        prisma,
        requireAuthenticatedPrincipal(response),
        requireParam(request.params.sessionId, "sessionId"),
        requireParam(request.params.monitoringConsentId, "monitoringConsentId"),
        request.body,
      );
      response.status(200).json({ monitoringConsent });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/participants", async (request, response, next) => {
    try {
      const body = parseJoinSessionBody(request.body);
      await ensureSessionExists(prisma, request.params.sessionId);
      await assertSessionAllowsParticipantJoin(prisma, request.params.sessionId);

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

  router.get("/:sessionId/media-consent-requirements", async (request, response, next) => {
    try {
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      const requirements = await getMediaConsentRequirements(
        prisma,
        config,
        requireAuthenticatedPrincipal(response),
        sessionId,
      );
      response.status(200).json({ requirements });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/media-consent", async (request, response, next) => {
    try {
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      const body = parseMediaConsentBody(request.body);
      const mediaConsent = await grantMediaConsent(
        prisma,
        config,
        requireAuthenticatedPrincipal(response),
        sessionId,
        body.scopes,
      );
      response.status(201).json({ mediaConsent });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/media-consent/:mediaConsentId/revoke", async (request, response, next) => {
    try {
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      const mediaConsent = await revokeMediaConsent(
        prisma,
        requireAuthenticatedPrincipal(response),
        sessionId,
        requireParam(request.params.mediaConsentId, "mediaConsentId"),
      );
      response.status(200).json({ mediaConsent });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/gaze-calibrations", async (request, response, next) => {
    try {
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      const result = await startGazeCalibration(
        prisma,
        config,
        requireAuthenticatedPrincipal(response),
        sessionId,
      );
      response.status(result.created ? 201 : 200).json({
        gazeCalibration: result.gazeCalibration,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/gaze-calibrations/:gazeCalibrationId/steps", async (request, response, next) => {
    try {
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      const gazeCalibration = await acknowledgeGazeCalibrationStep(
        prisma,
        config,
        requireAuthenticatedPrincipal(response),
        sessionId,
        requireParam(request.params.gazeCalibrationId, "gazeCalibrationId"),
        parseGazeCalibrationStepBody(request.body),
      );
      response.status(200).json({ gazeCalibration });
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

  router.get("/:sessionId/livekit-recording", async (request, response, next) => {
    try {
      const principal = requireAuthenticatedPrincipal(response);
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      const participantRole = await getActiveSessionParticipantRole(prisma, principal, sessionId);
      const recording = await getLatestSessionRecording(prisma, sessionId);

      response.status(200).json({
        recordingStatus: recording ? toSessionRecordingStatus(recording) : null,
        recordingControl: participantRole === "interviewer" && principal.role === "interviewer" && recording?.state === "active"
          ? { egressId: recording.egressId }
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/livekit-recording", async (request, response, next) => {
    try {
      const principal = requireAuthenticatedPrincipal(response);
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      await requireActiveInterviewerRecordingAccess(prisma, principal, session.id);
      const mediaConsentSnapshots = await requireActiveRecordingConsents(prisma, config, session.id);
      const result = await startSessionRecording(
        prisma,
        config,
        {
          sessionId: session.id,
          mediaConsentSnapshots,
        },
        liveKitEgressClient,
      );

      response.status(201).json({
        recording: result.recording,
        sessionRecording: result.sessionRecording,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/livekit-recording/:egressId/stop", async (request, response, next) => {
    try {
      const principal = requireAuthenticatedPrincipal(response);
      const sessionId = requireParam(request.params.sessionId, "sessionId");
      await ensureSessionExists(prisma, sessionId);
      await requireActiveInterviewerRecordingAccess(prisma, principal, sessionId);
      const egressId = requireParam(request.params.egressId, "egressId");
      const result = await stopSessionRecording(
        prisma,
        config,
        { sessionId, egressId },
        liveKitEgressClient,
      );
      const recording = result.recording;
      let mediaAnalysisStatus = config.mediaAnalysisEnabled ? "not_published" : "disabled";

      if (config.mediaAnalysisEnabled) {
        if (recording.status !== LIVEKIT_EGRESS_COMPLETE) {
          throw new HttpError(
            409,
            "MEDIA_ANALYSIS_RECORDING_NOT_READY",
            "LiveKit recording is not ready for analysis",
          );
        }
        try {
          await publishRecordingMediaAnalysisJob(
            prisma,
            config,
            mediaAnalysisPublisher,
            { sessionId, egressId },
          );
          mediaAnalysisStatus = "queued";
        } catch (error) {
          if (error instanceof HttpError && error.code === "MEDIA_CONSENT_REQUIRED") {
            mediaAnalysisStatus = "not_published_consent_required";
          } else if (
            error instanceof HttpError &&
            error.code === "MEDIA_ANALYSIS_CANDIDATE_SOURCE_REQUIRED"
          ) {
            mediaAnalysisStatus = "not_published_candidate_source_required";
          } else {
            throw error;
          }
        }
      }

      response.status(200).json({
        recording,
        sessionRecording: result.sessionRecording,
        mediaAnalysis: {
          status: mediaAnalysisStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sessionId/native-risk-report", async (request, response, next) => {
    try {
      const principal = requireAuthenticatedPrincipal(response);
      if (principal.role !== "candidate") {
        throw new HttpError(403, "MONITORING_CANDIDATE_REQUIRED", "Candidate access is required");
      }
      const body = parseNativeRiskReportBody(request.body);
      const session = await findSessionOrThrow(prisma, request.params.sessionId);
      const participant = session.participants.find(
        (candidate) =>
          candidate.id === body.participantId &&
          candidate.userId === principal.subject &&
          candidate.role === "CANDIDATE" &&
          !candidate.leftAt,
      );

      if (!participant) {
        throw new HttpError(403, "MONITORING_PARTICIPANT_FORBIDDEN", "Candidate cannot monitor this participant");
      }

      const monitoringConsent = await prisma.monitoringConsent.findFirst({
        where: {
          id: body.monitoringConsentId,
          sessionId: session.id,
          participantId: participant.id,
          monitoringStoppedAt: null,
          revokedAt: null,
        },
        select: {
          policyVersion: true,
          policyDigestSha256: true,
          nativeMonitoringPolicy: true,
        },
      });
      if (!monitoringConsent) {
        throw new HttpError(404, "MONITORING_NOT_ACTIVE", "Active monitoring enrollment not found");
      }

      const monitoringPolicy = requireBoundNativeMonitoringPolicy(monitoringConsent);
      requireConfiguredProhibitedApplicationMatches(
        body.nativeReport.prohibitedApplicationMatches ?? [],
        monitoringPolicy.prohibitedApplicationRules,
      );

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

      let automaticRecording:
        | Awaited<ReturnType<typeof startSessionRecording>>
        | Awaited<ReturnType<typeof stopActiveSessionRecording>>
        | undefined;
      if (
        config.livekitRecordingAutoLifecycleEnabled &&
        (requestedState === "active" || ((requestedState === "ended" || requestedState === "cancelled") && currentState === "active"))
      ) {
        const principal = requireAuthenticatedPrincipal(response);
        await requireActiveInterviewerRecordingAccess(prisma, principal, existingSession.id);

        if (requestedState === "active") {
          const mediaConsentSnapshots = await requireActiveRecordingConsents(prisma, config, existingSession.id);
          automaticRecording = await startSessionRecording(
            prisma,
            config,
            {
              sessionId: existingSession.id,
              mediaConsentSnapshots,
            },
            liveKitEgressClient,
          );
        } else {
          automaticRecording = await stopActiveSessionRecording(
            prisma,
            config,
            existingSession.id,
            liveKitEgressClient,
          );
        }
      }

      let session;
      try {
        session = await prisma.session.update({
          where: {
            id: request.params.sessionId,
          },
          data: transitionUpdateData(requestedState),
          include: sessionInclude,
        });
      } catch (error) {
        if (automaticRecording && "sessionRecording" in automaticRecording && requestedState === "active") {
          await stopSessionRecording(
            prisma,
            config,
            {
              sessionId: existingSession.id,
              egressId: automaticRecording.sessionRecording.egressId,
            },
            liveKitEgressClient,
          ).catch(() => undefined);
        }
        throw error;
      }

      response.status(200).json({
        session: serializeSession(session),
        ...(automaticRecording
          ? {
              recording: automaticRecording.recording,
              sessionRecording: automaticRecording.sessionRecording,
            }
          : {}),
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

function parseMediaConsentBody(body: unknown): { scopes: MediaConsentScope[] } {
  const record = requireRecord(body);

  if (record.accepted !== true) {
    throw new HttpError(400, "BAD_REQUEST", "accepted must be true to grant media consent");
  }

  try {
    return {
      scopes: createMediaConsentScopes(record.scopes),
    };
  } catch (error) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      error instanceof Error ? error.message : "media consent scopes are invalid",
    );
  }
}

function parseGazeCalibrationStepBody(body: unknown) {
  try {
    return createGazeCalibrationStep(body);
  } catch (error) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      error instanceof Error ? error.message : "gaze calibration step is invalid",
    );
  }
}

function parseNativeRiskReportBody(body: unknown): {
  participantId: string;
  monitoringConsentId: string;
  windowStartedAt: string;
  windowEndedAt: string;
  nativeReport: NativeRiskSignalReport;
} {
  const record = requireRecord(body);
  const participantId = requireNonEmptyString(record, "participantId");
  const monitoringConsentId = requireNonEmptyString(record, "monitoringConsentId");
  const windowStartedAt = requireIsoTimestamp(record, "windowStartedAt");
  const windowEndedAt = requireIsoTimestamp(record, "windowEndedAt");
  const nativeReport = parseNativeRiskSignalReport(record.nativeReport);

  return {
    participantId,
    monitoringConsentId,
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
  const principal = requireAuthenticatedPrincipal(response);

  if (!isPrivilegedUserRole(principal.role)) {
    throw new HttpError(403, "FORBIDDEN", "Reviewer access is required");
  }

  return principal;
}

function requireAuthenticatedPrincipal(response: Response): AuthenticatedPrincipal {
  const principal = (response.locals as SessionRouteLocals).authenticatedPrincipal;
  if (!principal) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token");
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
    environmentReports: optionalArray(record.environmentReports).map(parseEnvironmentReport),
    virtualizationReports: optionalArray(record.virtualizationReports).map(parseVirtualizationReport),
    prohibitedApplicationMatches: optionalArray(record.prohibitedApplicationMatches).map(
      parseProhibitedApplicationMatch,
    ),
  };
}

function parseEnvironmentReport(value: unknown): NativeEnvironmentReport {
  const record = requireRecord(value);
  const monitorCount = requireMonitorCount(record.monitorCount, "monitorCount");
  return {
    platform: requireNonEmptyString(record, "platform"),
    remoteSession: requireBoolean(record, "remoteSession"),
    monitorCount,
    ...(record.previousMonitorCount === undefined
      ? {}
      : { previousMonitorCount: requireMonitorCount(record.previousMonitorCount, "previousMonitorCount") }),
  };
}

function requireMonitorCount(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an integer between 1 and 32`);
  }
  return value as number;
}

function parseProhibitedApplicationMatch(value: unknown): NativeProhibitedApplicationMatch {
  try {
    return createNativeProhibitedApplicationMatch(value);
  } catch (error) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      error instanceof Error ? error.message : "Prohibited application match is invalid",
    );
  }
}

function requireConfiguredProhibitedApplicationMatches(
  matches: readonly NativeProhibitedApplicationMatch[],
  configuredRules: ServerConfig["monitoringProhibitedApplicationRules"],
): void {
  const configuredRuleIds = new Set(configuredRules.map((rule) => rule.id));
  if (matches.some((match) => !configuredRuleIds.has(match.ruleId))) {
    throw new HttpError(
      400,
      "MONITORING_RULE_NOT_CONFIGURED",
      "Prohibited application report references an unconfigured rule",
    );
  }
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
