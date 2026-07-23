import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { type YTextEvent } from "yjs";

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
  onCursorPositionChange?: (position: EditorCursorPosition) => void;
}

export interface EditorCursorPosition {
  lineNumber: number;
  column: number;
}

type MonacoModule = typeof import("monaco-editor/esm/vs/editor/editor.api.js");
type MonacoEditor = import("monaco-editor/esm/vs/editor/editor.api.js").editor.IStandaloneCodeEditor;
type MonacoModel = import("monaco-editor/esm/vs/editor/editor.api.js").editor.ITextModel;

export interface EditorTextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

interface MonacoPasteGuardEditor {
  addAction(descriptor: {
    id: string;
    label: string;
    keybindings: number[];
    run: () => void | Promise<void>;
  }): { dispose(): void };
}

export interface MonacoPasteGuardKeybindings {
  ctrlCmd: number;
  shift: number;
  keyV: number;
  insert: number;
}

interface MonacoEnvironmentLike {
  getWorker?: (_workerId: string, label: string) => Worker;
}

let themeRegistered = false;

export function MonacoCollabEditor(props: MonacoCollabEditorProps): ReactElement {
  const {
    document,
    language,
    readOnly = false,
    className,
    disablePaste = true,
    telemetry,
    onCursorPositionChange,
  } = props;
  const initialText = document.text.toString();
  const lineNumberCount = Math.max(24, initialText.split(/\r\n|\r|\n/).length + 8);
  const lineNumbers = Array.from({ length: lineNumberCount }, (_, index) => index + 1);
  const monacoContainerRef = useRef<HTMLDivElement | null>(null);
  const fallbackTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const telemetryRef = useRef(telemetry);
  const [monacoReady, setMonacoReady] = useState(false);
  const reactId = useId();
  telemetryRef.current = telemetry;

  const emitPasteBlockedTelemetry = useCallback(() => {
    const currentTelemetry = telemetryRef.current;
    if (currentTelemetry) {
      currentTelemetry.onEvent(
        createEditorPasteBlockedTelemetryEvent(document, currentTelemetry),
      );
    }
  }, [document]);

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!disablePaste) {
      return;
    }

    event.preventDefault();
    emitPasteBlockedTelemetry();
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!disablePaste) {
      return;
    }

    event.preventDefault();
    emitPasteBlockedTelemetry();
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    applyEditorTextValue(document, event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || event.key !== "Tab") {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const nextValue = `${target.value.slice(0, start)}  ${target.value.slice(end)}`;
    target.value = nextValue;
    target.selectionStart = start + 2;
    target.selectionEnd = start + 2;
    applyEditorTextValue(document, nextValue);
  };

  useEffect(() => {
    const container = monacoContainerRef.current;

    if (!container || typeof window === "undefined") {
      return;
    }

    let disposed = false;
    let editor: MonacoEditor | null = null;
    let model: MonacoModel | null = null;
    let removeTextObserver: (() => void) | null = null;
    let contentChangeSubscription: { dispose(): void } | null = null;
    let cursorPositionSubscription: { dispose(): void } | null = null;
    let pasteGuardSubscription: { dispose(): void } | null = null;
    let ignoreMonacoChange = false;

    void loadMonaco().then((monaco) => {
      if (disposed || !monacoContainerRef.current) {
        return;
      }

      registerAnecitesTheme(monaco);
      model = monaco.editor.createModel(
        document.text.toString(),
        normalizeMonacoLanguage(language),
        monaco.Uri.parse(`inmemory://anecites/${encodeURIComponent(document.documentId)}/${sanitizeReactId(reactId)}.${fileExtensionForLanguage(language)}`),
      );
      editor = monaco.editor.create(monacoContainerRef.current, {
        model,
        readOnly,
        theme: "anecites-light",
        automaticLayout: true,
        minimap: {
          enabled: false,
        },
        fontFamily: "var(--font-mono), Consolas, monospace",
        fontLigatures: false,
        fontSize: 14,
        lineHeight: 24,
        lineNumbersMinChars: 3,
        padding: {
          top: 14,
          bottom: 14,
        },
        renderLineHighlight: "line",
        roundedSelection: false,
        scrollBeyondLastLine: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        tabSize: 2,
        wordWrap: "off",
      });
      pasteGuardSubscription = disablePaste
        ? installMonacoPasteGuards(
            editor,
            {
              ctrlCmd: monaco.KeyMod.CtrlCmd,
              shift: monaco.KeyMod.Shift,
              keyV: monaco.KeyCode.KeyV,
              insert: monaco.KeyCode.Insert,
            },
            emitPasteBlockedTelemetry,
          )
        : null;
      onCursorPositionChange?.({
        lineNumber: editor.getPosition()?.lineNumber ?? 1,
        column: editor.getPosition()?.column ?? 1,
      });
      cursorPositionSubscription = editor.onDidChangeCursorPosition((event) => {
        onCursorPositionChange?.({
          lineNumber: event.position.lineNumber,
          column: event.position.column,
        });
      });
      contentChangeSubscription = model.onDidChangeContent((event) => {
        if (ignoreMonacoChange) {
          return;
        }

        applyEditorTextChanges(document, event.changes);
      });
      const textObserver = (_event: YTextEvent) => {
        if (!model || model.getValue() === document.text.toString()) {
          return;
        }

        const selection = editor?.getSelection() ?? null;
        ignoreMonacoChange = true;
        model.setValue(document.text.toString());
        ignoreMonacoChange = false;

        if (selection) {
          editor?.setSelection(selection);
        }
      };

      document.text.observe(textObserver);
      removeTextObserver = () => {
        document.text.unobserve(textObserver);
      };
      setMonacoReady(true);

      if (fallbackTextAreaRef.current) {
        fallbackTextAreaRef.current.value = document.text.toString();
      }
    }).catch(() => {
      if (!disposed) {
        setMonacoReady(false);
      }
    });

    return () => {
      disposed = true;
      setMonacoReady(false);
      contentChangeSubscription?.dispose();
      cursorPositionSubscription?.dispose();
      pasteGuardSubscription?.dispose();
      removeTextObserver?.();
      editor?.dispose();
      model?.dispose();
    };
  }, [disablePaste, document, emitPasteBlockedTelemetry, language, onCursorPositionChange, readOnly, reactId]);

  return (
    <div
      className={className}
      data-anecites-editor="monaco-collab"
      data-document-id={document.documentId}
      data-language={language}
      data-paste-disabled={disablePaste ? "true" : "false"}
      data-read-only={readOnly ? "true" : "false"}
      onContextMenu={handleContextMenu}
      onPaste={handlePaste}
    >
      <div
        ref={monacoContainerRef}
        className="editor-monaco-surface"
        data-monaco-ready={monacoReady ? "true" : "false"}
      />
      <div className="editor-code-frame">
        <div className="editor-line-gutter" aria-hidden="true">
          {lineNumbers.map((lineNumber) => (
            <span key={lineNumber}>{lineNumber}</span>
          ))}
        </div>
        <textarea
          ref={fallbackTextAreaRef}
          aria-label="Code editor"
          className="editor-textarea"
          data-anecites-editor-input="true"
          data-fallback-active={monacoReady ? "false" : "true"}
          defaultValue={initialText}
          readOnly={readOnly}
          spellCheck={false}
          onChange={handleChange}
          onClick={(event) => {
            const position = getTextareaCursorPosition(event.currentTarget);
            onCursorPositionChange?.(position);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            const position = getTextareaCursorPosition(event.currentTarget);
            onCursorPositionChange?.(position);
          }}
        />
      </div>
    </div>
  );
}

