import {
  createNativeApplicationDetectionRules,
  type NativeApplicationDetectionRule,
} from "@anecites/shared";
import { createHash, createPrivateKey } from "node:crypto";

export type NodeEnv = "development" | "test" | "production";
export type CodeExecutionProviderName = "piston" | "judge0";
export type Judge0Provider = "self-hosted";
export type MediaAnalysisSecondVoiceMode = "disabled" | "shadow";
export type MediaAnalysisGazeMode = "disabled" | "shadow";

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
  monitoringProhibitedApplicationRules: readonly NativeApplicationDetectionRule[];
  monitoringPolicyVersion: string;
  monitoringPolicySigningKeyId: string | null;
  monitoringPolicySigningPrivateKeyPkcs8Base64: string | null;
  mediaAnalysisEnabled: boolean;
  mediaConsentNoticeVersion: string;
  mediaConsentNoticeText: string;
  mediaConsentNoticeFingerprint: string;
  mediaAnalysisQueueName: string;
  mediaAnalysisSampleWindowMs: number;
  mediaAnalysisMaxSamplesPerRecording: number;
  mediaAnalysisRequestTimeoutMs: number;
  mediaAnalysisSecondVoiceMode: MediaAnalysisSecondVoiceMode;
  mediaAnalysisGazeMode: MediaAnalysisGazeMode;
  mediaAnalysisShadowQueueName: string;
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
  objectStorageEndpoint: string | null;
  objectStorageBucket: string | null;
  objectStorageAccessKeyId: string | null;
  objectStorageSecretAccessKey: string | null;
  objectStorageRegion: string;
  objectStorageForcePathStyle: boolean;
  recordingStorageKeyPrefix: string;
  evidenceSignedUrlTtlSeconds: number;
  recordingVerificationQueueName: string;
  recordingCompletenessAbsoluteToleranceMs: number;
  recordingCompletenessRelativeTolerancePercent: number;
  recordingVerificationTimeoutMs: number;
  livekitRecordingS3Endpoint: string | null;
  livekitRecordingS3Bucket: string | null;
  livekitRecordingS3AccessKeyId: string | null;
  livekitRecordingS3SecretAccessKey: string | null;
  livekitRecordingS3Region: string;
  livekitRecordingS3ForcePathStyle: boolean;
  livekitRecordingKeyPrefix: string;
  livekitRecordingAutoLifecycleEnabled: boolean;
}

type EnvironmentInput = Record<string, string | undefined>;

