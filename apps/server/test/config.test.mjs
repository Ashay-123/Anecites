import test from "node:test";
import assert from "node:assert/strict";

import { loadServerConfig } from "../dist/index.js";

const validEnv = {
  NODE_ENV: "test",
  API_HOST: "127.0.0.1",
  API_PORT: "3000",
  APP_ORIGIN: "http://localhost:5173",
  LOCAL_DEMO_ENABLED: "false",
  LOCAL_DEMO_PUBLIC_BASE_URL: "",
  DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
  EVIDENCE_RETENTION_DAYS: "90",
  RECORDING_RETENTION_DAYS: "30",
  REPLAY_RETENTION_DAYS: "90",
  TELEMETRY_RETENTION_DAYS: "180",
  RISK_SUMMARY_RETENTION_DAYS: "365",
  MEDIA_ANALYSIS_ENABLED: "true",
  MEDIA_ANALYSIS_QUEUE_NAME: "media-analysis.jobs",
  MEDIA_ANALYSIS_SAMPLE_WINDOW_MS: "10000",
  MEDIA_ANALYSIS_MAX_SAMPLES_PER_RECORDING: "12",
  MEDIA_ANALYSIS_REQUEST_TIMEOUT_MS: "30000",
  MEDIA_ANALYSIS_SECOND_VOICE_CONFIDENCE_THRESHOLD: "0.8",
  MEDIA_ANALYSIS_FACE_MISSING_CONFIDENCE_THRESHOLD: "0.8",
  MEDIA_ANALYSIS_MULTIPLE_FACES_CONFIDENCE_THRESHOLD: "0.8",
  MEDIA_ANALYSIS_GAZE_OFFSCREEN_CONFIDENCE_THRESHOLD: "0.85",
  CODE_EXECUTION_PROVIDER: "piston",
  CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: "63,71",
  PISTON_BASE_URL: "http://127.0.0.1:2000",
  PISTON_REQUEST_TIMEOUT_MS: "15000",
  JUDGE0_BASE_URL: "http://localhost:2358",
  JUDGE0_AUTHN_HEADER: "X-Judge0-Token",
  JUDGE0_AUTHN_TOKEN: "test-judge0-token",
  JUDGE0_REQUEST_TIMEOUT_MS: "15000",
  JUDGE0_ALLOWED_LANGUAGE_IDS: "63,71",
  AUTH_JWT_SECRET: "test_auth_secret_minimum_32_characters",
};

test("loadServerConfig accepts the required API server environment", () => {
  assert.deepEqual(loadServerConfig(validEnv), {
    nodeEnv: "test",
    apiHost: "127.0.0.1",
    apiPort: 3000,
    appOrigin: "http://localhost:5173",
    localDemoEnabled: false,
    localDemoPublicBaseUrl: null,
    databaseUrl: validEnv.DATABASE_URL,
    redisUrl: validEnv.REDIS_URL,
    rabbitmqUrl: validEnv.RABBITMQ_URL,
    evidenceRetentionDays: 90,
    recordingRetentionDays: 30,
    replayRetentionDays: 90,
    telemetryRetentionDays: 180,
    riskSummaryRetentionDays: 365,
    mediaAnalysisEnabled: true,
    mediaAnalysisQueueName: "media-analysis.jobs",
    mediaAnalysisSampleWindowMs: 10000,
    mediaAnalysisMaxSamplesPerRecording: 12,
    mediaAnalysisRequestTimeoutMs: 30000,
    mediaAnalysisSecondVoiceConfidenceThreshold: 0.8,
    mediaAnalysisFaceMissingConfidenceThreshold: 0.8,
    mediaAnalysisMultipleFacesConfidenceThreshold: 0.8,
    mediaAnalysisGazeOffscreenConfidenceThreshold: 0.85,
    codeExecutionProvider: "piston",
    codeExecutionAllowedLanguageIds: [63, 71],
    pistonBaseUrl: validEnv.PISTON_BASE_URL,
    pistonRequestTimeoutMs: 15000,
    judge0Provider: "self-hosted",
    judge0BaseUrl: validEnv.JUDGE0_BASE_URL,
    judge0AuthHeader: validEnv.JUDGE0_AUTHN_HEADER,
    judge0AuthToken: validEnv.JUDGE0_AUTHN_TOKEN,
    judge0RequestTimeoutMs: 15000,
    judge0AllowedLanguageIds: [63, 71],
    authJwtSecret: validEnv.AUTH_JWT_SECRET,
    jsonBodyLimit: "1mb",
    codeExecutionCpuTimeLimitSeconds: 2,
    codeExecutionWallTimeLimitSeconds: 5,
    codeExecutionMemoryLimitKb: 131072,
    codeExecutionStackLimitKb: 64000,
    codeExecutionSourceLimitBytes: 65536,
    codeExecutionStdinLimitBytes: 8192,
    codeExecutionOutputLimitBytes: 65536,
    livekitUrl: null,
    livekitApiUrl: null,
    livekitApiKey: null,
    livekitApiSecret: null,
    livekitTokenTtlSeconds: 3600,
    livekitRecordingS3Endpoint: null,
    livekitRecordingS3Bucket: null,
    livekitRecordingS3AccessKeyId: null,
    livekitRecordingS3SecretAccessKey: null,
    livekitRecordingS3Region: "us-east-1",
    livekitRecordingS3ForcePathStyle: true,
    livekitRecordingKeyPrefix: "recordings/livekit",
  });
});