export function applyEditorTextChanges(
  document: EditorYjsDocument,
  changes: readonly EditorTextChange[],
): void {
  const orderedChanges = [...changes].sort((left, right) => right.rangeOffset - left.rangeOffset);
  const currentLength = document.text.length;

  for (const change of orderedChanges) {
    if (
      !Number.isInteger(change.rangeOffset) ||
      !Number.isInteger(change.rangeLength) ||
      change.rangeOffset < 0 ||
      change.rangeLength < 0 ||
      change.rangeOffset + change.rangeLength > currentLength
    ) {
      throw new Error("Editor text change range is invalid");
    }
  }

  document.doc.transact(() => {
    for (const change of orderedChanges) {
      if (change.rangeLength > 0) {
        document.text.delete(change.rangeOffset, change.rangeLength);
      }
      if (change.text.length > 0) {
        document.text.insert(change.rangeOffset, change.text);
      }
    }
  });
}

export function installMonacoPasteGuards(
  editor: MonacoPasteGuardEditor,
  keybindings: MonacoPasteGuardKeybindings,
  onPasteBlocked: () => void,
): { dispose(): void } {
  return editor.addAction({
    id: "editor.action.clipboardPasteAction",
    label: "Paste disabled",
    keybindings: [
      keybindings.ctrlCmd | keybindings.keyV,
      keybindings.shift | keybindings.insert,
    ],
    run: onPasteBlocked,
  });
}

