import {
  MONITORING_POLICY_VERSION,
  MONITORING_SCOPES,
  RISK_SIGNAL_TYPES,
  canonicalizeNativeMonitoringPolicyPayload,
  createNativeMonitoringPolicyManifest,
  createNativeRiskSignals,
  type MonitoringStopReason,
  type NativeApplicationDetectionRule,
  type NativeMonitoringPolicyManifest,
  type NativeRiskSignalReport,
} from "@anecites/shared";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CandidateMonitoringLifecycleRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  participantId: string;
  clientInstanceId: string;
  clientVersion: string;
}

export interface CandidateMonitoringLifecycle {
  monitoringConsentId: string;
  prohibitedApplicationRules: readonly NativeApplicationDetectionRule[];
  monitoringPolicyDigestSha256: string | null;
  heartbeat(): Promise<void>;
  recordNativeRiskReport(report: NativeRiskSignalReport): Promise<number>;
  recordFocusLoss(event: CandidateFocusLossEvent): Promise<void>;
  stop(reason: MonitoringStopReason): Promise<void>;
}

export interface CandidateFocusLossEvent {
  reason: "document_hidden" | "window_blur";
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface CandidateMonitoringLifecycleOptions {
  fetch?: FetchLike;
  now?: () => Date;
  heartbeatIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  onHeartbeatSuccess?: () => void;
  onHeartbeatError?: (error: Error) => void;
  trustedMonitoringPolicyPublicKeys?: Readonly<Record<string, string>>;
  allowUnsignedMonitoringPolicy?: boolean;
  crypto?: Crypto;
}

interface MonitoringConsentResponse {
  id: string;
  nextSequence: number;
  prohibitedApplicationRules: NativeApplicationDetectionRule[];
  monitoringPolicyDigestSha256: string | null;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const MINIMUM_HEARTBEAT_INTERVAL_MS = 5_000;
const NATIVE_RISK_DETECTOR_VERSION = "anecites-native-risk-v1";
const FOCUS_RISK_DETECTOR_VERSION = "anecites-focus-v1";

export async function beginCandidateMonitoringLifecycle(
  request: CandidateMonitoringLifecycleRequest,
  options: CandidateMonitoringLifecycleOptions = {},
): Promise<CandidateMonitoringLifecycle> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const setIntervalImpl = options.setInterval ?? globalThis.setInterval;
  const clearIntervalImpl = options.clearInterval ?? globalThis.clearInterval;

  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < MINIMUM_HEARTBEAT_INTERVAL_MS) {
    throw new Error(`heartbeatIntervalMs must be at least ${MINIMUM_HEARTBEAT_INTERVAL_MS}`);
  }

  const monitoringConsent = await startMonitoring(request, fetchImpl, now, options);
  let nextSequence = monitoringConsent.nextSequence;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const previousMonitorCounts = new Map<string, number>();

  const heartbeat = () => enqueue(async () => {
    await postMonitoringRequest(
      request,
      monitoringConsent.id,
      "heartbeat",
      {
        sequence: nextSequence,
        occurredAt: requireTimestamp(now()),
      },
      fetchImpl,
      "Monitoring heartbeat failed",
    );
    nextSequence += 1;
    options.onHeartbeatSuccess?.();
  });

  const recordNativeRiskReport = async (report: NativeRiskSignalReport): Promise<number> => {
    const contextualReport = {
      ...report,
      ...(report.environmentReports
        ? {
            environmentReports: report.environmentReports.map((environmentReport) => {
              const previousMonitorCount = previousMonitorCounts.get(environmentReport.platform);
              return {
                ...environmentReport,
                ...(previousMonitorCount === undefined ? {} : { previousMonitorCount }),
              };
            }),
          }
        : {}),
    } satisfies NativeRiskSignalReport;
    const signals = createNativeRiskSignals(contextualReport);
    for (const environmentReport of report.environmentReports ?? []) {
      previousMonitorCounts.set(environmentReport.platform, environmentReport.monitorCount);
    }

    await enqueue(async () => {
      for (const signal of signals) {
        await postMonitoringRequest(
          request,
          monitoringConsent.id,
          "events",
          {
            sequence: nextSequence,
            occurredAt: signal.occurredAt,
            type: signal.type,
            source: "desktop_native",
            confidence: signal.weight,
            detectorVersion: NATIVE_RISK_DETECTOR_VERSION,
            ...(signal.evidenceObjectId ? { evidenceObjectId: signal.evidenceObjectId } : {}),
            metadata: {
              ...(signal.metadata ?? {}),
              ...(monitoringConsent.monitoringPolicyDigestSha256
                ? { policyDigestSha256: monitoringConsent.monitoringPolicyDigestSha256 }
                : {}),
            },
          },
          fetchImpl,
          "Recording native monitoring event failed",
        );
        nextSequence += 1;
      }
    });

    return signals.length;
  };

