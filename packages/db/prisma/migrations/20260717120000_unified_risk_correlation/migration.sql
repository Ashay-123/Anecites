ALTER TABLE "EditorTelemetryAggregate"
ADD COLUMN "participantId" TEXT;

DROP INDEX "EditorTelemetryAggregate_documentId_windowStartedAt_windowE_key";

CREATE UNIQUE INDEX "EditorTelemetryAggregate_participantId_documentId_windowSta_key"
ON "EditorTelemetryAggregate"("participantId", "documentId", "windowStartedAt", "windowEndedAt");

CREATE INDEX "EditorTelemetryAggregate_participantId_windowStartedAt_idx"
ON "EditorTelemetryAggregate"("participantId", "windowStartedAt");

ALTER TABLE "EditorTelemetryAggregate"
ADD CONSTRAINT "EditorTelemetryAggregate_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RiskSummary"
ADD COLUMN "participantId" TEXT,
ADD COLUMN "correlationKey" TEXT,
ADD COLUMN "meetsCorrelationPolicy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "evidenceReferences" JSONB NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX "RiskSummary_correlationKey_key"
ON "RiskSummary"("correlationKey");

CREATE INDEX "RiskSummary_sessionId_participantId_windowStartedAt_idx"
ON "RiskSummary"("sessionId", "participantId", "windowStartedAt");

ALTER TABLE "RiskSummary"
ADD CONSTRAINT "RiskSummary_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
