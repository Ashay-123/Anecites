export type NodeEnv = "development" | "test" | "production";
export type CodeExecutionProviderName = "piston" | "judge0";
export type Judge0Provider = "self-hosted";

export interface ServerConfig {
  nodeEnv: NodeEnv;
  apiHost: string;
  apiPort: number;
  appOrigin: string;
  localDemoEnabled: boolean;
  localDemoPublicBaseUrl: string | null;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
  evidenceRetentionDays: number;
  recordingRetentionDays: number;
  replayRetentionDays: number;
  telemetryRetentionDays: number;
  riskSummaryRetentionDays: number;
  mediaAnalysisEnabled: boolean;
  mediaAnalysisQueueName: string;
  mediaAnalysisSampleWindowMs: number;
  mediaAnalysisMaxSamplesPerRecording: number;
  mediaAnalysisRequestTimeoutMs: number;
  mediaAnalysisSecondVoiceConfidenceThreshold: number;
  mediaAnalysisFaceMissingConfidenceThreshold: number;
  mediaAnalysisMultipleFacesConfidenceThreshold: number;
  mediaAnalysisGazeOffscreenConfidenceThreshold: number;
  codeExecutionProvider: CodeExecutionProviderName;
  codeExecutionAllowedLanguageIds: readonly number[];
  pistonBaseUrl: string;
  pistonRequestTimeoutMs: number;
  judge0Provider: Judge0Provider;
  judge0BaseUrl: string;
  judge0AuthHeader: string | null;
  judge0AuthToken: string | null;
  judge0RequestTimeoutMs: number;
  judge0AllowedLanguageIds: readonly number[];
  authJwtSecret: string;
  jsonBodyLimit: string;
  codeExecutionCpuTimeLimitSeconds: number;
  codeExecutionWallTimeLimitSeconds: number;
  codeExecutionMemoryLimitKb: number;
  codeExecutionStackLimitKb: number;
  codeExecutionSourceLimitBytes: number;
  codeExecutionStdinLimitBytes: number;
  codeExecutionOutputLimitBytes: number;
  livekitUrl: string | null;
  livekitApiUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  livekitTokenTtlSeconds: number;
  livekitRecordingS3Endpoint: string | null;
  livekitRecordingS3Bucket: string | null;
  livekitRecordingS3AccessKeyId: string | null;
  livekitRecordingS3SecretAccessKey: string | null;
  livekitRecordingS3Region: string;
  livekitRecordingS3ForcePathStyle: boolean;
  livekitRecordingKeyPrefix: string;
}

type EnvironmentInput = Record<string, string | undefined>;

