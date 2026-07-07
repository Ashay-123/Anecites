import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { createPrismaClient } from "@anecites/db";
import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `auth-${Date.now()}`;

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

  return {
    response,
    body: await response.json(),
  };
}

async function createToken(role = "interviewer") {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`auth-user-${testRunId}`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));
}

test("session routes reject missing and invalid bearer tokens", async (t) => {
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
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const missingToken = await jsonRequest(server, "/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: `${testRunId} missing token`,
    }),
  });

  assert.equal(missingToken.response.status, 401);
  assert.deepEqual(missingToken.body, {
    error: {
      code: "UNAUTHENTICATED",
      message: "Missing bearer token",
    },
  });

  const invalidToken = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer not-a-valid-jwt",
    },
    body: JSON.stringify({
      title: `${testRunId} invalid token`,
    }),
  });

  assert.equal(invalidToken.response.status, 401);
  assert.deepEqual(invalidToken.body, {
    error: {
      code: "UNAUTHENTICATED",
      message: "Invalid bearer token",
    },
  });
});

test("session routes accept a valid bearer token", async (t) => {
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
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const token = await createToken();
  const result = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: `${testRunId} valid token`,
    }),
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.body.session.title, `${testRunId} valid token`);
});
