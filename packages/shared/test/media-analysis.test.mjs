import test from "node:test";
import assert from "node:assert/strict";

import {
  MEDIA_ANALYSIS_MODES,
  createMediaAnalysisJob,
  isMediaAnalysisMode,
} from "../dist/index.js";

test("media-analysis job contract contains object ids and bounded options only", () => {
  const job = createMediaAnalysisJob({
    sessionId: "session-1",
    recordingEvidenceObjectId: "recording-evidence-1",
    requestedModes: [
      MEDIA_ANALYSIS_MODES.audioSecondVoice,
      MEDIA_ANALYSIS_MODES.videoFacePresence,
      MEDIA_ANALYSIS_MODES.videoGazeOffscreen,
      MEDIA_ANALYSIS_MODES.audioSecondVoice,
    ],
    options: {
      sampleWindowMs: 10000,
      maxSamplesPerRecording: 12,
      requestTimeoutMs: 30000,
      confidenceThresholds: {
        secondVoice: 0.8,
        faceMissing: 0.8,
        multipleFaces: 0.8,
        gazeOffscreen: 0.85,
      },
    },
    rawMediaBytes: "must-not-be-copied",
    storageCredentials: {
      accessKeyId: "must-not-be-copied",
      secretAccessKey: "must-not-be-copied",
    },
    storageKey: "recordings/session-1/output.mp4",
  });

  assert.deepEqual(job, {
    version: 1,
    sessionId: "session-1",
    recordingEvidenceObjectId: "recording-evidence-1",
    requestedModes: [
      "audio.second_voice",
      "video.face_presence",
      "video.gaze_offscreen",
    ],
    options: {
      sampleWindowMs: 10000,
      maxSamplesPerRecording: 12,
      requestTimeoutMs: 30000,
      confidenceThresholds: {
        secondVoice: 0.8,
        faceMissing: 0.8,
        multipleFaces: 0.8,
        gazeOffscreen: 0.85,
      },
    },
  });

  const serialized = JSON.stringify(job);
  assert.equal(serialized.includes("rawMediaBytes"), false);
  assert.equal(serialized.includes("storageCredentials"), false);
  assert.equal(serialized.includes("secretAccessKey"), false);
  assert.equal(serialized.includes("storageKey"), false);
});

test("media-analysis job contract rejects invalid ids, modes, and limits", () => {
  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /sessionId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "session-1",
        recordingEvidenceObjectId: "",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /recordingEvidenceObjectId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "session-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [],
        options: validOptions(),
      }),
    /requestedModes must contain at least one media-analysis mode/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "session-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: ["video.deepfake_scan"],
        options: validOptions(),
      }),
    /requestedModes contains an unsupported media-analysis mode/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "session-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: {
          ...validOptions(),
          sampleWindowMs: 60001,
        },
      }),
    /sampleWindowMs must be less than or equal to 60000/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        sessionId: "session-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: {
          ...validOptions(),
          confidenceThresholds: {
            ...validOptions().confidenceThresholds,
            gazeOffscreen: 1.2,
          },
        },
      }),
    /gazeOffscreen must be between 0 and 1/,
  );
});

test("media-analysis mode guard accepts only supported modes", () => {
  assert.equal(isMediaAnalysisMode("audio.second_voice"), true);
  assert.equal(isMediaAnalysisMode("video.face_presence"), true);
  assert.equal(isMediaAnalysisMode("video.gaze_offscreen"), true);
  assert.equal(isMediaAnalysisMode("video.deepfake_scan"), false);
});

function validOptions() {
  return {
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
}
