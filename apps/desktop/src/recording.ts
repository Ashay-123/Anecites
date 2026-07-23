const RECORDING_REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type SessionRecordingState = "active" | "stop_requested" | "completed" | "failed";

export interface SessionRecordingStatus {
  state: SessionRecordingState;
  startedAt: string;
  stopRequestedAt: string | null;
  completedAt: string | null;
}

export interface SessionRecordingControl {
  egressId: string;
}

export interface SessionRecordingSnapshot {
  recordingStatus: SessionRecordingStatus | null;
  recordingControl: SessionRecordingControl | null;
}

export interface GetSessionRecordingStatusRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
}

export interface StopSessionRecordingRequest extends GetSessionRecordingStatusRequest {
  egressId: string;
}

export interface StartedSessionRecording extends SessionRecordingStatus {
  egressId: string;
}

export interface StoppedSessionRecording {
  recording: SessionRecordingStatus;
  mediaAnalysisStatus: string | null;
}

export async function getSessionRecordingStatus(
  request: GetSessionRecordingStatusRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SessionRecordingSnapshot> {
  const body = await requestRecording(
    buildSessionUrl(request),
    {
      method: "GET",
      headers: authorizationHeaders(request.authToken),
      signal: AbortSignal.timeout(RECORDING_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(body, "Recording status response is invalid");

  return {
    recordingStatus: record.recordingStatus === null
      ? null
      : parseSessionRecordingStatus(record.recordingStatus, "Recording status response is invalid"),
    recordingControl: record.recordingControl === null
      ? null
      : parseSessionRecordingControl(record.recordingControl, "Recording status response is invalid"),
  };
}

export async function startSessionRecording(
  request: GetSessionRecordingStatusRequest,
  fetchImpl: FetchLike = fetch,
): Promise<StartedSessionRecording> {
  const body = await requestRecording(
    buildSessionUrl(request),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authorizationHeaders(request.authToken),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(RECORDING_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(body, "Recording start response is invalid");
  const sessionRecording = requireRecord(record.sessionRecording, "Recording start response is invalid");
  const status = parseSessionRecordingStatus(sessionRecording, "Recording start response is invalid");

  return {
    ...status,
    egressId: requireNonEmptyString(sessionRecording.egressId, "Recording start response is invalid"),
  };
}

export async function stopSessionRecording(
  request: StopSessionRecordingRequest,
  fetchImpl: FetchLike = fetch,
): Promise<StoppedSessionRecording> {
  const egressId = requireNonEmptyString(request.egressId, "Recording stop request is invalid");
  const body = await requestRecording(
    `${buildSessionUrl(request)}/${encodeURIComponent(egressId)}/stop`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authorizationHeaders(request.authToken),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(RECORDING_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(body, "Recording stop response is invalid");
  const mediaAnalysis = record.mediaAnalysis === undefined
    ? null
    : requireRecord(record.mediaAnalysis, "Recording stop response is invalid");

  return {
    recording: parseSessionRecordingStatus(record.sessionRecording, "Recording stop response is invalid"),
    mediaAnalysisStatus: mediaAnalysis === null
      ? null
      : optionalNonEmptyString(mediaAnalysis.status, "Recording stop response is invalid"),
  };
}

async function requestRecording(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("Recording service timed out");
    }
    throw new Error("Recording service is unavailable");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Recording request failed");
  }

  return body;
}

function buildSessionUrl(request: GetSessionRecordingStatusRequest): string {
  const apiBaseUrl = requireNonEmptyString(request.apiBaseUrl, "Recording request is invalid");
  const sessionId = requireNonEmptyString(request.sessionId, "Recording request is invalid");
  requireNonEmptyString(request.authToken, "Recording request is invalid");

  return `${apiBaseUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(sessionId)}/livekit-recording`;
}

function authorizationHeaders(authToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${requireNonEmptyString(authToken, "Recording request is invalid")}`,
  };
}

function parseSessionRecordingStatus(value: unknown, message: string): SessionRecordingStatus {
  const record = requireRecord(value, message);
  const state = requireNonEmptyString(record.state, message);
  if (state !== "active" && state !== "stop_requested" && state !== "completed" && state !== "failed") {
    throw new Error(message);
  }

  return {
    state,
    startedAt: requireIsoTimestamp(record.startedAt, message),
    stopRequestedAt: record.stopRequestedAt === null
      ? null
      : requireIsoTimestamp(record.stopRequestedAt, message),
    completedAt: record.completedAt === null
      ? null
      : requireIsoTimestamp(record.completedAt, message),
  };
}

function parseSessionRecordingControl(value: unknown, message: string): SessionRecordingControl {
  const record = requireRecord(value, message);
  return {
    egressId: requireNonEmptyString(record.egressId, message),
  };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalNonEmptyString(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonEmptyString(value, message);
}

function requireIsoTimestamp(value: unknown, message: string): string {
  const timestamp = requireNonEmptyString(value, message);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(message);
  }

  return timestamp;
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}
