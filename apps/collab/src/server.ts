import { createServer, type Server } from "node:http";
import { jwtVerify } from "jose";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as Y from "yjs";

import { type ReplayEvidenceOptions } from "./replay-evidence.js";
import {
  trackPasteBlocked,
  trackYjsTextChange,
  type CollabTelemetryOptions,
} from "./telemetry.js";

export interface AuthenticatedPrincipal {
  subject: string;
  role: string;
}

export interface AuthorizedRoomContext {
  participantId: string;
}

export type AuthorizeRoom = (
  principal: AuthenticatedPrincipal,
  sessionId: string,
  documentId: string,
) => boolean | AuthorizedRoomContext | Promise<boolean | AuthorizedRoomContext>;

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

type ClientSyncMessage = {
  type: "sync:update";
  update: string;
};

type ClientTelemetryMessage = {
  type: "telemetry:paste-blocked";
};

type ClientMessage = ClientSyncMessage | ClientTelemetryMessage;

interface ConnectionContext {
  sessionId: string;
  participantId: string;
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

    const authorization = authorizeRoom
      ? await authorizeRoom(principal, sessionId, documentId)
      : true;
    if (!authorization) {
      socket.close(closePolicyViolation, "Unauthorized room");
      return;
    }
    const participantId = typeof authorization === "object"
      ? authorization.participantId
      : principal.subject;

    const room = getOrCreateRoom(rooms, createRoomKey(sessionId, documentId));
    const context = {
      sessionId,
      participantId,
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

function createRoomKey(sessionId: string, documentId: string): string {
  return JSON.stringify([sessionId, documentId]);
}

function getOrCreateRoom(rooms: Map<string, RoomState>, roomKey: string): RoomState {
  const existing = rooms.get(roomKey);

  if (existing) {
    return existing;
  }

  const room = {
    doc: new Y.Doc(),
    clients: new Set<WebSocket>(),
  };

  rooms.set(roomKey, room);
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

    if (message.type === "telemetry:paste-blocked") {
      if (context.principal.role === "candidate") {
        trackPasteBlocked(context, telemetry);
      }
      return;
    }

    const update = Buffer.from(message.update, "base64");
    const occurredAt = (replayEvidence?.now?.() ?? new Date()).toISOString();
    void replayEvidence?.recordUpdate?.({
      sessionId: context.sessionId,
      documentId: context.documentId,
      participantId: context.participantId,
      occurredAt,
      updateBase64: message.update,
    }).catch(() => undefined);

    const textName = telemetry?.textName ?? defaultDocumentTextName;
    const change = applyYjsUpdateAndSummarizeTextChange(room.doc, textName, update);

    trackYjsTextChange(
      context,
      change,
      telemetry,
    );

    broadcastUpdate(sender, room, message.update);
  } catch {
    sender.close(closePolicyViolation, "Invalid sync message");
  }
}

function applyYjsUpdateAndSummarizeTextChange(
  document: Y.Doc,
  textName: string,
  update: Uint8Array,
): { insertedCharacterCount: number; deletedCharacterCount: number } {
  const text = document.getText(textName);
  let insertedCharacterCount = 0;
  let deletedCharacterCount = 0;
  const observer = (event: Y.YTextEvent) => {
    for (const operation of event.delta) {
      if (typeof operation.insert === "string") {
        insertedCharacterCount += operation.insert.length;
      }
      if (typeof operation.delete === "number") {
        deletedCharacterCount += operation.delete;
      }
    }
  };

  text.observe(observer);
  try {
    Y.applyUpdate(document, update);
  } finally {
    text.unobserve(observer);
  }

  return {
    insertedCharacterCount,
    deletedCharacterCount,
  };
}

function parseClientMessage(rawData: RawData): ClientMessage {
  const parsed = JSON.parse(rawData.toString()) as Record<string, unknown>;

  if (parsed.type === "telemetry:paste-blocked") {
    return {
      type: parsed.type,
    };
  }

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
