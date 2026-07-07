import test from "node:test";
import assert from "node:assert/strict";

import { createApp, loadServerConfig } from "../dist/index.js";

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    JUDGE0_BASE_URL: "http://localhost:2358",
    JUDGE0_ALLOWED_LANGUAGE_IDS: "63,71",
    AUTH_JWT_SECRET: "test_auth_secret_minimum_32_characters",
    ...overrides,
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

test("GET /health returns service status and CORS header", async (t) => {
  const logs = [];
  const app = createApp(testConfig(), {
    logger: {
      info(message, metadata) {
        logs.push({ message, metadata });
      },
      warn() {},
      error() {},
    },
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: {
      Origin: "http://localhost:5173",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);

  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "anecites-api");
  assert.equal(typeof body.uptimeSeconds, "number");
  assert.equal(logs.some((log) => log.message === "request.completed" && log.metadata.statusCode === 200), true);
});

test("unknown routes return a JSON 404 instead of HTML", async (t) => {
  const app = createApp(testConfig(), {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/missing`);

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
});

test("JSON body limit failures return a controlled error response", async (t) => {
  const app = createApp(testConfig({ JSON_BODY_LIMIT: "8b" }), {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/missing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ large: "payload" }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body too large",
    },
  });
});
