ALTER TABLE "MediaAnalysisJobRun" ADD COLUMN "payloadSha256" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "MediaAnalysisJobRun" ALTER COLUMN "payloadSha256" DROP DEFAULT;