  const recordFocusLoss = (event: CandidateFocusLossEvent): Promise<void> => enqueue(async () => {
    await postMonitoringRequest(
      request,
      monitoringConsent.id,
      "events",
      {
        sequence: nextSequence,
        occurredAt: event.endedAt,
        type: RISK_SIGNAL_TYPES.clientFocusLost,
        source: "desktop_app",
        confidence: 0.65,
        detectorVersion: FOCUS_RISK_DETECTOR_VERSION,
        metadata: event,
      },
      fetchImpl,
      "Recording focus monitoring event failed",
    );
    nextSequence += 1;
  });

  const intervalId = setIntervalImpl(() => {
    void heartbeat().catch((error: unknown) => {
      options.onHeartbeatError?.(asError(error, "Monitoring heartbeat failed"));
    });
  }, heartbeatIntervalMs);

  await heartbeat().catch((error: unknown) => {
    clearIntervalImpl(intervalId);
    throw error;
  });

  return {
    monitoringConsentId: monitoringConsent.id,
    prohibitedApplicationRules: monitoringConsent.prohibitedApplicationRules,
    monitoringPolicyDigestSha256: monitoringConsent.monitoringPolicyDigestSha256,
    heartbeat,
    recordNativeRiskReport,
    recordFocusLoss,
    async stop(reason: MonitoringStopReason): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIntervalImpl(intervalId);
      await queue.catch(() => undefined);
      await postMonitoringRequest(
        request,
        monitoringConsent.id,
        "stop",
        {
          sequence: nextSequence,
          occurredAt: requireTimestamp(now()),
          reason,
        },
        fetchImpl,
        "Stopping monitoring failed",
      );
      nextSequence += 1;
    },
  };

  function enqueue(operation: () => Promise<void>): Promise<void> {
    if (stopped) {
      return Promise.reject(new Error("Monitoring has stopped"));
    }
    queue = queue.catch(() => undefined).then(operation);
    return queue;
  }
}

export function createMonitoringClientInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseTrustedMonitoringPolicyPublicKeys(value: string | undefined): Record<string, string> {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("VITE_MONITORING_POLICY_PUBLIC_KEYS_JSON must be valid JSON");
  }
  const record = requireRecord(parsed, "VITE_MONITORING_POLICY_PUBLIC_KEYS_JSON is invalid");
  return Object.fromEntries(Object.entries(record).map(([keyId, publicKey]) => {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || typeof publicKey !== "string" || publicKey.length > 512) {
      throw new Error("VITE_MONITORING_POLICY_PUBLIC_KEYS_JSON is invalid");
    }
    return [keyId, publicKey];
  }));
}

async function startMonitoring(
  request: CandidateMonitoringLifecycleRequest,
  fetchImpl: FetchLike,
  now: () => Date,
  options: CandidateMonitoringLifecycleOptions,
): Promise<MonitoringConsentResponse> {
  const response = await fetchImpl(
    `${trimTrailingSlash(request.apiBaseUrl)}/sessions/${encodeURIComponent(request.sessionId)}/monitoring/start`,
    {
      method: "POST",
      headers: requestHeaders(request.authToken),
      body: JSON.stringify({
        participantId: request.participantId,
        policyVersion: MONITORING_POLICY_VERSION,
        scopes: MONITORING_SCOPES,
        clientInstanceId: request.clientInstanceId,
        clientVersion: request.clientVersion,
        grantedAt: requireTimestamp(now()),
      }),
    },
  );
  const body = await parseJsonResponse(response, "Starting monitoring failed");
  const monitoringConsent = requireRecord(body.monitoringConsent, "Monitoring consent response is invalid");
  const id = requireString(monitoringConsent.id, "Monitoring consent response is invalid");
  const nextSequence = monitoringConsent.nextSequence;
  if (!Number.isSafeInteger(nextSequence) || (nextSequence as number) < 1) {
    throw new Error("Monitoring consent response is invalid");
  }
  return {
    id,
    nextSequence: nextSequence as number,
    ...(await parseMonitoringPolicy(body.monitoringPolicy, optionsToPolicyVerification(options))),
  };
}

