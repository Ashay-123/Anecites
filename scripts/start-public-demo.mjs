import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicWebPort = 4173;
const publicApiPort = 3100;
const publicCollabPort = 3101;
const localHostUrl = `http://127.0.0.1:${publicWebPort}`;
const containerName = `anecites-public-demo-tunnel-${process.pid}`;
const children = [];
let tunnelProcess = null;
let stopping = false;

process.once("SIGINT", () => {
  void shutdown(0);
});
process.once("SIGTERM", () => {
  void shutdown(0);
});

try {
  loadEnvironment();
  validateCompiledArtifacts();
  validateRemoteLiveKitEnvironment();
  validateDocker();

  await Promise.all([
    assertPortAvailable(publicWebPort),
    assertPortAvailable(publicApiPort),
    assertPortAvailable(publicCollabPort),
  ]);
  await validateLocalDependencies();

  const tunnel = startQuickTunnel();
  tunnelProcess = tunnel.process;
  const publicBaseUrl = await tunnel.publicUrl;
  const publicUrl = new URL(publicBaseUrl);
  const sessionSecret = randomBytes(48).toString("base64url");
  const commonEnvironment = createCommonEnvironment(sessionSecret);

  children.push(
    startManagedProcess(
      "api",
      process.execPath,
      ["apps/server/scripts/start-local-demo.mjs"],
      {
        ...commonEnvironment,
        API_HOST: "127.0.0.1",
        API_PORT: String(publicApiPort),
        APP_ORIGIN: localHostUrl,
        LOCAL_DEMO_ENABLED: "true",
        LOCAL_DEMO_PUBLIC_BASE_URL: publicBaseUrl,
      },
    ),
    startManagedProcess(
      "collab",
      process.execPath,
      ["apps/collab/dist/index.js"],
      {
        ...commonEnvironment,
        COLLAB_HOST: "127.0.0.1",
        COLLAB_PORT: String(publicCollabPort),
      },
    ),
    startManagedProcess(
      "web",
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "apps/desktop",
        "--config",
        "apps/desktop/vite.config.ts",
        "--host",
        "127.0.0.1",
        "--port",
        String(publicWebPort),
        "--strictPort",
      ],
      {
        ...process.env,
        ANECITES_PUBLIC_DEMO_HOST: publicUrl.hostname,
        ANECITES_API_PROXY_TARGET: `http://127.0.0.1:${publicApiPort}`,
        ANECITES_COLLAB_PROXY_TARGET: `ws://127.0.0.1:${publicCollabPort}`,
      },
    ),
  );

  await Promise.all([
    waitForHttp(`${localHostUrl}/`, 30_000),
    waitForHttp(`http://127.0.0.1:${publicApiPort}/health`, 30_000),
    waitForTcpPort(publicCollabPort, 30_000),
  ]);

  process.stdout.write(
    [
      "",
      "Anecites public demo is ready.",
      `Host locally: ${localHostUrl}/`,
      `Candidate link base: ${publicBaseUrl}/`,
      "The host page creates the meeting and Copy link includes the public address.",
      "Press Ctrl+C to stop the public demo.",
      "",
    ].join("\n"),
  );

  await waitForUnexpectedExit();
} catch (error) {
  await cleanup();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function loadEnvironment() {
  const environmentPath = resolve(repositoryRoot, ".env");
  if (!existsSync(environmentPath)) {
    throw new Error("Create .env from .env.example and add remote LiveKit credentials before starting a public demo.");
  }

  process.loadEnvFile(environmentPath);
}

function validateCompiledArtifacts() {
  const requiredArtifacts = [
    "apps/server/dist/index.js",
    "apps/collab/dist/index.js",
    "apps/desktop/dist-web/index.html",
  ];
  const missing = requiredArtifacts.filter((artifact) => !existsSync(resolve(repositoryRoot, artifact)));

  if (missing.length > 0) {
    throw new Error("Public demo build artifacts are missing. Run: npm run demo:public:build");
  }
}

function validateRemoteLiveKitEnvironment() {
  const livekitUrl = parseRequiredPublicUrl("LIVEKIT_URL", process.env.LIVEKIT_URL, "wss:");
  const livekitApiUrl = process.env.LIVEKIT_API_URL
    ? parseRequiredPublicUrl("LIVEKIT_API_URL", process.env.LIVEKIT_API_URL, "https:")
    : deriveLiveKitApiUrl(livekitUrl);

  requireSecret("LIVEKIT_API_KEY", process.env.LIVEKIT_API_KEY);
  requireSecret("LIVEKIT_API_SECRET", process.env.LIVEKIT_API_SECRET);

  process.env.LIVEKIT_URL = livekitUrl.toString().replace(/\/$/, "");
  process.env.LIVEKIT_API_URL = livekitApiUrl.toString().replace(/\/$/, "");
}

function parseRequiredPublicUrl(name, value, protocol) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be configured for remote LiveKit before starting a public demo.`);
  }

  if (url.protocol !== protocol || isLoopbackHostname(url.hostname)) {
    throw new Error(`${name} must use ${protocol}// with a non-loopback host for public demos.`);
  }

  return url;
}

