import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

import { loadServerConfig } from "../dist/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const livekitClientBundlePath = resolve(repoRoot, "node_modules/livekit-client/dist/livekit-client.umd.js");

loadDotEnv(resolve(repoRoot, ".env"));

async function main() {
  const config = loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://anecites:anecites_dev_password@localhost:5672",
    CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: process.env.CODE_EXECUTION_ALLOWED_LANGUAGE_IDS ?? "63,71",
    LIVEKIT_URL: process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880",
    LIVEKIT_API_URL: process.env.LIVEKIT_API_URL ?? "http://127.0.0.1:7880",
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? "devkey",
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? "devsecret_livekit_local_minimum_32_chars",
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? "local_smoke_auth_secret_minimum_32_characters",
  });

  if (!config.livekitUrl || !config.livekitApiUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    throw new Error("Verify LIVEKIT_URL, LIVEKIT_API_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in your .env file.");
  }

  if (!existsSync(livekitClientBundlePath)) {
    throw new Error(`LiveKit client bundle was not found at ${livekitClientBundlePath}. Run npm install first.`);
  }

  const chromePath = findBrowserExecutable();
  const roomName = `smoke-livekit-browser-${Date.now()}`;
  const rooms = new RoomServiceClient(config.livekitApiUrl, config.livekitApiKey, config.livekitApiSecret);
  const webServer = await startBundleServer(livekitClientBundlePath);
  const debugPort = await findAvailablePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "anecites-livekit-chrome-"));
  let browser = null;
  let cdp = null;

  try {
    await rooms.createRoom({
      name: roomName,
      emptyTimeout: 60,
      maxParticipants: 2,
    });

    const participantTokenA = await createParticipantToken(config, roomName, "browser-smoke-a");
    const participantTokenB = await createParticipantToken(config, roomName, "browser-smoke-b");
    browser = launchBrowser(chromePath, debugPort, userDataDir, webServer.origin);
    cdp = await connectToBrowser(debugPort);

    const sessionId = await cdp.openPage(webServer.origin);
    await cdp.send(sessionId, "Runtime.enable");
    await cdp.send(sessionId, "Network.enable");

    const connected = await cdp.evaluate(
      sessionId,
      createConnectExpression(config.livekitUrl, participantTokenA, participantTokenB),
      30_000,
    );

    if (!connected?.connected || !connected.events.includes("trackSubscribed")) {
      throw new Error(`LiveKit browser smoke did not subscribe to a remote track: ${JSON.stringify(connected)}`);
    }

    await cdp.send(sessionId, "Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await delay(3_500);
    await cdp.send(sessionId, "Network.emulateNetworkConditions", {
      offline: false,
      latency: 120,
      downloadThroughput: 1024 * 1024,
      uploadThroughput: 1024 * 1024,
    });

    const reconnected = await cdp.evaluate(sessionId, createReconnectExpression(), 30_000);
    const sawReconnectStart =
      reconnected?.events?.includes("signalReconnecting") || reconnected?.events?.includes("reconnecting");
    const sawReconnectEnd =
      reconnected?.events?.includes("reconnected") || reconnected?.events?.includes("state:connected");

    if (!sawReconnectStart || !sawReconnectEnd || reconnected.timeout) {
      throw new Error(`LiveKit browser smoke did not reconnect cleanly: ${JSON.stringify(reconnected)}`);
    }

    await cdp.evaluate(sessionId, createDisconnectExpression(), 10_000).catch(() => {});
    console.log(`LiveKit browser smoke passed with room ${roomName}.`);
  } finally {
    if (cdp) {
      cdp.close();
    }
    await rooms.deleteRoom(roomName).catch(() => {});
    await webServer.close();
    if (browser) {
      await stopBrowser(browser);
    }
    removeDirectoryWithRetry(userDataDir);
  }
}

async function createParticipantToken(config, roomName, identity) {
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity,
    ttl: config.livekitTokenTtlSeconds,
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
}

function createConnectExpression(livekitUrl, participantTokenA, participantTokenB) {
  return `
    (async () => {
      const waitUntil = async (predicate, label, events = [], timeoutMs = 20_000) => {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          if (predicate()) {
            return true;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        throw new Error(label + " timed out: " + JSON.stringify(events));
      };

      await waitUntil(() => Boolean(window.LivekitClient), "LiveKit client bundle", []);
      const livekit = window.LivekitClient;
      const events = [];
      const roomA = new livekit.Room({ adaptiveStream: false, dynacast: false });
      const roomB = new livekit.Room({ adaptiveStream: false, dynacast: false });
      const mark = (name) => () => events.push(name);

      for (const room of [roomA, roomB]) {
        room.on("connectionStateChanged", (state) => events.push("state:" + state));
        room.on("signalReconnecting", mark("signalReconnecting"));
        room.on("reconnecting", mark("reconnecting"));
        room.on("reconnected", mark("reconnected"));
        room.on("trackSubscribed", mark("trackSubscribed"));
        room.on("participantConnected", mark("participantConnected"));
      }

      await roomA.connect(${JSON.stringify(livekitUrl)}, ${JSON.stringify(participantTokenA)});
      await roomB.connect(${JSON.stringify(livekitUrl)}, ${JSON.stringify(participantTokenB)});

      const tracks = await livekit.createLocalTracks({ audio: true, video: true });
      await Promise.all(tracks.map((track) => roomA.localParticipant.publishTrack(track)));
      await waitUntil(() => events.includes("trackSubscribed"), "trackSubscribed", events);

      window.__anecitesLiveKitSmoke = {
        roomA,
        roomB,
        tracks,
        events,
      };

      return {
        connected: true,
        events,
      };
    })()
  `;
}

