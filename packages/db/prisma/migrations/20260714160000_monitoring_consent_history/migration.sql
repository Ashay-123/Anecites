DROP INDEX "MonitoringConsent_sessionId_participantId_key";

ALTER TABLE "MonitoringConsent" ADD COLUMN "stopReason" TEXT;

CREATE INDEX "MonitoringConsent_sessionId_participantId_monitoringStartedAt_idx"
ON "MonitoringConsent"("sessionId", "participantId", "monitoringStartedAt");

CREATE UNIQUE INDEX "MonitoringConsent_one_active_per_participant_key"
ON "MonitoringConsent"("sessionId", "participantId")
WHERE "monitoringStoppedAt" IS NULL AND "revokedAt" IS NULL;
