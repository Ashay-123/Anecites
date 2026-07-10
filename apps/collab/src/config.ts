export interface CollabConfig {
  host: string;
  port: number;
  authJwtSecret: string;
  databaseUrl: string;
  redisUrl: string;
  telemetryRawStreamKey: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Region: string;
  replayEvidenceKeyPrefix: string;
}

export function loadCollabConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const host = normalizeOptionalString(env.COLLAB_HOST) ?? "127.0.0.1";
  const port = parsePort(env.COLLAB_PORT ?? "3001", "COLLAB_PORT");
  const authJwtSecret = requiredString(env.AUTH_JWT_SECRET, "AUTH_JWT_SECRET");
  const databaseUrl = parseRequiredUrl("DATABASE_URL", env.DATABASE_URL);
  const redisUrl = parseRequiredUrl("REDIS_URL", env.REDIS_URL);
  const telemetryRawStreamKey =
    normalizeOptionalString(env.COLLAB_TELEMETRY_RAW_STREAM_KEY) ?? "anecites:editor:raw";
  const s3Endpoint = parseRequiredUrl("S3_ENDPOINT", env.S3_ENDPOINT);
  const s3Bucket = requiredString(env.S3_BUCKET, "S3_BUCKET");
  const s3AccessKeyId = requiredString(env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = requiredString(env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY");
  const s3Region = normalizeOptionalString(env.S3_REGION) ?? "us-east-1";
  const replayEvidenceKeyPrefix =
    normalizeOptionalString(env.COLLAB_REPLAY_EVIDENCE_KEY_PREFIX) ?? "replay/editor";

  if (authJwtSecret.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
  }

  return {
    host,
    port,
    authJwtSecret,
    databaseUrl,
    redisUrl,
    telemetryRawStreamKey,
    s3Endpoint,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3Region,
    replayEvidenceKeyPrefix,
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredString(value: string | undefined, name: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function parsePort(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return parsed;
}

function parseRequiredUrl(name: string, value: string | undefined): string {
  const normalized = requiredString(value, name);

  try {
    new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  return normalized;
}
