CREATE TYPE "MediaAnalysisJobRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED');

CREATE TABLE "MediaAnalysisJobRun" (
    "jobId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordingEvidenceObjectId" TEXT NOT NULL,
    "status" "MediaAnalysisJobRunStatus" NOT NULL DEFAULT 'PENDING',
    "leaseVersion" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "riskSummaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAnalysisJobRun_pkey" PRIMARY KEY ("jobId")
);

CREATE UNIQUE INDEX "MediaAnalysisJobRun_riskSummaryId_key" ON "MediaAnalysisJobRun"("riskSummaryId");
CREATE INDEX "MediaAnalysisJobRun_status_lockedAt_idx" ON "MediaAnalysisJobRun"("status", "lockedAt");
CREATE INDEX "MediaAnalysisJobRun_sessionId_createdAt_idx" ON "MediaAnalysisJobRun"("sessionId", "createdAt");
CREATE INDEX "MediaAnalysisJobRun_recordingEvidenceObjectId_idx" ON "MediaAnalysisJobRun"("recordingEvidenceObjectId");

ALTER TABLE "MediaAnalysisJobRun" ADD CONSTRAINT "MediaAnalysisJobRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAnalysisJobRun" ADD CONSTRAINT "MediaAnalysisJobRun_recordingEvidenceObjectId_fkey" FOREIGN KEY ("recordingEvidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAnalysisJobRun" ADD CONSTRAINT "MediaAnalysisJobRun_riskSummaryId_fkey" FOREIGN KEY ("riskSummaryId") REFERENCES "RiskSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
