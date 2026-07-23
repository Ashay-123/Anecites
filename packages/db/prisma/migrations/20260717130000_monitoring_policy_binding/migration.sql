ALTER TABLE "MonitoringConsent"
ADD COLUMN "policyDigestSha256" TEXT,
ADD COLUMN "nativeMonitoringPolicy" JSONB;
