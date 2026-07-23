import { Prisma, type PrismaClient } from "@anecites/db";
import {
  MEDIA_RECORDING_SCOPES,
  type MediaConsentScope,
  type ParticipantRole,
} from "@anecites/shared";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import {
  startLiveKitCandidateRecording,
  stopLiveKitRoomRecording,
  type LiveKitEgressClient,
  type LiveKitRecordingResponse,
} from "./livekit.js";
import { type MediaConsentSnapshot } from "./media-consent.js";
import { LIVEKIT_EGRESS_COMPLETE } from "./recording-analysis.js";
import { createRecordingVerificationJob, type RecordingVerificationJob } from "@anecites/shared";

const ACTIVE_RECORDING_STATES = ["ACTIVE", "STOP_REQUESTED"] as const;

export interface SerializedSessionRecording {
  id: string;
  egressId: string;
  evidenceObjectId: string;
  state: "active" | "stop_requested" | "completed" | "failed";
  startedAt: string;
  stopRequestedAt: string | null;
  completedAt: string | null;
}

export interface SerializedSessionRecordingStatus {
  state: SerializedSessionRecording["state"];
  startedAt: string;
  stopRequestedAt: string | null;
  completedAt: string | null;
}

export interface StartSessionRecordingResult {
  recording: LiveKitRecordingResponse;
  sessionRecording: SerializedSessionRecording;
}

export interface StopSessionRecordingResult {
  recording: LiveKitRecordingResponse;
  sessionRecording: SerializedSessionRecording;
}

export async function startSessionRecording(
  prisma: PrismaClient,
  config: ServerConfig,
  request: {
    sessionId: string;
    mediaConsentSnapshots: readonly MediaConsentSnapshot[];
  },
  egressClient?: LiveKitEgressClient,
): Promise<StartSessionRecordingResult> {
  await ensureNoActiveSessionRecording(prisma, request.sessionId);
  const candidateParticipantId = requireSingleCandidateParticipantId(request.mediaConsentSnapshots);

  const recording = await startLiveKitCandidateRecording(
    config,
    {
      sessionId: request.sessionId,
      participantId: candidateParticipantId,
    },
    egressClient,
  );

  try {
    return await prisma.$transaction(async (transaction) => {
      await ensureNoActiveSessionRecording(transaction, request.sessionId);
      const evidenceObject = await createRecordingEvidenceObject(transaction, config, {
        sessionId: request.sessionId,
        recording,
        mediaConsentSnapshots: request.mediaConsentSnapshots,
      });
      const sessionRecording = await transaction.sessionRecording.create({
        data: {
          sessionId: request.sessionId,
          egressId: recording.egressId,
          evidenceObjectId: evidenceObject.id,
          state: "ACTIVE",
          startedAt: new Date(),
        },
      });

      return {
        recording: {
          ...recording,
          evidenceObjectId: evidenceObject.id,
          storageKey: evidenceObject.storageKey,
        },
        sessionRecording: serializeSessionRecording(sessionRecording),
      };
    });
  } catch (error) {
    await stopLiveKitRoomRecording(config, recording.egressId, egressClient).catch(() => undefined);

    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(
      500,
      "LIVEKIT_RECORDING_PERSISTENCE_FAILED",
      "LiveKit recording could not be persisted",
    );
  }
}

export async function stopSessionRecording(
  prisma: PrismaClient,
  config: ServerConfig,
  request: {
    sessionId: string;
    egressId: string;
  },
  egressClient?: LiveKitEgressClient,
): Promise<StopSessionRecordingResult> {
  const sessionRecording = await prisma.sessionRecording.findFirst({
    where: {
      sessionId: request.sessionId,
      egressId: request.egressId,
    },
  });

  if (!sessionRecording) {
    throw new HttpError(404, "LIVEKIT_RECORDING_NOT_FOUND", "LiveKit recording was not found");
  }

  if (sessionRecording.state !== "ACTIVE") {
    throw new HttpError(409, "LIVEKIT_RECORDING_NOT_ACTIVE", "LiveKit recording is not active");
  }

  const recording = await stopLiveKitRoomRecording(config, request.egressId, egressClient);
  const now = new Date();
  const updated = await prisma.sessionRecording.update({
    where: {
      id: sessionRecording.id,
    },
    data: recording.status === LIVEKIT_EGRESS_COMPLETE
      ? {
          state: "COMPLETED",
          stopRequestedAt: now,
          completedAt: now,
        }
      : {
          state: "STOP_REQUESTED",
          stopRequestedAt: now,
        },
  });

  return {
    recording,
    sessionRecording: serializeSessionRecording(updated),
  };
}

export async function stopActiveSessionRecording(
  prisma: PrismaClient,
  config: ServerConfig,
  sessionId: string,
  egressClient?: LiveKitEgressClient,
): Promise<StopSessionRecordingResult | null> {
  const sessionRecording = await prisma.sessionRecording.findFirst({
    where: {
      sessionId,
      state: "ACTIVE",
    },
    select: {
      egressId: true,
    },
  });

  if (!sessionRecording) {
    return null;
  }

  return stopSessionRecording(
    prisma,
    config,
    {
      sessionId,
      egressId: sessionRecording.egressId,
    },
    egressClient,
  );
}

export async function getLatestSessionRecording(
  prisma: PrismaClient,
  sessionId: string,
): Promise<SerializedSessionRecording | null> {
  const recording = await prisma.sessionRecording.findFirst({
    where: {
      sessionId,
    },
    orderBy: [
      { startedAt: "desc" },
      { id: "desc" },
    ],
  });

  return recording ? serializeSessionRecording(recording) : null;
}

