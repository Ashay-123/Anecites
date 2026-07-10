import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { SignJWT } from "jose";
import WebSocket from "ws";
import * as Y from "yjs";

import { createCollabServer, createSessionParticipantAuthorizer, loadCollabConfig } from "../dist/index.js";

const authJwtSecret = "collab-test-secret-must-be-at-least-32-chars";
const socketStates = new WeakMap();

test("loadCollabConfig accepts the required collaboration environment", () => {
  assert.deepEqual(
    loadCollabConfig({
      COLLAB_HOST: "127.0.0.1",
      COLLAB_PORT: "3001",
      AUTH_JWT_SECRET: authJwtSecret,
      DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
      REDIS_URL: "redis://localhost:6379",
      COLLAB_TELEMETRY_RAW_STREAM_KEY: "anecites:test:editor-raw",
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      S3_REGION: "us-east-1",
      COLLAB_REPLAY_EVIDENCE_KEY_PREFIX: "replay/test",
    }),
    {
      host: "127.0.0.1",
      port: 3001,
      authJwtSecret,
      databaseUrl: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
      redisUrl: "redis://localhost:6379",
      telemetryRawStreamKey: "anecites:test:editor-raw",
      s3Endpoint: "http://localhost:9000",
      s3Bucket: "anecites-dev",
      s3AccessKeyId: "anecites",
      s3SecretAccessKey: "anecites_dev_password",
      s3Region: "us-east-1",
      replayEvidenceKeyPrefix: "replay/test",
    },
  );
});

test("loadCollabConfig fails closed without a Redis URL", () => {
  assert.throws(
    () =>
      loadCollabConfig({
        AUTH_JWT_SECRET: authJwtSecret,
        DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
      }),
    /REDIS_URL is required/,
  );
});

test("collab server relays Yjs updates within a session room", async () => {
  const server = await startServer();
  const token = await mintToken("candidate-1", "candidate");

  try {
    const first = await connect(server.port, "session-a", token);
    const second = await connect(server.port, "session-a", token);
    await drainSnapshot(first);
    await drainSnapshot(second);

    const update = createTextUpdate("hello from yjs");
    first.send(JSON.stringify({ type: "sync:update", update }));

    const message = await waitForMessage(second, "sync:update");
    const receivedDoc = new Y.Doc();
    Y.applyUpdate(receivedDoc, Buffer.from(message.update, "base64"));

    assert.equal(receivedDoc.getText("main").toString(), "hello from yjs");

    first.close();
    second.close();
  } finally {
    await server.close();
  }
});

test("collab server isolates updates by session room", async () => {
  const server = await startServer();
  const token = await mintToken("candidate-1", "candidate");

  try {
    const first = await connect(server.port, "session-a", token);
    const second = await connect(server.port, "session-b", token);
    await drainSnapshot(first);
    await drainSnapshot(second);

    first.send(JSON.stringify({ type: "sync:update", update: createTextUpdate("private") }));

    await assert.rejects(
      waitForMessage(second, "sync:update", 150),
      /Timed out waiting for sync:update/,
    );

    first.close();
    second.close();
  } finally {
    await server.close();
  }
});

test("collab server rejects invalid websocket auth before room join", async () => {
  const server = await startServer();

  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/collab?sessionId=session-a&token=bad`);
    const [code] = await once(socket, "close");

    assert.equal(code, 1008);
    assert.equal(server.roomCount(), 0);
  } finally {
    await server.close();
  }
});

test("collab server rejects unauthorized rooms before room join", async () => {
  const server = await startServer({
    authorizeRoom: () => false,
  });
  const token = await mintToken("candidate-1", "candidate");

  try {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/collab?sessionId=session-a&token=${encodeURIComponent(token)}`,
    );
    const [code] = await once(socket, "close");

    assert.equal(code, 1008);
    assert.equal(server.roomCount(), 0);
  } finally {
    await server.close();
  }
});

