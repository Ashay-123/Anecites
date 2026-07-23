-- Existing rows cannot establish what exact notice text was shown. They are intentionally
-- made non-current so participants must re-consent against the configured notice fingerprint.
ALTER TABLE "MediaConsent"
ADD COLUMN "noticeFingerprint" TEXT NOT NULL DEFAULT 'legacy-unverifiable';

ALTER TABLE "MediaConsent"
ALTER COLUMN "noticeFingerprint" DROP DEFAULT;
