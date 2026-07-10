import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { createApp, loadServerConfig } from "../dist/index.js";

const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `piston-${Date.now()}`;

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    CODE_EXECUTION_PROVIDER: "piston",
    CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: "63,71",
    PISTON_BASE_URL: "http://piston.test",
    PISTON_REQUEST_TIMEOUT_MS: "15000",
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
    .setSubject(`piston-user-${testRunId}`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));

  return {
    Authorization: `Bearer ${token}`,
  };
}

function createFakePistonFetch(responseBody, options = {}) {
  const calls = [];
  const status = options.status ?? 200;

  async function fetchImpl(url, init = {}) {
    calls.push({
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : null,
    });

    if (options.error) {
      throw options.error;
    }

    return new Response(JSON.stringify(responseBody), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return { fetchImpl, calls };
}

test("POST /code-executions maps JavaScript submissions to Piston execute", async (t) => {
  const fakePiston = createFakePistonFetch({
    language: "javascript",
    version: "20.11.1",
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
    fetch: fakePiston.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
      stdin: "input",
    }),
  });

  assert.equal(result.response.status, 201);
  assert.deepEqual(result.body, {
    execution: {
      token: null,
      status: {
        id: 3,
        description: "Accepted",
      },
      stdout: "ok\n",
      stderr: "",
      compileOutput: null,
      message: null,
      timeSeconds: null,
      memoryKb: null,
    },
  });

  assert.equal(fakePiston.calls.length, 1);
  assert.equal(fakePiston.calls[0].url, "http://piston.test/api/v2/execute");
  assert.equal(fakePiston.calls[0].method, "POST");
  assert.equal(fakePiston.calls[0].headers.get("Content-Type"), "application/json");
  assert.equal(fakePiston.calls[0].headers.get("Accept"), "application/json");
  assert.deepEqual(fakePiston.calls[0].body, {
    language: "javascript",
    version: "20.11.1",
    files: [
      {
        name: "main.js",
        content: "console.log('ok')",
      },
    ],
    stdin: "input",
    compile_timeout: 5000,
    run_timeout: 5000,
    compile_memory_limit: 134217728,
    run_memory_limit: 134217728,
  });
});

test("POST /code-executions maps Piston timeout to a generic timeout error", async (t) => {
  const fakePiston = createFakePistonFetch({}, {
    error: new DOMException("timeout", "TimeoutError"),
  });
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: fakePiston.fetchImpl,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await jsonRequest(server, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
    }),
  });

  assert.equal(result.response.status, 504);
  assert.deepEqual(result.body, {
    error: {
      code: "CODE_EXECUTION_TIMEOUT",
      message: "Code execution timed out",
    },
  });
});

test("POST /code-executions rejects invalid Piston responses and oversized output", async (t) => {
  const invalidResponseApp = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: createFakePistonFetch({ language: "javascript" }).fetchImpl,
  });
  const invalidResponseServer = await listen(invalidResponseApp);
  t.after(() => new Promise((resolve) => invalidResponseServer.close(resolve)));

  const invalidResponse = await jsonRequest(invalidResponseServer, "/code-executions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      languageId: 63,
      sourceCode: "console.log('ok')",
    }),
  });

  assert.equal(invalidResponse.response.status, 502);
  assert.deepEqual(invalidResponse.body, {
    error: {
      code: "CODE_EXECUTION_INVALID_RESPONSE",
      message: "Code execution service returned an invalid response",
    },
  });

  const largeOutputApp = createApp(testConfig(), {
    logger: quietLogger(),
    fetch: createFakePistonFetch({
      run: {
        stdout: "a".repeat(65_537),
        stderr: "",
        output: "a".repeat(65_537),
        code: 0,
        signal: null,
      },
    }).fetchImpl,
  });
  const largeOutputServer = await listen(largeOutputApp);
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
      code: "CODE_EXECUTION_OUTPUT_TOO_LARGE",
      message: "Code execution output exceeded the configured limit",
    },
  });
});

