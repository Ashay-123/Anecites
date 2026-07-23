export const RISK_SUMMARY_REVIEW_STATUSES = [
  "pending_review",
  "confirmed",
  "dismissed",
  "needs_more_context",
] as const;

export type RiskSummaryReviewStatus = (typeof RISK_SUMMARY_REVIEW_STATUSES)[number];

export interface RiskSummarySignalBreakdown {
  category: string;
  count: number;
  maxWeight: number;
  types: string[];
}

export interface ReviewerRiskSummary {
  id: string;
  sessionId: string;
  participantId: string | null;
  evidenceObjectId: string | null;
  windowStartedAt: string;
  windowEndedAt: string;
  score: number;
  correlatedSignalCount: number;
  meetsCorrelationPolicy: boolean;
  humanReviewRequired: boolean;
  reviewStatus: RiskSummaryReviewStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  rationale: string | null;
  signalBreakdown: RiskSummarySignalBreakdown[];
  evidenceReferences: ReviewerEvidenceReference[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewerEvidenceReference {
  kind: "risk_event" | "editor_aggregate" | "media_evidence";
  id: string;
  type?: string;
  source?: string;
  occurredAt: string;
  evidenceObjectId?: string | null;
  documentId?: string;
}

export interface ListSessionRiskSummariesRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  reviewStatus?: RiskSummaryReviewStatus;
}

export interface ListSessionRiskSummariesResult {
  riskSummaries: ReviewerRiskSummary[];
}

export interface UpdateRiskSummaryReviewRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  riskSummaryId: string;
  reviewStatus: RiskSummaryReviewStatus;
}

export interface UpdateRiskSummaryReviewResult {
  riskSummary: ReviewerRiskSummary;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function listSessionRiskSummaries(
  request: ListSessionRiskSummariesRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ListSessionRiskSummariesResult> {
  const params = new URLSearchParams();
  if (request.reviewStatus) {
    params.set("reviewStatus", request.reviewStatus);
  }

  const query = params.toString();
  const response = await fetchImpl(
    `${trimTrailingSlash(request.apiBaseUrl)}/sessions/${encodeURIComponent(request.sessionId)}/risk-summaries${
      query ? `?${query}` : ""
    }`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${request.authToken}`,
      },
    },
  );
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Risk summary list failed");
  }

  return parseListSessionRiskSummariesResult(body);
}

export async function updateRiskSummaryReview(
  request: UpdateRiskSummaryReviewRequest,
  fetchImpl: FetchLike = fetch,
): Promise<UpdateRiskSummaryReviewResult> {
  const response = await fetchImpl(
    `${trimTrailingSlash(request.apiBaseUrl)}/sessions/${encodeURIComponent(
      request.sessionId,
    )}/risk-summaries/${encodeURIComponent(request.riskSummaryId)}/review`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.authToken}`,
      },
      body: JSON.stringify({
        reviewStatus: request.reviewStatus,
      }),
    },
  );
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Risk summary review update failed");
  }

  return parseUpdateRiskSummaryReviewResult(body);
}

function parseListSessionRiskSummariesResult(body: unknown): ListSessionRiskSummariesResult {
  const record = requireRecord(body, "Risk summary list response is invalid");
  const riskSummaries = record.riskSummaries;

  if (!Array.isArray(riskSummaries)) {
    throw new Error("Risk summary list response is invalid");
  }

  return {
    riskSummaries: riskSummaries.map(parseReviewerRiskSummary),
  };
}

function parseUpdateRiskSummaryReviewResult(body: unknown): UpdateRiskSummaryReviewResult {
  const record = requireRecord(body, "Risk summary review response is invalid");

  return {
    riskSummary: parseReviewerRiskSummary(record.riskSummary),
  };
}

