CREATE TYPE "SessionRecordingState" AS ENUM ('ACTIVE', 'STOP_REQUESTED', 'COMPLETED', 'FAILED');

CREATE TABLE "SessionRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "egressId" TEXT NOT NULL,
    "evidenceObjectId" TEXT NOT NULL,
    "state" "SessionRecordingState" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stopRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionRecording_egressId_key" ON "SessionRecording"("egressId");
CREATE UNIQUE INDEX "SessionRecording_evidenceObjectId_key" ON "SessionRecording"("evidenceObjectId");
CREATE INDEX "SessionRecording_sessionId_state_createdAt_idx"
ON "SessionRecording"("sessionId", "state", "createdAt");

CREATE UNIQUE INDEX "SessionRecording_one_active_per_session_key"
ON "SessionRecording"("sessionId")
WHERE "state" IN ('ACTIVE', 'STOP_REQUESTED');

ALTER TABLE "SessionRecording"
ADD CONSTRAINT "SessionRecording_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRecording"
ADD CONSTRAINT "SessionRecording_evidenceObjectId_fkey"
FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
