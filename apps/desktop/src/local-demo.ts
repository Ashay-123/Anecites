import { normalizeJoinSessionInput, type NormalizedJoinSessionInput } from "./session.js";

const LOCAL_DEMO_API_BASE_URL = "http://127.0.0.1:3000";
const LOCAL_DEMO_COLLAB_BASE_URL = "ws://127.0.0.1:3001";
const LOCAL_DEMO_WEB_BASE_URL = "http://127.0.0.1:5173/";
const LOCAL_DEMO_REQUEST_TIMEOUT_MS = 10_000;
const LOCAL_DEMO_MEETING_CODE_PATTERN = /^\d{6}$/;

type DemoRole = "candidate" | "interviewer";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LocalDemoMeetingCredentials {
  code: string;
  password: string;
  expiresAt: string;
  joinUrl: string | null;
}

export interface LocalDemoBootstrap {
  connection: NormalizedJoinSessionInput;
  role: DemoRole;
  meeting: LocalDemoMeetingCredentials | null;
}

export interface LocalDemoWorkspaceState {
  codeEditorOpen: boolean;
}

export interface JoinLocalDemoMeetingRequest {
  code: string;
  password: string;
}

export interface LocalDemoWorkspaceStateRequest {
  sessionId: string;
  authToken: string;
}

export interface UpdateLocalDemoWorkspaceStateRequest extends LocalDemoWorkspaceStateRequest {
  codeEditorOpen: boolean;
}

export interface LocalDemoServiceUrls {
  apiBaseUrl: string;
  collabBaseUrl: string;
}

export function createLocalDemoJoinLink(
  code: string,
  baseUrl: string = LOCAL_DEMO_WEB_BASE_URL,
): string {
  const normalizedCode = code.trim();
  if (!LOCAL_DEMO_MEETING_CODE_PATTERN.test(normalizedCode)) {
    throw new Error("Local demo meeting code is invalid");
  }

  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `join?${new URLSearchParams({ code: normalizedCode }).toString()}`;
  return url.toString();
}

export function readLocalDemoJoinCode(urlValue: string): string | null {
  let url: URL;
  try {
    url = new URL(urlValue, LOCAL_DEMO_WEB_BASE_URL);
  } catch {
    return null;
  }

  const hash = url.hash.slice(1);
  if (!hash.startsWith("join?")) {
    return null;
  }

  const searchParams = new URLSearchParams(hash.slice("join?".length));
  if (
    searchParams.getAll("code").length !== 1 ||
    [...searchParams.keys()].some((key) => key !== "code")
  ) {
    return null;
  }

  const code = searchParams.get("code")?.trim() ?? "";
  return LOCAL_DEMO_MEETING_CODE_PATTERN.test(code) ? code : null;
}

export function resolveLocalDemoServiceUrls(pageUrl: string | null = readBrowserPageUrl()): LocalDemoServiceUrls {
  if (pageUrl) {
    try {
      const url = new URL(pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const collabProtocol = url.protocol === "https:" ? "wss:" : "ws:";
        return {
          apiBaseUrl: new URL("/api", url.origin).toString().replace(/\/$/, ""),
          collabBaseUrl: new URL("/collab", `${collabProtocol}//${url.host}`).toString(),
        };
      }
    } catch {
      // Packaged desktop origins fall back to direct loopback services.
    }
  }

  return {
    apiBaseUrl: LOCAL_DEMO_API_BASE_URL,
    collabBaseUrl: LOCAL_DEMO_COLLAB_BASE_URL,
  };
}

