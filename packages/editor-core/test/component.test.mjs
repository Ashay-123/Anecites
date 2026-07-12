import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MonacoCollabEditor,
  createEditorPasteBlockedTelemetryEvent,
  createEditorYjsDocument,
} from "../dist/index.js";

test("MonacoCollabEditor renders a stable editor host element", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "hello",
  });
  const html = renderToStaticMarkup(
    React.createElement(MonacoCollabEditor, {
      document,
      language: "javascript",
      readOnly: false,
    }),
  );

  assert.match(html, /data-anecites-editor="monaco-collab"/);
  assert.match(html, /data-document-id="document-a"/);
  assert.match(html, /data-language="javascript"/);
  assert.match(html, /class="editor-monaco-surface"/);
  assert.match(html, /data-monaco-ready="false"/);
  assert.match(html, /class="editor-code-frame"/);
  assert.match(html, /class="editor-line-gutter"/);
  assert.match(html, /data-anecites-editor-input="true"/);
  assert.match(html, /data-fallback-active="true"/);
  assert.match(html, /hello/);

  document.destroy();
});

test("editor paste blocked telemetry includes session and participant context", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const event = createEditorPasteBlockedTelemetryEvent(document, {
    sessionId: "session-a",
    participantId: "candidate-a",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    onEvent() {},
  });

  assert.equal(event.type, "editor.paste_blocked");
  assert.equal(event.sessionId, "session-a");
  assert.equal(event.participantId, "candidate-a");
  assert.equal(event.documentId, "document-a");
  assert.equal(event.occurredAt, "2026-01-01T00:00:00.000Z");
  assert.equal(event.source, "paste_event");

  document.destroy();
});

test("MonacoCollabEditor marks paste and context-menu paste paths as disabled", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const html = renderToStaticMarkup(
    React.createElement(MonacoCollabEditor, {
      document,
      language: "javascript",
      disablePaste: true,
    }),
  );

  assert.match(html, /data-paste-disabled="true"/);

  document.destroy();
});
