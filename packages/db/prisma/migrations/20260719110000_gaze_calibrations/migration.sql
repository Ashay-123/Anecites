CREATE TYPE "GazeCalibrationState" AS ENUM ('ACTIVE', 'COMPLETED');

CREATE TABLE "GazeCalibration" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "state" "GazeCalibrationState" NOT NULL DEFAULT 'ACTIVE',
    "steps" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GazeCalibration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GazeCalibration_sessionId_participantId_state_createdAt_idx"
ON "GazeCalibration"("sessionId", "participantId", "state", "createdAt");
CREATE INDEX "GazeCalibration_participantId_createdAt_idx"
ON "GazeCalibration"("participantId", "createdAt");
CREATE UNIQUE INDEX "GazeCalibration_one_active_per_candidate_key"
ON "GazeCalibration"("sessionId", "participantId")
WHERE "state" = 'ACTIVE';

ALTER TABLE "GazeCalibration"
ADD CONSTRAINT "GazeCalibration_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GazeCalibration"
ADD CONSTRAINT "GazeCalibration_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
