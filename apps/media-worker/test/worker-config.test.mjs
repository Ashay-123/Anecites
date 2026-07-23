import test from "node:test";
import assert from "node:assert/strict";

import { loadMediaWorkerConfig } from "../dist/index.js";

const validEnv = {
  DATABASE_URL: "postgresql://anecites:password@postgres:5432/anecites",
  RABBITMQ_URL: "amqp://anecites:password@rabbitmq:5672",
  MEDIA_ANALYSIS_QUEUE_NAME: "media-analysis.jobs",
  MEDIA_ANALYSIS_CONSUMER_PREFETCH: "1",
  MEDIA_ANALYSIS_MAX_RETRIES: "3",
  MEDIA_ANALYSIS_RETRY_DELAY_MS: "5000",
  MEDIA_ANALYSIS_JOB_LEASE_MS: "600000",
  MEDIA_ANALYSIS_SHADOW_QUEUE_NAME: "media-analysis.shadow.v1.jobs",
  MEDIA_INFERENCE_BASE_URL: "http://media-inference:8080",
  MEDIA_INFERENCE_AUTH_TOKEN: "test-inference-token",
  MEDIA_INFERENCE_EXPECTED_ADAPTER_VERSION: "test-adapter-v1",
  MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED: "false",
  RECORDING_VERIFICATION_QUEUE_NAME: "recording-verification.jobs",
  RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS: "5000",
  RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT: "2",
  RECORDING_VERIFICATION_TIMEOUT_MS: "30000",
};

test("loadMediaWorkerConfig parses a bounded worker environment", () => {
  assert.deepEqual(loadMediaWorkerConfig(validEnv), {
    databaseUrl: validEnv.DATABASE_URL,
    rabbitmqUrl: validEnv.RABBITMQ_URL,
    queueName: "media-analysis.jobs",
    prefetch: 1,
    maxRetries: 3,
    retryDelayMs: 5000,
    jobLeaseMs: 600000,
    shadowQueueName: "media-analysis.shadow.v1.jobs",
    inferenceBaseUrl: validEnv.MEDIA_INFERENCE_BASE_URL,
    inferenceAuthToken: "test-inference-token",
    inferenceExpectedAdapterVersion: "test-adapter-v1",
    speakerDiarizationEnabled: false,
    recordingVerificationQueueName: "recording-verification.jobs",
    recordingVerificationAbsoluteToleranceMs: 5000,
    recordingVerificationRelativeTolerancePercent: 2,
    recordingVerificationTimeoutMs: 30000,
  });
});

test("loadMediaWorkerConfig rejects missing secrets, unsupported URLs, and unsafe limits", () => {
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, MEDIA_INFERENCE_AUTH_TOKEN: "" }),
    /MEDIA_INFERENCE_AUTH_TOKEN is required/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, RABBITMQ_URL: "http://rabbitmq:5672" }),
    /RABBITMQ_URL must use amqp or amqps/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, MEDIA_ANALYSIS_CONSUMER_PREFETCH: "0" }),
    /MEDIA_ANALYSIS_CONSUMER_PREFETCH must be an integer between 1 and 32/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, MEDIA_ANALYSIS_JOB_LEASE_MS: "999" }),
    /MEDIA_ANALYSIS_JOB_LEASE_MS must be an integer between 1000 and 1800000/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED: "sometimes" }),
    /MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED must be true or false/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, MEDIA_ANALYSIS_SHADOW_QUEUE_NAME: validEnv.MEDIA_ANALYSIS_QUEUE_NAME }),
    /MEDIA_ANALYSIS_SHADOW_QUEUE_NAME must differ from MEDIA_ANALYSIS_QUEUE_NAME/,
  );
  assert.throws(
    () => loadMediaWorkerConfig({ ...validEnv, RECORDING_VERIFICATION_TIMEOUT_MS: "999" }),
    /RECORDING_VERIFICATION_TIMEOUT_MS must be an integer between 1000 and 300000/,
  );
});
