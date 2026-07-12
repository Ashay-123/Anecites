import { normalizeJoinSessionInput, type NormalizedJoinSessionInput } from "./session.js";
import { type LocalDemoProblem } from "@anecites/shared";

const LOCAL_DEMO_API_BASE_URL = "http://127.0.0.1:3000";
const LOCAL_DEMO_COLLAB_BASE_URL = "ws://127.0.0.1:3001";
const LOCAL_DEMO_REQUEST_TIMEOUT_MS = 10_000;

type DemoRole = "candidate" | "interviewer";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LocalDemoMeetingCredentials {
  code: string;
  password: string;
  expiresAt: string;
}

export interface LocalDemoBootstrap {
  connection: NormalizedJoinSessionInput;
  role: DemoRole;
  meeting: LocalDemoMeetingCredentials | null;
}

export interface LocalDemoWorkspaceState {
  codeEditorOpen: boolean;
}

export interface LocalDemoProblemDetails {
  problem: LocalDemoProblem;
  starterCode: string;
  languageId: number;
  documentId: string;
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

export async function hostLocalDemoMeeting(fetchImpl: FetchLike = fetch): Promise<LocalDemoBootstrap> {
  const body = await requestJson(
    `${LOCAL_DEMO_API_BASE_URL}/local-demo/meetings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

  if (!/^\d{6}$/.test(code)) {
    throw new Error("Enter the 6-digit meeting code");
  }

  if (!/^[A-Z2-9]{8}$/.test(password)) {
    throw new Error("Enter the 8-character meeting password");
  }

  const body = await requestJson(
    `${LOCAL_DEMO_API_BASE_URL}/local-demo/meetings/join`,
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
  const body = await requestJson(
    `${LOCAL_DEMO_API_BASE_URL}/local-demo/meetings/state?sessionId=${encodeURIComponent(sessionId)}`,
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

export async function getLocalDemoProblem(
  request: LocalDemoWorkspaceStateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalDemoProblemDetails> {
  const sessionId = requireNonEmptyString(request.sessionId);
  const authToken = requireNonEmptyString(request.authToken);
  const body = await requestJson(
    `${LOCAL_DEMO_API_BASE_URL}/local-demo/meetings/problem?sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: AbortSignal.timeout(LOCAL_DEMO_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );

  return parseProblemDetails(body);
}

export async function updateLocalDemoWorkspaceState(
  request: UpdateLocalDemoWorkspaceStateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalDemoWorkspaceState> {
  const sessionId = requireNonEmptyString(request.sessionId);
  const authToken = requireNonEmptyString(request.authToken);
  const body = await requestJson(
    `${LOCAL_DEMO_API_BASE_URL}/local-demo/meetings/state`,
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
  const connection = normalizeJoinSessionInput({
    apiBaseUrl: LOCAL_DEMO_API_BASE_URL,
    collabBaseUrl: LOCAL_DEMO_COLLAB_BASE_URL,
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

  if (!/^\d{6}$/.test(code) || !/^[A-Z2-9]{8}$/.test(password) || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("Local demo response is invalid");
  }

  return { code, password, expiresAt };
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

function parseProblemDetails(value: unknown): LocalDemoProblemDetails {
  const record = requireRecord(value);
  const problem = parseProblem(record.problem);
  const starterCode = requireString(record.starterCode);
  const languageId = requirePositiveInteger(record.languageId);
  const documentId = requireString(record.documentId);

  return {
    problem,
    starterCode,
    languageId,
    documentId,
  };
}

function parseProblem(value: unknown): LocalDemoProblem {
  const record = requireRecord(value);
  const title = requireString(record.title);
  const difficulty = requireString(record.difficulty);
  const prompt = requireString(record.prompt);
  const examples = requireArray(record.examples).map(parseProblemExample);
  const testcases = requireArray(record.testcases).map(parseProblemTestcase);
  const constraints = requireArray(record.constraints).map(requireString);

  return {
    title,
    difficulty,
    prompt,
    examples,
    testcases,
    constraints,
  };
}

function parseProblemExample(value: unknown) {
  const record = requireRecord(value);

  return {
    input: requireString(record.input),
    output: requireString(record.output),
  };
}

function parseProblemTestcase(value: unknown) {
  const record = requireRecord(value);

  return {
    nums: requireArray(record.nums).map(requireNumber),
    target: requireNumber(record.target),
    expected: requireArray(record.expected).map(requireNumber),
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

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Local demo response is invalid");
  }
  return value;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
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
