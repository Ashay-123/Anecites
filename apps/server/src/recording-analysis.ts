import { type PrismaClient } from "@anecites/db";
import {
  MEDIA_ANALYSIS_MODES,
  createMediaAnalysisJob,
  getCandidateTrackRecordingParticipantId,
} from "@anecites/shared";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import { requireActiveMediaAnalysisConsents } from "./media-consent.js";
import { type MediaAnalysisPublisher } from "./media-analysis-publisher.js";

export const LIVEKIT_EGRESS_COMPLETE = 3;

export async function publishRecordingMediaAnalysisJob(
  prisma: PrismaClient,
  config: ServerConfig,
  mediaAnalysisPublisher: MediaAnalysisPublisher | undefined,
  request: {
    egressId: string;
    sessionId?: string;
  },
): Promise<void> {
  if (!mediaAnalysisPublisher) {
    throw new HttpError(
      503,
      "MEDIA_ANALYSIS_NOT_CONFIGURED",
      "Media-analysis publisher is unavailable",
    );
  }

  const evidenceObject = await prisma.evidenceObject.findFirst({
    where: {
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      kind: "SESSION_RECORDING",
      metadata: {
        path: ["livekit", "egressId"],
        equals: request.egressId,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!evidenceObject) {
    throw new HttpError(
      404,
      "MEDIA_ANALYSIS_EVIDENCE_NOT_FOUND",
      "Recording evidence was not found",
    );
  }

  await requireActiveMediaAnalysisConsents(prisma, config, evidenceObject.sessionId);
  const participantId = getCandidateTrackRecordingParticipantId(evidenceObject.metadata);
  if (!participantId) {
    throw new HttpError(
      409,
      "MEDIA_ANALYSIS_CANDIDATE_SOURCE_REQUIRED",
      "Candidate-scoped recording is required for individual media analysis",
    );
  }

  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
      sessionId: evidenceObject.sessionId,
      role: "CANDIDATE",
    },
    select: {
      id: true,
    },
  });
  if (!participant) {
    throw new HttpError(
      409,
      "MEDIA_ANALYSIS_CANDIDATE_SOURCE_REQUIRED",
      "Candidate-scoped recording is required for individual media analysis",
    );
  }

  const secondVoiceShadowEnabled = config.mediaAnalysisSecondVoiceMode === "shadow";

  const job = createMediaAnalysisJob({
    jobId: `media-analysis:${evidenceObject.id}`,
    sessionId: evidenceObject.sessionId,
    participantId,
    recordingEvidenceObjectId: evidenceObject.id,
    requestedModes: [
      MEDIA_ANALYSIS_MODES.videoFacePresence,
      ...(secondVoiceShadowEnabled ? [MEDIA_ANALYSIS_MODES.audioSecondVoice] : []),
    ],
    options: {
      sampleWindowMs: config.mediaAnalysisSampleWindowMs,
      maxSamplesPerRecording: config.mediaAnalysisMaxSamplesPerRecording,
      requestTimeoutMs: config.mediaAnalysisRequestTimeoutMs,
      confidenceThresholds: {
        secondVoice: config.mediaAnalysisSecondVoiceConfidenceThreshold,
        faceMissing: config.mediaAnalysisFaceMissingConfidenceThreshold,
        multipleFaces: config.mediaAnalysisMultipleFacesConfidenceThreshold,
        gazeOffscreen: config.mediaAnalysisGazeOffscreenConfidenceThreshold,
      },
      shadowModes: secondVoiceShadowEnabled ? [MEDIA_ANALYSIS_MODES.audioSecondVoice] : [],
    },
  });

  try {
    await mediaAnalysisPublisher.publish(job);
  } catch {
    throw new HttpError(
      502,
      "MEDIA_ANALYSIS_UPSTREAM_ERROR",
      "Media-analysis job could not be published",
    );
  }
}
