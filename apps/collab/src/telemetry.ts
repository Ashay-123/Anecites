import {
  createAtomicInsertTelemetryEvent,
  createPasteBlockedTelemetryEvent,
  createRollingEditorTelemetryAggregate,
  type AtomicInsertTelemetryEvent,
  type PasteBlockedTelemetryEvent,
  type RollingEditorTelemetryAggregate,
} from "@anecites/shared";
import { type PrismaClient } from "@anecites/db";

import { type AuthenticatedPrincipal } from "./server.js";

export interface CollabTelemetryOptions {
  atomicInsertThreshold?: number;
  aggregateWindowMs?: number;
  textName?: string;
  now?: () => Date;
  recordRawEvent?: (event: EditorRawTelemetryEvent) => void | Promise<void>;
  flushAggregate?: (aggregate: RollingEditorTelemetryAggregate) => void | Promise<void>;
}

export interface CollabTelemetryContext {
  sessionId: string;
  participantId: string;
  documentId: string;
  principal: AuthenticatedPrincipal;
}

export interface YjsTextChangeSummary {
  insertedCharacterCount: number;
  deletedCharacterCount: number;
}

export type TelemetryAggregateSink = (
  aggregate: RollingEditorTelemetryAggregate,
) => Promise<void>;

export type TelemetryRawEventSink = (
  event: EditorRawTelemetryEvent,
) => Promise<void>;

export type EditorRawTelemetryEvent =
  | AtomicInsertTelemetryEvent
  | PasteBlockedTelemetryEvent;

export interface RedisRawTelemetryClient {
  xAdd(
    streamKey: string,
    id: string,
    fields: Record<string, string>,
  ): Promise<unknown>;
}

export interface RedisRawTelemetrySinkOptions {
  streamKey?: string;
}

const defaultAtomicInsertThreshold = 32;
const defaultAggregateWindowMs = 2000;
const defaultRawTelemetryStreamKey = "anecites:editor:raw";

export function trackYjsTextChange(
  context: CollabTelemetryContext,
  change: YjsTextChangeSummary,
  options: CollabTelemetryOptions | undefined,
): void {
  if (!options) {
    return;
  }

  const insertedCharacterCount = Math.max(0, change.insertedCharacterCount);
  const deletedCharacterCount = Math.max(0, change.deletedCharacterCount);

  if (insertedCharacterCount === 0 && deletedCharacterCount === 0) {
    return;
  }

  const now = options.now?.() ?? new Date();
  const atomicInsertThreshold = options.atomicInsertThreshold ?? defaultAtomicInsertThreshold;
  const isAtomicInsert = insertedCharacterCount > atomicInsertThreshold;

  if (isAtomicInsert) {
    runBestEffortTelemetrySink(
      options.recordRawEvent,
      createAtomicInsertTelemetryEvent({
        sessionId: context.sessionId,
        participantId: context.participantId,
        documentId: context.documentId,
        occurredAt: now.toISOString(),
        insertedCharacterCount,
        source: "programmatic",
      }),
    );
  }

  const window = telemetryWindow(now, options.aggregateWindowMs ?? defaultAggregateWindowMs);

  runBestEffortTelemetrySink(
    options.flushAggregate,
    createRollingEditorTelemetryAggregate({
      sessionId: context.sessionId,
      participantId: context.participantId,
      documentId: context.documentId,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      insertEventCount: insertedCharacterCount > 0 ? 1 : 0,
      deleteEventCount: deletedCharacterCount > 0 ? 1 : 0,
      pasteBlockedCount: 0,
      atomicInsertCount: isAtomicInsert ? 1 : 0,
      maxInsertSize: insertedCharacterCount,
    }),
  );
}

