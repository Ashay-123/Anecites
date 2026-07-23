import {
  applyRemoteYjsUpdate,
  encodeEditorYjsState,
  type EditorYjsDocument,
} from "./yjs-binding.js";

export interface EditorCollabSessionOptions {
  baseUrl: string;
  sessionId: string;
  token: string;
  document: EditorYjsDocument;
  WebSocketConstructor?: WebSocketConstructor;
}

export interface EditorCollabSession {
  ready: Promise<void>;
  sendLocalState(): void;
  sendPasteBlockedTelemetry(): void;
  close(): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener?: (
    event: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ) => void;
  removeEventListener?: (
    event: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ) => void;
  on?: (event: "open" | "message" | "error" | "close", listener: (event: unknown) => void) => void;
  off?: (event: "open" | "message" | "error" | "close", listener: (event: unknown) => void) => void;
}

interface SyncMessage {
  type: "sync:snapshot" | "sync:update";
  update: string;
}

const websocketOpenState = 1;

export function connectEditorCollabSession(
  options: EditorCollabSessionOptions,
): EditorCollabSession {
  const WebSocketCtor = options.WebSocketConstructor ?? globalThis.WebSocket;

  if (!WebSocketCtor) {
    throw new Error("WebSocketConstructor is required when global WebSocket is unavailable");
  }

  const socket = new WebSocketCtor(buildCollabUrl(options));
  let closed = false;
  let removeOpenListener = () => {};
  let removeMessageListener = () => {};
  let removeErrorListener = () => {};
  let removeCloseListener = () => {};

  const ready = new Promise<void>((resolve, reject) => {
    const handleMessage = (event: unknown) => {
      const message = handleSyncMessage(options.document, event);

      if (message?.type === "sync:snapshot") {
        resolve();
      }
    };
    const handleError = (event: unknown) => {
      if (!closed) {
        reject(new Error("Collab WebSocket connection failed", { cause: event }));
      }
    };
    const handleClose = () => {
      if (!closed && socket.readyState !== websocketOpenState) {
        reject(new Error("Collab WebSocket closed before it was ready"));
      }
    };

    removeMessageListener = addSocketListener(socket, "message", handleMessage);
    removeErrorListener = addSocketListener(socket, "error", handleError);
    removeCloseListener = addSocketListener(socket, "close", handleClose);
  });

  return {
    ready,
    sendLocalState() {
      if (socket.readyState !== websocketOpenState) {
        throw new Error("Collab WebSocket is not ready");
      }

      socket.send(
        JSON.stringify({
          type: "sync:update",
          update: bytesToBase64(encodeEditorYjsState(options.document)),
        }),
      );
    },
    sendPasteBlockedTelemetry() {
      if (socket.readyState !== websocketOpenState) {
        throw new Error("Collab WebSocket is not ready");
      }

      socket.send(JSON.stringify({ type: "telemetry:paste-blocked" }));
    },
    close() {
      closed = true;
      removeOpenListener();
      removeMessageListener();
      removeErrorListener();
      removeCloseListener();
      socket.close();
    },
  };
}

function buildCollabUrl(options: EditorCollabSessionOptions): string {
  const url = new URL(options.baseUrl);

  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/collab";
  }

  url.searchParams.set("sessionId", requireNonEmptyString("sessionId", options.sessionId));
  url.searchParams.set("documentId", requireNonEmptyString("documentId", options.document.documentId));
  url.searchParams.set("token", requireNonEmptyString("token", options.token));

  return url.toString();
}

function handleSyncMessage(document: EditorYjsDocument, event: unknown): SyncMessage | null {
  const message = parseSyncMessage(extractMessageData(event));

  if (!message) {
    return null;
  }

  applyRemoteYjsUpdate(document, base64ToBytes(message.update));
  return message;
}

function parseSyncMessage(data: string): SyncMessage | null {
  const parsed: unknown = JSON.parse(data);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    ("type" in parsed && (parsed.type === "sync:snapshot" || parsed.type === "sync:update")) &&
    ("update" in parsed && typeof parsed.update === "string")
  ) {
    return parsed as SyncMessage;
  }

  return null;
}

function extractMessageData(event: unknown): string {
  if (typeof event === "string") {
    return event;
  }

  if (event instanceof Uint8Array) {
    return new TextDecoder().decode(event);
  }

  if (
    typeof event === "object" &&
    event !== null &&
    "data" in event &&
    typeof event.data === "string"
  ) {
    return event.data;
  }

  throw new Error("Unsupported Collab WebSocket message");
}

function addSocketListener(
  socket: WebSocketLike,
  event: "open" | "message" | "error" | "close",
  listener: (event: unknown) => void,
): () => void {
  if (socket.addEventListener && socket.removeEventListener) {
    socket.addEventListener(event, listener);

    return () => {
      socket.removeEventListener?.(event, listener);
    };
  }

  if (socket.on) {
    socket.on(event, listener);

    return () => {
      socket.off?.(event, listener);
    };
  }

  throw new Error("WebSocket implementation does not support event listeners");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function requireNonEmptyString(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}