const NODE_ENVS = new Set(["development", "test", "production"]);
const CODE_EXECUTION_PROVIDERS = new Set(["piston", "judge0"]);
const MEDIA_ANALYSIS_SECOND_VOICE_MODES = new Set(["disabled", "shadow"]);
const MEDIA_ANALYSIS_GAZE_MODES = new Set(["disabled", "shadow"]);
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUEUE_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DEVELOPMENT_MEDIA_CONSENT_NOTICE_TEXT =
  "Development-only notice: recording and optional media analysis are for local testing only and are not a production consent notice.";

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
  const livekitApiKey = parseOptionalString(env.LIVEKIT_API_KEY);
  const livekitApiSecret = parseOptionalString(env.LIVEKIT_API_SECRET);
  const livekitRecordingS3Endpoint = parseOptionalUrl(
    "LIVEKIT_RECORDING_S3_ENDPOINT",
    env.LIVEKIT_RECORDING_S3_ENDPOINT,
  );
  const objectStorageEndpoint = parseOptionalUrl("S3_ENDPOINT", env.S3_ENDPOINT) ?? livekitRecordingS3Endpoint;
  const objectStorageBucket = parseOptionalString(env.S3_BUCKET);
  const objectStorageAccessKeyId = parseOptionalString(env.S3_ACCESS_KEY_ID);
  const objectStorageSecretAccessKey = parseOptionalString(env.S3_SECRET_ACCESS_KEY);
  const objectStorageRegion = parseOptionalString(env.S3_REGION) ?? "us-east-1";
  const objectStorageForcePathStyle = parseBoolean("S3_FORCE_PATH_STYLE", env.S3_FORCE_PATH_STYLE, true);
  const recordingStorageKeyPrefix = parseStorageKeyPrefix(
    env.RECORDING_STORAGE_KEY_PREFIX ?? env.LIVEKIT_RECORDING_KEY_PREFIX,
    "recordings/livekit",
  );
  const livekitRecordingAutoLifecycleEnabled = parseBoolean(
    "LIVEKIT_RECORDING_AUTO_LIFECYCLE_ENABLED",
    env.LIVEKIT_RECORDING_AUTO_LIFECYCLE_ENABLED,
    false,
  );
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
  const monitoringProhibitedApplicationRules = parseMonitoringProhibitedApplicationRules(
    env.MONITORING_PROHIBITED_APPLICATION_RULES_JSON,
  );
  const monitoringPolicySigningKeyId = parseOptionalString(env.MONITORING_POLICY_SIGNING_KEY_ID);
  const monitoringPolicySigningPrivateKeyPkcs8Base64 = parseOptionalEd25519PrivateKey(
    env.MONITORING_POLICY_SIGNING_PRIVATE_KEY_PKCS8_BASE64,
  );
  const mediaAnalysisEnabled = parseBoolean("MEDIA_ANALYSIS_ENABLED", env.MEDIA_ANALYSIS_ENABLED, false);
  const mediaAnalysisSecondVoiceMode = parseMediaAnalysisSecondVoiceMode(
    env.MEDIA_ANALYSIS_SECOND_VOICE_MODE,
  );
  const mediaAnalysisGazeMode = parseMediaAnalysisGazeMode(env.MEDIA_ANALYSIS_GAZE_MODE);
  if (!mediaAnalysisEnabled && mediaAnalysisGazeMode === "shadow") {
    throw new Error("MEDIA_ANALYSIS_GAZE_MODE=shadow requires MEDIA_ANALYSIS_ENABLED=true");
  }
  const mediaAnalysisQueueName = parseQueueName(env.MEDIA_ANALYSIS_QUEUE_NAME, "media-analysis.jobs");
  const mediaAnalysisShadowQueueName = parseQueueName(
    env.MEDIA_ANALYSIS_SHADOW_QUEUE_NAME,
    "media-analysis.shadow.v1.jobs",
  );
  if (mediaAnalysisQueueName === mediaAnalysisShadowQueueName) {
    throw new Error("MEDIA_ANALYSIS_SHADOW_QUEUE_NAME must differ from MEDIA_ANALYSIS_QUEUE_NAME");
  }
  const mediaConsentNoticeVersion = parseMediaConsentNoticeVersion(env.MEDIA_CONSENT_NOTICE_VERSION);
  const mediaConsentNoticeText = parseMediaConsentNoticeText(nodeEnv, env.MEDIA_CONSENT_NOTICE_TEXT);
  const mediaConsentNoticeFingerprint = createNoticeFingerprint(mediaConsentNoticeText);
  if (Boolean(monitoringPolicySigningKeyId) !== Boolean(monitoringPolicySigningPrivateKeyPkcs8Base64)) {
    throw new Error("MONITORING_POLICY_SIGNING_KEY_ID and MONITORING_POLICY_SIGNING_PRIVATE_KEY_PKCS8_BASE64 must be configured together");
  }
  if (
    nodeEnv === "production" &&
    monitoringProhibitedApplicationRules.length > 0 &&
    !monitoringPolicySigningPrivateKeyPkcs8Base64
  ) {
    throw new Error("A signed monitoring policy is required when prohibited application rules are enabled in production");
  }
  if (nodeEnv === "production" && !env.MEDIA_CONSENT_NOTICE_VERSION?.trim()) {
    throw new Error("MEDIA_CONSENT_NOTICE_VERSION is required in production");
  }

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

  if (
    livekitRecordingAutoLifecycleEnabled &&
    (!livekitApiUrl ||
      !livekitApiKey ||
      !livekitApiSecret ||
      !livekitRecordingS3Endpoint ||
      !objectStorageBucket ||
      !objectStorageAccessKeyId ||
      !objectStorageSecretAccessKey)
  ) {
    throw new Error(
      "LIVEKIT_RECORDING_AUTO_LIFECYCLE_ENABLED requires configured LiveKit credentials and recording storage",
    );
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
    monitoringProhibitedApplicationRules,
    monitoringPolicyVersion: parsePolicyVersion(env.MONITORING_POLICY_VERSION),
    monitoringPolicySigningKeyId,
    monitoringPolicySigningPrivateKeyPkcs8Base64,
    mediaAnalysisEnabled,
    mediaConsentNoticeVersion,
    mediaConsentNoticeText,
    mediaConsentNoticeFingerprint,
    mediaAnalysisQueueName,
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
    mediaAnalysisSecondVoiceMode,
    mediaAnalysisGazeMode,
    mediaAnalysisShadowQueueName,
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
    livekitApiKey,
    livekitApiSecret,
    livekitTokenTtlSeconds,
    objectStorageEndpoint,
    objectStorageBucket,
    objectStorageAccessKeyId,
    objectStorageSecretAccessKey,
    objectStorageRegion,
    objectStorageForcePathStyle,
    recordingStorageKeyPrefix,
    evidenceSignedUrlTtlSeconds: parseBoundedPositiveInteger(
      "EVIDENCE_SIGNED_URL_TTL_SECONDS",
      env.EVIDENCE_SIGNED_URL_TTL_SECONDS,
      900,
      60,
      3_600,
    ),
    recordingVerificationQueueName: parseQueueName(
      env.RECORDING_VERIFICATION_QUEUE_NAME,
      "recording-verification.jobs",
    ),
    recordingCompletenessAbsoluteToleranceMs: parseBoundedPositiveInteger(
      "RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS",
      env.RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS,
      5_000,
      100,
      300_000,
    ),
    recordingCompletenessRelativeTolerancePercent: parseBoundedPositiveNumber(
      "RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT",
      env.RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT,
      2,
      0.01,
      100,
    ),
    recordingVerificationTimeoutMs: parseBoundedPositiveInteger(
      "RECORDING_VERIFICATION_TIMEOUT_MS",
      env.RECORDING_VERIFICATION_TIMEOUT_MS,
      30_000,
      1_000,
      600_000,
    ),
    livekitRecordingS3Endpoint,
    livekitRecordingS3Bucket: objectStorageBucket,
    livekitRecordingS3AccessKeyId: objectStorageAccessKeyId,
    livekitRecordingS3SecretAccessKey: objectStorageSecretAccessKey,
    livekitRecordingS3Region: objectStorageRegion,
    livekitRecordingS3ForcePathStyle: objectStorageForcePathStyle,
    livekitRecordingKeyPrefix: recordingStorageKeyPrefix,
    livekitRecordingAutoLifecycleEnabled,
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

function parseMediaAnalysisSecondVoiceMode(value: string | undefined): MediaAnalysisSecondVoiceMode {
  const mode = value?.trim() || "disabled";
  if (!MEDIA_ANALYSIS_SECOND_VOICE_MODES.has(mode)) {
    throw new Error("MEDIA_ANALYSIS_SECOND_VOICE_MODE must be one of: disabled, shadow");
  }
  return mode as MediaAnalysisSecondVoiceMode;
}

function parseMediaAnalysisGazeMode(value: string | undefined): MediaAnalysisGazeMode {
  const mode = value?.trim() || "disabled";
  if (!MEDIA_ANALYSIS_GAZE_MODES.has(mode)) {
    throw new Error("MEDIA_ANALYSIS_GAZE_MODE must be one of: disabled, shadow");
  }
  return mode as MediaAnalysisGazeMode;
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

function parseBoundedPositiveInteger(
  fieldName: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = parsePositiveInteger(fieldName, value, defaultValue, maximum);
  if (parsed < minimum) {
    throw new Error(`${fieldName} must be at least ${minimum}`);
  }
  return parsed;
}

function parseBoundedPositiveNumber(
  fieldName: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = parsePositiveNumber(fieldName, value, defaultValue, maximum);
  if (parsed < minimum) {
    throw new Error(`${fieldName} must be at least ${minimum}`);
  }
  return parsed;
}

function parseMonitoringProhibitedApplicationRules(value: string | undefined): NativeApplicationDetectionRule[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("MONITORING_PROHIBITED_APPLICATION_RULES_JSON must be valid JSON");
  }

  try {
    return createNativeApplicationDetectionRules(parsed);
  } catch (error) {
    throw new Error(
      `MONITORING_PROHIBITED_APPLICATION_RULES_JSON is invalid: ${error instanceof Error ? error.message : "invalid rule policy"}`,
    );
  }
}

function parsePolicyVersion(value: string | undefined): string {
  const version = value?.trim() || "2026-07-17.1";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(version)) {
    throw new Error("MONITORING_POLICY_VERSION must contain only letters, numbers, dots, underscores, or hyphens");
  }
  return version;
}

