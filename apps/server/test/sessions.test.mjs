import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, jwtVerify } from "jose";

import { createPrismaClient } from "@anecites/db";
import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `sessions-${Date.now()}`;

function testConfig(overrides = {}) {
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
    ...overrides,
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

test("session routes issue LiveKit tokens for existing participants", async (t) => {
  const livekitApiKey = "test_livekit_key";
  const livekitApiSecret = "test_livekit_secret_minimum_32_characters";
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
          startsWith: `${testRunId}-livekit`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.livekit.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: livekitApiKey,
      LIVEKIT_API_SECRET: livekitApiSecret,
      LIVEKIT_TOKEN_TTL_SECONDS: "900",
    }),
    {
      logger: quietLogger(),
      prisma,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-livekit interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.livekit.${testRunId}@example.test`,
        displayName: "Candidate LiveKit",
      },
    }),
  });
  const participantId = joinResult.body.participant.id;

  const tokenResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-token`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({ participantId }),
  });

  assert.equal(tokenResult.response.status, 201);
  assert.equal(tokenResult.body.livekit.url, "ws://127.0.0.1:7880");
  assert.equal(tokenResult.body.livekit.roomName, `session-${sessionId}`);
  assert.equal(tokenResult.body.livekit.participantIdentity, `participant-${participantId}`);
  assert.equal(typeof tokenResult.body.livekit.token, "string");

  const verified = await jwtVerify(
    tokenResult.body.livekit.token,
    new TextEncoder().encode(livekitApiSecret),
    {
      algorithms: ["HS256"],
    },
  );
  assert.equal(verified.payload.iss, livekitApiKey);
  assert.equal(verified.payload.sub, `participant-${participantId}`);
  assert.equal(verified.payload.video.room, `session-${sessionId}`);
  assert.equal(verified.payload.video.roomJoin, true);
});

test("session routes fail closed when LiveKit credentials are unavailable", async (t) => {
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
          startsWith: `${testRunId}-missing-livekit`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.missing-livekit.${testRunId}@example.test`,
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
      title: `${testRunId}-missing-livekit interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "interviewer",
      user: {
        email: `interviewer.missing-livekit.${testRunId}@example.test`,
        displayName: "Interviewer Missing LiveKit",
      },
    }),
  });

  const tokenResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-token`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({ participantId: joinResult.body.participant.id }),
  });

  assert.equal(tokenResult.response.status, 503);
  assert.deepEqual(tokenResult.body, {
    error: {
      code: "LIVEKIT_NOT_CONFIGURED",
      message: "LiveKit is not configured",
    },
  });
});

test("session routes start and stop LiveKit room recordings", async (t) => {
  const fakeEgressClient = {
    startCalls: [],
    stopCalls: [],
    async startRoomCompositeEgress(roomName, output, options) {
      this.startCalls.push({ roomName, output, options });
      return {
        egressId: "egress-test-1",
        roomName,
        status: 1,
      };
    },
    async stopEgress(egressId) {
      this.stopCalls.push(egressId);
      return {
        egressId,
        roomName: "session-stopped",
        status: 4,
      };
    },
  };
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
          startsWith: `${testRunId}-recording`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      LIVEKIT_RECORDING_KEY_PREFIX: "recordings/livekit",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const startResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 201);
  assert.equal(startResult.body.recording.egressId, "egress-test-1");
  assert.equal(startResult.body.recording.roomName, `session-${sessionId}`);
  assert.equal(startResult.body.recording.status, 1);
  assert.equal(fakeEgressClient.startCalls.length, 1);
  assert.equal(fakeEgressClient.startCalls[0].roomName, `session-${sessionId}`);
  assert.equal(fakeEgressClient.startCalls[0].options.layout, "grid");
  assert.match(
    fakeEgressClient.startCalls[0].output.file.filepath,
    new RegExp(`^recordings/livekit/${sessionId}/[0-9]+\\.mp4$`),
  );
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.case, "s3");
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.value.bucket, "anecites-dev");
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.value.forcePathStyle, true);

  const stopResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording/egress-test-1/stop`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({}),
  });

  assert.equal(stopResult.response.status, 200);
  assert.deepEqual(fakeEgressClient.stopCalls, ["egress-test-1"]);
  assert.equal(stopResult.body.recording.egressId, "egress-test-1");
  assert.equal(stopResult.body.recording.status, 4);
});

test("session routes fail closed when LiveKit recording storage is unavailable", async (t) => {
  const fakeEgressClient = {
    async startRoomCompositeEgress() {
      throw new Error("should not be called");
    },
  };
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
          startsWith: `${testRunId}-recording-missing`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording-missing interview`,
    }),
  });

  const startResult = await jsonRequest(server, `/sessions/${createResult.body.session.id}/livekit-recording`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 503);
  assert.deepEqual(startResult.body, {
    error: {
      code: "LIVEKIT_RECORDING_NOT_CONFIGURED",
      message: "LiveKit recording storage is not configured",
    },
  });
});
