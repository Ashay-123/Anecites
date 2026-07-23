CREATE TYPE "RecordingVerificationState" AS ENUM ('PENDING', 'VERIFYING', 'REVIEWABLE', 'INCOMPLETE', 'FAILED');

ALTER TABLE "SessionRecording"
ADD COLUMN "verificationState" "RecordingVerificationState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "verificationStartedAt" TIMESTAMP(3),
ADD COLUMN "verificationCompletedAt" TIMESTAMP(3),
ADD COLUMN "expectedDurationMs" INTEGER,
ADD COLUMN "recordedDurationMs" INTEGER,
ADD COLUMN "verificationFailureCode" TEXT;

CREATE INDEX "SessionRecording_verificationState_createdAt_idx"
ON "SessionRecording"("verificationState", "createdAt");
