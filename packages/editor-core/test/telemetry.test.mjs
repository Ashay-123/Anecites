import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditorTextChanges,
  createEditorTelemetryObserver,
  createEditorYjsDocument,
} from "../dist/index.js";

test("editor telemetry observer flags large atomic inserts", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const telemetryEvents = [];
  const observer = createEditorTelemetryObserver(document, {
    sessionId: "session-a",
    participantId: "candidate-a",
    atomicInsertThreshold: 10,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    onEvent(event) {
      telemetryEvents.push(event);
    },
  });

  document.text.insert(0, "x".repeat(11));

  assert.equal(telemetryEvents.length, 1);
  assert.equal(telemetryEvents[0].type, "editor.atomic_insert");
  assert.equal(telemetryEvents[0].sessionId, "session-a");
  assert.equal(telemetryEvents[0].participantId, "candidate-a");
  assert.equal(telemetryEvents[0].documentId, "document-a");
  assert.equal(telemetryEvents[0].insertedCharacterCount, 11);
  assert.equal(telemetryEvents[0].source, "programmatic");

  observer.destroy();
  document.destroy();
});

test("editor telemetry observer ignores small inserts", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const telemetryEvents = [];
  const observer = createEditorTelemetryObserver(document, {
    sessionId: "session-a",
    participantId: "candidate-a",
    atomicInsertThreshold: 10,
    onEvent(event) {
      telemetryEvents.push(event);
    },
  });

  document.text.insert(0, "small");

  assert.deepEqual(telemetryEvents, []);

  observer.destroy();
  document.destroy();
});

test("incremental editor changes preserve existing Yjs text and insertion size", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "const answer = 4;",
  });
  const events = [];
  const observer = createEditorTelemetryObserver(document, {
    sessionId: "session-a",
    participantId: "candidate-a",
    atomicInsertThreshold: 5,
    onEvent(event) {
      events.push(event);
    },
  });

  applyEditorTextChanges(document, [
    {
      rangeOffset: 15,
      rangeLength: 1,
      text: "42",
    },
  ]);

  assert.equal(document.text.toString(), "const answer = 42;");
  assert.deepEqual(events, []);

  observer.destroy();
  document.destroy();
});
