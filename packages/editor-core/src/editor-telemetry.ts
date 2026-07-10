import {
  createAtomicInsertTelemetryEvent,
  createPasteBlockedTelemetryEvent,
  type AtomicInsertTelemetryEvent,
  type PasteBlockedTelemetryEvent,
} from "@anecites/shared";
import { type YTextEvent } from "yjs";

import { type EditorYjsDocument } from "./yjs-binding.js";

export type EditorTelemetryEvent = AtomicInsertTelemetryEvent | PasteBlockedTelemetryEvent;

export interface EditorTelemetryOptions {
  sessionId: string;
  participantId: string;
  atomicInsertThreshold?: number;
  now?: () => Date;
  onEvent: (event: EditorTelemetryEvent) => void;
}

export interface EditorTelemetryObserver {
  destroy(): void;
}

const defaultAtomicInsertThreshold = 32;

export function createEditorTelemetryObserver(
  document: EditorYjsDocument,
  options: EditorTelemetryOptions,
): EditorTelemetryObserver {
  const normalizedOptions = normalizeTelemetryOptions(options);
  const observer = (event: YTextEvent) => {
    const insertedCharacterCount = countInsertedCharacters(event);

    if (insertedCharacterCount <= normalizedOptions.atomicInsertThreshold) {
      return;
    }

    normalizedOptions.onEvent(
      createAtomicInsertTelemetryEvent({
        sessionId: normalizedOptions.sessionId,
        participantId: normalizedOptions.participantId,
        documentId: document.documentId,
        occurredAt: currentIsoTime(normalizedOptions),
        insertedCharacterCount,
        source: "programmatic",
      }),
    );
  };

  document.text.observe(observer);

  return {
    destroy() {
      document.text.unobserve(observer);
    },
  };
}

export function createEditorPasteBlockedTelemetryEvent(
  document: EditorYjsDocument,
  options: EditorTelemetryOptions,
): PasteBlockedTelemetryEvent {
  const normalizedOptions = normalizeTelemetryOptions(options);

  return createPasteBlockedTelemetryEvent({
    sessionId: normalizedOptions.sessionId,
    participantId: normalizedOptions.participantId,
    documentId: document.documentId,
    occurredAt: currentIsoTime(normalizedOptions),
    source: "paste_event",
  });
}

function countInsertedCharacters(event: YTextEvent): number {
  return event.delta.reduce((total, operation) => {
    if (typeof operation.insert === "string") {
      return total + operation.insert.length;
    }

    return total;
  }, 0);
}

function normalizeTelemetryOptions(options: EditorTelemetryOptions): Required<EditorTelemetryOptions> {
  return {
    sessionId: requireNonEmptyString("sessionId", options.sessionId),
    participantId: requireNonEmptyString("participantId", options.participantId),
    atomicInsertThreshold: normalizeAtomicInsertThreshold(options.atomicInsertThreshold),
    now: options.now ?? (() => new Date()),
    onEvent: options.onEvent,
  };
}

function normalizeAtomicInsertThreshold(value: number | undefined): number {
  if (value === undefined) {
    return defaultAtomicInsertThreshold;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("atomicInsertThreshold must be a non-negative integer");
  }

  return value;
}

function currentIsoTime(options: Required<EditorTelemetryOptions>): string {
  return options.now().toISOString();
}

function requireNonEmptyString(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}