function createReconnectExpression() {
  return `
    (async () => {
      const state = window.__anecitesLiveKitSmoke;
      if (!state) {
        throw new Error("LiveKit smoke state is missing");
      }

      const { events } = state;
      const initialLength = events.length;
      const deadline = Date.now() + 25_000;

      while (Date.now() < deadline) {
        const newEvents = events.slice(initialLength);
        const sawReconnectStart = events.includes("signalReconnecting") || events.includes("reconnecting");
        const sawReconnectEnd = events.includes("reconnected") || newEvents.includes("state:connected");

        if (sawReconnectStart && sawReconnectEnd) {
          return { events };
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return {
        events,
        timeout: true,
      };
    })()
  `;
}

function createDisconnectExpression() {
  return `
    (async () => {
      const state = window.__anecitesLiveKitSmoke;
      if (!state) {
        return true;
      }

      for (const track of state.tracks) {
        track.stop();
      }

      await state.roomA.disconnect();
      await state.roomB.disconnect();
      return true;
    })()
  `;
}

async function startBundleServer(bundlePath) {
  const bundle = readFileSync(bundlePath);
  const server = createServer((request, response) => {
    if (request.url === "/livekit-client.umd.js") {
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
      });
      response.end(bundle);
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Anecites LiveKit smoke</title>
        </head>
        <body>
          <script src="/livekit-client.umd.js"></script>
        </body>
      </html>
    `);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    close() {
      return new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

function launchBrowser(chromePath, debugPort, userDataDir, origin) {
  return spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--unsafely-treat-insecure-origin-as-secure=${origin}`,
      origin,
    ],
    {
      stdio: "ignore",
    },
  );
}

async function connectToBrowser(debugPort) {
  let version = null;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);

      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
    }

    await delay(100);
  }

  if (!version?.webSocketDebuggerUrl) {
    throw new Error("Chrome DevTools endpoint did not become available");
  }

  return DevToolsConnection.connect(version.webSocketDebuggerUrl);
}

class DevToolsConnection {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.onopen = resolveOpen;
      socket.onerror = rejectOpen;
    });
    return new DevToolsConnection(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (!message.id || !this.pending.has(message.id)) {
        return;
      }

      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
        return;
      }

      pending.resolve(message.result);
    };
    this.socket.onclose = () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Chrome DevTools connection closed"));
      }
      this.pending.clear();
    };
  }

  async openPage(url) {
    const target = await this.sendBrowser("Target.createTarget", { url });
    const attached = await this.sendBrowser("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    return attached.sessionId;
  }

  send(sessionId, method, params = {}) {
    return this.sendCommand({
      sessionId,
      method,
      params,
    });
  }

  sendBrowser(method, params = {}) {
    return this.sendCommand({
      method,
      params,
    });
  }

  async evaluate(sessionId, expression, timeout) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.send(sessionId, "Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout,
        });

        if (result.exceptionDetails) {
          throw new Error(`Browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
        }

        return result.result?.value;
      } catch (error) {
        if (attempt < 2 && isExecutionContextDestroyed(error)) {
          await delay(200);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Browser evaluation did not complete");
  }

  sendCommand(payload) {
    const id = (this.nextId += 1);
    this.socket.send(JSON.stringify({ id, ...payload }));
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, {
        resolve: resolveCommand,
        reject: rejectCommand,
      });
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }
}

function isExecutionContextDestroyed(error) {
  return error instanceof Error && error.message.includes("Execution context was destroyed");
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null || browser.signalCode !== null) {
    return;
  }

  browser.kill();
  const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
  const exitedAfterTerminate = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);

  if (!exitedAfterTerminate && browser.exitCode === null && browser.signalCode === null) {
    browser.kill("SIGKILL");
    await Promise.race([exited, delay(5_000)]);
  }
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function findBrowserExecutable() {
  const explicitPath = process.env.CHROME_EXECUTABLE_PATH;

  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const candidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LocalAppData && join(process.env.LocalAppData, "Google/Chrome/Application/chrome.exe"),
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
      encoding: "utf8",
    });

    if (result.status === 0) {
      const firstPath = result.stdout.split(/\r?\n/).find(Boolean);

      if (firstPath) {
        return firstPath;
      }
    }
  }

  throw new Error("Chrome or Edge was not found. Set CHROME_EXECUTABLE_PATH to run the LiveKit browser smoke test.");
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

function removeDirectoryWithRetry(path) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(path, {
        recursive: true,
        force: true,
      });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