const NODE_ENVS = new Set(["development", "test", "production"]);
const CODE_EXECUTION_PROVIDERS = new Set(["piston", "judge0"]);
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUEUE_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function loadServerConfig(env: EnvironmentInput = process.env): ServerConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const apiHost = env.API_HOST?.trim() || "0.0.0.0";
  const localDemoEnabled = parseBoolean("LOCAL_DEMO_ENABLED", env.LOCAL_DEMO_ENABLED, false);
  const localDemoPublicBaseUrl = parseLocalDemoPublicBaseUrl(env.LOCAL_DEMO_PUBLIC_BASE_URL);
  const codeExecutionProvider = parseCodeExecutionProvider(env.CODE_EXECUTION_PROVIDER);
  const judge0AuthToken = parseOptionalString(env.JUDGE0_AUTHN_TOKEN);
  const judge0AuthHeader = parseOptionalHeaderName(env.JUDGE0_AUTHN_HEADER) ?? (judge0AuthToken ? "X-Judge0-Token" : null);
  const judge0RequestTimeoutMs = parsePositiveInteger("JUDGE0_REQUEST_TIMEOUT_MS", env.JUDGE0_REQUEST_TIMEOUT_MS, 15_000, 60_000);
  const pistonRequestTimeoutMs = parsePositiveInteger("PISTON_REQUEST_TIMEOUT_MS", env.PISTON_REQUEST_TIMEOUT_MS, 15_000, 60_000);
  const livekitTokenTtlSeconds = parsePositiveInteger("LIVEKIT_TOKEN_TTL_SECONDS", env.LIVEKIT_TOKEN_TTL_SECONDS, 3_600, 86_400);
  const livekitUrl = parseOptionalUrl("LIVEKIT_URL", env.LIVEKIT_URL);
  const livekitApiUrl = parseOptionalUrl("LIVEKIT_API_URL", env.LIVEKIT_API_URL) ?? deriveLiveKitApiUrl(livekitUrl);
  const codeExecutionAllowedLanguageIds = parseRequiredPositiveIntegerList(
    "CODE_EXECUTION_ALLOWED_LANGUAGE_IDS",
    env.CODE_EXECUTION_ALLOWED_LANGUAGE_IDS ?? env.JUDGE0_ALLOWED_LANGUAGE_IDS,
  );
  const codeExecutionCpuTimeLimitSeconds = parsePositiveNumber(
    "CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS",
    env.CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS,
    2,
    15,
  );
  const codeExecutionWallTimeLimitSeconds = parsePositiveNumber(
    "CODE_EXECUTION_WALL_TIME_LIMIT_SECONDS",
    env.CODE_EXECUTION_WALL_TIME_LIMIT_SECONDS,
    5,
    30,
  );

  if (codeExecutionWallTimeLimitSeconds < codeExecutionCpuTimeLimitSeconds) {
    throw new Error(
      "CODE_EXECUTION_WALL_TIME_LIMIT_SECONDS must be greater than or equal to CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS",
    );
  }

  if (localDemoEnabled && !isLoopbackHost(apiHost)) {
    throw new Error("LOCAL_DEMO_ENABLED requires API_HOST to be a loopback address");
  }

  if (localDemoPublicBaseUrl && !localDemoEnabled) {
    throw new Error("LOCAL_DEMO_PUBLIC_BASE_URL requires LOCAL_DEMO_ENABLED=true");
  }

  return {
    nodeEnv,
    apiHost,
    apiPort: parsePort(env.API_PORT ?? "3000"),
    appOrigin: parseRequiredUrl("APP_ORIGIN", env.APP_ORIGIN),
    localDemoEnabled,
    localDemoPublicBaseUrl,
    databaseUrl: parseRequiredUrl("DATABASE_URL", env.DATABASE_URL),
    redisUrl: parseRequiredUrl("REDIS_URL", env.REDIS_URL),
    rabbitmqUrl: parseRequiredUrl("RABBITMQ_URL", env.RABBITMQ_URL),
    evidenceRetentionDays: parsePositiveInteger("EVIDENCE_RETENTION_DAYS", env.EVIDENCE_RETENTION_DAYS, 90, 3_650),
    recordingRetentionDays: parsePositiveInteger("RECORDING_RETENTION_DAYS", env.RECORDING_RETENTION_DAYS, 30, 3_650),
    replayRetentionDays: parsePositiveInteger("REPLAY_RETENTION_DAYS", env.REPLAY_RETENTION_DAYS, 90, 3_650),
    telemetryRetentionDays: parsePositiveInteger("TELEMETRY_RETENTION_DAYS", env.TELEMETRY_RETENTION_DAYS, 180, 3_650),
    riskSummaryRetentionDays: parsePositiveInteger(
      "RISK_SUMMARY_RETENTION_DAYS",
      env.RISK_SUMMARY_RETENTION_DAYS,
      365,
      3_650,
    ),
    mediaAnalysisEnabled: parseBoolean("MEDIA_ANALYSIS_ENABLED", env.MEDIA_ANALYSIS_ENABLED, false),
    mediaAnalysisQueueName: parseQueueName(env.MEDIA_ANALYSIS_QUEUE_NAME, "media-analysis.jobs"),
    mediaAnalysisSampleWindowMs: parsePositiveInteger(
      "MEDIA_ANALYSIS_SAMPLE_WINDOW_MS",
      env.MEDIA_ANALYSIS_SAMPLE_WINDOW_MS,
      10_000,
      60_000,
    ),
    mediaAnalysisMaxSamplesPerRecording: parsePositiveInteger(
      "MEDIA_ANALYSIS_MAX_SAMPLES_PER_RECORDING",
      env.MEDIA_ANALYSIS_MAX_SAMPLES_PER_RECORDING,
      12,
      100,
    ),
    mediaAnalysisRequestTimeoutMs: parsePositiveInteger(
      "MEDIA_ANALYSIS_REQUEST_TIMEOUT_MS",
      env.MEDIA_ANALYSIS_REQUEST_TIMEOUT_MS,
      30_000,
      300_000,
    ),
    mediaAnalysisSecondVoiceConfidenceThreshold: parseConfidenceThreshold(
      "MEDIA_ANALYSIS_SECOND_VOICE_CONFIDENCE_THRESHOLD",
      env.MEDIA_ANALYSIS_SECOND_VOICE_CONFIDENCE_THRESHOLD,
      0.8,
    ),
    mediaAnalysisFaceMissingConfidenceThreshold: parseConfidenceThreshold(
      "MEDIA_ANALYSIS_FACE_MISSING_CONFIDENCE_THRESHOLD",
      env.MEDIA_ANALYSIS_FACE_MISSING_CONFIDENCE_THRESHOLD,
      0.8,
    ),
    mediaAnalysisMultipleFacesConfidenceThreshold: parseConfidenceThreshold(
      "MEDIA_ANALYSIS_MULTIPLE_FACES_CONFIDENCE_THRESHOLD",
      env.MEDIA_ANALYSIS_MULTIPLE_FACES_CONFIDENCE_THRESHOLD,
      0.8,
    ),
    mediaAnalysisGazeOffscreenConfidenceThreshold: parseConfidenceThreshold(
      "MEDIA_ANALYSIS_GAZE_OFFSCREEN_CONFIDENCE_THRESHOLD",
      env.MEDIA_ANALYSIS_GAZE_OFFSCREEN_CONFIDENCE_THRESHOLD,
      0.85,
    ),
    codeExecutionProvider,
    codeExecutionAllowedLanguageIds,
    pistonBaseUrl: parseRequiredUrl("PISTON_BASE_URL", env.PISTON_BASE_URL ?? "http://127.0.0.1:2000"),
    pistonRequestTimeoutMs,
    judge0Provider: "self-hosted",
    judge0BaseUrl: parseRequiredUrl("JUDGE0_BASE_URL", env.JUDGE0_BASE_URL ?? "http://localhost:2358"),
    judge0AuthHeader,
    judge0AuthToken,
    judge0RequestTimeoutMs,
    judge0AllowedLanguageIds: codeExecutionAllowedLanguageIds,
    authJwtSecret: parseJwtSecret(env.AUTH_JWT_SECRET),
    jsonBodyLimit: env.JSON_BODY_LIMIT?.trim() || "1mb",
    codeExecutionCpuTimeLimitSeconds,
    codeExecutionWallTimeLimitSeconds,
    codeExecutionMemoryLimitKb: parsePositiveInteger("CODE_EXECUTION_MEMORY_LIMIT_KB", env.CODE_EXECUTION_MEMORY_LIMIT_KB, 131_072, 1_048_576),
    codeExecutionStackLimitKb: parsePositiveInteger("CODE_EXECUTION_STACK_LIMIT_KB", env.CODE_EXECUTION_STACK_LIMIT_KB, 64_000, 128_000),
    codeExecutionSourceLimitBytes: parsePositiveInteger(
      "CODE_EXECUTION_SOURCE_LIMIT_BYTES",
      env.CODE_EXECUTION_SOURCE_LIMIT_BYTES,
      65_536,
      1_048_576,
    ),
    codeExecutionStdinLimitBytes: parsePositiveInteger("CODE_EXECUTION_STDIN_LIMIT_BYTES", env.CODE_EXECUTION_STDIN_LIMIT_BYTES, 8_192, 65_536),
    codeExecutionOutputLimitBytes: parsePositiveInteger(
      "CODE_EXECUTION_OUTPUT_LIMIT_BYTES",
      env.CODE_EXECUTION_OUTPUT_LIMIT_BYTES,
      65_536,
      1_048_576,
    ),
    livekitUrl,
    livekitApiUrl,
    livekitApiKey: parseOptionalString(env.LIVEKIT_API_KEY),
    livekitApiSecret: parseOptionalString(env.LIVEKIT_API_SECRET),
    livekitTokenTtlSeconds,
    livekitRecordingS3Endpoint: parseOptionalUrl(
      "LIVEKIT_RECORDING_S3_ENDPOINT",
      env.LIVEKIT_RECORDING_S3_ENDPOINT,
    ) ?? parseOptionalUrl("S3_ENDPOINT", env.S3_ENDPOINT),
    livekitRecordingS3Bucket: parseOptionalString(env.S3_BUCKET),
    livekitRecordingS3AccessKeyId: parseOptionalString(env.S3_ACCESS_KEY_ID),
    livekitRecordingS3SecretAccessKey: parseOptionalString(env.S3_SECRET_ACCESS_KEY),
    livekitRecordingS3Region: parseOptionalString(env.S3_REGION) ?? "us-east-1",
    livekitRecordingS3ForcePathStyle: parseBoolean("S3_FORCE_PATH_STYLE", env.S3_FORCE_PATH_STYLE, true),
    livekitRecordingKeyPrefix: parseStorageKeyPrefix(env.LIVEKIT_RECORDING_KEY_PREFIX, "recordings/livekit"),
  };
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  const nodeEnv = value?.trim() || "development";
  if (!NODE_ENVS.has(nodeEnv)) {
    throw new Error("NODE_ENV must be one of development, test, or production");
  }
  return nodeEnv as NodeEnv;
}

