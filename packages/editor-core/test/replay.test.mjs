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