function deriveLiveKitApiUrl(livekitUrl) {
  const apiUrl = new URL(livekitUrl);
  apiUrl.protocol = "https:";
  return apiUrl;
}

function requireSecret(name, value) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for the public demo and must remain backend-only.`);
  }
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function validateDocker() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error("Docker Desktop must be running to start the free Cloudflare quick tunnel.");
  }
}

async function validateLocalDependencies() {
  const dependencies = [
    ["PostgreSQL", readPortFromUrl(process.env.DATABASE_URL, 5432)],
    ["Redis", readPortFromUrl(process.env.REDIS_URL, 6379)],
    ["Piston", readPortFromUrl(process.env.PISTON_BASE_URL, 2000)],
    ["MinIO", readPortFromUrl(process.env.S3_ENDPOINT, 9000)],
  ];

  for (const [name, port] of dependencies) {
    if (port !== null) {
      try {
        await waitForTcpPort(port, 1_500);
      } catch {
        throw new Error(`${name} is not reachable on localhost port ${port}. Start the required Docker profiles first.`);
      }
    }
  }
}

function readPortFromUrl(value, fallbackPort) {
  if (!value) {
    return fallbackPort;
  }

  const url = new URL(value);
  if (!isLoopbackHostname(url.hostname)) {
    return null;
  }

  return url.port ? Number(url.port) : fallbackPort;
}

function startQuickTunnel() {
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "cloudflare/cloudflared:latest",
      "tunnel",
      "--no-autoupdate",
      "--url",
      `http://host.docker.internal:${publicWebPort}`,
    ],
    {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const publicUrl = new Promise((resolvePublicUrl, rejectPublicUrl) => {
    const timeout = setTimeout(() => {
      rejectPublicUrl(new Error("Cloudflare did not provide a public demo URL within 120 seconds."));
    }, 120_000);
    let resolved = false;
    let outputBuffer = "";

    const inspectOutput = (chunk) => {
      const text = chunk.toString();
      process.stderr.write(`[tunnel] ${text}`);
      outputBuffer = `${outputBuffer}${text}`.slice(-8_192);
      const match = outputBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!resolved && match) {
        resolved = true;
        clearTimeout(timeout);
        resolvePublicUrl(match[0].replace(/\/$/, ""));
      }
    };

    child.stdout.on("data", inspectOutput);
    child.stderr.on("data", inspectOutput);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPublicUrl(new Error(`Unable to start Cloudflare tunnel: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        rejectPublicUrl(new Error(`Cloudflare tunnel stopped before startup (exit ${code ?? "unknown"}).`));
      }
    });
  });

  return { process: child, publicUrl };
}

function createCommonEnvironment(sessionSecret) {
  return {
    ...process.env,
    AUTH_JWT_SECRET: sessionSecret,
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://anecites:anecites_dev_password@127.0.0.1:5432/anecites",
    REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    RABBITMQ_URL:
      process.env.RABBITMQ_URL ?? "amqp://anecites:anecites_dev_password@127.0.0.1:5672",
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
    S3_BUCKET: process.env.S3_BUCKET ?? "anecites-dev",
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "anecites",
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "anecites_dev_password",
    S3_REGION: process.env.S3_REGION ?? "us-east-1",
    CODE_EXECUTION_PROVIDER: "piston",
    PISTON_BASE_URL: process.env.PISTON_BASE_URL ?? "http://127.0.0.1:2000",
  };
}

function startManagedProcess(label, executable, args, environment) {
  const child = spawn(executable, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk.toString()}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk.toString()}`));
  return { label, process: child };
}

async function assertPortAvailable(port) {
  await new Promise((resolveAvailable, rejectAvailable) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      rejectAvailable(new Error(`Port ${port} is already in use. Stop the existing public demo before continuing.`, { cause: error }));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(resolveAvailable);
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // The service may still be starting.
    }
    await delay(200);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function waitForTcpPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnected) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.destroy();
        resolveConnected(true);
      });
      socket.once("error", () => resolveConnected(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolveConnected(false);
      });
    });
    if (connected) {
      return;
    }
    await delay(200);
  }
  throw new Error(`Service did not open localhost port ${port}.`);
}

function waitForUnexpectedExit() {
  const processes = [
    ...children,
    ...(tunnelProcess ? [{ label: "tunnel", process: tunnelProcess }] : []),
  ];

  return new Promise((_, rejectExit) => {
    for (const child of processes) {
      child.process.once("exit", (code, signal) => {
        if (!stopping) {
          rejectExit(new Error(`${child.label} stopped unexpectedly (exit ${code ?? signal ?? "unknown"}).`));
        }
      });
    }
  });
}

async function shutdown(exitCode) {
  await cleanup();
  process.exit(exitCode);
}

async function cleanup() {
  if (stopping) {
    return;
  }
  stopping = true;

  for (const child of children) {
    child.process.kill();
  }
  tunnelProcess?.kill();

  spawnSync("docker", ["rm", "--force", containerName], {
    cwd: repositoryRoot,
    stdio: "ignore",
    windowsHide: true,
  });
}

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}
