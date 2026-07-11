import test from "node:test";
import assert from "node:assert/strict";

import { createSecondVoiceAudioAdapter } from "../dist/index.js";

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
  confidenceThresholds: {
    secondVoice: 0.8,
    faceMissing: 0.8,
    multipleFaces: 0.8,
    gazeOffscreen: 0.85,
  },
};

test("second-voice audio adapter returns no observations for one-speaker fixture", async () => {
  const adapter = createSecondVoiceAudioAdapter({
    adapterVersion: "test-vad-v1",
    minimumSecondVoiceDurationMs: 2000,
    analyzeVoiceSegments: async () => [
      {
        speakerId: "candidate",
        confidence: 0.94,
        startedAtMs: 0,
        endedAtMs: 4200,
      },
      {
        speakerId: "candidate",
        confidence: 0.91,
        startedAtMs: 5000,
        endedAtMs: 7600,
      },
    ],
  });

  assert.deepEqual(await adapter.analyzeSecondVoice(baseRequest), []);
});

test("second-voice audio adapter maps two-speaker fixture to a bounded observation", async () => {
  const requests = [];
  const adapter = createSecondVoiceAudioAdapter({
    adapterVersion: "test-vad-v1",
    minimumSecondVoiceDurationMs: 2000,
    analyzeVoiceSegments: async (request) => {
      requests.push(request);
      return [
        {
          speakerId: "candidate",
          confidence: 0.93,
          startedAtMs: 0,
          endedAtMs: 3000,
        },
        {
          speakerId: "other-speaker",
          confidence: 0.89,
          startedAtMs: 4500,
          endedAtMs: 7200,
          transcript: "must-not-be-copied",
          embedding: [1, 2, 3],
        },
      ];
    },
  });

  const observations = await adapter.analyzeSecondVoice(baseRequest);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].recordingEvidenceObjectId, "recording-evidence-1");
  assert.deepEqual(observations, [
    {
      kind: "second_voice",
      confidence: 0.89,
      durationMs: 2700,
      sampleStartedAt: "1970-01-01T00:00:04.500Z",
      sampleEndedAt: "1970-01-01T00:00:07.200Z",
      adapterVersion: "test-vad-v1",
      speakerCount: 2,
    },
  ]);
  assert.equal(JSON.stringify(observations).includes("other-speaker"), false);
  assert.equal(JSON.stringify(observations).includes("transcript"), false);
  assert.equal(JSON.stringify(observations).includes("embedding"), false);
});

test("second-voice audio adapter ignores short or low-confidence voice segments", async () => {
  const shortAdapter = createSecondVoiceAudioAdapter({
    adapterVersion: "test-vad-v1",
    minimumSecondVoiceDurationMs: 2000,
    analyzeVoiceSegments: async () => [
      {
        speakerId: "candidate",
        confidence: 0.92,
        startedAtMs: 0,
        endedAtMs: 4000,
      },
      {
        speakerId: "other-speaker",
        confidence: 0.91,
        startedAtMs: 5000,
        endedAtMs: 6100,
      },
    ],
  });

  assert.deepEqual(await shortAdapter.analyzeSecondVoice(baseRequest), []);

  const lowConfidenceAdapter = createSecondVoiceAudioAdapter({
    adapterVersion: "test-vad-v1",
    minimumSecondVoiceDurationMs: 2000,
    analyzeVoiceSegments: async () => [
      {
        speakerId: "candidate",
        confidence: 0.92,
        startedAtMs: 0,
        endedAtMs: 4000,
      },
      {
        speakerId: "other-speaker",
        confidence: 0.79,
        startedAtMs: 5000,
        endedAtMs: 8200,
      },
    ],
  });

  assert.deepEqual(await lowConfidenceAdapter.analyzeSecondVoice(baseRequest), []);
});

test("second-voice audio adapter validates bounded options and segment fixtures", async () => {
  assert.throws(
    () =>
      createSecondVoiceAudioAdapter({
        adapterVersion: "test-vad-v1",
        minimumSecondVoiceDurationMs: 60001,
        analyzeVoiceSegments: async () => [],
      }),
    /minimumSecondVoiceDurationMs must be less than or equal to 60000/,
  );

  const adapter = createSecondVoiceAudioAdapter({
    adapterVersion: "test-vad-v1",
    analyzeVoiceSegments: async () => [
      {
        speakerId: "candidate",
        confidence: 1.1,
        startedAtMs: 0,
        endedAtMs: 4000,
      },
    ],
  });

  await assert.rejects(
    () => adapter.analyzeSecondVoice(baseRequest),
    /confidence must be between 0 and 1/,
  );
});
