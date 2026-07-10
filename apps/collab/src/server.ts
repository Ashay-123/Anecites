import { createServer, type Server } from "node:http";
import { jwtVerify } from "jose";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as Y from "yjs";

import { type ReplayEvidenceOptions } from "./replay-evidence.js";
import { trackYjsTextChange, type CollabTelemetryOptions } from "./telemetry.js";

export interface AuthenticatedPrincipal {
  subject: string;
  role: string;
}

export type AuthorizeRoom = (
  principal: AuthenticatedPrincipal,
  sessionId: string,
) => boolean | Promise<boolean>;

export interface CreateCollabServerOptions {
  authJwtSecret: string;
  authorizeRoom?: AuthorizeRoom;
  telemetry?: CollabTelemetryOptions;
  replayEvidence?: ReplayEvidenceOptions;
}

export interface CollabServer {
  httpServer: Server;
  webSocketServer: WebSocketServer;
  close(): Promise<void>;
  roomCount(): number;
}

interface RoomState {
  doc: Y.Doc;
  clients: Set<WebSocket>;
}

type ClientMessage = {
  type: "sync:update";
  update: string;
};

interface ConnectionContext {
  sessionId: string;
  documentId: string;
  principal: AuthenticatedPrincipal;
}

const closePolicyViolation = 1008;
const secretEncoder = new TextEncoder();
const defaultDocumentTextName = "main";

export function createCollabServer(options: CreateCollabServerOptions): CollabServer {
  const secret = secretEncoder.encode(options.authJwtSecret);
  const rooms = new Map<string, RoomState>();

  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  });

  const webSocketServer = new WebSocketServer({
    path: "/collab",
    server: httpServer,
  });

  webSocketServer.on("connection", (socket, request) => {
    void handleConnection({
      socket,
      requestUrl: request.url ?? "",
      rooms,
      secret,
      authorizeRoom: options.authorizeRoom,
      telemetry: options.telemetry,
      replayEvidence: options.replayEvidence,
    });
  });

  return {
    httpServer,
    webSocketServer,
    async close() {
      for (const room of rooms.values()) {
        for (const client of room.clients) {
          client.close();
        }

        room.doc.destroy();
      }

      rooms.clear();
      await closeWebSocketServer(webSocketServer);
      await closeHttpServer(httpServer);
    },
    roomCount() {
      return rooms.size;
    },
  };
}

async function handleConnection(input: {
  socket: WebSocket;
  requestUrl: string;
  rooms: Map<string, RoomState>;
  secret: Uint8Array;
  authorizeRoom: AuthorizeRoom | undefined;
  telemetry: CollabTelemetryOptions | undefined;
  replayEvidence: ReplayEvidenceOptions | undefined;
}): Promise<void> {
  const { socket, requestUrl, rooms, secret, authorizeRoom, telemetry, replayEvidence } = input;

  try {
    const url = new URL(requestUrl, "ws://127.0.0.1");
    const sessionId = normalizeRequiredParam(url.searchParams.get("sessionId"));
    const documentId = normalizeOptionalParam(url.searchParams.get("documentId")) ?? sessionId;
    const token = normalizeRequiredParam(url.searchParams.get("token"));
    const principal = await verifyPrincipal(token, secret);

    if (authorizeRoom && !(await authorizeRoom(principal, sessionId))) {
      socket.close(closePolicyViolation, "Unauthorized room");
      return;
    }

    const room = getOrCreateRoom(rooms, sessionId);
    const context = {
      sessionId,
      documentId,
      principal,
    };
    room.clients.add(socket);

    socket.on("message", (rawData) => {
      handleMessage(socket, room, rawData, context, telemetry, replayEvidence);
    });

    socket.on("close", () => {
      room.clients.delete(socket);
    });

    setImmediate(() => {
      if (socket.readyState === WebSocket.OPEN) {
        sendSnapshot(socket, room);
      }
    });
  } catch {
    socket.close(closePolicyViolation, "Invalid authentication");
  }
}

async function verifyPrincipal(token: string, secret: Uint8Array): Promise<AuthenticatedPrincipal> {
  const result = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
  });

  const subject = result.payload.sub;
  const role = result.payload.role;

  if (typeof subject !== "string" || subject.trim().length === 0 || typeof role !== "string") {
    throw new Error("Invalid token payload");
  }

  return {
    subject,
    role,
  };
}

function normalizeRequiredParam(value: string | null): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error("Missing websocket parameter");
  }

  return normalized;
}

function normalizeOptionalParam(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function getOrCreateRoom(rooms: Map<string, RoomState>, sessionId: string): RoomState {
  const existing = rooms.get(sessionId);

  if (existing) {
    return existing;
  }

  const room = {
    doc: new Y.Doc(),
    clients: new Set<WebSocket>(),
  };

  rooms.set(sessionId, room);
  return room;
}

function sendSnapshot(socket: WebSocket, room: RoomState): void {
  socket.send(
    JSON.stringify({
      type: "sync:snapshot",
      update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64"),
    }),
  );
}

function handleMessage(
  sender: WebSocket,
  room: RoomState,
  rawData: RawData,
  context: ConnectionContext,
  telemetry: CollabTelemetryOptions | undefined,
  replayEvidence: ReplayEvidenceOptions | undefined,
): void {
  let message: ClientMessage;

  try {
    message = parseClientMessage(rawData);
    const update = Buffer.from(message.update, "base64");
    const occurredAt = (replayEvidence?.now?.() ?? new Date()).toISOString();
    void replayEvidence?.recordUpdate?.({
      sessionId: context.sessionId,
      documentId: context.documentId,
      participantId: context.principal.subject,
      occurredAt,
      updateBase64: message.update,
    }).catch(() => undefined);

    const textName = telemetry?.textName ?? defaultDocumentTextName;
    const beforeLength = room.doc.getText(textName).length;
    Y.applyUpdate(room.doc, update);
    const afterLength = room.doc.getText(textName).length;

    trackYjsTextChange(
      context,
      {
        insertedCharacterCount: Math.max(0, afterLength - beforeLength),
        deletedCharacterCount: Math.max(0, beforeLength - afterLength),
      },
      telemetry,
    );

    broadcastUpdate(sender, room, message.update);
  } catch {
    sender.close(closePolicyViolation, "Invalid sync message");
  }
}

function parseClientMessage(rawData: RawData): ClientMessage {
  const parsed = JSON.parse(rawData.toString()) as Partial<ClientMessage>;

  if (parsed.type !== "sync:update" || typeof parsed.update !== "string") {
    throw new Error("Invalid client message");
  }

  return {
    type: parsed.type,
    update: parsed.update,
  };
}

function broadcastUpdate(sender: WebSocket, room: RoomState, update: string): void {
  const payload = JSON.stringify({
    type: "sync:update",
    update,
  });

  for (const client of room.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
