import test from "node:test";
import assert from "node:assert/strict";

import { MEDIA_ANALYSIS_MODES } from "@anecites/shared";
import { MediaWorkerError, createMediaInferenceClient } from "../dist/index.js";

const expectedAdapterVersion = "mediapipe-face-landmarker-0.10.35_silero-vad-6.2.1_pyannote-audio-4.0.7";
const baseRequest = {
  sessionId: "session-1",
  recordingEvidenceObjectId: "evidence-1",
  storageBucket: "anecites-dev",
  storageKey: "recordings/session-1.mp4",
  contentType: "video/mp4",
  durationMs: 60_000,
  sampleWindowMs: 10_000,
  maxSamplesPerRecording: 12,
  requestTimeoutMs: 30_000,
  confidenceThresholds: {
    secondVoice: 0.8,
    faceMissing: 0.8,
    multipleFaces: 0.8,
    gazeOffscreen: 0.85,
  },
};

test("media inference client sends bounded object references and sanitizes face windows", async () => {
  const calls = [];
  const client = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        version: 1,
        adapterVersion: expectedAdapterVersion,
        voiceActivityWindows: [],
        speakerSegments: [],
        faceWindows: [
          {
            faceCount: 0,
            conditionSupport: 0.9,
            detectorConfidence: null,
            startedAtMs: 0,
            endedAtMs: 10_000,
            rawFrame: "must-not-leave-runtime",
          },
        ],
      });
    },
  });

  const windows = await client.analyzeVideoWindows({
    ...baseRequest,
    requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
  });

  assert.deepEqual(windows, [
    {
      faceCount: 0,
      conditionSupport: 0.9,
      startedAtMs: 0,
      endedAtMs: 10_000,
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), "http://127.0.0.1:8090/v1/analyze");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-internal-token");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.recording, {
    storageBucket: "anecites-dev",
    storageKey: "recordings/session-1.mp4",
    contentType: "video/mp4",
    durationMs: 60_000,
  });
  assert.equal(JSON.stringify(body).includes("authToken"), false);
  assert.equal(JSON.stringify(body).includes("secretAccessKey"), false);
});

test("media inference client exposes VAD windows without mapping them to second-voice evidence", async () => {
  const client = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async () => Response.json({
      version: 1,
      adapterVersion: expectedAdapterVersion,
      voiceActivityWindows: [{ startedAtMs: 500, endedAtMs: 2_000, transcript: "must-be-dropped" }],
      speakerSegments: [],
      faceWindows: [],
    }),
  });

  assert.deepEqual(await client.analyzeVoiceActivity(baseRequest), [
    { startedAtMs: 500, endedAtMs: 2_000 },
  ]);
  assert.equal("analyzeSecondVoice" in client, false);
});

test("media inference client returns bounded diarization segments without raw audio data", async () => {
  const calls = [];
  const client = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        version: 1,
        adapterVersion: expectedAdapterVersion,
        voiceActivityWindows: [],
        faceWindows: [],
        speakerSegments: [
          {
            speakerId: "SPEAKER_00",
            startedAtMs: 0,
            endedAtMs: 3_000,
            transcript: "must-not-leave-inference",
            embedding: [0.1, 0.2],
          },
          {
            speakerId: "SPEAKER_01",
            startedAtMs: 3_500,
            endedAtMs: 6_500,
          },
        ],
      });
    },
  });

  const segments = await client.analyzeSpeakerDiarization(baseRequest);

  assert.deepEqual(segments, [
    { speakerId: "SPEAKER_00", startedAtMs: 0, endedAtMs: 3_000 },
    { speakerId: "SPEAKER_01", startedAtMs: 3_500, endedAtMs: 6_500 },
  ]);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.analyses, {
    voiceActivity: false,
    facePresence: false,
    speakerDiarization: true,
  });
  assert.equal(JSON.stringify(segments).includes("transcript"), false);
  assert.equal(JSON.stringify(segments).includes("embedding"), false);
});

test("media inference client rejects gaze, timeouts, and malformed responses", async () => {
  const client = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async () => Response.json({}),
  });
  await assert.rejects(
    () => client.analyzeVideoWindows({
      ...baseRequest,
      requestedModes: [MEDIA_ANALYSIS_MODES.videoGazeOffscreen],
    }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_UNAVAILABLE",
  );
  await assert.rejects(
    () => client.analyzeVoiceActivity(baseRequest),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_INVALID_RESPONSE",
  );

  const timeoutClient = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  });
  await assert.rejects(
    () => timeoutClient.analyzeVoiceActivity(baseRequest),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_TIMEOUT",
  );

  const upstreamTimeoutClient = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async () => new Response(null, { status: 504 }),
  });
  await assert.rejects(
    () => upstreamTimeoutClient.analyzeVoiceActivity(baseRequest),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_TIMEOUT",
  );

  const oversizedClient = createMediaInferenceClient({
    baseUrl: "http://127.0.0.1:8090",
    authToken: "test-internal-token",
    expectedAdapterVersion,
    fetchImpl: async () => new Response("x", { headers: { "Content-Length": "1048577" } }),
  });
  await assert.rejects(
    () => oversizedClient.analyzeVoiceActivity(baseRequest),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_INVALID_RESPONSE",
  );
});
