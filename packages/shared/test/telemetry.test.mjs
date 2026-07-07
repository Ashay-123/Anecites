import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITOR_EVENT_TYPES,
  TELEMETRY_STORAGE_POLICIES,
  createAtomicInsertTelemetryEvent,
  createRollingEditorTelemetryAggregate,
  shouldPersistTelemetryToPostgres,
} from "../dist/index.js";

const baseEvent = {
  sessionId: "session-1",
  participantId: "participant-1",
  documentId: "document-1",
  occurredAt: "2026-07-07T12:00:00.000Z",
};

test("editor event names are stable and namespaced", () => {
  assert.equal(EDITOR_EVENT_TYPES.yjsUpdate, "editor.yjs_update");
  assert.equal(EDITOR_EVENT_TYPES.atomicInsert, "editor.atomic_insert");
  assert.equal(EDITOR_EVENT_TYPES.pasteBlocked, "editor.paste_blocked");
});

test("raw atomic insert telemetry is object-storage-only, not Postgres", () => {
  const event = createAtomicInsertTelemetryEvent({
    ...baseEvent,
    insertedCharacterCount: 42,
    source: "programmatic",
  });

  assert.equal(event.type, EDITOR_EVENT_TYPES.atomicInsert);
  assert.equal(event.storagePolicy, TELEMETRY_STORAGE_POLICIES.objectStorageOnly);
  assert.equal(shouldPersistTelemetryToPostgres(event), false);
});

test("rolling editor aggregates are the Postgres-eligible telemetry shape", () => {
  const aggregate = createRollingEditorTelemetryAggregate({
    sessionId: "session-1",
    documentId: "document-1",
    windowStartedAt: "2026-07-07T12:00:00.000Z",
    windowEndedAt: "2026-07-07T12:00:02.000Z",
    insertEventCount: 10,
    deleteEventCount: 2,
    pasteBlockedCount: 1,
    atomicInsertCount: 1,
    maxInsertSize: 42,
  });

  assert.equal(aggregate.storagePolicy, TELEMETRY_STORAGE_POLICIES.postgresAggregate);
  assert.equal(shouldPersistTelemetryToPostgres(aggregate), true);
});

test("invalid atomic insert telemetry fails closed", () => {
  assert.throws(
    () => createAtomicInsertTelemetryEvent({
      ...baseEvent,
      insertedCharacterCount: 0,
      source: "programmatic",
    }),
    /insertedCharacterCount must be positive/,
  );
});