function applyEditorTextValue(document: EditorYjsDocument, nextValue: string): void {
  const currentValue = document.text.toString();
  if (currentValue === nextValue) {
    return;
  }

  let prefixLength = 0;
  const commonLength = Math.min(currentValue.length, nextValue.length);
  while (
    prefixLength < commonLength &&
    currentValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < commonLength - prefixLength &&
    currentValue[currentValue.length - suffixLength - 1] ===
      nextValue[nextValue.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  applyEditorTextChanges(document, [
    {
      rangeOffset: prefixLength,
      rangeLength: currentValue.length - prefixLength - suffixLength,
      text: nextValue.slice(prefixLength, nextValue.length - suffixLength),
    },
  ]);
}

async function loadMonaco(): Promise<MonacoModule> {
  configureMonacoEnvironment();
  const [monaco] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api.js"),
    import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
  ]);

  return monaco;
}

function configureMonacoEnvironment(): void {
  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: MonacoEnvironmentLike;
  };

  if (globalScope.MonacoEnvironment?.getWorker) {
    return;
  }

  globalScope.MonacoEnvironment = {
    getWorker() {
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
        type: "module",
      });
    },
  };
}

function registerAnecitesTheme(monaco: MonacoModule): void {
  if (themeRegistered) {
    return;
  }

  monaco.editor.defineTheme("anecites-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "6d28d9" },
      { token: "number", foreground: "0f766e" },
      { token: "string", foreground: "b45309" },
      { token: "type", foreground: "0369a1" },
      { token: "comment", foreground: "64748b" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#111827",
      "editor.lineHighlightBackground": "#f8fafc",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#111827",
      "editorCursor.foreground": "#111827",
      "editorIndentGuide.background1": "#e5e7eb",
      "editorIndentGuide.activeBackground1": "#cbd5e1",
      "editor.selectionBackground": "#bfdbfe",
    },
  });
  themeRegistered = true;
}

function normalizeMonacoLanguage(language: string): string {
  switch (language) {
    case "javascript":
    case "typescript":
    case "python":
      return language;
    default:
      return "plaintext";
  }
}

function fileExtensionForLanguage(language: string): string {
  switch (normalizeMonacoLanguage(language)) {
    case "javascript":
      return "js";
    case "typescript":
      return "ts";
    case "python":
      return "py";
    default:
      return "txt";
  }
}

function sanitizeReactId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getTextareaCursorPosition(textarea: HTMLTextAreaElement): EditorCursorPosition {
  const textBeforeCursor = textarea.value.slice(0, textarea.selectionStart);
  const lines = textBeforeCursor.split(/\r\n|\r|\n/);
  const currentLine = lines[lines.length - 1] ?? "";

  return {
    lineNumber: lines.length,
    column: currentLine.length + 1,
  };
}
