ALTER TYPE "GazeCalibrationState" ADD VALUE IF NOT EXISTS 'ABANDONED';

ALTER TABLE "GazeCalibration"
ADD COLUMN "sessionRecordingId" TEXT;

CREATE INDEX "GazeCalibration_sessionRecordingId_createdAt_idx"
ON "GazeCalibration"("sessionRecordingId", "createdAt");

ALTER TABLE "GazeCalibration"
ADD CONSTRAINT "GazeCalibration_sessionRecordingId_fkey"
FOREIGN KEY ("sessionRecordingId") REFERENCES "SessionRecording"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
