import { Prisma, type PrismaClient } from "@anecites/db";
import {
  MEDIA_CONSENT_SCOPES,
  createMediaConsentScopes,
  hasMediaConsentScopes,
  type MediaConsentScope,
  type ParticipantRole,
} from "@anecites/shared";

import { type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

type MediaConsentConfig = Pick<
  ServerConfig,
  | "mediaAnalysisEnabled"
  | "mediaAnalysisGazeMode"
  | "mediaConsentNoticeVersion"
  | "mediaConsentNoticeText"
  | "mediaConsentNoticeFingerprint"
>;

type DatabaseParticipantRole = "CANDIDATE" | "INTERVIEWER";

export interface MediaConsentRequirements {
  noticeVersion: string;
  noticeText: string;
  requiredScopes: MediaConsentScope[];
  mediaConsent: SerializedMediaConsent | null;
}

export interface SerializedMediaConsent {
  id: string;
  noticeVersion: string;
  scopes: MediaConsentScope[];
  grantedAt: string;
  revokedAt: string | null;
}

export interface MediaConsentSnapshot {
  consentId: string;
  participantId: string;
  participantRole: ParticipantRole;
  noticeVersion: string;
  noticeFingerprint: string;
  scopes: MediaConsentScope[];
}

export async function getMediaConsentRequirements(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  principal: AuthenticatedPrincipal,
  sessionId: string,
): Promise<MediaConsentRequirements> {
  const participant = await findActivePrincipalParticipant(prisma, principal, sessionId);
  const consent = await prisma.mediaConsent.findFirst({
    where: {
      sessionId,
      participantId: participant.id,
      noticeVersion: config.mediaConsentNoticeVersion,
      noticeFingerprint: config.mediaConsentNoticeFingerprint,
      revokedAt: null,
    },
    orderBy: {
      grantedAt: "desc",
    },
  });

  return {
    noticeVersion: config.mediaConsentNoticeVersion,
    noticeText: config.mediaConsentNoticeText,
    requiredScopes: requiredScopesForParticipant(
      participant.role,
      config.mediaAnalysisEnabled,
      config.mediaAnalysisGazeMode === "shadow",
    ),
    mediaConsent: consent ? serializeMediaConsent(consent) : null,
  };
}

export async function grantMediaConsent(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  scopes: readonly MediaConsentScope[],
): Promise<SerializedMediaConsent> {
  const participant = await findActivePrincipalParticipant(prisma, principal, sessionId);
  const normalizedScopes = createMediaConsentScopes(scopes);
  const now = new Date();

  try {
    const consent = await prisma.$transaction(async (transaction) => {
      const current = await transaction.mediaConsent.findFirst({
        where: {
          sessionId,
          participantId: participant.id,
          revokedAt: null,
        },
        orderBy: {
          grantedAt: "desc",
        },
      });

      if (
        current &&
        current.noticeVersion === config.mediaConsentNoticeVersion &&
        current.noticeFingerprint === config.mediaConsentNoticeFingerprint &&
        sameScopes(parseStoredScopes(current.scopes), normalizedScopes)
      ) {
        return current;
      }

      if (current) {
        await transaction.mediaConsent.update({
          where: {
            id: current.id,
          },
          data: {
            revokedAt: now,
          },
        });
      }

      return transaction.mediaConsent.create({
        data: {
          sessionId,
          participantId: participant.id,
          noticeVersion: config.mediaConsentNoticeVersion,
          noticeFingerprint: config.mediaConsentNoticeFingerprint,
          scopes: normalizedScopes,
          grantedAt: now,
        },
      });
    });

    return serializeMediaConsent(consent);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(
        409,
        "MEDIA_CONSENT_CONFLICT",
        "Media consent changed concurrently; retry the request",
      );
    }

    throw error;
  }
}