function parseMediaConsentNoticeVersion(value: string | undefined): string {
  const version = value?.trim() || "development-v1";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(version)) {
    throw new Error("MEDIA_CONSENT_NOTICE_VERSION must contain only letters, numbers, dots, underscores, or hyphens");
  }
  return version;
}

function parseMediaConsentNoticeText(nodeEnv: NodeEnv, value: string | undefined): string {
  const text = value?.trim() || (nodeEnv === "production" ? "" : DEVELOPMENT_MEDIA_CONSENT_NOTICE_TEXT);

  if (!text) {
    throw new Error("MEDIA_CONSENT_NOTICE_TEXT is required in production");
  }

  if (text.length > 4_000) {
    throw new Error("MEDIA_CONSENT_NOTICE_TEXT must contain at most 4000 characters");
  }

  if (text.includes("\u0000")) {
    throw new Error("MEDIA_CONSENT_NOTICE_TEXT must not contain null characters");
  }

  return text;
}

function createNoticeFingerprint(noticeText: string): string {
  return createHash("sha256").update(noticeText, "utf8").digest("hex");
}

function parseOptionalEd25519PrivateKey(value: string | undefined): string | null {
  const encoded = parseOptionalString(value);
  if (!encoded) {
    return null;
  }
  let key;
  try {
    key = createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new Error("MONITORING_POLICY_SIGNING_PRIVATE_KEY_PKCS8_BASE64 must be a valid PKCS#8 key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("MONITORING_POLICY_SIGNING_PRIVATE_KEY_PKCS8_BASE64 must contain an Ed25519 key");
  }
  return encoded;
}
