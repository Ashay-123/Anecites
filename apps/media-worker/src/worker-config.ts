export interface MediaWorkerConfig {
  databaseUrl: string;
  rabbitmqUrl: string;
  queueName: string;
  prefetch: number;
  maxRetries: number;
  retryDelayMs: number;
  jobLeaseMs: number;
  shadowQueueName: string;
  inferenceBaseUrl: string;
  inferenceAuthToken: string;
  inferenceExpectedAdapterVersion: string;
  speakerDiarizationEnabled: boolean;
  recordingVerificationQueueName: string;
  recordingVerificationAbsoluteToleranceMs: number;
  recordingVerificationRelativeTolerancePercent: number;
  recordingVerificationTimeoutMs: number;
}

export function loadMediaWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): MediaWorkerConfig {
  const queueName = parseQueueName(env.MEDIA_ANALYSIS_QUEUE_NAME ?? "media-analysis.jobs");
  const shadowQueueName = parseQueueName(
    env.MEDIA_ANALYSIS_SHADOW_QUEUE_NAME ?? "media-analysis.shadow.v1.jobs",
  );
  if (queueName === shadowQueueName) {
    throw new Error("MEDIA_ANALYSIS_SHADOW_QUEUE_NAME must differ from MEDIA_ANALYSIS_QUEUE_NAME");
  }

  return {
    databaseUrl: parseUrl("DATABASE_URL", env.DATABASE_URL, ["postgres:", "postgresql:"]),
    rabbitmqUrl: parseUrl("RABBITMQ_URL", env.RABBITMQ_URL, ["amqp:", "amqps:"]),
    queueName,
    prefetch: parseInteger("MEDIA_ANALYSIS_CONSUMER_PREFETCH", env.MEDIA_ANALYSIS_CONSUMER_PREFETCH, 1, 1, 32),
    maxRetries: parseInteger("MEDIA_ANALYSIS_MAX_RETRIES", env.MEDIA_ANALYSIS_MAX_RETRIES, 3, 0, 20),
    retryDelayMs: parseInteger("MEDIA_ANALYSIS_RETRY_DELAY_MS", env.MEDIA_ANALYSIS_RETRY_DELAY_MS, 5_000, 100, 900_000),
    jobLeaseMs: parseInteger("MEDIA_ANALYSIS_JOB_LEASE_MS", env.MEDIA_ANALYSIS_JOB_LEASE_MS, 600_000, 1_000, 1_800_000),
    shadowQueueName,
    inferenceBaseUrl: parseUrl("MEDIA_INFERENCE_BASE_URL", env.MEDIA_INFERENCE_BASE_URL, ["http:", "https:"]),
    inferenceAuthToken: requireString("MEDIA_INFERENCE_AUTH_TOKEN", env.MEDIA_INFERENCE_AUTH_TOKEN),
    inferenceExpectedAdapterVersion: requireString(
      "MEDIA_INFERENCE_EXPECTED_ADAPTER_VERSION",
      env.MEDIA_INFERENCE_EXPECTED_ADAPTER_VERSION,
    ),
    speakerDiarizationEnabled: parseBoolean(
      "MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED",
      env.MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED,
      false,
    ),
    recordingVerificationQueueName: parseQueueName(
      env.RECORDING_VERIFICATION_QUEUE_NAME ?? "recording-verification.jobs",
    ),
    recordingVerificationAbsoluteToleranceMs: parseInteger(
      "RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS", env.RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS, 5_000, 0, 300_000,
    ),
    recordingVerificationRelativeTolerancePercent: parseInteger(
      "RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT", env.RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT, 2, 0, 100,
    ),
    recordingVerificationTimeoutMs: parseInteger(
      "RECORDING_VERIFICATION_TIMEOUT_MS", env.RECORDING_VERIFICATION_TIMEOUT_MS, 30_000, 1_000, 300_000,
    ),
  };
}

function parseUrl(fieldName: string, value: string | undefined, protocols: readonly string[]): string {
  const normalized = requireString(fieldName, value);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw new Error(`${fieldName} must be a valid URL`, { cause: error });
  }
  if (!protocols.includes(parsed.protocol)) {
    const protocolNames = protocols.map((protocol) => protocol.slice(0, -1)).join(" or ");
    throw new Error(`${fieldName} must use ${protocolNames}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function parseQueueName(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new Error("MEDIA_ANALYSIS_QUEUE_NAME must contain at most 128 letters, numbers, dots, underscores, or hyphens");
  }
  return normalized;
}

function parseInteger(
  fieldName: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined || value.trim().length === 0 ? defaultValue : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function requireString(fieldName: string, value: string | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function parseBoolean(fieldName: string, value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${fieldName} must be true or false`);
}
