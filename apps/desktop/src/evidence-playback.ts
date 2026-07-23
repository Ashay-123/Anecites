export interface ReviewerEvidencePlayback {
  url: string;
  expiresIn: number;
  startTime: number | null;
  endTime: number | null;
}

export async function getReviewerEvidencePlayback(request: {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  evidenceObjectId: string;
  riskSummaryId?: string;
}, fetchImpl: typeof fetch = fetch): Promise<ReviewerEvidencePlayback> {
  const url = new URL(
    `/sessions/${encodeURIComponent(request.sessionId)}/evidence/${encodeURIComponent(request.evidenceObjectId)}`,
    request.apiBaseUrl.replace(/\/+$/, "") + "/",
  );
  if (request.riskSummaryId) {
    url.searchParams.set("riskSummaryId", request.riskSummaryId);
  }
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${request.authToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error(extractErrorMessage(body) ?? "Evidence playback request failed");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.expiresIn !== "number" || !Number.isSafeInteger(record.expiresIn)) {
    throw new Error("Evidence playback response is invalid");
  }
  return {
    url: record.url,
    expiresIn: record.expiresIn,
    startTime: nullableNumber(record.startTime),
    endTime: nullableNumber(record.endTime),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Evidence playback response is invalid");
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
  return typeof message === "string" && message.trim() ? message : null;
}
