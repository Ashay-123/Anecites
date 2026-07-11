import test from "node:test";
import assert from "node:assert/strict";

import {
  MEDIA_ANALYSIS_MODES,
  RISK_SIGNAL_TYPES,
  createMediaAnalysisJob,
} from "@anecites/shared";
import { createVideoAnalysisAdapter, processMediaAnalysisJob } from "../dist/index.js";

const baseRequest = {
  sessionId: "session-1",
  recordingEvidenceObjectId: "recording-evidence-1",
  storageBucket: "anecites-dev",
  storageKey: "recordings/session-1.mp4",
  contentType: "video/mp4",
  durationMs: 60000,
  sampleWindowMs: 10000,
  maxSamplesPerRecording: 12,
  requestTimeoutMs: 30000,
  requestedModes: [
    MEDIA_ANALYSIS_MODES.videoFacePresence,
    MEDIA_ANALYSIS_MODES.videoGazeOffscreen,
  ],
  confidenceThresholds: {
    secondVoice: 0.8,
    faceMissing: 0.8,
    multipleFaces: 0.8,
    gazeOffscreen: 0.85,
  },
};

test("video analysis adapter maps no-face and multi-face fixtures to bounded observations", async () => {
  const adapter = createVideoAnalysisAdapter({
    adapterVersion: "test-video-v1",
    minimumFaceMissingDurationMs: 3000,
    minimumMultipleFacesDurationMs: 1000,
    analyzeVideoWindows: async () => [
      {
        faceCount: 0,
        faceConfidence: 0.9,
        startedAtMs: 1000,
        endedAtMs: 4500,
        rawFrame: "must-not-be-copied",
      },
      {
        faceCount: 2,
        faceConfidence: 0.88,
        startedAtMs: 6000,
        endedAtMs: 7600,
        landmarks: [1, 2, 3],
      },
    ],
  });

  const observations = await adapter.analyzeVideo({
    ...baseRequest,
    requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
  });

  assert.deepEqual(observations, [
    {
      kind: "face_missing",
      confidence: 0.9,
      durationMs: 3500,
      sampleStartedAt: "1970-01-01T00:00:01.000Z",
      sampleEndedAt: "1970-01-01T00:00:04.500Z",
      adapterVersion: "test-video-v1",
    },
    {
      kind: "multiple_faces",
      confidence: 0.88,
      durationMs: 1600,
      sampleStartedAt: "1970-01-01T00:00:06.000Z",
      sampleEndedAt: "1970-01-01T00:00:07.600Z",
      adapterVersion: "test-video-v1",
      faceCount: 2,
    },
  ]);
  assert.equal(JSON.stringify(observations).includes("rawFrame"), false);
  assert.equal(JSON.stringify(observations).includes("landmarks"), false);
});

test("video analysis adapter requires calibration before gaze observations are emitted", async () => {
  const uncalibratedAdapter = createVideoAnalysisAdapter({
    adapterVersion: "test-video-v1",
    analyzeVideoWindows: async () => [
      {
        faceCount: 1,
        faceConfidence: 0.96,
        gazeOffscreenConfidence: 0.97,
        startedAtMs: 5000,
        endedAtMs: 8400,
        landmarks: [1, 2, 3],
      },
    ],
  });

  assert.deepEqual(await uncalibratedAdapter.analyzeVideo(baseRequest), []);

  const calibratedAdapter = createVideoAnalysisAdapter({
    adapterVersion: "test-video-v1",
    calibrationId: "calibration-1",
    analyzeVideoWindows: async () => [
      {
        faceCount: 1,
        faceConfidence: 0.96,
        gazeOffscreenConfidence: 0.91,
        startedAtMs: 5000,
        endedAtMs: 7900,
      },
    ],
  });

  assert.deepEqual(await calibratedAdapter.analyzeVideo(baseRequest), [
    {
      kind: "gaze_offscreen",
      confidence: 0.91,
      durationMs: 2900,
      sampleStartedAt: "1970-01-01T00:00:05.000Z",
      sampleEndedAt: "1970-01-01T00:00:07.900Z",
      adapterVersion: "test-video-v1",
      calibrationId: "calibration-1",
    },
  ]);
});

test("uncalibrated gaze fixture cannot produce high-confidence risk signals", async () => {
  const adapter = createVideoAnalysisAdapter({
    adapterVersion: "test-video-v1",
    analyzeVideoWindows: async () => [
      {
        faceCount: 1,
        faceConfidence: 0.96,
        gazeOffscreenConfidence: 0.99,
        startedAtMs: 5000,
        endedAtMs: 9000,
      },
    ],
  });
  const job = createMediaAnalysisJob({
    sessionId: "session-1",
    recordingEvidenceObjectId: "recording-evidence-1",
    requestedModes: [MEDIA_ANALYSIS_MODES.videoGazeOffscreen],
    options: {
      sampleWindowMs: 10000,
      maxSamplesPerRecording: 12,
      requestTimeoutMs: 30000,
      confidenceThresholds: baseRequest.confidenceThresholds,
    },
  });
  const prisma = {
    evidenceObject: {
      async findUnique() {
        return {
          id: "recording-evidence-1",
          sessionId: "session-1",
          kind: "SESSION_RECORDING",
          storageBucket: "anecites-dev",
          storageKey: "recordings/session-1.mp4",
          contentType: "video/mp4",
          durationMs: 60000,
        };
      },
    },
  };

  const result = await processMediaAnalysisJob({
    prisma,
    job,
    adapters: {
      video: adapter,
    },
    now: () => new Date("2026-07-11T00:01:00.000Z"),
  });

  assert.deepEqual(result.report.videoObservations ?? [], []);
  assert.equal(
    result.riskSignals.some((signal) => signal.type === RISK_SIGNAL_TYPES.mediaGazeOffscreen),
    false,
  );
});

test("video analysis adapter validates bounded options and fixture windows", async () => {
  assert.throws(
    () =>
      createVideoAnalysisAdapter({
        adapterVersion: "test-video-v1",
        minimumGazeOffscreenDurationMs: 60001,
        analyzeVideoWindows: async () => [],
      }),
    /minimumGazeOffscreenDurationMs must be less than or equal to 60000/,
  );

  const adapter = createVideoAnalysisAdapter({
    adapterVersion: "test-video-v1",
    analyzeVideoWindows: async () => [
      {
        faceCount: -1,
        faceConfidence: 0.9,
        startedAtMs: 0,
        endedAtMs: 3000,
      },
    ],
  });

  await assert.rejects(
    () => adapter.analyzeVideo(baseRequest),
    /faceCount must be a non-negative integer/,
  );
});
