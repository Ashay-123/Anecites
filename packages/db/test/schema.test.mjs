import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("prisma/schema.prisma");

function readSchema() {
  return fs.readFileSync(schemaPath, "utf8");
}

test("Prisma schema exists", () => {
  assert.equal(fs.existsSync(schemaPath), true);
});

test("schema includes Module 1 persistence models", () => {
  const schema = readSchema();
  const requiredModels = [
    "User",
    "Session",
    "Participant",
    "EditorDocument",
    "InterviewProblem",
    "InterviewProblemTestcase",
    "CodeSubmission",
    "RiskSummary",
    "RiskEvent",
    "EvidenceObject",
    "MediaConsent",
    "SessionRecording",
    "MonitoringConsent",
    "MonitoringHeartbeat",
    "MediaAnalysisJobRun",
  ];

  for (const modelName of requiredModels) {
    assert.match(schema, new RegExp(`model\\s+${modelName}\\s+\\{`));
  }
});

test("schema persists fenced media-analysis job completion", () => {
  const schema = readSchema();

  assert.match(schema, /enum\s+MediaAnalysisJobRunStatus\s+\{[\s\S]*PROCESSING[\s\S]*SUCCEEDED/);
  assert.match(schema, /model\s+MediaAnalysisJobRun\s+\{[\s\S]*jobId\s+String\s+@id/);
  assert.match(schema, /model\s+MediaAnalysisJobRun\s+\{[\s\S]*leaseVersion\s+Int/);
  assert.match(schema, /model\s+MediaAnalysisJobRun\s+\{[\s\S]*payloadSha256\s+String/);
  assert.match(schema, /model\s+MediaAnalysisJobRun\s+\{[\s\S]*riskSummaryId\s+String\?\s+@unique/);
});

test("schema records consent, ordered heartbeats, and evidence-linked risk events", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+MonitoringConsent\s+\{[\s\S]*policyVersion\s+String/);
  assert.match(schema, /model\s+MonitoringConsent\s+\{[\s\S]*policyDigestSha256\s+String\?/);
  assert.match(schema, /model\s+MonitoringConsent\s+\{[\s\S]*nativeMonitoringPolicy\s+Json\?/);
  assert.match(schema, /model\s+MonitoringConsent\s+\{[\s\S]*lastSequence\s+Int/);
  assert.match(schema, /model\s+MonitoringConsent\s+\{[\s\S]*stopReason\s+String\?/);
  assert.doesNotMatch(schema, /@@unique\(\[sessionId, participantId\]\)/);
  assert.match(schema, /model\s+MonitoringHeartbeat\s+\{[\s\S]*sequence\s+Int/);
  assert.match(schema, /model\s+RiskEvent\s+\{[\s\S]*evidenceObjectId\s+String\?/);
  assert.match(schema, /@@unique\(\[monitoringConsentId, sequence\]\)/);
});

test("schema keeps recording and video-analysis consent separate from native-monitoring consent", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+MediaConsent\s+\{[\s\S]*noticeVersion\s+String/);
  assert.match(schema, /model\s+MediaConsent\s+\{[\s\S]*noticeFingerprint\s+String/);
  assert.match(schema, /model\s+MediaConsent\s+\{[\s\S]*scopes\s+Json/);
  assert.match(schema, /model\s+MediaConsent\s+\{[\s\S]*grantedAt\s+DateTime/);
  assert.match(schema, /model\s+MediaConsent\s+\{[\s\S]*revokedAt\s+DateTime\?/);
  assert.match(schema, /model\s+Session\s+\{[\s\S]*mediaConsents\s+MediaConsent\[\]/);
  assert.match(schema, /model\s+Participant\s+\{[\s\S]*mediaConsents\s+MediaConsent\[\]/);
});

test("schema records one durable lifecycle for each LiveKit egress", () => {
  const schema = readSchema();

  assert.match(schema, /enum\s+SessionRecordingState\s+\{[\s\S]*ACTIVE[\s\S]*STOP_REQUESTED[\s\S]*COMPLETED/);
  assert.match(schema, /model\s+SessionRecording\s+\{[\s\S]*egressId\s+String\s+@unique/);
  assert.match(schema, /model\s+SessionRecording\s+\{[\s\S]*evidenceObjectId\s+String\s+@unique/);
  assert.match(schema, /model\s+SessionRecording\s+\{[\s\S]*state\s+SessionRecordingState/);
  assert.match(schema, /model\s+Session\s+\{[\s\S]*sessionRecordings\s+SessionRecording\[\]/);
});

test("schema binds new gaze calibrations to the source recording without storing raw landmarks", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+GazeCalibration\s+\{[\s\S]*sessionRecordingId\s+String\?/);
  assert.match(schema, /model\s+GazeCalibration\s+\{[\s\S]*sessionRecording\s+SessionRecording\?/);
  assert.match(schema, /model\s+SessionRecording\s+\{[\s\S]*gazeCalibrations\s+GazeCalibration\[\]/);
  assert.doesNotMatch(schema, /model\s+GazeCalibration\s+\{[\s\S]*faceLandmarks/);
});

test("schema stores replay and evidence as object references", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+EvidenceObject\s+\{[\s\S]*storageKey\s+String/);
  assert.match(schema, /model\s+EditorDocument\s+\{[\s\S]*replayObjectId\s+String\?/);
  assert.match(schema, /model\s+EditorDocument\s+\{[\s\S]*replayObject\s+EvidenceObject\?/);
});

test("schema links sessions and submissions to interview problems", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+Session\s+\{[\s\S]*problemId\s+String\?/);
  assert.match(schema, /model\s+CodeSubmission\s+\{[\s\S]*problemId\s+String\?/);
  assert.match(schema, /model\s+CodeSubmission\s+\{[\s\S]*executionMode\s+CodeExecutionMode/);
  assert.match(schema, /model\s+InterviewProblem\s+\{[\s\S]*starterCode\s+String/);
  assert.match(schema, /model\s+InterviewProblem\s+\{[\s\S]*functionName\s+String/);
  assert.match(schema, /model\s+InterviewProblemTestcase\s+\{[\s\S]*input\s+Json/);
  assert.match(schema, /enum\s+CodeSubmissionStatus\s+\{[\s\S]*WRONG_ANSWER/);
  assert.match(schema, /enum\s+CodeExecutionMode\s+\{[\s\S]*SUBMIT/);
});

test("schema does not model raw keystrokes as Postgres rows", () => {
  const schema = readSchema();

  assert.doesNotMatch(schema, /model\s+(Raw)?Keystroke\b/);
  assert.doesNotMatch(schema, /model\s+EditorEvent\b/);
  assert.doesNotMatch(schema, /model\s+PasteEvent\b/);
});

test("schema has rolling risk summary fields instead of single-signal verdicts", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+RiskSummary\s+\{[\s\S]*correlatedSignalCount\s+Int/);
  assert.match(schema, /model\s+RiskSummary\s+\{[\s\S]*humanReviewRequired\s+Boolean/);
  assert.doesNotMatch(schema, /autoFail/);
});
