import { type ClipboardEvent, type ReactElement } from "react";

import {
  createEditorPasteBlockedTelemetryEvent,
  type EditorTelemetryOptions,
} from "./editor-telemetry.js";
import { type EditorYjsDocument } from "./yjs-binding.js";

export interface MonacoCollabEditorProps {
  document: EditorYjsDocument;
  language: string;
  readOnly?: boolean;
  className?: string;
  disablePaste?: boolean;
  telemetry?: EditorTelemetryOptions;
}

export function MonacoCollabEditor(props: MonacoCollabEditorProps): ReactElement {
  const { document, language, readOnly = false, className, disablePaste = true, telemetry } = props;

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!disablePaste) {
      return;
    }

    event.preventDefault();

    if (telemetry) {
      telemetry.onEvent(createEditorPasteBlockedTelemetryEvent(document, telemetry));
    }
  };

  return (
    <div
      className={className}
      data-anecites-editor="monaco-collab"
      data-document-id={document.documentId}
      data-language={language}
      data-paste-disabled={disablePaste ? "true" : "false"}
      data-read-only={readOnly ? "true" : "false"}
      onPaste={handlePaste}
    />
  );
}
