import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SignJWT } from "jose";

import { createApp, loadServerConfig } from "../dist/index.js";

loadDotEnv(resolve(process.cwd(), ".env"));

const smokeOutput = "piston-smoke-ok";
const authJwtSecret = process.env.AUTH_JWT_SECRET ?? "local_smoke_auth_secret_minimum_32_characters";
const smokeLanguageId = Number(process.env.SMOKE_PISTON_LANGUAGE_ID ?? "63");
const smokeSourceCode = process.env.SMOKE_PISTON_SOURCE_CODE ?? `console.log("${smokeOutput}")`;
const expectedStatusDescription = process.env.SMOKE_PISTON_EXPECT_STATUS_DESCRIPTION ?? "Accepted";
const expectedStdout = process.env.SMOKE_PISTON_EXPECT_STDOUT;
const expectedStderrIncludes = process.env.SMOKE_PISTON_EXPECT_STDERR_INCLUDES ?? "";

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!Number.isSafeInteger(smokeLanguageId) || smokeLanguageId < 1) {
    throw new Error("SMOKE_PISTON_LANGUAGE_ID must be a positive integer");
  }

  const expectedStatusId = parseOptionalPositiveInteger(
    "SMOKE_PISTON_EXPECT_STATUS_ID",
    process.env.SMOKE_PISTON_EXPECT_STATUS_ID,
    3,
  );

  const config = loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://anecites:anecites_dev_password@localhost:5672",
    CODE_EXECUTION_PROVIDER: "piston",
    CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: process.env.CODE_EXECUTION_ALLOWED_LANGUAGE_IDS ?? String(smokeLanguageId),
    PISTON_BASE_URL: process.env.PISTON_BASE_URL ?? "http://127.0.0.1:2000",
    PISTON_REQUEST_TIMEOUT_MS: process.env.PISTON_REQUEST_TIMEOUT_MS ?? "15000",
    AUTH_JWT_SECRET: authJwtSecret,
  });

  const app = createApp(config, {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  const server = await listen(app);

  try {
    const { port } = server.address();
    const token = await new SignJWT({ role: "candidate" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("piston-smoke-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(authJwtSecret));

    const response = await fetch(`http://127.0.0.1:${port}/code-executions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        languageId: smokeLanguageId,
        sourceCode: smokeSourceCode,
      }),
    });
    const body = await response.json();

    if (response.status !== 201) {
      throw new Error(`Expected HTTP 201 from code proxy, received ${response.status}: ${JSON.stringify(body)}`);
    }

    if (body.execution?.status?.id !== expectedStatusId) {
      throw new Error(`Unexpected Piston smoke status id: ${JSON.stringify(body.execution)}`);
    }

    if (body.execution?.status?.description !== expectedStatusDescription) {
      throw new Error(`Unexpected Piston smoke status description: ${JSON.stringify(body.execution)}`);
    }

    if (expectedStdout === undefined && body.execution?.stdout !== `${smokeOutput}\n` && body.execution?.stdout !== smokeOutput) {
      throw new Error(`Unexpected Piston smoke result: ${JSON.stringify(body.execution)}`);
    }

    if (expectedStdout !== undefined && body.execution?.stdout !== expectedStdout) {
      throw new Error(`Unexpected Piston smoke stdout: ${JSON.stringify(body.execution)}`);
    }

    if (expectedStderrIncludes && !(body.execution?.stderr ?? "").includes(expectedStderrIncludes)) {
      throw new Error(`Unexpected Piston smoke stderr: ${JSON.stringify(body.execution)}`);
    }

    console.log(`Piston proxy smoke passed with language ${smokeLanguageId}.`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function parseOptionalPositiveInteger(fieldName, value, defaultValue) {
  const rawValue = value?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

function loadDotEnv(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^(['"])(.*)\1$/, "$2");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
