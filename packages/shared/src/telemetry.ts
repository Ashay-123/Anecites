import {
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertPositiveInteger,
  type IsoDateTimeString,
} from "./constants.js";

export const EDITOR_EVENT_TYPES = {
  yjsUpdate: "editor.yjs_update",
  atomicInsert: "editor.atomic_insert",
  pasteBlocked: "editor.paste_blocked",
  replayObjectWritten: "editor.replay_object_written",
} as const;

export type EditorEventType = (typeof EDITOR_EVENT_TYPES)[keyof typeof EDITOR_EVENT_TYPES];

export const TELEMETRY_STORAGE_POLICIES = {
  objectStorageOnly: "object-storage-only",
  postgresAggregate: "postgres-aggregate",
} as const;

export type TelemetryStoragePolicy =
  (typeof TELEMETRY_STORAGE_POLICIES)[keyof typeof TELEMETRY_STORAGE_POLICIES];

export type EditorEventSource = "keystroke" | "programmatic" | "paste_event" | "native";

export interface AtomicInsertTelemetryInput {
  sessionId: string;
  participantId: string;
  documentId: string;
  occurredAt: IsoDateTimeString;
  insertedCharacterCount: number;
  source: EditorEventSource;
}

export interface AtomicInsertTelemetryEvent extends AtomicInsertTelemetryInput {
  kind: "raw";
  type: typeof EDITOR_EVENT_TYPES.atomicInsert;
  storagePolicy: typeof TELEMETRY_STORAGE_POLICIES.objectStorageOnly;
}

export interface PasteBlockedTelemetryInput {
  sessionId: string;
  participantId: string;
  documentId: string;
  occurredAt: IsoDateTimeString;
  source: "paste_event";
}

export interface PasteBlockedTelemetryEvent extends PasteBlockedTelemetryInput {
  kind: "raw";
  type: typeof EDITOR_EVENT_TYPES.pasteBlocked;
  storagePolicy: typeof TELEMETRY_STORAGE_POLICIES.objectStorageOnly;
}

export interface RollingEditorTelemetryAggregateInput {
  sessionId: string;
  participantId: string;
  documentId: string;
  windowStartedAt: IsoDateTimeString;
  windowEndedAt: IsoDateTimeString;
  insertEventCount: number;
  deleteEventCount: number;
  pasteBlockedCount: number;
  atomicInsertCount: number;
  maxInsertSize: number;
}

export interface RollingEditorTelemetryAggregate extends RollingEditorTelemetryAggregateInput {
  kind: "aggregate";
  type: "editor.rolling_aggregate";
  storagePolicy: typeof TELEMETRY_STORAGE_POLICIES.postgresAggregate;
}

export type EditorTelemetryRecord =
  | AtomicInsertTelemetryEvent
  | PasteBlockedTelemetryEvent
  | RollingEditorTelemetryAggregate;

export function createAtomicInsertTelemetryEvent(
  input: AtomicInsertTelemetryInput,
): AtomicInsertTelemetryEvent {
  assertNonEmptyString("sessionId", input.sessionId);
  assertNonEmptyString("participantId", input.participantId);
  assertNonEmptyString("documentId", input.documentId);
  assertNonEmptyString("occurredAt", input.occurredAt);
  assertPositiveInteger("insertedCharacterCount", input.insertedCharacterCount);

  return {
    ...input,
    kind: "raw",
    type: EDITOR_EVENT_TYPES.atomicInsert,
    storagePolicy: TELEMETRY_STORAGE_POLICIES.objectStorageOnly,
  };
}

export function createPasteBlockedTelemetryEvent(
  input: PasteBlockedTelemetryInput,
): PasteBlockedTelemetryEvent {
  assertNonEmptyString("sessionId", input.sessionId);
  assertNonEmptyString("participantId", input.participantId);
  assertNonEmptyString("documentId", input.documentId);
  assertNonEmptyString("occurredAt", input.occurredAt);

  return {
    ...input,
    kind: "raw",
    type: EDITOR_EVENT_TYPES.pasteBlocked,
    storagePolicy: TELEMETRY_STORAGE_POLICIES.objectStorageOnly,
  };
}

export function createRollingEditorTelemetryAggregate(
  input: RollingEditorTelemetryAggregateInput,
): RollingEditorTelemetryAggregate {
  assertNonEmptyString("sessionId", input.sessionId);
  assertNonEmptyString("participantId", input.participantId);
  assertNonEmptyString("documentId", input.documentId);
  assertNonEmptyString("windowStartedAt", input.windowStartedAt);
  assertNonEmptyString("windowEndedAt", input.windowEndedAt);
  assertNonNegativeInteger("insertEventCount", input.insertEventCount);
  assertNonNegativeInteger("deleteEventCount", input.deleteEventCount);
  assertNonNegativeInteger("pasteBlockedCount", input.pasteBlockedCount);
  assertNonNegativeInteger("atomicInsertCount", input.atomicInsertCount);
  assertNonNegativeInteger("maxInsertSize", input.maxInsertSize);

  return {
    ...input,
    kind: "aggregate",
    type: "editor.rolling_aggregate",
    storagePolicy: TELEMETRY_STORAGE_POLICIES.postgresAggregate,
  };
}

export function shouldPersistTelemetryToPostgres(record: EditorTelemetryRecord): boolean {
  return record.storagePolicy === TELEMETRY_STORAGE_POLICIES.postgresAggregate;
}