test("collab server authorizes active persisted session participants", async () => {
  const prismaCalls = [];
  const prisma = {
    participant: {
      async findFirst(query) {
        prismaCalls.push(query);
        return { id: "participant-1" };
      },
    },
  };
  const server = await startServer({
    authorizeRoom: createSessionParticipantAuthorizer(prisma),
  });
  const token = await mintToken("user-1", "candidate");

  try {
    const socket = await connect(server.port, "session-a", token);
    await drainSnapshot(socket);

    assert.equal(server.roomCount(), 1);
    assert.deepEqual(prismaCalls, [
      {
        where: {
          sessionId: "session-a",
          userId: "user-1",
          role: "CANDIDATE",
          leftAt: null,
        },
        select: {
          id: true,
        },
      },
    ]);
    socket.close();
  } finally {
    await server.close();
  }
});

test("collab server rejects users without active persisted session membership", async () => {
  const prismaCalls = [];
  const prisma = {
    participant: {
      async findFirst(query) {
        prismaCalls.push(query);
        return null;
      },
    },
  };
  const server = await startServer({
    authorizeRoom: createSessionParticipantAuthorizer(prisma),
  });
  const token = await mintToken("outsider-1", "candidate");

  try {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/collab?sessionId=session-a&token=${encodeURIComponent(token)}`,
    );
    const [code] = await once(socket, "close");

    assert.equal(code, 1008);
    assert.equal(server.roomCount(), 0);
    assert.deepEqual(prismaCalls, [
      {
        where: {
          sessionId: "session-a",
          userId: "outsider-1",
          role: "CANDIDATE",
          leftAt: null,
        },
        select: {
          id: true,
        },
      },
    ]);
  } finally {
    await server.close();
  }
});

test("collab telemetry flags large atomic inserts from Yjs updates", async () => {
  const rawEvents = [];
  const aggregates = [];
  const server = await startServer({
    telemetry: {
      atomicInsertThreshold: 10,
      aggregateWindowMs: 0,
      recordRawEvent: (event) => {
        rawEvents.push(event);
      },
      flushAggregate: (aggregate) => {
        aggregates.push(aggregate);
      },
      now: fixedClock("2026-07-10T01:00:00.000Z"),
    },
  });
  const token = await mintToken("participant-1", "candidate");

  try {
    const socket = await connect(server.port, "session-a", token, {
      documentId: "document-a",
    });
    await drainSnapshot(socket);

    socket.send(JSON.stringify({ type: "sync:update", update: createTextUpdate("x".repeat(42)) }));
    await waitUntil(() => aggregates.length === 1);

    assert.equal(rawEvents.length, 1);
    assert.equal(rawEvents[0].sessionId, "session-a");
    assert.equal(rawEvents[0].participantId, "participant-1");
    assert.equal(rawEvents[0].documentId, "document-a");
    assert.equal(rawEvents[0].insertedCharacterCount, 42);
    assert.equal(rawEvents[0].storagePolicy, "object-storage-only");

    assert.equal(aggregates.length, 1);
    assert.equal(aggregates[0].insertEventCount, 1);
    assert.equal(aggregates[0].deleteEventCount, 0);
    assert.equal(aggregates[0].atomicInsertCount, 1);
    assert.equal(aggregates[0].maxInsertSize, 42);
    assert.equal(aggregates[0].storagePolicy, "postgres-aggregate");

    socket.close();
  } finally {
    await server.close();
  }
});

test("collab telemetry flushes small insert aggregates without raw atomic events", async () => {
  const rawEvents = [];
  const aggregates = [];
  const server = await startServer({
    telemetry: {
      atomicInsertThreshold: 10,
      aggregateWindowMs: 0,
      recordRawEvent: (event) => {
        rawEvents.push(event);
      },
      flushAggregate: (aggregate) => {
        aggregates.push(aggregate);
      },
      now: fixedClock("2026-07-10T01:00:00.000Z"),
    },
  });
  const token = await mintToken("participant-1", "candidate");

  try {
    const socket = await connect(server.port, "session-a", token, {
      documentId: "document-a",
    });
    await drainSnapshot(socket);

    socket.send(JSON.stringify({ type: "sync:update", update: createTextUpdate("abc") }));
    await waitUntil(() => aggregates.length === 1);

    assert.equal(rawEvents.length, 0);
    assert.equal(aggregates.length, 1);
    assert.equal(aggregates[0].insertEventCount, 1);
    assert.equal(aggregates[0].deleteEventCount, 0);
    assert.equal(aggregates[0].atomicInsertCount, 0);
    assert.equal(aggregates[0].maxInsertSize, 3);

    socket.close();
  } finally {
    await server.close();
  }
});

test("collab server records replay evidence for Yjs updates", async () => {
  const replayRecords = [];
  const server = await startServer({
    replayEvidence: {
      recordUpdate: (record) => {
        replayRecords.push(record);
      },
      now: fixedClock("2026-07-10T01:00:00.000Z"),
    },
  });
  const token = await mintToken("participant-1", "candidate");

  try {
    const socket = await connect(server.port, "session-a", token, {
      documentId: "document-a",
    });
    await drainSnapshot(socket);

    const update = createTextUpdate("replay me");
    socket.send(JSON.stringify({ type: "sync:update", update }));
    await waitUntil(() => replayRecords.length === 1);

    assert.deepEqual(replayRecords, [
      {
        sessionId: "session-a",
        documentId: "document-a",
        participantId: "participant-1",
        occurredAt: "2026-07-10T01:00:00.000Z",
        updateBase64: update,
      },
    ]);

    socket.close();
  } finally {
    await server.close();
  }
});

async function startServer(options = {}) {
  const collab = createCollabServer({
    authJwtSecret,
    ...options,
  });

  collab.httpServer.listen(0, "127.0.0.1");
  await once(collab.httpServer, "listening");

  const address = collab.httpServer.address();
  assert.equal(typeof address, "object");
  assert(address);

  return {
    ...collab,
    port: address.port,
  };
}

async function connect(port, sessionId, token, options = {}) {
  const searchParams = new URLSearchParams({
    sessionId,
    token,
  });

  if (options.documentId) {
    searchParams.set("documentId", options.documentId);
  }

  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/collab?${searchParams.toString()}`,
  );
  attachSocketState(socket);

  await once(socket, "open");
  return socket;
}

function fixedClock(isoDate) {
  return () => new Date(isoDate);
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

async function mintToken(subject, role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));
}

