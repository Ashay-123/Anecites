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

function createFakePistonFetch(responseBodies) {
  const calls = [];
  const bodies = Array.isArray(responseBodies) ? responseBodies : [responseBodies];

  async function fetchImpl(url, init = {}) {
    const responseBody = bodies[Math.min(calls.length, bodies.length - 1)];
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

  const fakePiston = createFakePistonFetch([
    {
      run: {
        stdout: "candidate run\n",
        stderr: "",
        output: "candidate run\n",
        code: 0,
        signal: null,
      },
    },
    {
      run: {
        stdout: "Case 1: expected [0,1], received []\n",
        stderr: "ANECITES_SUBMIT:FAIL 3/3\n",
        output: "Case 1: expected [0,1], received []\nANECITES_SUBMIT:FAIL 3/3\n",
        code: 1,
        signal: null,
      },
    },
  ]);
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    fetch: fakePiston.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const problemsResult = await jsonRequest(server, "/local-demo/problems", {
    method: "GET",
  });

  assert.equal(problemsResult.response.status, 200);
  assert.deepEqual(
    problemsResult.body.problems.map((problem) => problem.slug),
    ["local-demo-two-sum-javascript", "local-demo-product-pair-javascript"],
  );
  assert.equal(problemsResult.body.problems[1].title, "Product Pair");
  assert.equal(problemsResult.body.problems[1].languageId, 63);
  assert.equal("testcases" in problemsResult.body.problems[1], false);

  const hostResult = await jsonRequest(server, "/local-demo/meetings", {
    method: "POST",
    body: JSON.stringify({
      problemSlug: "local-demo-product-pair-javascript",
    }),
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
  assert.equal(problemResult.body.problem.title, "Product Pair");
  assert.equal(problemResult.body.problem.testcases.length, 2);
  assert.equal(problemResult.body.languageId, 63);
  assert.equal(problemResult.body.documentId, hostResult.body.connection.documentId);
  assert.match(problemResult.body.starterCode, /function productPair/);

  const persistedSession = await prisma.session.findUnique({
    where: {
      id: hostResult.body.connection.sessionId,
    },
    include: {
      problem: {
        include: {
          testcases: {
            orderBy: {
              ordinal: "asc",
            },
          },
        },
      },
    },
  });

  assert.equal(persistedSession?.problem?.title, "Product Pair");
  assert.equal(persistedSession?.problem?.testcases.length, 3);
  assert.equal(persistedSession?.problem?.testcases.filter((testcase) => testcase.hidden).length, 1);

  const runResult = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joinResult.body.connection.authToken}`,
    },
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('candidate run')",
      executionMode: "run",
      sessionId: joinResult.body.connection.sessionId,
      documentId: joinResult.body.connection.documentId,
      participantId: joinResult.body.connection.participantId,
    }),
  });

  assert.equal(runResult.response.status, 201);
  assert.equal(runResult.body.execution.status.description, "Accepted");
  assert.equal(runResult.body.execution.stdout, "candidate run\n");
  assert.equal(fakePiston.calls.length, 1);
  assert.equal(fakePiston.calls[0].body.files[0].content, "console.log('candidate run')");

  const executionResult = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${joinResult.body.connection.authToken}`,
    },
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "function productPair() { return []; }",
      executionMode: "submit",
      sessionId: joinResult.body.connection.sessionId,
      documentId: joinResult.body.connection.documentId,
      participantId: joinResult.body.connection.participantId,
    }),
  });

  assert.equal(executionResult.response.status, 201);
  assert.equal(executionResult.body.execution.status.description, "Wrong Answer");
  assert.equal(executionResult.body.execution.message, "One or more interview problem testcases failed");
  assert.equal(fakePiston.calls.length, 2);
  assert.match(fakePiston.calls[1].body.files[0].content, /ANECITES_SUBMIT:FAIL/);
  assert.match(fakePiston.calls[1].body.files[0].content, /function productPair/);
  assert.match(fakePiston.calls[1].body.files[0].content, /"target":18/);

  const submissions = await prisma.codeSubmission.findMany({
    where: {
      sessionId: joinResult.body.connection.sessionId,
    },
  });
  const runSubmission = submissions.find((submission) => submission.executionMode === "RUN");
  const submitSubmission = submissions.find((submission) => submission.executionMode === "SUBMIT");

  assert.equal(submissions.length, 2);
  assert.equal(runSubmission?.problemId, persistedSession?.problem?.id);
  assert.equal(runSubmission?.documentId, joinResult.body.connection.documentId);
  assert.equal(runSubmission?.participantId, joinResult.body.connection.participantId);
  assert.equal(runSubmission?.status, "ACCEPTED");
  assert.equal(runSubmission?.stdout, "candidate run\n");
  assert.equal(submitSubmission?.problemId, persistedSession?.problem?.id);
  assert.equal(submitSubmission?.documentId, joinResult.body.connection.documentId);
  assert.equal(submitSubmission?.participantId, joinResult.body.connection.participantId);
  assert.equal(submitSubmission?.status, "WRONG_ANSWER");
  assert.equal(submitSubmission?.stdout, "Case 1: expected [0,1], received []\n");

  const submissionHistoryResult = await jsonRequest(
    server,
    `/code-executions?sessionId=${encodeURIComponent(joinResult.body.connection.sessionId)}&documentId=${encodeURIComponent(joinResult.body.connection.documentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${joinResult.body.connection.authToken}`,
      },
    },
  );

  assert.equal(submissionHistoryResult.response.status, 200);
  assert.equal(submissionHistoryResult.body.submissions.length, 2);
  assert.deepEqual(
    submissionHistoryResult.body.submissions
      .map((submission) => [submission.executionMode, submission.status])
      .sort(),
    [
      ["run", "Accepted"],
      ["submit", "Wrong Answer"],
    ],
  );
  assert.equal(
    submissionHistoryResult.body.submissions.every((submission) => submission.problemId === persistedSession?.problem?.id),
    true,
  );
  assert.equal(
    submissionHistoryResult.body.submissions.every((submission) => submission.timeMs === null),
    true,
  );
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
