import { type PrismaClient } from "@anecites/db";
import { createRecordingVerificationJob, type RecordingVerificationJob } from "@anecites/shared";

import { MediaWorkerError } from "./errors.js";
import { type RecordingVerificationResult } from "./inference-client.js";

export interface ProcessRecordingVerificationJobRequest {
  prisma: PrismaClient;
  job: RecordingVerificationJob;
  verifyRecording(request: {
    storageBucket: string;
    storageKey: string;
    contentType: string;
    durationMs: number | null;
    requestTimeoutMs: number;
  }): Promise<RecordingVerificationResult>;
  absoluteToleranceMs: number;
  relativeTolerancePercent: number;
  leaseDurationMs: number;
  requestTimeoutMs: number;
  now?: () => Date;
}

export async function processRecordingVerificationJob(
  request: ProcessRecordingVerificationJobRequest,
): Promise<{ status: "reviewable" | "incomplete" | "duplicate" }> {
  const job = createRecordingVerificationJob(request.job);
  const now = request.now?.() ?? new Date();
  const recording = await request.prisma.sessionRecording.findFirst({
    where: { sessionId: job.sessionId, evidenceObjectId: job.recordingEvidenceObjectId },
    include: { evidenceObject: true },
  });
  if (!recording) {
    throw new MediaWorkerError("MEDIA_EVIDENCE_NOT_FOUND", "Recording verification evidence was not found");
  }
  if (recording.state !== "COMPLETED") {
    throw new MediaWorkerError("MEDIA_EVIDENCE_INVALID", "Recording has not completed");
  }
  if (recording.verificationState === "REVIEWABLE" || recording.verificationState === "INCOMPLETE") {
    return { status: "duplicate" };
  }

  const expectedDurationMs = Math.max(1, (recording.completedAt ?? recording.stopRequestedAt ?? now).getTime() - recording.startedAt.getTime());
  const staleBefore = new Date(now.getTime() - request.leaseDurationMs);
  const claimed = await request.prisma.sessionRecording.updateMany({
    where: {
      id: recording.id,
      OR: [
        { verificationState: "PENDING" },
        { verificationState: "VERIFYING", verificationStartedAt: { lte: staleBefore } },
      ],
    },
    data: {
      verificationState: "VERIFYING",
      verificationStartedAt: now,
      expectedDurationMs,
      verificationFailureCode: null,
    },
  });
  if (claimed.count !== 1) {
    if (recording.verificationState === "FAILED") {
      return { status: "duplicate" };
    }
    throw new MediaWorkerError("MEDIA_JOB_BUSY", "Recording verification is already in progress");
  }

  try {
    const verified = await request.verifyRecording({
      storageBucket: recording.evidenceObject.storageBucket,
      storageKey: recording.evidenceObject.storageKey,
      contentType: recording.evidenceObject.contentType,
      durationMs: recording.evidenceObject.durationMs,
      requestTimeoutMs: request.requestTimeoutMs,
    });
    const toleranceMs = Math.max(
      request.absoluteToleranceMs,
      Math.round(expectedDurationMs * request.relativeTolerancePercent / 100),
    );
    const complete = Math.abs(verified.durationMs - expectedDurationMs) <= toleranceMs;
    await request.prisma.$transaction([
      request.prisma.evidenceObject.update({
        where: { id: recording.evidenceObjectId },
        data: { durationMs: verified.durationMs, byteSize: BigInt(verified.byteSize) },
      }),
      request.prisma.sessionRecording.update({
        where: { id: recording.id },
        data: {
          verificationState: complete ? "REVIEWABLE" : "INCOMPLETE",
          verificationCompletedAt: request.now?.() ?? new Date(),
          recordedDurationMs: verified.durationMs,
          verificationFailureCode: complete ? null : "DURATION_MISMATCH",
        },
      }),
    ]);
    return { status: complete ? "reviewable" : "incomplete" };
  } catch (error) {
    await request.prisma.sessionRecording.update({
      where: { id: recording.id },
      data: { verificationState: "PENDING", verificationFailureCode: null },
    }).catch(() => undefined);
    throw error;
  }
}

export async function markRecordingVerificationFailed(
  prisma: PrismaClient,
  job: RecordingVerificationJob,
  failureCode: string,
): Promise<void> {
  await prisma.sessionRecording.updateMany({
    where: {
      sessionId: job.sessionId,
      evidenceObjectId: job.recordingEvidenceObjectId,
      verificationState: { in: ["PENDING", "VERIFYING"] },
    },
    data: {
      verificationState: "FAILED",
      verificationCompletedAt: new Date(),
      verificationFailureCode: failureCode.slice(0, 128),
    },
  });
}
