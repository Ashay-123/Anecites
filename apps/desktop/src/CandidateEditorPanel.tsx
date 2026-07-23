import { type ReactElement } from "react";
import {
  MonacoCollabEditor,
  type CodeExecutionResult,
  type EditorTelemetryEvent,
  type EditorYjsDocument,
} from "@anecites/editor-core";

import {
  type CollabStatus,
  type EditorCursorPosition,
  type ExecutionMode,
  type ExecutionStatus,
} from "./meeting-types.js";
import { type LocalDemoEditorDocument } from "./local-demo.js";

export interface CandidateEditorPanelProps {
  document: EditorYjsDocument;
  language: "javascript" | "python";
  languageLabel: string;
  collabStatus: CollabStatus;
  cursorPosition: EditorCursorPosition;
  execution: CodeExecutionResult;
  executionStatus: ExecutionStatus;
  sessionId: string;
  participantId: string;
  disablePaste: boolean;
  documents: readonly LocalDemoEditorDocument[];
  activeDocumentId: string;
  creatingDocument: boolean;
  onCursorPositionChange: (position: EditorCursorPosition) => void;
  onExecute: (mode: ExecutionMode) => void;
  onSelectDocument: (documentId: string) => void;
  onCreateDocument: () => void;
  onTelemetryEvent: (event: EditorTelemetryEvent) => void;
}

export function CandidateEditorPanel({
  document,
  language,
  languageLabel,
  collabStatus,
  cursorPosition,
  execution,
  executionStatus,
  sessionId,
  participantId,
  disablePaste,
  documents,
  activeDocumentId,
  creatingDocument,
  onCursorPositionChange,
  onExecute,
  onSelectDocument,
  onCreateDocument,
  onTelemetryEvent,
}: CandidateEditorPanelProps): ReactElement {
  const executionOutput = formatExecutionOutput(execution);
  const hasExecutionOutput = executionOutput.trim().length > 0;

  return (
    <section className="candidate-code-pane" aria-label="Shared code editor">
      <header className="candidate-editor-header">
        <div className="candidate-editor-title">
          <strong>Code editor</strong>
          <span>{languageLabel}</span>
        </div>
        <div className="candidate-editor-tabs" role="tablist" aria-label="Code editor tabs">
          {documents.map((editorDocument, index) => (
            <button
              key={editorDocument.id}
              type="button"
              role="tab"
              aria-selected={editorDocument.id === activeDocumentId}
              tabIndex={editorDocument.id === activeDocumentId ? 0 : -1}
              onClick={() => onSelectDocument(editorDocument.id)}
              onKeyDown={(event) => {
                const lastIndex = documents.length - 1;
                const nextIndex = event.key === "ArrowRight"
                  ? (index + 1) % documents.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + documents.length) % documents.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? lastIndex
                        : null;
                if (nextIndex === null) {
                  return;
                }
                event.preventDefault();
                const nextDocument = documents[nextIndex];
                if (!nextDocument) {
                  return;
                }
                onSelectDocument(nextDocument.id);
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
                tabs?.[nextIndex]?.focus();
              }}
            >
              {editorDocument.label}
            </button>
          ))}
          <button
            className="candidate-editor-add-tab"
            type="button"
            aria-label="New editor tab"
            title="New editor tab"
            onClick={onCreateDocument}
            disabled={creatingDocument || documents.length >= 10}
          >
            +
          </button>
        </div>
        <div className="candidate-editor-assist">
          <span>{formatCollabStatus(collabStatus)}</span>
          <span>
            Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
          </span>
        </div>
        <button
          className="candidate-run-button"
          type="button"
          onClick={() => onExecute("run")}
          disabled={executionStatus === "running"}
        >
          {executionStatus === "running" ? "Running" : "Run"}
        </button>
      </header>
      <div className="candidate-editor-body">
        <MonacoCollabEditor
          className="candidate-editor-host"
          document={document}
          language={language}
          disablePaste={disablePaste}
          onCursorPositionChange={onCursorPositionChange}
          telemetry={{
            sessionId,
            participantId,
            onEvent: onTelemetryEvent,
          }}
        />
      </div>
      <section className="candidate-console-pane" aria-label="Execution output">
        <header className="candidate-console-toolbar">
          <strong>Output</strong>
          <span>{execution.status.description}</span>
        </header>
        <div className="candidate-console-body" data-status={executionStatus}>
          {executionStatus === "idle" && !hasExecutionOutput ? (
            <p>Run code to see output.</p>
          ) : executionStatus === "running" ? (
            <p>Running...</p>
          ) : (
            <pre>{executionOutput}</pre>
          )}
        </div>
      </section>
    </section>
  );
}

function formatCollabStatus(status: CollabStatus): string {
  switch (status) {
    case "connected":
      return "Synced";
    case "connecting":
      return "Syncing";
    case "unavailable":
      return "Local only";
    case "idle":
      return "Local draft";
  }
}

function formatExecutionOutput(execution: CodeExecutionResult): string {
  return [execution.stdout, execution.stderr, execution.compileOutput, execution.message]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .trimEnd();
}