function parseCodeExecutionProvider(value: string | undefined): CodeExecutionProviderName {
  const provider = value?.trim() || "piston";
  if (!CODE_EXECUTION_PROVIDERS.has(provider)) {
    throw new Error("CODE_EXECUTION_PROVIDER must be one of: piston, judge0");
  }
  return provider as CodeExecutionProviderName;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function parseRequiredUrl(fieldName: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
}

function parseOptionalUrl(fieldName: string, value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
}

function parseLocalDemoPublicBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("LOCAL_DEMO_PUBLIC_BASE_URL must be a valid HTTPS URL");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("LOCAL_DEMO_PUBLIC_BASE_URL must be a valid HTTPS URL without credentials, query, or fragment");
  }

  return url.toString().replace(/\/$/, "");
}

function deriveLiveKitApiUrl(livekitUrl: string | null): string | null {
  if (!livekitUrl) {
    return null;
  }

  const url = new URL(livekitUrl);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  return url.toString().replace(/\/$/, "");
}

function parseJwtSecret(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error("AUTH_JWT_SECRET is required");
  }

  if (trimmed.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
  }

  return trimmed;
}

function parseOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function parseBoolean(fieldName: string, value: string | undefined, defaultValue: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return defaultValue;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  throw new Error(`${fieldName} must be true or false`);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parseStorageKeyPrefix(value: string | undefined, defaultValue: string): string {
  const prefix = value?.trim() || defaultValue;
  return prefix.replace(/^\/+|\/+$/g, "");
}

function parseQueueName(value: string | undefined, defaultValue: string): string {
  const queueName = value?.trim() || defaultValue;

  if (queueName.length > 128 || !QUEUE_NAME_PATTERN.test(queueName)) {
    throw new Error("MEDIA_ANALYSIS_QUEUE_NAME must contain only letters, numbers, dots, underscores, colons, or hyphens");
  }

  return queueName;
}

function parseOptionalHeaderName(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (!HTTP_HEADER_NAME_PATTERN.test(trimmed)) {
    throw new Error("JUDGE0_AUTHN_HEADER must be a valid HTTP header name");
  }

  return trimmed;
}

function parseRequiredPositiveIntegerList(fieldName: string, value: string | undefined): number[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  const parsedValues = trimmed.split(",").map((rawValue) => {
    const parsed = Number(rawValue.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(`${fieldName} must contain positive integer language IDs`);
    }
    return parsed;
  });

  return [...new Set(parsedValues)];
}

function parsePositiveNumber(fieldName: string, value: string | undefined, defaultValue: number, maxValue: number): number {
  const parsed = value?.trim() ? Number(value) : defaultValue;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }

  if (parsed > maxValue) {
    throw new Error(`${fieldName} must be less than or equal to ${maxValue}`);
  }

  return parsed;
}

function parseConfidenceThreshold(fieldName: string, value: string | undefined, defaultValue: number): number {
  const parsed = value?.trim() ? Number(value) : defaultValue;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${fieldName} must be between 0 and 1`);
  }

  return parsed;
}

function parsePositiveInteger(fieldName: string, value: string | undefined, defaultValue: number, maxValue: number): number {
  const parsed = value?.trim() ? Number(value) : defaultValue;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  if (parsed > maxValue) {
    throw new Error(`${fieldName} must be less than or equal to ${maxValue}`);
  }

  return parsed;
}
