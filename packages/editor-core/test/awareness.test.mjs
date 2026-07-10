import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditorAwarenessUpdate,
  createEditorAwareness,
  createEditorYjsDocument,
  encodeEditorAwarenessUpdate,
  getEditorAwarenessStates,
  setEditorAwarenessSelection,
} from "../dist/index.js";

test("editor awareness publishes local cursor selection", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
    initialText: "hello world",
  });
  const awareness = createEditorAwareness(document, {
    user: {
      id: "candidate-1",
      displayName: "Candidate One",
      color: "#2563eb",
    },
  });

  setEditorAwarenessSelection(awareness, {
    anchor: 2,
    head: 5,
  });

  assert.deepEqual(getEditorAwarenessStates(awareness), [
    {
      documentId: "document-a",
      user: {
        id: "candidate-1",
        displayName: "Candidate One",
        color: "#2563eb",
      },
      selection: {
        anchor: 2,
        head: 5,
      },
    },
  ]);

  awareness.destroy();
  document.destroy();
});

test("editor awareness updates sync selections across document instances", () => {
  const firstDocument = createEditorYjsDocument({
    documentId: "document-a",
  });
  const secondDocument = createEditorYjsDocument({
    documentId: "document-a",
  });
  const firstAwareness = createEditorAwareness(firstDocument, {
    user: {
      id: "candidate-1",
      displayName: "Candidate One",
    },
  });
  const secondAwareness = createEditorAwareness(secondDocument, {
    user: {
      id: "interviewer-1",
      displayName: "Interviewer One",
    },
  });

  setEditorAwarenessSelection(firstAwareness, {
    anchor: 3,
    head: 9,
  });
  applyEditorAwarenessUpdate(secondAwareness, encodeEditorAwarenessUpdate(firstAwareness));

  assert.deepEqual(getEditorAwarenessStates(secondAwareness), [
    {
      documentId: "document-a",
      user: {
        id: "interviewer-1",
        displayName: "Interviewer One",
      },
      selection: null,
    },
    {
      documentId: "document-a",
      user: {
        id: "candidate-1",
        displayName: "Candidate One",
      },
      selection: {
        anchor: 3,
        head: 9,
      },
    },
  ]);

  firstAwareness.destroy();
  secondAwareness.destroy();
  firstDocument.destroy();
  secondDocument.destroy();
});

test("editor awareness rejects invalid cursor selections", () => {
  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const awareness = createEditorAwareness(document, {
    user: {
      id: "candidate-1",
      displayName: "Candidate One",
    },
  });

  assert.throws(
    () => setEditorAwarenessSelection(awareness, { anchor: -1, head: 0 }),
    /anchor must be a non-negative integer/,
  );

  assert.throws(
    () => setEditorAwarenessSelection(awareness, { anchor: 0.5, head: 1 }),
    /anchor must be a non-negative integer/,
  );

  awareness.destroy();
  document.destroy();
});
