import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { SignJWT } from "jose";
import WebSocket from "ws";

import { createCollabServer } from "@anecites/collab";
import {
  connectEditorCollabSession,
  createEditorYjsDocument,
} from "../dist/index.js";

const authJwtSecret = "editor-core-collab-secret-minimum-32-chars";

test("editor-core syncs Yjs document updates through the collab server", async () => {
  const collab = createCollabServer({
    authJwtSecret,
  });
  collab.httpServer.listen(0, "127.0.0.1");
  await once(collab.httpServer, "listening");

  const address = collab.httpServer.address();
  assert.equal(typeof address, "object");
  assert(address);

  const first = createEditorYjsDocument({
    documentId: "document-a",
  });
  const second = createEditorYjsDocument({
    documentId: "document-a",
  });
  const token = await mintToken("candidate-1", "candidate");

  const firstClient = connectEditorCollabSession({
    baseUrl: `ws://127.0.0.1:${address.port}`,
    sessionId: "session-a",
    token,
    document: first,
    WebSocketConstructor: WebSocket,
  });
  const secondClient = connectEditorCollabSession({
    baseUrl: `ws://127.0.0.1:${address.port}`,
    sessionId: "session-a",
    token,
    document: second,
    WebSocketConstructor: WebSocket,
  });

  try {
    await Promise.all([firstClient.ready, secondClient.ready]);

    first.text.insert(0, "through collab");
    firstClient.sendLocalState();

    await waitUntil(() => second.text.toString() === "through collab");
    assert.equal(second.text.toString(), "through collab");
  } finally {
    firstClient.close();
    secondClient.close();
    first.destroy();
    second.destroy();
    await collab.close();
  }
});

test("editor-core waits for the authorized collab snapshot before reporting ready", async () => {
  const collab = createCollabServer({
    authJwtSecret,
    authorizeRoom: async () => {
      await delay(75);
      return true;
    },
  });
  collab.httpServer.listen(0, "127.0.0.1");
  await once(collab.httpServer, "listening");

  const address = collab.httpServer.address();
  assert.equal(typeof address, "object");
  assert(address);

  const interviewer = createEditorYjsDocument({
    documentId: "document-a",
  });
  const candidate = createEditorYjsDocument({
    documentId: "document-a",
  });
  const token = await mintToken("candidate-1", "candidate");

  const interviewerClient = connectEditorCollabSession({
    baseUrl: `ws://127.0.0.1:${address.port}`,
    sessionId: "session-a",
    token,
    document: interviewer,
    WebSocketConstructor: WebSocket,
  });
  const candidateClient = connectEditorCollabSession({
    baseUrl: `ws://127.0.0.1:${address.port}`,
    sessionId: "session-a",
    token,
    document: candidate,
    WebSocketConstructor: WebSocket,
  });

  try {
    await Promise.all([interviewerClient.ready, candidateClient.ready]);

    candidate.text.insert(0, "after authorization");
    candidateClient.sendLocalState();

    await waitUntil(() => interviewer.text.toString() === "after authorization");
    assert.equal(interviewer.text.toString(), "after authorization");
  } finally {
    interviewerClient.close();
    candidateClient.close();
    interviewer.destroy();
    candidate.destroy();
    await collab.close();
  }
});

test("editor-core sends paste-blocked telemetry through the authenticated collab socket", async () => {
  const rawEvents = [];
  const aggregates = [];
  const collab = createCollabServer({
    authJwtSecret,
    telemetry: {
      recordRawEvent(event) {
        rawEvents.push(event);
      },
      flushAggregate(aggregate) {
        aggregates.push(aggregate);
      },
      now: () => new Date("2026-07-17T10:00:00.000Z"),
    },
  });
  collab.httpServer.listen(0, "127.0.0.1");
  await once(collab.httpServer, "listening");

  const address = collab.httpServer.address();
  assert.equal(typeof address, "object");
  assert(address);

  const document = createEditorYjsDocument({
    documentId: "document-a",
  });
  const token = await mintToken("candidate-1", "candidate");
  const client = connectEditorCollabSession({
    baseUrl: `ws://127.0.0.1:${address.port}`,
    sessionId: "session-a",
    token,
    document,
    WebSocketConstructor: WebSocket,
  });

  try {
    await client.ready;
    client.sendPasteBlockedTelemetry();
    await waitUntil(() => rawEvents.length === 1 && aggregates.length === 1);

    assert.deepEqual(rawEvents[0], {
      kind: "raw",
      type: "editor.paste_blocked",
      storagePolicy: "object-storage-only",
      sessionId: "session-a",
      participantId: "candidate-1",
      documentId: "document-a",
      occurredAt: "2026-07-17T10:00:00.000Z",
      source: "paste_event",
    });
    assert.equal(aggregates[0].pasteBlockedCount, 1);
    assert.equal(aggregates[0].insertEventCount, 0);
    assert.equal(aggregates[0].atomicInsertCount, 0);
  } finally {
    client.close();
    document.destroy();
    await collab.close();
  }
});

async function mintToken(subject, role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));
}

async function delay(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(predicate, timeoutMs = 500) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}