async function postMonitoringRequest(
  request: CandidateMonitoringLifecycleRequest,
  monitoringConsentId: string,
  action: "events" | "heartbeat" | "stop",
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
  fallbackMessage: string,
): Promise<void> {
  const response = await fetchImpl(
    `${trimTrailingSlash(request.apiBaseUrl)}/sessions/${encodeURIComponent(request.sessionId)}/monitoring/${encodeURIComponent(monitoringConsentId)}/${action}`,
    {
      method: "POST",
      headers: requestHeaders(request.authToken),
      body: JSON.stringify(body),
    },
  );
  await parseJsonResponse(response, fallbackMessage);
}

async function parseJsonResponse(response: Response, fallbackMessage: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? fallbackMessage);
  }
  return requireRecord(body, fallbackMessage);
}

function requestHeaders(authToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };
}

function requireTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Monitoring timestamp must be valid");
  }
  return value.toISOString();
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
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

async function parseMonitoringPolicy(
  value: unknown,
  options: NativeMonitoringPolicyVerificationOptions,
): Promise<Pick<MonitoringConsentResponse, "prohibitedApplicationRules" | "monitoringPolicyDigestSha256">> {
  if (value === undefined) {
    return { prohibitedApplicationRules: [], monitoringPolicyDigestSha256: null };
  }
  const policy = await verifyNativeMonitoringPolicyManifest(value, options);
  return {
    prohibitedApplicationRules: [...policy.prohibitedApplicationRules],
    monitoringPolicyDigestSha256: policy.digestSha256,
  };
}

export interface NativeMonitoringPolicyVerificationOptions {
  trustedPublicKeys?: Readonly<Record<string, string>>;
  allowUnsigned?: boolean;
  crypto?: Crypto;
}

export async function verifyNativeMonitoringPolicyManifest(
  value: unknown,
  options: NativeMonitoringPolicyVerificationOptions = {},
): Promise<NativeMonitoringPolicyManifest> {
  let manifest: NativeMonitoringPolicyManifest;
  try {
    manifest = createNativeMonitoringPolicyManifest(value);
  } catch {
    throw new Error("Monitoring policy response is invalid");
  }
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error("Monitoring policy verification is unavailable");
  }
  const payload = new TextEncoder().encode(canonicalizeNativeMonitoringPolicyPayload(manifest));
  const digest = bytesToHex(new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", payload)));
  if (digest !== manifest.digestSha256) {
    throw new Error("Monitoring policy digest is invalid");
  }
  if (!manifest.signature) {
    if (manifest.prohibitedApplicationRules.length > 0 && options.allowUnsigned !== true) {
      throw new Error("Monitoring policy signature is required");
    }
    return manifest;
  }

  const publicKeyBase64 = options.trustedPublicKeys?.[manifest.signature.keyId];
  if (!publicKeyBase64) {
    throw new Error("Monitoring policy signing key is not trusted");
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await cryptoImpl.subtle.importKey(
      "spki",
      base64ToBytes(publicKeyBase64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("Monitoring policy public key is invalid");
  }
  const verified = await cryptoImpl.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64ToBytes(manifest.signature.valueBase64),
    payload,
  );
  if (!verified) {
    throw new Error("Monitoring policy signature is invalid");
  }
  return manifest;
}

function optionsToPolicyVerification(
  options: CandidateMonitoringLifecycleOptions,
): NativeMonitoringPolicyVerificationOptions {
  return {
    ...(options.trustedMonitoringPolicyPublicKeys
      ? { trustedPublicKeys: options.trustedMonitoringPolicyPublicKeys }
      : {}),
    ...(options.allowUnsignedMonitoringPolicy === undefined
      ? {}
      : { allowUnsigned: options.allowUnsignedMonitoringPolicy }),
    ...(options.crypto ? { crypto: options.crypto } : {}),
  };
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = globalThis.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
