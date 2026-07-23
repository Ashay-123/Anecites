import test from "node:test";
import assert from "node:assert/strict";

import {
  MEDIA_CONSENT_SCOPES,
  MEDIA_ANALYSIS_MODES,
  MEDIA_RECORDING_SCOPES,
  createMediaConsentScopes,
  createMediaAnalysisJob,
  getCandidateTrackRecordingParticipantId,
  hasMediaConsentScopes,
  isMediaAnalysisMode,
} from "../dist/index.js";

test("media-analysis job contract contains object ids and bounded options only", () => {
  const job = createMediaAnalysisJob({
    jobId: "media-job-1",
    sessionId: "session-1",
    participantId: "candidate-participant-1",
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
    jobId: "media-job-1",
    sessionId: "session-1",
    participantId: "candidate-participant-1",
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
      shadowModes: [],
    },
  });

  const serialized = JSON.stringify(job);
  assert.equal(serialized.includes("rawMediaBytes"), false);
  assert.equal(serialized.includes("storageCredentials"), false);
  assert.equal(serialized.includes("secretAccessKey"), false);
  assert.equal(serialized.includes("storageKey"), false);
});

test("media-analysis job permits only requested second-voice analysis in shadow mode", () => {
  const job = createMediaAnalysisJob({
    jobId: "media-job-shadow-1",
    sessionId: "session-1",
    participantId: "candidate-participant-1",
    recordingEvidenceObjectId: "recording-evidence-1",
    requestedModes: [
      MEDIA_ANALYSIS_MODES.audioSecondVoice,
      MEDIA_ANALYSIS_MODES.videoFacePresence,
    ],
    options: {
      ...validOptions(),
      shadowModes: [
        MEDIA_ANALYSIS_MODES.audioSecondVoice,
        MEDIA_ANALYSIS_MODES.audioSecondVoice,
      ],
    },
  });

  assert.deepEqual(job.options.shadowModes, [MEDIA_ANALYSIS_MODES.audioSecondVoice]);

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-shadow-2",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
        options: {
          ...validOptions(),
          shadowModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        },
      }),
    /shadowModes must contain only requested media-analysis modes/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-shadow-3",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [
          MEDIA_ANALYSIS_MODES.audioSecondVoice,
          MEDIA_ANALYSIS_MODES.videoFacePresence,
        ],
        options: {
          ...validOptions(),
          shadowModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
        },
      }),
    /shadowModes currently supports only audio.second_voice/,
  );
});

test("media-analysis job contract rejects invalid ids, modes, and limits", () => {
  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /jobId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /sessionId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /recordingEvidenceObjectId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
        options: validOptions(),
      }),
    /participantId must be a non-empty string/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: [],
        options: validOptions(),
      }),
    /requestedModes must contain at least one media-analysis mode/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
        recordingEvidenceObjectId: "recording-evidence-1",
        requestedModes: ["video.deepfake_scan"],
        options: validOptions(),
      }),
    /requestedModes contains an unsupported media-analysis mode/,
  );

  assert.throws(
    () =>
      createMediaAnalysisJob({
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
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
        jobId: "media-job-1",
        sessionId: "session-1",
        participantId: "candidate-participant-1",
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

test("candidate-track recording metadata requires an explicit bounded participant id", () => {
  assert.equal(
    getCandidateTrackRecordingParticipantId({
      livekit: {
        recordingScope: MEDIA_RECORDING_SCOPES.candidateTrack,
        participantId: "candidate-participant-1",
      },
    }),
    "candidate-participant-1",
  );
  assert.equal(
    getCandidateTrackRecordingParticipantId({
      livekit: {
        recordingScope: MEDIA_RECORDING_SCOPES.roomComposite,
        participantId: "candidate-participant-1",
      },
    }),
    null,
  );
  assert.equal(
    getCandidateTrackRecordingParticipantId({
      livekit: {
        recordingScope: MEDIA_RECORDING_SCOPES.candidateTrack,
        participantId: "",
      },
    }),
    null,
  );
});

test("media-analysis mode guard accepts only supported modes", () => {
  assert.equal(isMediaAnalysisMode("audio.second_voice"), true);
  assert.equal(isMediaAnalysisMode("video.face_presence"), true);
  assert.equal(isMediaAnalysisMode("video.gaze_offscreen"), true);
  assert.equal(isMediaAnalysisMode("video.deepfake_scan"), false);
});

test("media consent scopes are explicit, bounded, and cannot be mistaken for analysis modes", () => {
  const scopes = createMediaConsentScopes([
    MEDIA_CONSENT_SCOPES.sessionRecording,
    MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
    MEDIA_CONSENT_SCOPES.videoGazeCalibration,
    MEDIA_CONSENT_SCOPES.sessionRecording,
  ]);

  assert.deepEqual(scopes, [
    "session_recording",
    "video_face_analysis",
    "video_gaze_calibration",
  ]);
  assert.equal(
    hasMediaConsentScopes(scopes, [
      MEDIA_CONSENT_SCOPES.sessionRecording,
      MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
      MEDIA_CONSENT_SCOPES.videoGazeCalibration,
    ]),
    true,
  );
  assert.equal(
    hasMediaConsentScopes(scopes, [MEDIA_CONSENT_SCOPES.videoFaceAnalysis, "audio_second_voice"]),
    false,
  );

  assert.throws(
    () => createMediaConsentScopes([]),
    /media consent scopes must contain at least one scope/,
  );
  assert.throws(
    () => createMediaConsentScopes(["audio.second_voice"]),
    /media consent scopes contains an unsupported scope/,
  );
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
