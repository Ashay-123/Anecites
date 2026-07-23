CREATE TYPE "MonitoringEventSource" AS ENUM ('DESKTOP_APP', 'DESKTOP_NATIVE', 'EDITOR', 'MEDIA_WORKER', 'SERVER');

CREATE TABLE "MonitoringConsent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "clientInstanceId" TEXT NOT NULL,
    "clientVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "monitoringStartedAt" TIMESTAMP(3) NOT NULL,
    "monitoringStoppedAt" TIMESTAMP(3),
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringHeartbeat" (
    "id" TEXT NOT NULL,
    "monitoringConsentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonitoringHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "monitoringConsentId" TEXT,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT,
    "evidenceObjectId" TEXT,
    "sequence" INTEGER,
    "type" TEXT NOT NULL,
    "source" "MonitoringEventSource" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringConsent_sessionId_participantId_key" ON "MonitoringConsent"("sessionId", "participantId");
CREATE INDEX "MonitoringConsent_sessionId_monitoringStartedAt_idx" ON "MonitoringConsent"("sessionId", "monitoringStartedAt");
CREATE INDEX "MonitoringConsent_participantId_idx" ON "MonitoringConsent"("participantId");
CREATE UNIQUE INDEX "MonitoringHeartbeat_monitoringConsentId_sequence_key" ON "MonitoringHeartbeat"("monitoringConsentId", "sequence");
CREATE INDEX "MonitoringHeartbeat_sessionId_occurredAt_idx" ON "MonitoringHeartbeat"("sessionId", "occurredAt");
CREATE INDEX "MonitoringHeartbeat_participantId_occurredAt_idx" ON "MonitoringHeartbeat"("participantId", "occurredAt");
CREATE UNIQUE INDEX "RiskEvent_monitoringConsentId_sequence_key" ON "RiskEvent"("monitoringConsentId", "sequence");
CREATE INDEX "RiskEvent_sessionId_occurredAt_idx" ON "RiskEvent"("sessionId", "occurredAt");
CREATE INDEX "RiskEvent_participantId_occurredAt_idx" ON "RiskEvent"("participantId", "occurredAt");
CREATE INDEX "RiskEvent_type_idx" ON "RiskEvent"("type");
CREATE INDEX "RiskEvent_evidenceObjectId_idx" ON "RiskEvent"("evidenceObjectId");

ALTER TABLE "MonitoringConsent" ADD CONSTRAINT "MonitoringConsent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringConsent" ADD CONSTRAINT "MonitoringConsent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringHeartbeat" ADD CONSTRAINT "MonitoringHeartbeat_monitoringConsentId_fkey" FOREIGN KEY ("monitoringConsentId") REFERENCES "MonitoringConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringHeartbeat" ADD CONSTRAINT "MonitoringHeartbeat_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringHeartbeat" ADD CONSTRAINT "MonitoringHeartbeat_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_monitoringConsentId_fkey" FOREIGN KEY ("monitoringConsentId") REFERENCES "MonitoringConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_evidenceObjectId_fkey" FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
