import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { createPrismaClient } from "@anecites/db";
import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `sessions-${Date.now()}`;

function testConfig() {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    JUDGE0_BASE_URL: "http://localhost:2358",
    JUDGE0_ALLOWED_LANGUAGE_IDS: "63,71",
    AUTH_JWT_SECRET: authJwtSecret,
  });
}

function quietLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

async function jsonRequest(server, path, options = {}) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const body = await response.json();
  return { response, body };
}

async function authorizationHeader(role = "interviewer") {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test-user-${testRunId}`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));

  return {
    Authorization: `Bearer ${token}`,
  };
}

test("session routes create, read, join, start, and end a session", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: testRunId,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId} API interview`,
      scheduledAt: "2026-07-08T10:00:00.000Z",
    }),
  });

  assert.equal(createResult.response.status, 201);
  assert.equal(createResult.body.session.title, `${testRunId} API interview`);
  assert.equal(createResult.body.session.state, "created");
  assert.equal(createResult.body.session.participants.length, 0);

  const sessionId = createResult.body.session.id;

  const readResult = await jsonRequest(server, `/sessions/${sessionId}`, {
    headers: await authorizationHeader(),
  });
  assert.equal(readResult.response.status, 200);
  assert.equal(readResult.body.session.id, sessionId);
  assert.equal(readResult.body.session.state, "created");

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.${testRunId}@example.test`,
        displayName: "Candidate One",
      },
    }),
  });

  assert.equal(joinResult.response.status, 201);
  assert.equal(joinResult.body.participant.role, "candidate");
  assert.equal(joinResult.body.participant.user.email, `candidate.${testRunId}@example.test`);

  for (const state of ["scheduled", "lobby", "active", "ended"]) {
    const transitionResult = await jsonRequest(server, `/sessions/${sessionId}/state`, {
      method: "PATCH",
      headers: await authorizationHeader(),
      body: JSON.stringify({ state }),
    });

    assert.equal(transitionResult.response.status, 200);
    assert.equal(transitionResult.body.session.state, state);
  }

  const endedResult = await jsonRequest(server, `/sessions/${sessionId}`, {
    headers: await authorizationHeader(),
  });
  assert.equal(endedResult.response.status, 200);
  assert.equal(endedResult.body.session.state, "ended");
  assert.equal(endedResult.body.session.participants.length, 1);
  assert.equal(typeof endedResult.body.session.startedAt, "string");
  assert.equal(typeof endedResult.body.session.endedAt, "string");
});

test("session routes reject invalid transitions and missing sessions", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: `${testRunId}-invalid`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-invalid transition interview`,
    }),
  });

  const sessionId = createResult.body.session.id;
  const invalidTransition = await jsonRequest(server, `/sessions/${sessionId}/state`, {
    method: "PATCH",
    headers: await authorizationHeader(),
    body: JSON.stringify({ state: "active" }),
  });

  assert.equal(invalidTransition.response.status, 409);
  assert.deepEqual(invalidTransition.body, {
    error: {
      code: "INVALID_SESSION_TRANSITION",
      message: "Cannot transition session from created to active",
    },
  });

  const missingRead = await jsonRequest(server, "/sessions/missing-session-id", {
    headers: await authorizationHeader(),
  });
  assert.equal(missingRead.response.status, 404);
  assert.deepEqual(missingRead.body, {
    error: {
      code: "SESSION_NOT_FOUND",
      message: "Session not found",
    },
  });
});
