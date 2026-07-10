import * as Y from "yjs";

export interface EditorYjsDocumentOptions {
  documentId: string;
  initialText?: string;
  textName?: string;
}

export interface EditorYjsDocument {
  documentId: string;
  textName: string;
  doc: Y.Doc;
  text: Y.Text;
  destroy(): void;
}

const defaultTextName = "main";

export function createEditorYjsDocument(options: EditorYjsDocumentOptions): EditorYjsDocument {
  const documentId = requireNonEmptyString("documentId", options.documentId);
  const textName = normalizeOptionalString(options.textName) ?? defaultTextName;
  const doc = new Y.Doc();
  const text = doc.getText(textName);

  if (options.initialText !== undefined && options.initialText.length > 0) {
    text.insert(0, options.initialText);
  }

  return {
    documentId,
    textName,
    doc,
    text,
    destroy() {
      doc.destroy();
    },
  };
}

export function encodeEditorYjsState(document: EditorYjsDocument): Uint8Array {
  return Y.encodeStateAsUpdate(document.doc);
}

export function applyRemoteYjsUpdate(document: EditorYjsDocument, update: Uint8Array): void {
  try {
    Y.applyUpdate(document.doc, update);
  } catch (error) {
    throw new Error("Invalid Yjs update", {
      cause: error,
    });
  }
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function requireNonEmptyString(name: string, value: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}
