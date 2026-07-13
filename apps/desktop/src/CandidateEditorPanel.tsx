import { type ReactElement } from "react";
import { MonacoCollabEditor, type CodeExecutionResult, type EditorYjsDocument } from "@anecites/editor-core";

import {
  type CollabStatus,
  type EditorCursorPosition,
  type ExecutionMode,
  type ExecutionStatus,
} from "./meeting-types.js";

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
  onCursorPositionChange: (position: EditorCursorPosition) => void;
  onExecute: (mode: ExecutionMode) => void;
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
  onCursorPositionChange,
  onExecute,
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
          onCursorPositionChange={onCursorPositionChange}
          telemetry={{
            sessionId,
            participantId,
            onEvent() {},
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
