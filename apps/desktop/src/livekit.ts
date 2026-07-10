export interface LiveKitTokenRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  participantId: string;
}

export interface LiveKitConnectionDetails {
  url: string;
  roomName: string;
  participantIdentity: string;
  token: string;
}

export interface ConnectableLiveKitRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect?(): Promise<void> | void;
  on?(event: string, handler: () => void): unknown;
  off?(event: string, handler: () => void): unknown;
  localParticipant?: {
    setScreenShareEnabled?(enabled: boolean): Promise<unknown>;
  };
}

type FetchLike = typeof fetch;

export interface DisplayMediaTrack {
  stop(): void;
}

export interface DisplayMediaStream {
  getTracks(): DisplayMediaTrack[];
}

export type DisplayMediaGetter = (constraints: { video: true; audio: false }) => Promise<DisplayMediaStream>;

export interface DisplayMediaSelfCheckResult {
  trackCount: number;
}

export type LiveKitConnectionStatus = "connected" | "reconnecting" | "disconnected";
export type LiveKitMediaMode = "normal" | "audio-priority";

export interface LiveKitRoomEventHandlers {
  onConnectionStatus(status: LiveKitConnectionStatus): void;
  onMediaMode(mode: LiveKitMediaMode): void;
}

export async function requestLiveKitToken(
  request: LiveKitTokenRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LiveKitConnectionDetails> {
  const response = await fetchImpl(`${request.apiBaseUrl}/sessions/${encodeURIComponent(request.sessionId)}/livekit-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.authToken}`,
    },
    body: JSON.stringify({
      participantId: request.participantId,
    }),
  });
  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(body) ?? "LiveKit token request failed");
  }

  return parseLiveKitConnectionDetails(body);
}

export async function createLiveKitRoom(): Promise<ConnectableLiveKitRoom> {
  const { Room } = await import("livekit-client");
  return new Room({
    adaptiveStream: true,
    dynacast: true,
  });
}

export async function connectLiveKitRoom(
  room: ConnectableLiveKitRoom,
  details: LiveKitConnectionDetails,
): Promise<ConnectableLiveKitRoom> {
  await room.connect(details.url, details.token);
  return room;
}

export async function runDisplayMediaSelfCheck(
  getDisplayMedia: DisplayMediaGetter | null = defaultDisplayMediaGetter(),
): Promise<DisplayMediaSelfCheckResult> {
  if (!getDisplayMedia) {
    throw new Error("Screen capture is not available");
  }

  const stream = await getDisplayMedia({
    video: true,
    audio: false,
  });
  const tracks = stream.getTracks();

  try {
    if (tracks.length === 0) {
      throw new Error("Screen share self-check did not capture a track");
    }

    return {
      trackCount: tracks.length,
    };
  } finally {
    for (const track of tracks) {
      track.stop();
    }
  }
}

export async function setLiveKitScreenShare(room: ConnectableLiveKitRoom, enabled: boolean): Promise<void> {
  const setScreenShareEnabled = room.localParticipant?.setScreenShareEnabled;

  if (!setScreenShareEnabled) {
    throw new Error("LiveKit room does not support screen sharing");
  }

  await setScreenShareEnabled.call(room.localParticipant, enabled);
}

export function observeLiveKitRoomEvents(
  room: ConnectableLiveKitRoom,
  handlers: LiveKitRoomEventHandlers,
): () => void {
  if (!room.on || !room.off) {
    return () => {};
  }

  const onSignalReconnecting = () => {
    handlers.onConnectionStatus("reconnecting");
    handlers.onMediaMode("audio-priority");
  };
  const onReconnecting = () => {
    handlers.onConnectionStatus("reconnecting");
    handlers.onMediaMode("audio-priority");
  };
  const onReconnected = () => {
    handlers.onConnectionStatus("connected");
    handlers.onMediaMode("normal");
  };
  const onDisconnected = () => {
    handlers.onConnectionStatus("disconnected");
    handlers.onMediaMode("audio-priority");
  };

  room.on("signalReconnecting", onSignalReconnecting);
  room.on("reconnecting", onReconnecting);
  room.on("reconnected", onReconnected);
  room.on("disconnected", onDisconnected);

  return () => {
    room.off?.("signalReconnecting", onSignalReconnecting);
    room.off?.("reconnecting", onReconnecting);
    room.off?.("reconnected", onReconnected);
    room.off?.("disconnected", onDisconnected);
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseLiveKitConnectionDetails(body: unknown): LiveKitConnectionDetails {
  const record = requireRecord(body);
  const livekit = requireRecord(record.livekit);
  const url = requireString(livekit.url);
  const roomName = requireString(livekit.roomName);
  const participantIdentity = requireString(livekit.participantIdentity);
  const token = requireString(livekit.token);

  if (!url || !roomName || !participantIdentity || !token) {
    throw new Error("LiveKit token response is invalid");
  }

  return {
    url,
    roomName,
    participantIdentity,
    token,
  };
}

function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LiveKit token response is invalid");
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("LiveKit token response is invalid");
  }

  return value;
}

function defaultDisplayMediaGetter(): DisplayMediaGetter | null {
  const getDisplayMedia = globalThis.navigator?.mediaDevices?.getDisplayMedia;

  if (!getDisplayMedia) {
    return null;
  }

  return getDisplayMedia.bind(globalThis.navigator.mediaDevices) as DisplayMediaGetter;
}