export async function revokeMediaConsent(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  mediaConsentId: string,
): Promise<SerializedMediaConsent> {
  const participant = await findActivePrincipalParticipant(prisma, principal, sessionId);
  const consent = await prisma.mediaConsent.findFirst({
    where: {
      id: mediaConsentId,
      sessionId,
      participantId: participant.id,
    },
  });

  if (!consent) {
    throw new HttpError(404, "MEDIA_CONSENT_NOT_FOUND", "Media consent was not found");
  }

  if (consent.revokedAt) {
    return serializeMediaConsent(consent);
  }

  const revoked = await prisma.mediaConsent.update({
    where: {
      id: consent.id,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return serializeMediaConsent(revoked);
}

export async function requireActiveInterviewerRecordingAccess(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
): Promise<void> {
  const participant = await findActivePrincipalParticipant(prisma, principal, sessionId);

  if (participant.role !== "INTERVIEWER" || principal.role !== "interviewer") {
    throw new HttpError(403, "RECORDING_INTERVIEWER_REQUIRED", "Interviewer access is required to control recording");
  }
}

export async function getActiveSessionParticipantRole(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
): Promise<ParticipantRole> {
  const participant = await findActivePrincipalParticipant(prisma, principal, sessionId);
  return toApiParticipantRole(participant.role);
}

export async function requireActiveRecordingConsents(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  sessionId: string,
): Promise<MediaConsentSnapshot[]> {
  return requireConsents(prisma, config, sessionId, config.mediaAnalysisEnabled);
}

export async function requireActiveMediaAnalysisConsents(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  sessionId: string,
): Promise<MediaConsentSnapshot[]> {
  return requireConsents(prisma, config, sessionId, true);
}

export async function requireActiveGazeCalibrationConsents(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  sessionId: string,
): Promise<MediaConsentSnapshot[]> {
  if (!config.mediaAnalysisEnabled || config.mediaAnalysisGazeMode !== "shadow") {
    throw new HttpError(
      409,
      "GAZE_CALIBRATION_UNAVAILABLE",
      "Gaze calibration is not enabled for this interview",
    );
  }

  return requireConsents(prisma, config, sessionId, true, true);
}

async function requireConsents(
  prisma: PrismaClient,
  config: MediaConsentConfig,
  sessionId: string,
  requireFaceAnalysis: boolean,
  requireGazeCalibration = false,
): Promise<MediaConsentSnapshot[]> {
  const participants = await prisma.participant.findMany({
    where: {
      sessionId,
      leftAt: null,
    },
    select: {
      id: true,
      role: true,
    },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });

  if (participants.length === 0) {
    throw new HttpError(
      409,
      "MEDIA_CONSENT_REQUIRED",
      "An active interviewer and candidate must consent before recording or media analysis",
    );
  }

  const participantRoles = new Set(participants.map((participant) => participant.role));
  if (!participantRoles.has("INTERVIEWER") || !participantRoles.has("CANDIDATE")) {
    throw new HttpError(
      409,
      "MEDIA_CONSENT_REQUIRED",
      "An active interviewer and candidate must consent before recording or media analysis",
    );
  }

  const consents = await prisma.mediaConsent.findMany({
    where: {
      sessionId,
      participantId: {
        in: participants.map((participant) => participant.id),
      },
      noticeVersion: config.mediaConsentNoticeVersion,
      noticeFingerprint: config.mediaConsentNoticeFingerprint,
      revokedAt: null,
    },
    select: {
      id: true,
      participantId: true,
      noticeVersion: true,
      noticeFingerprint: true,
      scopes: true,
    },
  });
  const consentByParticipantId = new Map(consents.map((consent) => [consent.participantId, consent]));
  const snapshots: MediaConsentSnapshot[] = [];

  for (const participant of participants) {
    const consent = consentByParticipantId.get(participant.id);
    const scopes = consent ? parseStoredScopes(consent.scopes) : null;
    const requiredScopes = requiredScopesForParticipant(
      participant.role,
      requireFaceAnalysis,
      requireGazeCalibration,
    );

    if (!consent || !scopes || !hasMediaConsentScopes(scopes, requiredScopes)) {
      throw new HttpError(
        409,
        "MEDIA_CONSENT_REQUIRED",
        "An active interviewer and candidate must consent before recording or media analysis",
      );
    }

    snapshots.push({
      consentId: consent.id,
      participantId: participant.id,
      participantRole: toApiParticipantRole(participant.role),
      noticeVersion: consent.noticeVersion,
      noticeFingerprint: consent.noticeFingerprint,
      scopes,
    });
  }

  return snapshots;
}

async function findActivePrincipalParticipant(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
) {
  const participant = await prisma.participant.findFirst({
    where: {
      sessionId,
      userId: principal.subject,
      leftAt: null,
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (!participant || principal.role !== toApiParticipantRole(participant.role)) {
    throw new HttpError(403, "MEDIA_CONSENT_PARTICIPANT_FORBIDDEN", "Participant cannot manage media consent");
  }

  return participant;
}

function requiredScopesForParticipant(
  role: DatabaseParticipantRole,
  requireFaceAnalysis: boolean,
  requireGazeCalibration: boolean,
): MediaConsentScope[] {
  if (role === "CANDIDATE" && requireFaceAnalysis) {
    return [
      MEDIA_CONSENT_SCOPES.sessionRecording,
      MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
      ...(requireGazeCalibration ? [MEDIA_CONSENT_SCOPES.videoGazeCalibration] : []),
    ];
  }

  return [MEDIA_CONSENT_SCOPES.sessionRecording];
}

function parseStoredScopes(value: Prisma.JsonValue): MediaConsentScope[] | null {
  try {
    return createMediaConsentScopes(value);
  } catch {
    return null;
  }
}

function sameScopes(left: readonly MediaConsentScope[] | null, right: readonly MediaConsentScope[]): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }

  return hasMediaConsentScopes(left, right);
}

function serializeMediaConsent(consent: {
  id: string;
  noticeVersion: string;
  scopes: Prisma.JsonValue;
  grantedAt: Date;
  revokedAt: Date | null;
}): SerializedMediaConsent {
  const scopes = parseStoredScopes(consent.scopes);

  if (!scopes) {
    throw new HttpError(409, "MEDIA_CONSENT_INVALID", "Media consent contains invalid scopes");
  }

  return {
    id: consent.id,
    noticeVersion: consent.noticeVersion,
    scopes,
    grantedAt: consent.grantedAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
  };
}

function toApiParticipantRole(role: DatabaseParticipantRole): ParticipantRole {
  return role === "CANDIDATE" ? "candidate" : "interviewer";
}