export function toSessionRecordingStatus(
  recording: SerializedSessionRecording,
): SerializedSessionRecordingStatus {
  return {
    state: recording.state,
    startedAt: recording.startedAt,
    stopRequestedAt: recording.stopRequestedAt,
    completedAt: recording.completedAt,
  };
}

export async function markSessionRecordingCompleted(
  prisma: PrismaClient,
  egressId: string,
): Promise<SerializedSessionRecording | null> {
  const sessionRecording = await prisma.sessionRecording.findUnique({
    where: {
      egressId,
    },
  });

  if (!sessionRecording) {
    return null;
  }

  if (sessionRecording.state === "COMPLETED") {
    return serializeSessionRecording(sessionRecording);
  }

  const now = new Date();
  const updated = await prisma.sessionRecording.update({
    where: {
      id: sessionRecording.id,
    },
    data: {
      state: "COMPLETED",
      stopRequestedAt: sessionRecording.stopRequestedAt ?? now,
      completedAt: now,
    },
  });

  return serializeSessionRecording(updated);
}

export async function createSessionRecordingVerificationJob(
  prisma: PrismaClient,
  egressId: string,
): Promise<RecordingVerificationJob | null> {
  const recording = await prisma.sessionRecording.findUnique({
    where: { egressId },
    select: { sessionId: true, evidenceObjectId: true, state: true },
  });
  if (!recording || recording.state !== "COMPLETED") {
    return null;
  }
  return createRecordingVerificationJob({
    version: 1,
    jobId: `recording-verification:${recording.evidenceObjectId}`,
    sessionId: recording.sessionId,
    recordingEvidenceObjectId: recording.evidenceObjectId,
  });
}

export async function assertSessionAllowsParticipantJoin(
  prisma: PrismaClient,
  sessionId: string,
): Promise<void> {
  const activeRecording = await prisma.sessionRecording.findFirst({
    where: {
      sessionId,
      state: {
        in: [...ACTIVE_RECORDING_STATES],
      },
    },
    select: {
      id: true,
    },
  });

  if (activeRecording) {
    throw new HttpError(
      409,
      "RECORDING_PARTICIPANT_JOIN_BLOCKED",
      "Participants cannot join while a session recording is active",
    );
  }
}

async function ensureNoActiveSessionRecording(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
): Promise<void> {
  const activeRecording = await prisma.sessionRecording.findFirst({
    where: {
      sessionId,
      state: {
        in: [...ACTIVE_RECORDING_STATES],
      },
    },
    select: {
      id: true,
    },
  });

  if (activeRecording) {
    throw new HttpError(409, "LIVEKIT_RECORDING_ALREADY_ACTIVE", "LiveKit recording is already active");
  }
}

async function createRecordingEvidenceObject(
  prisma: PrismaClient | Prisma.TransactionClient,
  config: ServerConfig,
  request: {
    sessionId: string;
    recording: {
      egressId: string;
      roomName: string;
      status: number;
      filepath?: string;
    };
    mediaConsentSnapshots: readonly MediaConsentSnapshot[];
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
          recordingScope: MEDIA_RECORDING_SCOPES.candidateTrack,
          participantId: requireSingleCandidateParticipantId(request.mediaConsentSnapshots),
        },
        mediaConsent: {
          participants: request.mediaConsentSnapshots.map(serializeMediaConsentSnapshot),
        },
      } satisfies Prisma.InputJsonValue,
    },
  });
}

function serializeMediaConsentSnapshot(snapshot: {
  consentId: string;
  participantId: string;
  participantRole: ParticipantRole;
  noticeVersion: string;
  noticeFingerprint: string;
  scopes: readonly MediaConsentScope[];
}) {
  return {
    consentId: snapshot.consentId,
    participantId: snapshot.participantId,
    participantRole: snapshot.participantRole,
    noticeVersion: snapshot.noticeVersion,
    noticeFingerprint: snapshot.noticeFingerprint,
    scopes: snapshot.scopes,
  };
}

function requireConfiguredRecordingValue(value: string | null | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new HttpError(503, "LIVEKIT_RECORDING_NOT_CONFIGURED", `${fieldName} is required for LiveKit recording`);
  }

  return value.trim();
}

function requireSingleCandidateParticipantId(
  mediaConsentSnapshots: readonly MediaConsentSnapshot[],
): string {
  const candidateParticipantIds = mediaConsentSnapshots
    .filter((snapshot) => snapshot.participantRole === "candidate")
    .map((snapshot) => snapshot.participantId);

  if (candidateParticipantIds.length !== 1 || !candidateParticipantIds[0]) {
    throw new HttpError(
      409,
      "LIVEKIT_RECORDING_CANDIDATE_REQUIRED",
      "Exactly one active candidate is required for candidate recording",
    );
  }

  return candidateParticipantIds[0];
}

function serializeSessionRecording(recording: {
  id: string;
  egressId: string;
  evidenceObjectId: string;
  state: "ACTIVE" | "STOP_REQUESTED" | "COMPLETED" | "FAILED";
  startedAt: Date;
  stopRequestedAt: Date | null;
  completedAt: Date | null;
}): SerializedSessionRecording {
  return {
    id: recording.id,
    egressId: recording.egressId,
    evidenceObjectId: recording.evidenceObjectId,
    state: recording.state.toLowerCase() as SerializedSessionRecording["state"],
    startedAt: recording.startedAt.toISOString(),
    stopRequestedAt: recording.stopRequestedAt?.toISOString() ?? null,
    completedAt: recording.completedAt?.toISOString() ?? null,
  };
}