test("loadServerConfig fails closed when required values are missing", () => {
  const env = { ...validEnv };
  delete env.DATABASE_URL;

  assert.throws(
    () => loadServerConfig(env),
    /DATABASE_URL is required/,
  );
});

test("loadServerConfig restricts local demo mode to loopback hosts", () => {
  assert.equal(
    loadServerConfig({
      ...validEnv,
      LOCAL_DEMO_ENABLED: "true",
    }).localDemoEnabled,
    true,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        API_HOST: "0.0.0.0",
        LOCAL_DEMO_ENABLED: "true",
      }),
    /LOCAL_DEMO_ENABLED requires API_HOST to be a loopback address/,
  );
});

test("loadServerConfig validates optional public demo URLs", () => {
  assert.equal(
    loadServerConfig({
      ...validEnv,
      LOCAL_DEMO_ENABLED: "true",
      LOCAL_DEMO_PUBLIC_BASE_URL: "https://demo.trycloudflare.com/",
    }).localDemoPublicBaseUrl,
    "https://demo.trycloudflare.com",
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        LOCAL_DEMO_ENABLED: "true",
        LOCAL_DEMO_PUBLIC_BASE_URL: "http://demo.example.com",
      }),
    /LOCAL_DEMO_PUBLIC_BASE_URL must be a valid HTTPS URL/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        LOCAL_DEMO_PUBLIC_BASE_URL: "https://demo.example.com",
      }),
    /LOCAL_DEMO_PUBLIC_BASE_URL requires LOCAL_DEMO_ENABLED=true/,
  );
});

test("loadServerConfig fails closed when no code execution languages are allowed", () => {
  assert.throws(
    () => loadServerConfig({ ...validEnv, CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: "" }),
    /CODE_EXECUTION_ALLOWED_LANGUAGE_IDS is required/,
  );
});

test("loadServerConfig validates data-retention settings", () => {
  const defaultConfig = loadServerConfig({
    ...validEnv,
    EVIDENCE_RETENTION_DAYS: "",
    RECORDING_RETENTION_DAYS: "",
    REPLAY_RETENTION_DAYS: "",
    TELEMETRY_RETENTION_DAYS: "",
    RISK_SUMMARY_RETENTION_DAYS: "",
  });

  assert.equal(defaultConfig.evidenceRetentionDays, 90);
  assert.equal(defaultConfig.recordingRetentionDays, 30);
  assert.equal(defaultConfig.replayRetentionDays, 90);
  assert.equal(defaultConfig.telemetryRetentionDays, 180);
  assert.equal(defaultConfig.riskSummaryRetentionDays, 365);

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        EVIDENCE_RETENTION_DAYS: "0",
      }),
    /EVIDENCE_RETENTION_DAYS must be a positive integer/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        RECORDING_RETENTION_DAYS: "3661",
      }),
    /RECORDING_RETENTION_DAYS must be less than or equal to 3650/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        RISK_SUMMARY_RETENTION_DAYS: "forever",
      }),
    /RISK_SUMMARY_RETENTION_DAYS must be a positive integer/,
  );
});

test("loadServerConfig validates media-analysis settings", () => {
  const disabledByDefault = loadServerConfig({
    ...validEnv,
    MEDIA_ANALYSIS_ENABLED: "",
    MEDIA_ANALYSIS_QUEUE_NAME: "",
  });

  assert.equal(disabledByDefault.mediaAnalysisEnabled, false);
  assert.equal(disabledByDefault.mediaAnalysisQueueName, "media-analysis.jobs");

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_ENABLED: "sometimes",
      }),
    /MEDIA_ANALYSIS_ENABLED must be true or false/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_QUEUE_NAME: "../unsafe",
      }),
    /MEDIA_ANALYSIS_QUEUE_NAME must contain only/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_SAMPLE_WINDOW_MS: "60001",
      }),
    /MEDIA_ANALYSIS_SAMPLE_WINDOW_MS must be less than or equal to 60000/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_MAX_SAMPLES_PER_RECORDING: "101",
      }),
    /MEDIA_ANALYSIS_MAX_SAMPLES_PER_RECORDING must be less than or equal to 100/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_REQUEST_TIMEOUT_MS: "300001",
      }),
    /MEDIA_ANALYSIS_REQUEST_TIMEOUT_MS must be less than or equal to 300000/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        MEDIA_ANALYSIS_SECOND_VOICE_CONFIDENCE_THRESHOLD: "1.1",
      }),
    /MEDIA_ANALYSIS_SECOND_VOICE_CONFIDENCE_THRESHOLD must be between 0 and 1/,
  );
});

