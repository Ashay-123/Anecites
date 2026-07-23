import {
  RISK_SIGNAL_TYPES,
  createNativeApplicationDetectionRules,
  type NativeApplicationDetectionRule,
  type RiskSignalType,
} from "./risk.js";

export const MONITORING_POLICY_VERSION = "2026-07-17.1";

export const MONITORING_SCOPES = [
  "process.scan",
  "window.scan",
  "capture_affinity.read",
  "vm.detect",
] as const;

export const MONITORING_EVENT_SOURCES = [
  "desktop_app",
  "desktop_native",
  "editor",
  "media_worker",
  "server",
] as const;

export const MONITORING_STOP_REASONS = [
  "session_left",
  "consent_revoked",
  "client_shutdown",
] as const;

export type MonitoringScope = (typeof MONITORING_SCOPES)[number];
export type MonitoringEventSource = (typeof MONITORING_EVENT_SOURCES)[number];
export type MonitoringStopReason = (typeof MONITORING_STOP_REASONS)[number];

export const NATIVE_MONITORING_POLICY_SCHEMA_VERSION = 1 as const;

export interface NativeMonitoringPolicySignature {
  algorithm: "Ed25519";
  keyId: string;
  valueBase64: string;
}

export interface NativeMonitoringPolicyManifest {
  schemaVersion: typeof NATIVE_MONITORING_POLICY_SCHEMA_VERSION;
  policyVersion: string;
  prohibitedApplicationRules: readonly NativeApplicationDetectionRule[];
  digestSha256: string;
  signature: NativeMonitoringPolicySignature | null;
}

export function createNativeMonitoringPolicyManifest(value: unknown): NativeMonitoringPolicyManifest {
  const record = requireUnknownRecord("Monitoring policy manifest", value);
  if (record.schemaVersion !== NATIVE_MONITORING_POLICY_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${NATIVE_MONITORING_POLICY_SCHEMA_VERSION}`);
  }
  const policyVersion = requireNonEmptyString("policyVersion", record.policyVersion);
  const prohibitedApplicationRules = createNativeApplicationDetectionRules(
    record.prohibitedApplicationRules ?? [],
  );
  const digestSha256 = requireSha256("digestSha256", record.digestSha256);
  const signature = record.signature === null
    ? null
    : createNativeMonitoringPolicySignature(record.signature);

  return {
    schemaVersion: NATIVE_MONITORING_POLICY_SCHEMA_VERSION,
    policyVersion,
    prohibitedApplicationRules,
    digestSha256,
    signature,
  };
}

export function canonicalizeNativeMonitoringPolicyPayload(
  manifest: Pick<NativeMonitoringPolicyManifest, "schemaVersion" | "policyVersion" | "prohibitedApplicationRules">,
): string {
  if (manifest.schemaVersion !== NATIVE_MONITORING_POLICY_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${NATIVE_MONITORING_POLICY_SCHEMA_VERSION}`);
  }
  return JSON.stringify({
    schemaVersion: NATIVE_MONITORING_POLICY_SCHEMA_VERSION,
    policyVersion: requireNonEmptyString("policyVersion", manifest.policyVersion),
    prohibitedApplicationRules: createNativeApplicationDetectionRules(manifest.prohibitedApplicationRules),
  });
}

export interface MonitoringStartRequest {
  participantId: string;
  policyVersion: string;
  scopes: MonitoringScope[];
  clientInstanceId: string;
  clientVersion: string;
  grantedAt: string;
}

export interface MonitoringSequenceRequest {
  sequence: number;
  occurredAt: string;
}

export interface MonitoringRiskEventRequest extends MonitoringSequenceRequest {
  type: RiskSignalType;
  source: MonitoringEventSource;
  confidence: number;
  detectorVersion: string;
  evidenceObjectId?: string;
  metadata?: Record<string, unknown>;
}

export interface MonitoringStopRequest extends MonitoringSequenceRequest {
  reason: MonitoringStopReason;
}

