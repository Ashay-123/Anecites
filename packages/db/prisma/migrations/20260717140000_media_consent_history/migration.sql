CREATE TABLE "MediaConsent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaConsent_sessionId_participantId_grantedAt_idx"
ON "MediaConsent"("sessionId", "participantId", "grantedAt");

CREATE INDEX "MediaConsent_participantId_idx"
ON "MediaConsent"("participantId");

CREATE UNIQUE INDEX "MediaConsent_one_active_per_participant_key"
ON "MediaConsent"("sessionId", "participantId")
WHERE "revokedAt" IS NULL;

ALTER TABLE "MediaConsent"
ADD CONSTRAINT "MediaConsent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaConsent"
ADD CONSTRAINT "MediaConsent_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
