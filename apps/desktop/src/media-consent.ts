import {
  createMediaConsentScopes,
  hasMediaConsentScopes,
  type MediaConsentScope,
} from "@anecites/shared";

const MEDIA_CONSENT_REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface MediaConsent {
  id: string;
  noticeVersion: string;
  scopes: MediaConsentScope[];
  grantedAt: string;
  revokedAt: string | null;
}

export interface MediaConsentRequirements {
  noticeVersion: string;
  noticeText: string;
  requiredScopes: MediaConsentScope[];
  mediaConsent: MediaConsent | null;
}

export interface GetMediaConsentRequirementsRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
}

export interface GrantMediaConsentRequest extends GetMediaConsentRequirementsRequest {
  scopes: readonly MediaConsentScope[];
}

export interface RevokeMediaConsentRequest extends GetMediaConsentRequirementsRequest {
  mediaConsentId: string;
}

export function hasCurrentMediaConsent(requirements: MediaConsentRequirements): boolean {
  return Boolean(
    requirements.mediaConsent &&
      requirements.mediaConsent.revokedAt === null &&
      hasMediaConsentScopes(requirements.mediaConsent.scopes, requirements.requiredScopes),
  );
}

export async function getMediaConsentRequirements(
  request: GetMediaConsentRequirementsRequest,
  fetchImpl: FetchLike = fetch,
): Promise<MediaConsentRequirements> {
  const response = await requestMediaConsent(
    `${buildSessionUrl(request)}/media-consent-requirements`,
    {
      method: "GET",
      headers: authorizationHeaders(request.authToken),
      signal: AbortSignal.timeout(MEDIA_CONSENT_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(response, "Media consent requirements response is invalid");

  return parseMediaConsentRequirements(record.requirements);
}

export async function grantMediaConsent(
  request: GrantMediaConsentRequest,
  fetchImpl: FetchLike = fetch,
): Promise<MediaConsent> {
  const scopes = createMediaConsentScopes(request.scopes);
  const response = await requestMediaConsent(
    `${buildSessionUrl(request)}/media-consent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authorizationHeaders(request.authToken),
      },
      body: JSON.stringify({ accepted: true, scopes }),
      signal: AbortSignal.timeout(MEDIA_CONSENT_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(response, "Media consent response is invalid");

  return parseMediaConsent(record.mediaConsent);
}

export async function revokeMediaConsent(
  request: RevokeMediaConsentRequest,
  fetchImpl: FetchLike = fetch,
): Promise<MediaConsent> {
  const mediaConsentId = requireNonEmptyString(request.mediaConsentId, "Media consent request is invalid");
  const response = await requestMediaConsent(
    `${buildSessionUrl(request)}/media-consent/${encodeURIComponent(mediaConsentId)}/revoke`,
    {
      method: "POST",
      headers: authorizationHeaders(request.authToken),
      signal: AbortSignal.timeout(MEDIA_CONSENT_REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  const record = requireRecord(response, "Media consent response is invalid");

  return parseMediaConsent(record.mediaConsent);
}

async function requestMediaConsent(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("Media consent service timed out");
    }
    throw new Error("Media consent service is unavailable");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Media consent request failed");
  }

  return body;
}

function buildSessionUrl(request: GetMediaConsentRequirementsRequest): string {
  const apiBaseUrl = requireNonEmptyString(request.apiBaseUrl, "Media consent request is invalid");
  const sessionId = requireNonEmptyString(request.sessionId, "Media consent request is invalid");
  requireNonEmptyString(request.authToken, "Media consent request is invalid");

  return `${apiBaseUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(sessionId)}`;
}

function authorizationHeaders(authToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${requireNonEmptyString(authToken, "Media consent request is invalid")}`,
  };
}

function parseMediaConsentRequirements(value: unknown): MediaConsentRequirements {
  const record = requireRecord(value, "Media consent requirements response is invalid");
  const noticeText = requireNonEmptyString(record.noticeText, "Media consent requirements response is invalid");

  if (noticeText.length > 4_000) {
    throw new Error("Media consent requirements response is invalid");
  }

  return {
    noticeVersion: requireNonEmptyString(record.noticeVersion, "Media consent requirements response is invalid"),
    noticeText,
    requiredScopes: createMediaConsentScopes(record.requiredScopes),
    mediaConsent: record.mediaConsent === null ? null : parseMediaConsent(record.mediaConsent),
  };
}

function parseMediaConsent(value: unknown): MediaConsent {
  const record = requireRecord(value, "Media consent response is invalid");
  const grantedAt = requireIsoTimestamp(record.grantedAt, "Media consent response is invalid");
  const revokedAt = record.revokedAt === null
    ? null
    : requireIsoTimestamp(record.revokedAt, "Media consent response is invalid");

  return {
    id: requireNonEmptyString(record.id, "Media consent response is invalid"),
    noticeVersion: requireNonEmptyString(record.noticeVersion, "Media consent response is invalid"),
    scopes: createMediaConsentScopes(record.scopes),
    grantedAt,
    revokedAt,
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
