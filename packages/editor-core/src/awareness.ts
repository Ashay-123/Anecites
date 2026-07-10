import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

import { type EditorYjsDocument } from "./yjs-binding.js";

export interface EditorAwarenessUser {
  id: string;
  displayName: string;
  color?: string;
}

export interface EditorCursorSelection {
  anchor: number;
  head: number;
}

export interface EditorAwarenessState {
  documentId: string;
  user: EditorAwarenessUser;
  selection: EditorCursorSelection | null;
}

export interface EditorAwarenessOptions {
  user: EditorAwarenessUser;
}

export interface EditorAwareness {
  documentId: string;
  awareness: Awareness;
  destroy(): void;
}

export function createEditorAwareness(
  document: EditorYjsDocument,
  options: EditorAwarenessOptions,
): EditorAwareness {
  const user = normalizeUser(options.user);
  const awareness = new Awareness(document.doc);

  awareness.setLocalState({
    documentId: document.documentId,
    user,
    selection: null,
  } satisfies EditorAwarenessState);

  return {
    documentId: document.documentId,
    awareness,
    destroy() {
      awareness.destroy();
    },
  };
}

export function setEditorAwarenessSelection(
  editorAwareness: EditorAwareness,
  selection: EditorCursorSelection,
): void {
  const normalizedSelection = normalizeSelection(selection);
  const currentState = editorAwareness.awareness.getLocalState();

  if (!isEditorAwarenessState(currentState)) {
    throw new Error("Editor awareness local state is invalid");
  }

  editorAwareness.awareness.setLocalState({
    ...currentState,
    selection: normalizedSelection,
  });
}

export function encodeEditorAwarenessUpdate(editorAwareness: EditorAwareness): Uint8Array {
  return encodeAwarenessUpdate(editorAwareness.awareness, [editorAwareness.awareness.clientID]);
}

export function applyEditorAwarenessUpdate(
  editorAwareness: EditorAwareness,
  update: Uint8Array,
): void {
  try {
    applyAwarenessUpdate(editorAwareness.awareness, update, "remote");
  } catch (error) {
    throw new Error("Invalid awareness update", {
      cause: error,
    });
  }
}

export function getEditorAwarenessStates(editorAwareness: EditorAwareness): EditorAwarenessState[] {
  return [...editorAwareness.awareness.getStates().values()]
    .filter(isEditorAwarenessState)
    .filter((state) => state.documentId === editorAwareness.documentId)
    .map((state) => ({
      documentId: state.documentId,
      user: state.user,
      selection: state.selection,
    }));
}

function normalizeUser(user: EditorAwarenessUser): EditorAwarenessUser {
  return {
    id: requireNonEmptyString("user.id", user.id),
    displayName: requireNonEmptyString("user.displayName", user.displayName),
    ...(user.color !== undefined ? { color: requireNonEmptyString("user.color", user.color) } : {}),
  };
}

function normalizeSelection(selection: EditorCursorSelection): EditorCursorSelection {
  return {
    anchor: requireNonNegativeInteger("anchor", selection.anchor),
    head: requireNonNegativeInteger("head", selection.head),
  };
}

function isEditorAwarenessState(value: unknown): value is EditorAwarenessState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EditorAwarenessState>;
  return (
    typeof record.documentId === "string" &&
    isEditorAwarenessUser(record.user) &&
    (record.selection === null || isEditorCursorSelection(record.selection))
  );
}

function isEditorAwarenessUser(value: unknown): value is EditorAwarenessUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EditorAwarenessUser>;
  return (
    typeof record.id === "string" &&
    typeof record.displayName === "string" &&
    (record.color === undefined || typeof record.color === "string")
  );
}

function isEditorCursorSelection(value: unknown): value is EditorCursorSelection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EditorCursorSelection>;
  return Number.isInteger(record.anchor) && Number.isInteger(record.head);
}

function requireNonEmptyString(name: string, value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}

function requireNonNegativeInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}
