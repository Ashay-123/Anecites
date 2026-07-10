import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

import {
  applyRemoteYjsUpdate,
  createEditorYjsDocument,
  encodeEditorYjsState,
} from "../dist/index.js";

test("editor-core syncs two Yjs document instances", () => {
  const first = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "hello",
  });
  const second = createEditorYjsDocument({
    documentId: "document-a",
  });

  applyRemoteYjsUpdate(second, encodeEditorYjsState(first));
  assert.equal(second.text.toString(), "hello");

  first.text.insert(first.text.length, " world");
  applyRemoteYjsUpdate(second, encodeEditorYjsState(first));

  assert.equal(second.text.toString(), "hello world");

  first.destroy();
  second.destroy();
});

test("editor-core creates isolated Yjs document instances", () => {
  const first = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "alpha",
  });
  const second = createEditorYjsDocument({
    documentId: "document-b",
    initialText: "beta",
  });

  assert.notEqual(first.doc, second.doc);
  assert.equal(first.text.toString(), "alpha");
  assert.equal(second.text.toString(), "beta");

  first.destroy();
  second.destroy();
});

test("editor-core rejects invalid remote Yjs updates", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });

  assert.throws(
    () => applyRemoteYjsUpdate(document, new Uint8Array([1, 2, 3])),
    /Invalid Yjs update/,
  );

  document.destroy();
});

test("encoded editor state is a real Yjs update", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "sync me",
  });
  const update = encodeEditorYjsState(document);
  const remoteDoc = new Y.Doc();

  Y.applyUpdate(remoteDoc, update);

  assert.equal(remoteDoc.getText("main").toString(), "sync me");

  remoteDoc.destroy();
  document.destroy();
});
