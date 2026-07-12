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
  on?(event: string, handler: (...args: unknown[]) => void): unknown;
  off?(event: string, handler: (...args: unknown[]) => void): unknown;
  localParticipant?: {
    enableCameraAndMicrophone?(): Promise<unknown>;
    setCameraEnabled?(enabled: boolean): Promise<unknown>;
    setMicrophoneEnabled?(enabled: boolean): Promise<unknown>;
    setScreenShareEnabled?(enabled: boolean): Promise<unknown>;
  };
}

export interface LiveKitAttachableTrack {
  kind?: string;
  sid?: string;
  attach?(): HTMLMediaElement;
  detach?(): HTMLMediaElement[] | void;
}

export interface LiveKitTrackPublication {
  kind?: string;
  source?: string;
  trackSid?: string;
  track?: LiveKitAttachableTrack | null;
}

export interface LiveKitParticipant {
  identity?: string;
  name?: string;
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
  onTrackSubscribed?(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
  ): void;
  onTrackUnsubscribed?(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
  ): void;
  onLocalTrackPublished?(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
  ): void;
  onLocalTrackUnpublished?(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
  ): void;
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

export async function publishLiveKitCameraAndMicrophone(room: ConnectableLiveKitRoom): Promise<void> {
  const localParticipant = room.localParticipant;

  if (!localParticipant) {
    throw new Error("LiveKit room does not support local media");
  }

  if (localParticipant.enableCameraAndMicrophone) {
    await localParticipant.enableCameraAndMicrophone();
    return;
  }

  if (!localParticipant.setCameraEnabled || !localParticipant.setMicrophoneEnabled) {
    throw new Error("LiveKit room does not support camera and microphone publishing");
  }

  await localParticipant.setCameraEnabled(true);
  await localParticipant.setMicrophoneEnabled(true);
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

export function attachLiveKitMediaTrack(track: LiveKitAttachableTrack): HTMLMediaElement {
  if (!track.attach) {
    throw new Error("LiveKit track does not support media attachment");
  }

  const element = track.attach();
  element.autoplay = true;
  element.controls = false;
  if (typeof HTMLVideoElement !== "undefined" && element instanceof HTMLVideoElement) {
    element.playsInline = true;
  }
  return element;
}

export function detachLiveKitMediaTrack(track: LiveKitAttachableTrack): void {
  track.detach?.();
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
  const onTrackSubscribed = (...args: unknown[]) => {
    const [track, publication, participant] = args as [
      LiveKitAttachableTrack,
      LiveKitTrackPublication,
      LiveKitParticipant,
    ];

    if (isRenderableMediaTrack(track, publication)) {
      handlers.onTrackSubscribed?.(track, publication, participant);
    }
  };
  const onTrackUnsubscribed = (...args: unknown[]) => {
    const [track, publication, participant] = args as [
      LiveKitAttachableTrack,
      LiveKitTrackPublication,
      LiveKitParticipant,
    ];

    if (isRenderableMediaTrack(track, publication)) {
      handlers.onTrackUnsubscribed?.(track, publication, participant);
    }
  };
  const onLocalTrackPublished = (...args: unknown[]) => {
    const [publication, participant] = args as [LiveKitTrackPublication, LiveKitParticipant];
    const track = publication.track;

    if (track && isRenderableMediaTrack(track, publication)) {
      handlers.onLocalTrackPublished?.(track, publication, participant);
    }
  };
  const onLocalTrackUnpublished = (...args: unknown[]) => {
    const [publication, participant] = args as [LiveKitTrackPublication, LiveKitParticipant];
    const track = publication.track;

    if (track && isRenderableMediaTrack(track, publication)) {
      handlers.onLocalTrackUnpublished?.(track, publication, participant);
    }
  };

  room.on("signalReconnecting", onSignalReconnecting);
  room.on("reconnecting", onReconnecting);
  room.on("reconnected", onReconnected);
  room.on("disconnected", onDisconnected);
  room.on("trackSubscribed", onTrackSubscribed);
  room.on("trackUnsubscribed", onTrackUnsubscribed);
  room.on("localTrackPublished", onLocalTrackPublished);
  room.on("localTrackUnpublished", onLocalTrackUnpublished);

  return () => {
    room.off?.("signalReconnecting", onSignalReconnecting);
    room.off?.("reconnecting", onReconnecting);
    room.off?.("reconnected", onReconnected);
    room.off?.("disconnected", onDisconnected);
    room.off?.("trackSubscribed", onTrackSubscribed);
    room.off?.("trackUnsubscribed", onTrackUnsubscribed);
    room.off?.("localTrackPublished", onLocalTrackPublished);
    room.off?.("localTrackUnpublished", onLocalTrackUnpublished);
  };
}

function isRenderableMediaTrack(track: LiveKitAttachableTrack, publication: LiveKitTrackPublication): boolean {
  if (!track || !publication) {
    return false;
  }

  const kind = track.kind ?? publication.kind;
  return kind === "audio" || kind === "video";
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