test("loadServerConfig validates code execution provider settings", () => {
  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        CODE_EXECUTION_PROVIDER: "invalid",
      }),
    /CODE_EXECUTION_PROVIDER must be/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        PISTON_BASE_URL: "not-a-url",
      }),
    /PISTON_BASE_URL must be a valid URL/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        PISTON_REQUEST_TIMEOUT_MS: "60001",
      }),
    /PISTON_REQUEST_TIMEOUT_MS must be less than or equal to 60000/,
  );
});

test("loadServerConfig validates LiveKit settings", () => {
  const config = loadServerConfig({
    ...validEnv,
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "devsecret",
    LIVEKIT_TOKEN_TTL_SECONDS: "900",
  });

  assert.equal(config.livekitUrl, "ws://127.0.0.1:7880");
  assert.equal(config.livekitApiUrl, "http://127.0.0.1:7880");
  assert.equal(config.livekitApiKey, "devkey");
  assert.equal(config.livekitApiSecret, "devsecret");
  assert.equal(config.livekitTokenTtlSeconds, 900);

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        LIVEKIT_URL: "not-a-url",
      }),
    /LIVEKIT_URL must be a valid URL/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        LIVEKIT_TOKEN_TTL_SECONDS: "86401",
      }),
    /LIVEKIT_TOKEN_TTL_SECONDS must be less than or equal to 86400/,
  );

  const recordingConfig = loadServerConfig({
    ...validEnv,
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_BUCKET: "anecites-dev",
    S3_ACCESS_KEY_ID: "anecites",
    S3_SECRET_ACCESS_KEY: "anecites_dev_password",
    S3_REGION: "us-west-2",
    S3_FORCE_PATH_STYLE: "false",
    LIVEKIT_RECORDING_KEY_PREFIX: "custom/livekit",
    LIVEKIT_RECORDING_S3_ENDPOINT: "http://minio:9000",
  });

  assert.equal(recordingConfig.livekitRecordingS3Endpoint, "http://minio:9000");
  assert.equal(recordingConfig.livekitRecordingS3Bucket, "anecites-dev");
  assert.equal(recordingConfig.livekitRecordingS3AccessKeyId, "anecites");
  assert.equal(recordingConfig.livekitRecordingS3SecretAccessKey, "anecites_dev_password");
  assert.equal(recordingConfig.livekitRecordingS3Region, "us-west-2");
  assert.equal(recordingConfig.livekitRecordingS3ForcePathStyle, false);
  assert.equal(recordingConfig.livekitRecordingKeyPrefix, "custom/livekit");
});

test("loadServerConfig rejects unsafe Judge0 execution limits", () => {
  assert.throws(
    () => loadServerConfig({ ...validEnv, CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS: "0" }),
    /CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS must be greater than 0/,
  );

  assert.throws(
    () =>
      loadServerConfig({
        ...validEnv,
        CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS: "6",
        CODE_EXECUTION_WALL_TIME_LIMIT_SECONDS: "5",
      }),
    /CODE_EXECUTION_WALL_TIME_LIMIT_SECONDS must be greater than or equal to CODE_EXECUTION_CPU_TIME_LIMIT_SECONDS/,
  );

  assert.throws(
    () => loadServerConfig({ ...validEnv, CODE_EXECUTION_STACK_LIMIT_KB: "128001" }),
    /CODE_EXECUTION_STACK_LIMIT_KB must be less than or equal to 128000/,
  );

  assert.throws(
    () => loadServerConfig({ ...validEnv, JUDGE0_REQUEST_TIMEOUT_MS: "60001" }),
    /JUDGE0_REQUEST_TIMEOUT_MS must be less than or equal to 60000/,
  );
});

test("loadServerConfig rejects invalid ports and origins", () => {
  assert.throws(
    () => loadServerConfig({ ...validEnv, API_PORT: "70000" }),
    /API_PORT must be an integer between 1 and 65535/,
  );

  assert.throws(
    () => loadServerConfig({ ...validEnv, APP_ORIGIN: "not-a-url" }),
    /APP_ORIGIN must be a valid URL/,
  );
});
