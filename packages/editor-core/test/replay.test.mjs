import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorYjsDocument,
  encodeEditorYjsState,
  parseEditorReplayEvidenceNdjson,
  replayEditorEvidence,
} from "../dist/index.js";

test("editor replay reconstructs final document state from evidence records", () => {
  const updates = createReplayUpdates();
  const records = parseEditorReplayEvidenceNdjson([
    replayLine("2026-01-01T00:00:00.000Z", updates[0]),
    replayLine("2026-01-01T00:00:00.250Z", updates[1]),
  ].join("\n"));

  const replay = replayEditorEvidence(records, {
    documentId: "document-a",
  });

  assert.equal(replay.finalText, "hello world");
  assert.equal(replay.document.text.toString(), "hello world");
  assert.equal(replay.timeline.length, 2);

  replay.document.destroy();
});

test("editor replay preserves elapsed timing between operations", () => {
  const updates = createReplayUpdates();
  const records = parseEditorReplayEvidenceNdjson([
    replayLine("2026-01-01T00:00:01.000Z", updates[0]),
    replayLine("2026-01-01T00:00:01.250Z", updates[0]),
    replayLine("2026-01-01T00:00:02.000Z", updates[1]),
  ].join("\n"));

  const replay = replayEditorEvidence(records, {
    documentId: "document-a",
  });

  assert.deepEqual(
    replay.timeline.map((step) => step.delayMs),
    [0, 250, 750],
  );
  assert.deepEqual(
    replay.timeline.map((step) => step.elapsedMs),
    [0, 250, 1000],
  );

  replay.document.destroy();
});

test("editor replay matches original keystroke timing within documented tolerance", () => {
  const timingToleranceMs = 5;
  const updates = createKeystrokeReplayUpdates("hello");
  const records = parseEditorReplayEvidenceNdjson([
    replayLine("2026-01-01T00:00:10.000Z", updates[0]),
    replayLine("2026-01-01T00:00:10.080Z", updates[1]),
    replayLine("2026-01-01T00:00:10.225Z", updates[2]),
    replayLine("2026-01-01T00:00:10.310Z", updates[3]),
    replayLine("2026-01-01T00:00:10.500Z", updates[4]),
  ].join("\n"));

  const replay = replayEditorEvidence(records, {
    documentId: "document-a",
  });

  assert.equal(replay.finalText, "hello");
  assertTimingWithinTolerance(
    replay.timeline.map((step) => step.elapsedMs),
    [0, 80, 225, 310, 500],
    timingToleranceMs,
  );
  assertTimingWithinTolerance(
    replay.timeline.map((step) => step.delayMs),
    [0, 80, 145, 85, 190],
    timingToleranceMs,
  );

  replay.document.destroy();
});

test("editor replay rejects invalid evidence lines", () => {
  assert.throws(
    () => parseEditorReplayEvidenceNdjson("{\"type\":\"editor.unknown\"}\n"),
    /Invalid replay evidence record/,
  );
});

function createReplayUpdates() {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });

  document.text.insert(0, "hello");
  const first = encodeEditorYjsState(document);

  document.text.insert(document.text.length, " world");
  const second = encodeEditorYjsState(document);

  document.destroy();

  return [first, second];
}

function createKeystrokeReplayUpdates(value) {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const updates = [];

  for (const character of value) {
    document.text.insert(document.text.length, character);
    updates.push(encodeEditorYjsState(document));
  }

  document.destroy();

  return updates;
}

function assertTimingWithinTolerance(actual, expected, toleranceMs) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= toleranceMs,
      `Expected ${actual[index]}ms to be within ${toleranceMs}ms of ${expected[index]}ms`,
    );
  }
}

function replayLine(occurredAt, update) {
  return JSON.stringify({
    type: "editor.yjs_update",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "candidate-a",
    occurredAt,
    updateBase64: Buffer.from(update).toString("base64"),
  });
}
