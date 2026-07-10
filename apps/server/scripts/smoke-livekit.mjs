import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { RoomServiceClient } from "livekit-server-sdk";

import { loadServerConfig } from "../dist/index.js";

loadDotEnv(resolve(process.cwd(), ".env"));

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

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

  if (!config.livekitApiUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    throw new Error("Verify LIVEKIT_API_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in your .env file.");
  }

  const roomName = `smoke-livekit-${Date.now()}`;
  const rooms = new RoomServiceClient(config.livekitApiUrl, config.livekitApiKey, config.livekitApiSecret);

  try {
    const createdRoom = await rooms.createRoom({
      name: roomName,
      emptyTimeout: 60,
      maxParticipants: 2,
    });

    if (createdRoom.name !== roomName) {
      throw new Error(`Unexpected LiveKit room create result: ${JSON.stringify(createdRoom)}`);
    }

    const listedRooms = await rooms.listRooms([roomName]);
    if (!listedRooms.some((room) => room.name === roomName)) {
      throw new Error(`Created LiveKit room was not returned by listRooms: ${JSON.stringify(listedRooms)}`);
    }

    console.log(`LiveKit smoke passed with room ${roomName}.`);
  } finally {
    await rooms.deleteRoom(roomName).catch(() => {});
  }
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