function parseReviewerRiskSummary(value: unknown): ReviewerRiskSummary {
  const record = requireRecord(value, "Risk summary response is invalid");
  const reviewStatus = requireReviewStatus(record.reviewStatus);

  return {
    id: requireString(record.id, "id"),
    sessionId: requireString(record.sessionId, "sessionId"),
    participantId: requireNullableString(record.participantId, "participantId"),
    evidenceObjectId: requireNullableString(record.evidenceObjectId, "evidenceObjectId"),
    windowStartedAt: requireString(record.windowStartedAt, "windowStartedAt"),
    windowEndedAt: requireString(record.windowEndedAt, "windowEndedAt"),
    score: requireNumber(record.score, "score"),
    correlatedSignalCount: requireInteger(record.correlatedSignalCount, "correlatedSignalCount"),
    meetsCorrelationPolicy: requireBoolean(record.meetsCorrelationPolicy, "meetsCorrelationPolicy"),
    humanReviewRequired: requireBoolean(record.humanReviewRequired, "humanReviewRequired"),
    reviewStatus,
    reviewerId: requireNullableString(record.reviewerId, "reviewerId"),
    reviewedAt: requireNullableString(record.reviewedAt, "reviewedAt"),
    rationale: requireNullableString(record.rationale, "rationale"),
    signalBreakdown: requireSignalBreakdown(record.signalBreakdown),
    evidenceReferences: requireEvidenceReferences(record.evidenceReferences),
    createdAt: requireString(record.createdAt, "createdAt"),
    updatedAt: requireString(record.updatedAt, "updatedAt"),
  };
}

function requireEvidenceReferences(value: unknown): ReviewerEvidenceReference[] {
  if (!Array.isArray(value)) {
    throw new Error("Risk summary response is invalid");
  }

  return value.map((entry) => {
    const record = requireRecord(entry, "Risk summary response is invalid");
    const kind = requireString(record.kind, "evidence reference kind");
    if (kind !== "risk_event" && kind !== "editor_aggregate" && kind !== "media_evidence") {
      throw new Error("Risk summary response is invalid");
    }
    return {
      kind,
      id: requireString(record.id, "evidence reference id"),
      occurredAt: requireString(record.occurredAt, "evidence reference occurredAt"),
      ...(record.type === undefined ? {} : { type: requireString(record.type, "evidence reference type") }),
      ...(record.source === undefined ? {} : { source: requireString(record.source, "evidence reference source") }),
      ...(record.evidenceObjectId === undefined
        ? {}
        : { evidenceObjectId: requireNullableString(record.evidenceObjectId, "evidence reference object id") }),
      ...(record.documentId === undefined
        ? {}
        : { documentId: requireString(record.documentId, "evidence reference document id") }),
    };
  });
}

function requireSignalBreakdown(value: unknown): RiskSummarySignalBreakdown[] {
  if (!Array.isArray(value)) {
    throw new Error("Risk summary response is invalid");
  }

  return value.map((entry) => {
    const record = requireRecord(entry, "Risk summary response is invalid");
    const types = record.types;

    if (!Array.isArray(types) || types.some((type) => typeof type !== "string")) {
      throw new Error("Risk summary response is invalid");
    }

    return {
      category: requireString(record.category, "category"),
      count: requireInteger(record.count, "count"),
      maxWeight: requireNumber(record.maxWeight, "maxWeight"),
      types,
    };
  });
}

function requireReviewStatus(value: unknown): RiskSummaryReviewStatus {
  if (typeof value !== "string" || !isRiskSummaryReviewStatus(value)) {
    throw new Error("Risk summary response is invalid");
  }

  return value;
}

function isRiskSummaryReviewStatus(value: string): value is RiskSummaryReviewStatus {
  return (RISK_SUMMARY_REVIEW_STATUSES as readonly string[]).includes(value);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Risk summary ${fieldName} is invalid`);
  }

  return value;
}

function requireNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, fieldName);
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Risk summary ${fieldName} is invalid`);
  }

  return value;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Risk summary ${fieldName} is invalid`);
  }

  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Risk summary ${fieldName} is invalid`);
  }

  return value;
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const error = (body as { error?: unknown }).error;

  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
