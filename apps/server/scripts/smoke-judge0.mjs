import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SignJWT } from "jose";

import { createApp, loadServerConfig } from "../dist/index.js";

loadDotEnv(resolve(process.cwd(), ".env"));

const smokeOutput = "judge0-smoke-ok";
const authJwtSecret = process.env.AUTH_JWT_SECRET ?? "local_smoke_auth_secret_minimum_32_characters";
const judge0Provider = process.env.JUDGE0_PROVIDER ?? "self-hosted";
const judge0BaseUrl = (
  process.env.JUDGE0_BASE_URL ?? (judge0Provider === "remote" ? "https://judge0-ce.p.rapidapi.com" : "http://localhost:2358")
).replace(/\/$/, "");
const judge0AuthHeader = process.env.JUDGE0_AUTHN_HEADER ?? (judge0Provider === "remote" ? "X-RapidAPI-Key" : "X-Judge0-Token");
const judge0AuthToken =
  process.env.JUDGE0_AUTHN_TOKEN ?? (judge0Provider === "remote" ? "" : "local_judge0_dev_token_change_me");
const judge0RapidApiHost = process.env.JUDGE0_RAPIDAPI_HOST ?? "";
const judge0RequestTimeoutMs = process.env.JUDGE0_REQUEST_TIMEOUT_MS ?? "15000";

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const smokeLanguage = await resolveSmokeLanguage();
  const config = loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://anecites:anecites_dev_password@localhost:5672",
    JUDGE0_PROVIDER: judge0Provider,
    JUDGE0_BASE_URL: judge0BaseUrl,
    JUDGE0_AUTHN_HEADER: judge0AuthHeader,
    JUDGE0_AUTHN_TOKEN: judge0AuthToken,
    JUDGE0_RAPIDAPI_HOST: judge0RapidApiHost,
    JUDGE0_REQUEST_TIMEOUT_MS: judge0RequestTimeoutMs,
    JUDGE0_ALLOWED_LANGUAGE_IDS: String(smokeLanguage.id),
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
      .setSubject("judge0-smoke-user")
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
        languageId: smokeLanguage.id,
        sourceCode: smokeLanguage.sourceCode,
      }),
    });
    const body = await response.json();

    if (response.status !== 201) {
      throw new Error(`Expected HTTP 201 from code proxy, received ${response.status}: ${JSON.stringify(body)}`);
    }

    if (body.execution?.stdout !== `${smokeOutput}\n` && body.execution?.stdout !== smokeOutput) {
      throw new Error(`Unexpected Judge0 smoke result: ${JSON.stringify(body.execution)}`);
    }

    console.log(`Judge0 proxy smoke passed with language ${smokeLanguage.id} (${smokeLanguage.name}).`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function resolveSmokeLanguage() {
  if (process.env.SMOKE_JUDGE0_LANGUAGE_ID) {
    const id = Number(process.env.SMOKE_JUDGE0_LANGUAGE_ID);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("SMOKE_JUDGE0_LANGUAGE_ID must be a positive integer");
    }

    if (!process.env.SMOKE_JUDGE0_SOURCE_CODE) {
      throw new Error("SMOKE_JUDGE0_SOURCE_CODE is required when SMOKE_JUDGE0_LANGUAGE_ID is set");
    }

    return {
      id,
      name: "custom",
      sourceCode: process.env.SMOKE_JUDGE0_SOURCE_CODE,
    };
  }

  let response;
  try {
    response = await fetch(`${judge0BaseUrl}/languages`, {
      headers: judge0Headers(),
      signal: AbortSignal.timeout(Number(judge0RequestTimeoutMs)),
    });
  } catch (error) {
    throw new Error(`Could not reach Judge0 at ${judge0BaseUrl}. Verify JUDGE0_BASE_URL and credentials in your .env file.`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(`Could not read Judge0 languages from ${judge0BaseUrl}: HTTP ${response.status}`);
  }

  const languages = await response.json();
  if (!Array.isArray(languages)) {
    throw new Error("Judge0 /languages returned an unexpected payload");
  }

  const candidates = [
    {
      pattern: /JavaScript.*Node/i,
      sourceCode: `console.log("${smokeOutput}")`,
    },
    {
      pattern: /Python.*3/i,
      sourceCode: `print("${smokeOutput}")`,
    },
    {
      pattern: /Python/i,
      sourceCode: `print("${smokeOutput}")`,
    },
  ];

  for (const candidate of candidates) {
    const language = languages.find((item) => isLanguage(item) && candidate.pattern.test(item.name));
    if (language) {
      return {
        id: language.id,
        name: language.name,
        sourceCode: candidate.sourceCode,
      };
    }
  }

  throw new Error("Could not find a JavaScript or Python runtime in Judge0 /languages");
}

function judge0Headers() {
  const headers = {};

  if (judge0AuthHeader && judge0AuthToken) {
    headers[judge0AuthHeader] = judge0AuthToken;
  }

  if (judge0RapidApiHost) {
    headers["X-RapidAPI-Host"] = judge0RapidApiHost;
  }

  return headers;
}

function isLanguage(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger(value.id) &&
    typeof value.name === "string"
  );
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
