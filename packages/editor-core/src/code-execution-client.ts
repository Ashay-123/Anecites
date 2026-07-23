export interface CodeExecutionClientOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
}

export interface CodeExecutionSubmission {
  languageId: number;
  sourceCode: string;
  stdin?: string;
  executionMode?: "run" | "submit";
  sessionId?: string;
  documentId?: string;
  participantId?: string;
}

export interface CodeExecutionSubmissionListRequest {
  sessionId: string;
  documentId?: string;
  limit?: number;
}

export interface CodeExecutionStatus {
  id: number;
  description: string;
}

export interface CodeExecutionResult {
  token: string | null;
  status: CodeExecutionStatus;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
  timeSeconds: number | null;
  memoryKb: number | null;
}

export interface CodeExecutionSubmissionRecord {
  id: string;
  sessionId: string;
  problemId: string | null;
  participantId: string | null;
  documentId: string;
  languageId: number;
  executionMode: "run" | "submit";
  status: string;
  stdout: string | null;
  stderr: string | null;
  timeMs: number | null;
  memoryKb: number | null;
  createdAt: string;
}

export interface CodeExecutionClient {
  execute(submission: CodeExecutionSubmission): Promise<CodeExecutionResult>;
  listSubmissions(request: CodeExecutionSubmissionListRequest): Promise<CodeExecutionSubmissionRecord[]>;
}

export interface CodeExecutionProxyErrorBody {
  error: {
    code: string;
    message: string;
  };
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class CodeExecutionClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CodeExecutionClientError";
    this.status = status;
    this.code = code;
  }
}

export function createCodeExecutionClient(
  options: CodeExecutionClientOptions,
): CodeExecutionClient {
  const baseUrl = requireNonEmptyString("baseUrl", options.baseUrl);
  const token = requireNonEmptyString("token", options.token);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("fetch is required when global fetch is unavailable");
  }

  return {
    async listSubmissions(request) {
      const url = createEndpointUrl(baseUrl, "code-executions");
      url.searchParams.set("sessionId", requireNonEmptyString("sessionId", request.sessionId));

      if (request.documentId !== undefined) {
        url.searchParams.set("documentId", requireNonEmptyString("documentId", request.documentId));
      }

      if (request.limit !== undefined) {
        if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50) {
          throw new Error("limit must be between 1 and 50");
        }
        url.searchParams.set("limit", String(request.limit));
      }

      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await readJsonResponse(response);

      if (!response.ok) {
        throw toClientError(response.status, body);
      }

      return parseCodeExecutionSubmissionListResponse(body);
    },

    async execute(submission) {
      const response = await fetchImpl(createEndpointUrl(baseUrl, "code-executions"), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizeSubmission(submission)),
      });

      const body = await readJsonResponse(response);

      if (!response.ok) {
        throw toClientError(response.status, body);
      }

      return parseCodeExecutionResponse(body);
    },
  };
}

function createEndpointUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path, normalizedBaseUrl);
}

function normalizeSubmission(submission: CodeExecutionSubmission): CodeExecutionSubmission & { stdin: string } {
  if (!Number.isSafeInteger(submission.languageId) || submission.languageId < 1) {
    throw new Error("languageId must be a positive integer");
  }

  const normalized: CodeExecutionSubmission & { stdin: string } = {
    languageId: submission.languageId,
    sourceCode: requireNonEmptyString("sourceCode", submission.sourceCode),
    stdin: submission.stdin ?? "",
  };

  if (submission.executionMode !== undefined) {
    if (submission.executionMode !== "run" && submission.executionMode !== "submit") {
      throw new Error("executionMode must be one of: run, submit");
    }

    normalized.executionMode = submission.executionMode;
  }

  if (submission.sessionId !== undefined) {
    normalized.sessionId = requireNonEmptyString("sessionId", submission.sessionId);
  }

  if (submission.documentId !== undefined) {
    normalized.documentId = requireNonEmptyString("documentId", submission.documentId);
  }

  if (submission.participantId !== undefined) {
    normalized.participantId = requireNonEmptyString("participantId", submission.participantId);
  }

  return normalized;
}

function toClientError(status: number, body: unknown): CodeExecutionClientError {
  if (isProxyErrorBody(body)) {
    return new CodeExecutionClientError(status, body.error.code, body.error.message);
  }

  return new CodeExecutionClientError(
    status,
    status >= 500 ? "CODE_EXECUTION_UPSTREAM_ERROR" : "CODE_EXECUTION_PROXY_ERROR",
    status >= 500
      ? "Code execution service is temporarily unavailable"
      : "Code execution proxy request failed",
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim().length === 0) {
    if (!response.ok) {
      throw toClientError(response.status, null);
    }

    throw new Error("Code execution proxy returned an invalid response");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      throw toClientError(response.status, null);
    }

    throw new Error("Code execution proxy returned an invalid response");
  }
}

function parseCodeExecutionResponse(body: unknown): CodeExecutionResult {
  if (!isRecord(body) || !("execution" in body) || !isCodeExecutionResult(body.execution)) {
    throw new Error("Code execution proxy returned an invalid response");
  }

  return body.execution;
}

function parseCodeExecutionSubmissionListResponse(body: unknown): CodeExecutionSubmissionRecord[] {
  if (!isRecord(body) || !Array.isArray(body.submissions)) {
    throw new Error("Code execution proxy returned an invalid submission list");
  }

  return body.submissions.map((submission) => {
    if (!isCodeExecutionSubmissionRecord(submission)) {
      throw new Error("Code execution proxy returned an invalid submission list");
    }

    return submission;
  });
}

function isProxyErrorBody(value: unknown): value is CodeExecutionProxyErrorBody {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isCodeExecutionResult(value: unknown): value is CodeExecutionResult {
  if (!isRecord(value) || !isRecord(value.status)) {
    return false;
  }

  return (
    isNullableString(value.token) &&
    typeof value.status.id === "number" &&
    typeof value.status.description === "string" &&
    isNullableString(value.stdout) &&
    isNullableString(value.stderr) &&
    isNullableString(value.compileOutput) &&
    isNullableString(value.message) &&
    isNullableNumber(value.timeSeconds) &&
    isNullableNumber(value.memoryKb)
  );
}

function isCodeExecutionSubmissionRecord(value: unknown): value is CodeExecutionSubmissionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    isNullableString(value.problemId) &&
    isNullableString(value.participantId) &&
    typeof value.documentId === "string" &&
    typeof value.languageId === "number" &&
    (value.executionMode === "run" || value.executionMode === "submit") &&
    typeof value.status === "string" &&
    isNullableString(value.stdout) &&
    isNullableString(value.stderr) &&
    isNullableNumber(value.timeMs) &&
    isNullableNumber(value.memoryKb) &&
    typeof value.createdAt === "string"
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(name: string, value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}
