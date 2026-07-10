import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MonacoCollabEditor,
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

  document.destroy();
});

test("MonacoCollabEditor prevents paste and emits paste-blocked telemetry", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const telemetryEvents = [];
  const element = MonacoCollabEditor({
    document,
    language: "javascript",
    telemetry: {
      sessionId: "session-a",
      participantId: "candidate-a",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onEvent(event) {
        telemetryEvents.push(event);
      },
    },
  });
  const pasteEvent = {
    preventDefaultCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
  };

  element.props.onPaste(pasteEvent);

  assert.equal(pasteEvent.preventDefaultCalled, true);
  assert.equal(telemetryEvents.length, 1);
  assert.equal(telemetryEvents[0].type, "editor.paste_blocked");
  assert.equal(telemetryEvents[0].sessionId, "session-a");
  assert.equal(telemetryEvents[0].participantId, "candidate-a");
  assert.equal(telemetryEvents[0].documentId, "document-a");
  assert.equal(telemetryEvents[0].occurredAt, "2026-01-01T00:00:00.000Z");
  assert.equal(telemetryEvents[0].source, "paste_event");

  document.destroy();
});

test("MonacoCollabEditor prevents context-menu paste path and emits paste-blocked telemetry", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const telemetryEvents = [];
  const element = MonacoCollabEditor({
    document,
    language: "javascript",
    telemetry: {
      sessionId: "session-a",
      participantId: "candidate-a",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onEvent(event) {
        telemetryEvents.push(event);
      },
    },
  });
  const contextMenuEvent = {
    preventDefaultCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
  };

  element.props.onContextMenu(contextMenuEvent);

  assert.equal(contextMenuEvent.preventDefaultCalled, true);
  assert.equal(telemetryEvents.length, 1);
  assert.equal(telemetryEvents[0].type, "editor.paste_blocked");
  assert.equal(telemetryEvents[0].sessionId, "session-a");
  assert.equal(telemetryEvents[0].participantId, "candidate-a");
  assert.equal(telemetryEvents[0].documentId, "document-a");
  assert.equal(telemetryEvents[0].occurredAt, "2026-01-01T00:00:00.000Z");
  assert.equal(telemetryEvents[0].source, "paste_event");

  document.destroy();
});
