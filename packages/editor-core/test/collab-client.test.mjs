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

async function mintToken(subject, role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));
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
