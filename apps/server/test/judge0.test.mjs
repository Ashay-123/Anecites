import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { createApp, loadServerConfig } from "../dist/index.js";

const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `judge0-${Date.now()}`;

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    JUDGE0_BASE_URL: "http://judge0.test",
    JUDGE0_AUTHN_HEADER: "X-Judge0-Token",
    JUDGE0_AUTHN_TOKEN: "test-judge0-token",
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

  return {
    response,
    body: await response.json(),
  };
}

async function authorizationHeader(role = "candidate") {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`judge0-user-${testRunId}`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));

  return {
    Authorization: `Bearer ${token}`,
  };
}

function createFakeJudge0Fetch(responseBody, options = {}) {
  const calls = [];
  const status = options.status ?? 201;

  async function fetchImpl(url, init = {}) {
    calls.push({
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: JSON.parse(init.body),
    });

    return new Response(JSON.stringify(responseBody), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return { fetchImpl, calls };
}

test("POST /code-executions submits allowed code to Judge0 with enforced limits", async (t) => {
  const fakeJudge0 = createFakeJudge0Fetch({
    token: "submission-token",
    stdout: "ok\n",
    stderr: null,
    compile_output: null,
    message: null,
    time: "0.012",
    memory: 1024,
    status: {
      id: 3,
      description: "Accepted",
    },
  });
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: fakeJudge0.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
      stdin: "ignored",
    }),
  });

  assert.equal(result.response.status, 201);
  assert.deepEqual(result.body, {
    execution: {
      token: "submission-token",
      status: {
        id: 3,
        description: "Accepted",
      },
      stdout: "ok\n",
      stderr: null,
      compileOutput: null,
      message: null,
      timeSeconds: 0.012,
      memoryKb: 1024,
    },
  });

  assert.equal(fakeJudge0.calls.length, 1);
  assert.equal(fakeJudge0.calls[0].url, "http://judge0.test/submissions?base64_encoded=false&wait=true");
  assert.equal(fakeJudge0.calls[0].method, "POST");
  assert.equal(fakeJudge0.calls[0].headers.get("Content-Type"), "application/json");
  assert.equal(fakeJudge0.calls[0].headers.get("Accept"), "application/json");
  assert.equal(fakeJudge0.calls[0].headers.get("X-Judge0-Token"), "test-judge0-token");
  assert.deepEqual(fakeJudge0.calls[0].body, {
    source_code: "console.log('ok')",
    language_id: 63,
    stdin: "ignored",
    cpu_time_limit: 2,
    cpu_extra_time: 0,
    wall_time_limit: 5,
    memory_limit: 131072,
    stack_limit: 64000,
    max_processes_and_or_threads: 32,
    enable_per_process_and_thread_time_limit: false,
    enable_per_process_and_thread_memory_limit: false,
    enable_network: false,
    max_file_size: 64,
    number_of_runs: 1,
  });
});

test("POST /code-executions rejects unauthenticated requests before Judge0 is called", async (t) => {
  const fakeJudge0 = createFakeJudge0Fetch({});
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: fakeJudge0.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await jsonRequest(server, "/code-executions", {
    method: "POST",
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
    }),
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.body.error.code, "UNAUTHENTICATED");
  assert.equal(fakeJudge0.calls.length, 0);
});

test("POST /code-executions rejects disallowed languages and oversized input", async (t) => {
  const fakeJudge0 = createFakeJudge0Fetch({});
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: fakeJudge0.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const headers = await authorizationHeader();
  const disallowedLanguage = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      languageId: 999,
      sourceCode: "console.log('ok')",
    }),
  });

  assert.equal(disallowedLanguage.response.status, 400);
  assert.deepEqual(disallowedLanguage.body, {
    error: {
      code: "LANGUAGE_NOT_ALLOWED",
      message: "Language is not allowed for code execution",
    },
  });

  const oversizedSource = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "a".repeat(65_537),
    }),
  });

  assert.equal(oversizedSource.response.status, 400);
  assert.equal(oversizedSource.body.error.code, "SOURCE_CODE_TOO_LARGE");

  const oversizedStdin = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
      stdin: "a".repeat(8_193),
    }),
  });

  assert.equal(oversizedStdin.response.status, 400);
  assert.equal(oversizedStdin.body.error.code, "STDIN_TOO_LARGE");
  assert.equal(fakeJudge0.calls.length, 0);
});

test("POST /code-executions fails closed on Judge0 upstream errors and oversized output", async (t) => {
  const appWithUpstreamError = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: createFakeJudge0Fetch({ error: "queue is full" }, { status: 503 }).fetchImpl,
  });
  const upstreamServer = await listen(appWithUpstreamError);
  t.after(() => new Promise((resolve) => upstreamServer.close(resolve)));

  const upstreamError = await jsonRequest(upstreamServer, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
    }),
  });

  assert.equal(upstreamError.response.status, 502);
  assert.deepEqual(upstreamError.body, {
    error: {
      code: "JUDGE0_UPSTREAM_ERROR",
      message: "Code execution service failed",
    },
  });

  const appWithLargeOutput = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: createFakeJudge0Fetch({
      token: "submission-token",
      stdout: "a".repeat(65_537),
      stderr: null,
      compile_output: null,
      message: null,
      time: "0.001",
      memory: 512,
      status: {
        id: 3,
        description: "Accepted",
      },
    }).fetchImpl,
  });
  const largeOutputServer = await listen(appWithLargeOutput);
  t.after(() => new Promise((resolve) => largeOutputServer.close(resolve)));

  const largeOutput = await jsonRequest(largeOutputServer, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('too much')",
    }),
  });

  assert.equal(largeOutput.response.status, 502);
  assert.deepEqual(largeOutput.body, {
    error: {
      code: "JUDGE0_OUTPUT_TOO_LARGE",
      message: "Code execution output exceeded the configured limit",
    },
  });
});
