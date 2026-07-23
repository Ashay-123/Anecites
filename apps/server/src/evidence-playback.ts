import { type PrismaClient } from "@anecites/db";
import { isPrivilegedUserRole, type UserRole } from "@anecites/shared";

import { type ServerConfig } from "./config.js";
import { type EvidenceStorage } from "./evidence-storage.js";
import { HttpError } from "./http-error.js";

export interface ReviewerEvidencePlaybackRequest {
  sessionId: string;
  evidenceObjectId: string;
  principalRole: UserRole;
  riskSummaryId?: string;
}

export interface ReviewerEvidencePlaybackResponse {
  url: string;
  expiresIn: number;
  startTime: number | null;
  endTime: number | null;
}

export async function createReviewerEvidencePlayback(
  prisma: PrismaClient,
  config: ServerConfig,
  storage: EvidenceStorage | null,
  request: ReviewerEvidencePlaybackRequest,
): Promise<ReviewerEvidencePlaybackResponse> {
  if (!isPrivilegedUserRole(request.principalRole)) {
    throw new HttpError(403, "FORBIDDEN", "Reviewer access is required");
  }
  if (!storage) {
    throw new HttpError(503, "EVIDENCE_STORAGE_NOT_CONFIGURED", "Evidence storage is not configured");
  }

  const evidence = await prisma.evidenceObject.findFirst({
    where: {
      id: request.evidenceObjectId,
      sessionId: request.sessionId,
      kind: "SESSION_RECORDING",
    },
    include: {
      sessionRecording: true,
    },
  });
  if (!evidence || !evidence.sessionRecording) {
    throw new HttpError(404, "EVIDENCE_NOT_FOUND", "Evidence was not found");
  }
  if (evidence.sessionRecording.verificationState !== "REVIEWABLE") {
    throw new HttpError(409, "EVIDENCE_NOT_REVIEWABLE", "Recording evidence is not reviewable");
  }

  const range = request.riskSummaryId
    ? await resolveRiskSummaryRange(prisma, request.sessionId, evidence.id, evidence.sessionRecording.startedAt, request.riskSummaryId)
    : { startTime: null, endTime: null };
  const url = await storage.createPresignedReadUrl({
    bucket: evidence.storageBucket,
    key: evidence.storageKey,
    contentType: evidence.contentType,
  }, config.evidenceSignedUrlTtlSeconds);

  return { url, expiresIn: config.evidenceSignedUrlTtlSeconds, ...range };
}

async function resolveRiskSummaryRange(
  prisma: PrismaClient,
  sessionId: string,
  evidenceObjectId: string,
  recordingStartedAt: Date,
  riskSummaryId: string,
): Promise<{ startTime: number | null; endTime: number | null }> {
  const summary = await prisma.riskSummary.findFirst({
    where: { id: riskSummaryId, sessionId },
    select: { evidenceObjectId: true, windowStartedAt: true, windowEndedAt: true },
  });
  if (!summary || summary.evidenceObjectId !== evidenceObjectId) {
    throw new HttpError(404, "EVIDENCE_NOT_FOUND", "Evidence was not found");
  }
  const startTime = Math.max(0, (summary.windowStartedAt.getTime() - recordingStartedAt.getTime()) / 1_000);
  const endTime = Math.max(startTime, (summary.windowEndedAt.getTime() - recordingStartedAt.getTime()) / 1_000);
  return { startTime: roundSeconds(startTime), endTime: roundSeconds(endTime) };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
