import assert from "node:assert/strict";
import test from "node:test";

import {
  createAtomicInsertTelemetryEvent,
  createPasteBlockedTelemetryEvent,
  createRollingEditorTelemetryAggregate,
} from "@anecites/shared";
import {
  createPrismaTelemetryAggregateSink,
  createRedisRawTelemetrySink,
} from "../dist/index.js";

test("Prisma telemetry sink creates a new rolling aggregate", async () => {
  const calls = [];
  const prisma = {
    async $transaction(callback) {
      return await callback(this);
    },
    editorTelemetryAggregate: {
      async findUnique(query) {
        calls.push(["findUnique", query]);
        return null;
      },
      async create(query) {
        calls.push(["create", query]);
        return query.data;
      },
    },
  };
  const sink = createPrismaTelemetryAggregateSink(prisma);

  await sink(testAggregate({ maxInsertSize: 42 }));

  assert.deepEqual(calls, [
    [
      "findUnique",
      {
        where: aggregateWhere(),
        select: {
          maxInsertSize: true,
        },
      },
    ],
    [
      "create",
      {
        data: {
          sessionId: "session-a",
          participantId: "participant-a",
          documentId: "document-a",
          windowStartedAt: new Date("2026-07-10T01:00:00.000Z"),
          windowEndedAt: new Date("2026-07-10T01:00:02.000Z"),
          insertEventCount: 1,
          deleteEventCount: 0,
          pasteBlockedCount: 0,
          atomicInsertCount: 1,
          maxInsertSize: 42,
        },
      },
    ],
  ]);
});

test("Prisma telemetry sink increments an existing rolling aggregate without lowering max insert size", async () => {
  const calls = [];
  const prisma = {
    async $transaction(callback) {
      return await callback(this);
    },
    editorTelemetryAggregate: {
      async findUnique(query) {
        calls.push(["findUnique", query]);
        return { maxInsertSize: 50 };
      },
      async update(query) {
        calls.push(["update", query]);
        return query.data;
      },
    },
  };
  const sink = createPrismaTelemetryAggregateSink(prisma);

  await sink(testAggregate({ maxInsertSize: 12 }));

  assert.deepEqual(calls, [
    [
      "findUnique",
      {
        where: aggregateWhere(),
        select: {
          maxInsertSize: true,
        },
      },
    ],
    [
      "update",
      {
        where: aggregateWhere(),
        data: {
          insertEventCount: {
            increment: 1,
          },
          deleteEventCount: {
            increment: 0,
          },
          pasteBlockedCount: {
            increment: 0,
          },
          atomicInsertCount: {
            increment: 1,
          },
          maxInsertSize: 50,
        },
      },
    ],
  ]);
});

test("Redis raw telemetry sink appends atomic insert events to a stream", async () => {
  const calls = [];
  const redis = {
    async xAdd(streamKey, id, fields) {
      calls.push({ streamKey, id, fields });
      return "1700000000000-0";
    },
  };
  const sink = createRedisRawTelemetrySink(redis, {
    streamKey: "anecites:test:editor-raw",
  });

  await sink(createAtomicInsertTelemetryEvent({
    sessionId: "session-a",
    participantId: "participant-a",
    documentId: "document-a",
    occurredAt: "2026-07-10T01:00:00.000Z",
    insertedCharacterCount: 42,
    source: "programmatic",
  }));

  assert.deepEqual(calls, [
    {
      streamKey: "anecites:test:editor-raw",
      id: "*",
      fields: {
        type: "editor.atomic_insert",
        kind: "raw",
        storagePolicy: "object-storage-only",
        sessionId: "session-a",
        participantId: "participant-a",
        documentId: "document-a",
        occurredAt: "2026-07-10T01:00:00.000Z",
        insertedCharacterCount: "42",
        source: "programmatic",
      },
    },
  ]);
});

test("Redis raw telemetry sink appends paste-blocked events without atomic insert fields", async () => {
  const calls = [];
  const redis = {
    async xAdd(streamKey, id, fields) {
      calls.push({ streamKey, id, fields });
      return "1700000000000-0";
    },
  };
  const sink = createRedisRawTelemetrySink(redis, {
    streamKey: "anecites:test:editor-raw",
  });

  await sink(createPasteBlockedTelemetryEvent({
    sessionId: "session-a",
    participantId: "participant-a",
    documentId: "document-a",
    occurredAt: "2026-07-17T10:00:00.000Z",
    source: "paste_event",
  }));

  assert.deepEqual(calls, [
    {
      streamKey: "anecites:test:editor-raw",
      id: "*",
      fields: {
        type: "editor.paste_blocked",
        kind: "raw",
        storagePolicy: "object-storage-only",
        sessionId: "session-a",
        participantId: "participant-a",
        documentId: "document-a",
        occurredAt: "2026-07-17T10:00:00.000Z",
        source: "paste_event",
      },
    },
  ]);
});

function testAggregate(overrides = {}) {
  return createRollingEditorTelemetryAggregate({
    sessionId: "session-a",
    participantId: "participant-a",
    documentId: "document-a",
    windowStartedAt: "2026-07-10T01:00:00.000Z",
    windowEndedAt: "2026-07-10T01:00:02.000Z",
    insertEventCount: 1,
    deleteEventCount: 0,
    pasteBlockedCount: 0,
    atomicInsertCount: 1,
    maxInsertSize: 42,
    ...overrides,
  });
}

function aggregateWhere() {
  return {
    participantId_documentId_windowStartedAt_windowEndedAt: {
      participantId: "participant-a",
      documentId: "document-a",
      windowStartedAt: new Date("2026-07-10T01:00:00.000Z"),
      windowEndedAt: new Date("2026-07-10T01:00:02.000Z"),
    },
  };
}