export async function hostLocalDemoMeeting(fetchImpl: FetchLike = fetch): Promise<LocalDemoBootstrap> {
  const { apiBaseUrl } = resolveLocalDemoServiceUrls();
  const body = await requestJson(
    `${apiBaseUrl}/local-demo/meetings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(LOCAL_DEMO_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );

  return parseBootstrap(body, true);
}

export async function joinLocalDemoMeeting(
  request: JoinLocalDemoMeetingRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalDemoBootstrap> {
  const code = request.code.trim();
  const password = request.password.trim().toUpperCase();

  if (!LOCAL_DEMO_MEETING_CODE_PATTERN.test(code)) {
    throw new Error("Enter the 6-digit meeting code");
  }

  if (!/^[A-Z2-9]{8}$/.test(password)) {
    throw new Error("Enter the 8-character meeting password");
  }

  const { apiBaseUrl } = resolveLocalDemoServiceUrls();
  const body = await requestJson(
    `${apiBaseUrl}/local-demo/meetings/join`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, password }),
      signal: AbortSignal.timeout(LOCAL_DEMO_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );

  return parseBootstrap(body, false);
}

export async function getLocalDemoWorkspaceState(
  request: LocalDemoWorkspaceStateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalDemoWorkspaceState> {
  const sessionId = requireNonEmptyString(request.sessionId);
  const authToken = requireNonEmptyString(request.authToken);
  const { apiBaseUrl } = resolveLocalDemoServiceUrls();
  const body = await requestJson(
    `${apiBaseUrl}/local-demo/meetings/state?sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: AbortSignal.timeout(LOCAL_DEMO_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );

  return parseWorkspaceState(body);
}

export async function updateLocalDemoWorkspaceState(
  request: UpdateLocalDemoWorkspaceStateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalDemoWorkspaceState> {
  const sessionId = requireNonEmptyString(request.sessionId);
  const authToken = requireNonEmptyString(request.authToken);
  const { apiBaseUrl } = resolveLocalDemoServiceUrls();
  const body = await requestJson(
    `${apiBaseUrl}/local-demo/meetings/state`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        sessionId,
        codeEditorOpen: request.codeEditorOpen,
      }),
      signal: AbortSignal.timeout(LOCAL_DEMO_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );

  return parseWorkspaceState(body);
}

async function requestJson(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Local demo server timed out");
    }
    throw new Error("Local demo server is not running");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Local demo request failed");
  }

  return body;
}

function parseBootstrap(value: unknown, includeMeeting: boolean): LocalDemoBootstrap {
  const record = requireRecord(value);
  const connectionRecord = requireRecord(record.connection);
  const role = requireRole(connectionRecord.role);
  const serviceUrls = resolveLocalDemoServiceUrls();
  const connection = normalizeJoinSessionInput({
    apiBaseUrl: serviceUrls.apiBaseUrl,
    collabBaseUrl: serviceUrls.collabBaseUrl,
    sessionId: requireString(connectionRecord.sessionId),
    documentId: requireString(connectionRecord.documentId),
    participantId: requireString(connectionRecord.participantId),
    authToken: requireString(connectionRecord.authToken),
    languageId: requirePositiveInteger(connectionRecord.languageId),
  });

  return {
    connection,
    role,
    meeting: includeMeeting ? parseMeeting(record.meeting) : null,
  };
}

function parseMeeting(value: unknown): LocalDemoMeetingCredentials {
  const record = requireRecord(value);
  const code = requireString(record.code);
  const password = requireString(record.password);
  const expiresAt = requireString(record.expiresAt);
  const joinUrl = parseJoinUrl(record.joinUrl, code);

  if (
    !LOCAL_DEMO_MEETING_CODE_PATTERN.test(code) ||
    !/^[A-Z2-9]{8}$/.test(password) ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    throw new Error("Local demo response is invalid");
  }

  return { code, password, expiresAt, joinUrl };
}

function parseJoinUrl(value: unknown, code: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Local demo response is invalid");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Local demo response is invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    readLocalDemoJoinCode(url.toString()) !== code
  ) {
    throw new Error("Local demo response is invalid");
  }

  return url.toString();
}

function parseWorkspaceState(value: unknown): LocalDemoWorkspaceState {
  const record = requireRecord(value);
  const state = requireRecord(record.state);

  if (typeof state.codeEditorOpen !== "boolean") {
    throw new Error("Local demo response is invalid");
  }

  return {
    codeEditorOpen: state.codeEditorOpen,
  };
}

function requireNonEmptyString(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("Local demo request is invalid");
  }

  return normalized;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local demo response is invalid");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Local demo response is invalid");
  }
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Local demo response is invalid");
  }
  return value;
}

function requireRole(value: unknown): DemoRole {
  if (value !== "candidate" && value !== "interviewer") {
    throw new Error("Local demo response is invalid");
  }
  return value;
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

function readBrowserPageUrl(): string | null {
  return typeof window === "undefined" ? null : window.location.href;
}
