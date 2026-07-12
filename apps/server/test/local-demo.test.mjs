import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaClient } from "@anecites/db";
import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";

function testConfig(localDemoEnabled = true) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://127.0.0.1:5173",
    LOCAL_DEMO_ENABLED: String(localDemoEnabled),
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: "63,71",
    AUTH_JWT_SECRET: "test_auth_secret_minimum_32_characters",
  });
}

function quietLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createFakePistonFetch(responseBody) {
  const calls = [];

  async function fetchImpl(url, init = {}) {
    calls.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return { fetchImpl, calls };
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
      Origin: "http://127.0.0.1:5173",
      ...(options.headers ?? {}),
    },
  });

  return {
    response,
    body: await response.json(),
  };
}

test("local demo host and candidate use code/password to receive real session bootstrap data", async (t) => {
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
          startsWith: "Local demo ",
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: "@local.invalid",
        },
      },
    });
    await prisma.$disconnect();
  });

  const fakePiston = createFakePistonFetch({
    run: {
      stdout: "ok\n",
      stderr: "",
      output: "ok\n",
      code: 0,
      signal: null,
    },
  });
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    fetch: fakePiston.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const hostResult = await jsonRequest(server, "/local-demo/meetings", {
    method: "POST",
  });

  assert.equal(hostResult.response.status, 201);
  assert.equal(hostResult.response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  assert.match(hostResult.body.meeting.code, /^\d{6}$/);
  assert.match(hostResult.body.meeting.password, /^[A-Z2-9]{8}$/);
  assert.equal(hostResult.body.connection.role, "interviewer");
  assert.equal(typeof hostResult.body.connection.authToken, "string");

  const deniedResult = await jsonRequest(server, "/local-demo/meetings/join", {
    method: "POST",
    body: JSON.stringify({
      code: hostResult.body.meeting.code,
      password: "AAAAAAAA",
    }),
  });

  assert.equal(deniedResult.response.status, 401);
  assert.equal(deniedResult.body.error.code, "LOCAL_DEMO_ACCESS_DENIED");

  const joinResult = await jsonRequest(server, "/local-demo/meetings/join", {
    method: "POST",
    body: JSON.stringify({
      code: hostResult.body.meeting.code,
      password: hostResult.body.meeting.password,
    }),
  });

  assert.equal(joinResult.response.status, 201);
  assert.equal(joinResult.body.connection.role, "candidate");
  assert.equal(joinResult.body.connection.sessionId, hostResult.body.connection.sessionId);
  assert.equal(joinResult.body.connection.documentId, hostResult.body.connection.documentId);
  assert.notEqual(joinResult.body.connection.participantId, hostResult.body.connection.participantId);

  const initialStateResult = await jsonRequest(
    server,
    `/local-demo/meetings/state?sessionId=${encodeURIComponent(hostResult.body.connection.sessionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${joinResult.body.connection.authToken}`,
      },
    },
  );

  assert.equal(initialStateResult.response.status, 200);
  assert.deepEqual(initialStateResult.body.state, {
    codeEditorOpen: false,
  });

  const candidateUpdateResult = await jsonRequest(server, "/local-demo/meetings/state", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${joinResult.body.connection.authToken}`,
    },
    body: JSON.stringify({
      sessionId: hostResult.body.connection.sessionId,
      codeEditorOpen: true,
    }),
  });

  assert.equal(candidateUpdateResult.response.status, 403);
  assert.equal(candidateUpdateResult.body.error.code, "FORBIDDEN");

  const hostUpdateResult = await jsonRequest(server, "/local-demo/meetings/state", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${hostResult.body.connection.authToken}`,
    },
    body: JSON.stringify({
      sessionId: hostResult.body.connection.sessionId,
      codeEditorOpen: true,
    }),
  });

  assert.equal(hostUpdateResult.response.status, 200);
  assert.deepEqual(hostUpdateResult.body.state, {
    codeEditorOpen: true,
  });

  const openedStateResult = await jsonRequest(
    server,
    `/local-demo/meetings/state?sessionId=${encodeURIComponent(hostResult.body.connection.sessionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${joinResult.body.connection.authToken}`,
      },
    },
  );

  assert.equal(openedStateResult.response.status, 200);
  assert.deepEqual(openedStateResult.body.state, {
    codeEditorOpen: true,
  });

  const sessionResult = await jsonRequest(server, `/sessions/${joinResult.body.connection.sessionId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${joinResult.body.connection.authToken}`,
    },
  });

  assert.equal(sessionResult.response.status, 200);
  assert.equal(sessionResult.body.session.participants.length, 2);

  const problemResult = await jsonRequest(
    server,
    `/local-demo/meetings/problem?sessionId=${encodeURIComponent(hostResult.body.connection.sessionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${joinResult.body.connection.authToken}`,
      },
    },
  );

  assert.equal(problemResult.response.status, 200);
  assert.equal(problemResult.body.problem.title, "Two Sum");
  assert.equal(problemResult.body.languageId, 63);
  assert.equal(problemResult.body.documentId, hostResult.body.connection.documentId);
  assert.match(problemResult.body.starterCode, /function twoSum/);

  const executionResult = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joinResult.body.connection.authToken}`,
    },
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
      sessionId: joinResult.body.connection.sessionId,
      documentId: joinResult.body.connection.documentId,
      participantId: joinResult.body.connection.participantId,
    }),
  });

  assert.equal(executionResult.response.status, 201);
  assert.equal(executionResult.body.execution.status.description, "Accepted");
  assert.equal(fakePiston.calls.length, 1);

  const submissions = await prisma.codeSubmission.findMany({
    where: {
      sessionId: joinResult.body.connection.sessionId,
    },
  });

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].documentId, joinResult.body.connection.documentId);
  assert.equal(submissions[0].participantId, joinResult.body.connection.participantId);
  assert.equal(submissions[0].status, "ACCEPTED");
  assert.equal(submissions[0].stdout, "ok\n");
});

test("local demo routes are unavailable unless explicitly enabled", async (t) => {
  const app = createApp(testConfig(false), {
    logger: quietLogger(),
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await jsonRequest(server, "/local-demo/meetings", {
    method: "POST",
  });

  assert.equal(result.response.status, 404);
  assert.equal(result.body.error.code, "NOT_FOUND");
});