export function trackPasteBlocked(
  context: CollabTelemetryContext,
  options: CollabTelemetryOptions | undefined,
): void {
  if (!options) {
    return;
  }

  const now = options.now?.() ?? new Date();
  runBestEffortTelemetrySink(
    options.recordRawEvent,
    createPasteBlockedTelemetryEvent({
      sessionId: context.sessionId,
      participantId: context.participantId,
      documentId: context.documentId,
      occurredAt: now.toISOString(),
      source: "paste_event",
    }),
  );

  const window = telemetryWindow(now, options.aggregateWindowMs ?? defaultAggregateWindowMs);
  runBestEffortTelemetrySink(
    options.flushAggregate,
    createRollingEditorTelemetryAggregate({
      sessionId: context.sessionId,
      participantId: context.participantId,
      documentId: context.documentId,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      insertEventCount: 0,
      deleteEventCount: 0,
      pasteBlockedCount: 1,
      atomicInsertCount: 0,
      maxInsertSize: 0,
    }),
  );
}

function runBestEffortTelemetrySink<T>(
  sink: ((value: T) => void | Promise<void>) | undefined,
  value: T,
): void {
  if (!sink) {
    return;
  }

  try {
    void Promise.resolve(sink(value)).catch(() => undefined);
  } catch {
    // Telemetry must not interrupt editor collaboration.
  }
}

function telemetryWindow(now: Date, requestedWindowMs: number): {
  startedAt: string;
  endedAt: string;
} {
  const windowMs = Math.max(1, requestedWindowMs);
  const startedAtMs = Math.floor(now.getTime() / windowMs) * windowMs;

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(startedAtMs + windowMs).toISOString(),
  };
}

export function createPrismaTelemetryAggregateSink(prisma: PrismaClient): TelemetryAggregateSink {
  return async (aggregate) => {
    const windowStartedAt = new Date(aggregate.windowStartedAt);
    const windowEndedAt = new Date(aggregate.windowEndedAt);
    const where = {
      participantId_documentId_windowStartedAt_windowEndedAt: {
        participantId: aggregate.participantId,
        documentId: aggregate.documentId,
        windowStartedAt,
        windowEndedAt,
      },
    };

    await prisma.$transaction(async (transaction) => {
      const existing = await transaction.editorTelemetryAggregate.findUnique({
        where,
        select: {
          maxInsertSize: true,
        },
      });

      if (!existing) {
        await transaction.editorTelemetryAggregate.create({
          data: {
            sessionId: aggregate.sessionId,
            participantId: aggregate.participantId,
            documentId: aggregate.documentId,
            windowStartedAt,
            windowEndedAt,
            insertEventCount: aggregate.insertEventCount,
            deleteEventCount: aggregate.deleteEventCount,
            pasteBlockedCount: aggregate.pasteBlockedCount,
            atomicInsertCount: aggregate.atomicInsertCount,
            maxInsertSize: aggregate.maxInsertSize,
          },
        });
        return;
      }

      await transaction.editorTelemetryAggregate.update({
        where,
        data: {
          insertEventCount: {
            increment: aggregate.insertEventCount,
          },
          deleteEventCount: {
            increment: aggregate.deleteEventCount,
          },
          pasteBlockedCount: {
            increment: aggregate.pasteBlockedCount,
          },
          atomicInsertCount: {
            increment: aggregate.atomicInsertCount,
          },
          maxInsertSize: Math.max(existing.maxInsertSize, aggregate.maxInsertSize),
        },
      });
    });
  };
}

export function createRedisRawTelemetrySink(
  redis: RedisRawTelemetryClient,
  options: RedisRawTelemetrySinkOptions = {},
): TelemetryRawEventSink {
  const streamKey = options.streamKey ?? defaultRawTelemetryStreamKey;

  return async (event) => {
    const fields = {
      type: event.type,
      kind: event.kind,
      storagePolicy: event.storagePolicy,
      sessionId: event.sessionId,
      participantId: event.participantId,
      documentId: event.documentId,
      occurredAt: event.occurredAt,
      source: event.source,
    };

    await redis.xAdd(
      streamKey,
      "*",
      event.type === "editor.atomic_insert"
        ? {
            ...fields,
            insertedCharacterCount: String(event.insertedCharacterCount),
          }
        : fields,
    );
  };
}