function createTextUpdate(value) {
  const doc = new Y.Doc();
  doc.getText("main").insert(0, value);

  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

async function drainSnapshot(socket) {
  const message = await waitForMessage(socket, "sync:snapshot");
  assert.equal(typeof message.update, "string");
}

async function waitForMessage(socket, expectedType, timeoutMs = 500) {
  const state = socketStates.get(socket);
  assert(state);

  const queuedIndex = state.messages.findIndex((message) => message.type === expectedType);
  if (queuedIndex >= 0) {
    const [message] = state.messages.splice(queuedIndex, 1);
    return message;
  }

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      const waiterIndex = state.waiters.indexOf(waiter);

      if (waiterIndex >= 0) {
        state.waiters.splice(waiterIndex, 1);
      }
    }

    const waiter = {
      expectedType,
      resolve: (message) => {
        cleanup();
        resolve(message);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    };

    state.waiters.push(waiter);
  });
}

function attachSocketState(socket) {
  const state = {
    messages: [],
    waiters: [],
  };

  socketStates.set(socket, state);

  socket.on("message", (rawData) => {
    const message = JSON.parse(rawData.toString());
    const waiter = state.waiters.find((candidate) => candidate.expectedType === message.type);

    if (waiter) {
      waiter.resolve(message);
      return;
    }

    state.messages.push(message);
  });

  socket.on("close", () => {
    for (const waiter of [...state.waiters]) {
      waiter.reject(new Error(`Socket closed before ${waiter.expectedType}`));
    }
  });

  socket.on("error", (error) => {
    for (const waiter of [...state.waiters]) {
      waiter.reject(error);
    }
  });
}
