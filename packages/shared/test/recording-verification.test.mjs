import test from "node:test";
import assert from "node:assert/strict";

import { createRecordingVerificationJob } from "../dist/index.js";

test("createRecordingVerificationJob accepts its deterministic evidence id", () => {
  assert.deepEqual(createRecordingVerificationJob({
    version: 1,
    jobId: "recording-verification:evidence_123",
    sessionId: "session_123",
    recordingEvidenceObjectId: "evidence_123",
  }), {
    version: 1,
    jobId: "recording-verification:evidence_123",
    sessionId: "session_123",
    recordingEvidenceObjectId: "evidence_123",
  });
});

test("createRecordingVerificationJob rejects malformed identifiers", () => {
  assert.throws(() => createRecordingVerificationJob({
    version: 1,
    jobId: "different-job",
    sessionId: "session_123",
    recordingEvidenceObjectId: "evidence_123",
  }), /job id is invalid/);
});