export function createMonitoringStartRequest(input: MonitoringStartRequest): MonitoringStartRequest {
  const scopes = Array.from(new Set(input.scopes.map(requireMonitoringScope)));
  if (scopes.length === 0) {
    throw new Error("scopes must contain at least one monitoring scope");
  }

  return {
    participantId: requireNonEmptyString("participantId", input.participantId),
    policyVersion: requireNonEmptyString("policyVersion", input.policyVersion),
    scopes,
    clientInstanceId: requireNonEmptyString("clientInstanceId", input.clientInstanceId),
    clientVersion: requireNonEmptyString("clientVersion", input.clientVersion),
    grantedAt: requireTimestamp("grantedAt", input.grantedAt),
  };
}

export function createMonitoringHeartbeatRequest(input: MonitoringSequenceRequest): MonitoringSequenceRequest {
  return createMonitoringSequenceRequest(input);
}

export function createMonitoringRiskEventRequest(
  input: MonitoringRiskEventRequest,
): MonitoringRiskEventRequest {
  const sequence = createMonitoringSequenceRequest(input);
  if (!(Object.values(RISK_SIGNAL_TYPES) as string[]).includes(input.type)) {
    throw new Error("type must be a supported risk signal type");
  }
  if (!MONITORING_EVENT_SOURCES.includes(input.source)) {
    throw new Error("source must be a supported monitoring event source");
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }

  return {
    ...sequence,
    type: input.type,
    source: input.source,
    confidence: input.confidence,
    detectorVersion: requireNonEmptyString("detectorVersion", input.detectorVersion),
    ...(input.evidenceObjectId
      ? { evidenceObjectId: requireNonEmptyString("evidenceObjectId", input.evidenceObjectId) }
      : {}),
    ...(input.metadata ? { metadata: requireRecord("metadata", input.metadata) } : {}),
  };
}

export function createMonitoringStopRequest(input: MonitoringStopRequest): MonitoringStopRequest {
  const sequence = createMonitoringSequenceRequest(input);
  if (!MONITORING_STOP_REASONS.includes(input.reason)) {
    throw new Error("reason must be a supported monitoring stop reason");
  }

  return {
    ...sequence,
    reason: input.reason,
  };
}

function createMonitoringSequenceRequest(input: MonitoringSequenceRequest): MonitoringSequenceRequest {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error("sequence must be a positive integer");
  }

  return {
    sequence: input.sequence,
    occurredAt: requireTimestamp("occurredAt", input.occurredAt),
  };
}

function requireMonitoringScope(scope: MonitoringScope): MonitoringScope {
  if (!MONITORING_SCOPES.includes(scope)) {
    throw new Error("scopes contains an unsupported monitoring scope");
  }
  return scope;
}

function requireTimestamp(fieldName: string, value: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function requireNonEmptyString(fieldName: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireRecord(fieldName: string, value: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function requireUnknownRecord(fieldName: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireSha256(fieldName: string, value: unknown): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error(`${fieldName} must be a SHA-256 hexadecimal digest`);
  }
  return value.trim().toLowerCase();
}

function createNativeMonitoringPolicySignature(value: unknown): NativeMonitoringPolicySignature {
  const signature = requireUnknownRecord("Monitoring policy signature", value);
  if (signature.algorithm !== "Ed25519") {
    throw new Error("Monitoring policy signature algorithm must be Ed25519");
  }
  const keyId = requireNonEmptyString("signature keyId", signature.keyId);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new Error("Monitoring policy signature keyId is invalid");
  }
  const valueBase64 = requireNonEmptyString("signature valueBase64", signature.valueBase64);
  if (!isBase64ByteLength(valueBase64, 64)) {
    throw new Error("Monitoring policy signature must be a 64-byte base64 value");
  }
  return { algorithm: "Ed25519", keyId, valueBase64 };
}

function isBase64ByteLength(value: string, expectedLength: number): boolean {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length * 3) / 4 - padding === expectedLength;
}
