import { Prisma, type PrismaClient } from "@anecites/db";
import {
  MONITORING_EVENT_SOURCES,
  MONITORING_SCOPES,
  MONITORING_STOP_REASONS,
  RISK_SIGNAL_TYPES,
  createMonitoringHeartbeatRequest,
  createMonitoringRiskEventRequest,
  createMonitoringStartRequest,
  createMonitoringStopRequest,
  createNativeMonitoringPolicyManifest,
  createNativeProhibitedApplicationMatch,
  type MonitoringEventSource,
  type MonitoringRiskEventRequest,
  type MonitoringScope,
  type MonitoringStartRequest,
  type MonitoringStopReason,
  type NativeMonitoringPolicyManifest,
} from "@anecites/shared";

import { type AuthenticatedPrincipal } from "./auth.js";
import { HttpError } from "./http-error.js";
import { listRiskSummaries } from "./risk-summaries.js";

type DbMonitoringEventSource =
  | "DESKTOP_APP"
  | "DESKTOP_NATIVE"
  | "EDITOR"
  | "MEDIA_WORKER"
  | "SERVER";

const API_TO_DB_EVENT_SOURCE = {
  desktop_app: "DESKTOP_APP",
  desktop_native: "DESKTOP_NATIVE",
  editor: "EDITOR",
  media_worker: "MEDIA_WORKER",
  server: "SERVER",
} as const satisfies Record<MonitoringEventSource, DbMonitoringEventSource>;

const DB_TO_API_EVENT_SOURCE = {
  DESKTOP_APP: "desktop_app",
  DESKTOP_NATIVE: "desktop_native",
  EDITOR: "editor",
  MEDIA_WORKER: "media_worker",
  SERVER: "server",
} as const satisfies Record<DbMonitoringEventSource, MonitoringEventSource>;

const CLIENT_EVENT_SOURCES = new Set<MonitoringEventSource>(["desktop_app", "desktop_native"]);
const DEFAULT_TIMELINE_LIMIT = 200;
const MAX_TIMELINE_LIMIT = 500;

export async function startCandidateMonitoring(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  body: unknown,
  monitoringPolicy: NativeMonitoringPolicyManifest,
) {
  requireCandidatePrincipal(principal);
  const input = parseMonitoringStartBody(body);
  requireMatchingMonitoringPolicyVersion(input.policyVersion, monitoringPolicy);
  await requireOwnedCandidateParticipant(prisma, principal, sessionId, input.participantId);

  const existing = await prisma.monitoringConsent.findFirst({
    where: {
      sessionId,
      participantId: input.participantId,
      monitoringStoppedAt: null,
      revokedAt: null,
    },
    orderBy: { monitoringStartedAt: "desc" },
  });

  if (existing) {
    if (existing.clientInstanceId !== input.clientInstanceId) {
      throw new HttpError(409, "MONITORING_ALREADY_ACTIVE", "Monitoring is already active on another client");
    }
    requireCurrentPolicyForActiveConsent(existing, monitoringPolicy);
    return serializeMonitoringStart(existing);
  }

  const startedAt = new Date();
  let consent: Prisma.MonitoringConsentGetPayload<Record<string, never>>;
  try {
    consent = await prisma.monitoringConsent.create({
      data: {
        sessionId,
        participantId: input.participantId,
        policyVersion: monitoringPolicy.policyVersion,
        policyDigestSha256: monitoringPolicy.digestSha256,
        nativeMonitoringPolicy: monitoringPolicy as unknown as Prisma.InputJsonObject,
        scopes: input.scopes,
        clientInstanceId: input.clientInstanceId,
        clientVersion: input.clientVersion,
        grantedAt: new Date(input.grantedAt),
        monitoringStartedAt: startedAt,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const concurrent = await prisma.monitoringConsent.findFirst({
      where: {
        sessionId,
        participantId: input.participantId,
        monitoringStoppedAt: null,
        revokedAt: null,
      },
      orderBy: { monitoringStartedAt: "desc" },
    });
    if (!concurrent || concurrent.clientInstanceId !== input.clientInstanceId) {
      throw new HttpError(409, "MONITORING_ALREADY_ACTIVE", "Monitoring is already active on another client");
    }
    requireCurrentPolicyForActiveConsent(concurrent, monitoringPolicy);
    consent = concurrent;
  }

  return serializeMonitoringStart(consent);
}

export async function recordCandidateMonitoringHeartbeat(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  monitoringConsentId: string,
  body: unknown,
) {
  requireCandidatePrincipal(principal);
  const input = parseMonitoringHeartbeatBody(body);
  const consent = await requireOwnedActiveConsent(prisma, principal, sessionId, monitoringConsentId);

  if (input.sequence <= consent.lastSequence) {
    const existingHeartbeat = await prisma.monitoringHeartbeat.findUnique({
      where: {
        monitoringConsentId_sequence: {
          monitoringConsentId: consent.id,
          sequence: input.sequence,
        },
      },
    });
    if (existingHeartbeat) {
      return serializeHeartbeat(existingHeartbeat);
    }
  }

  return prisma.$transaction(async (transaction) => {
    await advanceSequence(transaction, consent.id, input.sequence);
    const heartbeat = await transaction.monitoringHeartbeat.create({
      data: {
        monitoringConsentId: consent.id,
        sessionId,
        participantId: consent.participantId,
        sequence: input.sequence,
        occurredAt: new Date(input.occurredAt),
      },
    });
    return serializeHeartbeat(heartbeat);
  });
}

export async function recordCandidateRiskEvent(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  monitoringConsentId: string,
  body: unknown,
) {
  requireCandidatePrincipal(principal);
  const input = parseMonitoringRiskEventBody(body);
  if (!CLIENT_EVENT_SOURCES.has(input.source)) {
    throw new HttpError(403, "MONITORING_SOURCE_FORBIDDEN", "Client cannot submit this monitoring event source");
  }
  requireAllowedClientSignalSource(input);
  const consent = await requireOwnedActiveConsent(prisma, principal, sessionId, monitoringConsentId);
  const monitoringPolicy = requireBoundNativeMonitoringPolicy(consent);
  const eventMetadata = normalizeClientRiskEventMetadata(input, monitoringPolicy);
  const confidence = deriveClientRiskEventConfidence(input, eventMetadata);

  if (input.evidenceObjectId) {
    const evidence = await prisma.evidenceObject.findFirst({
      where: { id: input.evidenceObjectId, sessionId },
      select: { id: true },
    });
    if (!evidence) {
      throw new HttpError(404, "EVIDENCE_NOT_FOUND", "Evidence object not found for this session");
    }
  }

  return prisma.$transaction(async (transaction) => {
    await advanceSequence(transaction, consent.id, input.sequence);
    const riskEvent = await transaction.riskEvent.create({
      data: {
        monitoringConsentId: consent.id,
        sessionId,
        participantId: consent.participantId,
        sequence: input.sequence,
        type: input.type,
        source: API_TO_DB_EVENT_SOURCE[input.source],
        confidence,
        detectorVersion: input.detectorVersion,
        occurredAt: new Date(input.occurredAt),
        ...(input.evidenceObjectId ? { evidenceObjectId: input.evidenceObjectId } : {}),
        ...(eventMetadata ? { metadata: eventMetadata as Prisma.InputJsonObject } : {}),
      },
    });
    return serializeRiskEvent(riskEvent);
  });
}

function requireAllowedClientSignalSource(input: MonitoringRiskEventRequest): void {
  const allowed = input.source === "desktop_app"
    ? input.type === RISK_SIGNAL_TYPES.clientFocusLost
    : input.type === RISK_SIGNAL_TYPES.nativeCaptureAffinity ||
      input.type === RISK_SIGNAL_TYPES.nativeRemoteSession ||
      input.type === RISK_SIGNAL_TYPES.nativeDisplayTopologyChange ||
      input.type === RISK_SIGNAL_TYPES.nativeVmSignal ||
      input.type === RISK_SIGNAL_TYPES.nativeProhibitedApplication;
  if (!allowed) {
    throw new HttpError(
      400,
      "MONITORING_EVENT_INVALID",
      "Monitoring event type is not allowed for this client source",
    );
  }
}

function deriveClientRiskEventConfidence(
  input: MonitoringRiskEventRequest,
  metadata: Record<string, unknown> | undefined,
): number {
  if (input.type === RISK_SIGNAL_TYPES.clientFocusLost) {
    return 0.65;
  }
  if (input.type === RISK_SIGNAL_TYPES.nativeCaptureAffinity) {
    return 0.6;
  }
  if (input.type === RISK_SIGNAL_TYPES.nativeRemoteSession) {
    return 0.8;
  }
  if (input.type === RISK_SIGNAL_TYPES.nativeDisplayTopologyChange) {
    return 0.45;
  }
  if (input.type === RISK_SIGNAL_TYPES.nativeVmSignal) {
    const detectedSignalCount = Array.isArray(metadata?.detectedSignals)
      ? metadata.detectedSignals.length
      : 1;
    return Math.min(0.95, 0.35 + Math.max(0, detectedSignalCount - 1) * 0.3);
  }

  const matchKinds = Array.isArray(metadata?.matchKinds) ? metadata.matchKinds : [];
  const processNameMatched = matchKinds.includes("process_name");
  const windowTitleMatched = matchKinds.includes("window_title");
  return processNameMatched && windowTitleMatched ? 0.85 : processNameMatched ? 0.75 : 0.5;
}

export async function stopCandidateMonitoring(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  monitoringConsentId: string,
  body: unknown,
) {
  requireCandidatePrincipal(principal);
  const input = parseMonitoringStopBody(body);
  const consent = await requireOwnedActiveConsent(prisma, principal, sessionId, monitoringConsentId);

  return prisma.$transaction(async (transaction) => {
    await advanceSequence(transaction, consent.id, input.sequence);
    const stopped = await transaction.monitoringConsent.update({
      where: { id: consent.id },
      data: {
        monitoringStoppedAt: new Date(input.occurredAt),
        stopReason: input.reason,
        ...(input.reason === "consent_revoked" ? { revokedAt: new Date(input.occurredAt) } : {}),
      },
    });
    return serializeMonitoringConsent(stopped);
  });
}

export async function listMonitoringTimeline(
  prisma: PrismaClient,
  sessionId: string,
  requestedLimit: unknown,
) {
  const limit = parseTimelineLimit(requestedLimit);
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }

  const [consents, heartbeats, riskEvents, editorAggregates, riskSummaries] = await Promise.all([
    prisma.monitoringConsent.findMany({
      where: { sessionId },
      orderBy: { monitoringStartedAt: "asc" },
    }),
    prisma.monitoringHeartbeat.findMany({
      where: { sessionId },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    prisma.riskEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    prisma.editorTelemetryAggregate.findMany({
      where: {
        sessionId,
        OR: [
          { pasteBlockedCount: { gt: 0 } },
          { atomicInsertCount: { gt: 0 } },
        ],
      },
      orderBy: { windowEndedAt: "desc" },
      take: limit,
    }),
    listRiskSummaries(prisma, { sessionId }),
  ]);

  const timeline = [
    ...heartbeats.map((heartbeat) => ({ kind: "heartbeat" as const, ...serializeHeartbeat(heartbeat) })),
    ...riskEvents.map((riskEvent) => ({ kind: "risk_event" as const, ...serializeRiskEvent(riskEvent) })),
    ...editorAggregates.map((aggregate) => ({
      kind: "editor_aggregate" as const,
      ...serializeEditorAggregate(aggregate),
    })),
    ...riskSummaries.map((riskSummary) => ({
      kind: "risk_summary" as const,
      ...riskSummary,
      occurredAt: riskSummary.windowEndedAt,
    })),
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);

  return {
    monitoringConsents: consents.map(serializeMonitoringConsent),
    timeline,
  };
}

function serializeEditorAggregate(aggregate: {
  id: string;
  participantId: string | null;
  documentId: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
  insertEventCount: number;
  deleteEventCount: number;
  pasteBlockedCount: number;
  atomicInsertCount: number;
  maxInsertSize: number;
  createdAt: Date;
}) {
  return {
    id: aggregate.id,
    participantId: aggregate.participantId,
    documentId: aggregate.documentId,
    windowStartedAt: aggregate.windowStartedAt.toISOString(),
    windowEndedAt: aggregate.windowEndedAt.toISOString(),
    occurredAt: aggregate.windowEndedAt.toISOString(),
    insertEventCount: aggregate.insertEventCount,
    deleteEventCount: aggregate.deleteEventCount,
    pasteBlockedCount: aggregate.pasteBlockedCount,
    atomicInsertCount: aggregate.atomicInsertCount,
    maxInsertSize: aggregate.maxInsertSize,
    receivedAt: aggregate.createdAt.toISOString(),
  };
}

async function advanceSequence(
  transaction: Prisma.TransactionClient,
  monitoringConsentId: string,
  sequence: number,
): Promise<void> {
  const result = await transaction.monitoringConsent.updateMany({
    where: {
      id: monitoringConsentId,
      lastSequence: sequence - 1,
      monitoringStoppedAt: null,
      revokedAt: null,
    },
    data: { lastSequence: sequence },
  });
  if (result.count !== 1) {
    throw new HttpError(
      409,
      "MONITORING_SEQUENCE_REJECTED",
      "Monitoring sequence is replayed, missing, or out of order",
    );
  }
}

async function requireOwnedActiveConsent(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  monitoringConsentId: string,
) {
  const consent = await prisma.monitoringConsent.findFirst({
    where: {
      id: monitoringConsentId,
      sessionId,
      monitoringStoppedAt: null,
      revokedAt: null,
      participant: { userId: principal.subject, role: "CANDIDATE", leftAt: null },
    },
  });
  if (!consent) {
    throw new HttpError(404, "MONITORING_NOT_ACTIVE", "Active monitoring enrollment not found");
  }
  return consent;
}

export function requireBoundNativeMonitoringPolicy(consent: {
  policyVersion: string;
  policyDigestSha256: string | null;
  nativeMonitoringPolicy: Prisma.JsonValue | null;
}): NativeMonitoringPolicyManifest {
  if (!consent.policyDigestSha256 || !consent.nativeMonitoringPolicy) {
    throw new HttpError(
      409,
      "MONITORING_POLICY_BINDING_REQUIRED",
      "Monitoring enrollment must be restarted because its policy binding is unavailable",
    );
  }

  let monitoringPolicy: NativeMonitoringPolicyManifest;
  try {
    monitoringPolicy = createNativeMonitoringPolicyManifest(consent.nativeMonitoringPolicy);
  } catch {
    throw new HttpError(
      409,
      "MONITORING_POLICY_BINDING_INVALID",
      "Monitoring enrollment policy binding is invalid",
    );
  }

  if (
    monitoringPolicy.policyVersion !== consent.policyVersion ||
    monitoringPolicy.digestSha256 !== consent.policyDigestSha256
  ) {
    throw new HttpError(
      409,
      "MONITORING_POLICY_BINDING_INVALID",
      "Monitoring enrollment policy binding is invalid",
    );
  }

  return monitoringPolicy;
}

function requireCurrentPolicyForActiveConsent(
  consent: {
    policyVersion: string;
    policyDigestSha256: string | null;
    nativeMonitoringPolicy: Prisma.JsonValue | null;
  },
  currentPolicy: NativeMonitoringPolicyManifest,
): void {
  const boundPolicy = requireBoundNativeMonitoringPolicy(consent);
  if (
    boundPolicy.policyVersion !== currentPolicy.policyVersion ||
    boundPolicy.digestSha256 !== currentPolicy.digestSha256
  ) {
    throw new HttpError(
      409,
      "MONITORING_POLICY_BINDING_CONFLICT",
      "Active monitoring uses a different policy and must be restarted",
    );
  }
}

async function requireOwnedCandidateParticipant(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  participantId: string,
): Promise<void> {
  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
      sessionId,
      userId: principal.subject,
      role: "CANDIDATE",
      leftAt: null,
    },
    select: { id: true },
  });
  if (!participant) {
    throw new HttpError(403, "MONITORING_PARTICIPANT_FORBIDDEN", "Candidate cannot monitor this participant");
  }
}

function requireCandidatePrincipal(principal: AuthenticatedPrincipal): void {
  if (principal.role !== "candidate") {
    throw new HttpError(403, "MONITORING_CANDIDATE_REQUIRED", "Candidate access is required");
  }
}

function requireMatchingMonitoringPolicyVersion(
  requestedPolicyVersion: string,
  monitoringPolicy: NativeMonitoringPolicyManifest,
): void {
  if (requestedPolicyVersion !== monitoringPolicy.policyVersion) {
    throw new HttpError(
      409,
      "MONITORING_POLICY_VERSION_MISMATCH",
      "Desktop monitoring policy does not match the active policy",
    );
  }
}

function parseMonitoringStartBody(body: unknown): MonitoringStartRequest {
  const record = requireRecord(body);
  const scopes = requireArray(record.scopes, "scopes").map((value) => {
    if (typeof value !== "string" || !(MONITORING_SCOPES as readonly string[]).includes(value)) {
      throw new HttpError(400, "BAD_REQUEST", "scopes contains an unsupported monitoring scope");
    }
    return value as MonitoringScope;
  });
  return wrapContractError(() => createMonitoringStartRequest({
    participantId: requireString(record.participantId, "participantId"),
    policyVersion: requireString(record.policyVersion, "policyVersion"),
    scopes,
    clientInstanceId: requireString(record.clientInstanceId, "clientInstanceId"),
    clientVersion: requireString(record.clientVersion, "clientVersion"),
    grantedAt: requireString(record.grantedAt, "grantedAt"),
  }));
}

function parseMonitoringHeartbeatBody(body: unknown) {
  const record = requireRecord(body);
  return wrapContractError(() => createMonitoringHeartbeatRequest({
    sequence: requireNumber(record.sequence, "sequence"),
    occurredAt: requireString(record.occurredAt, "occurredAt"),
  }));
}

function parseMonitoringRiskEventBody(body: unknown): MonitoringRiskEventRequest {
  const record = requireRecord(body);
  const source = requireString(record.source, "source");
  if (!(MONITORING_EVENT_SOURCES as readonly string[]).includes(source)) {
    throw new HttpError(400, "BAD_REQUEST", "source must be a supported monitoring event source");
  }
  const metadata = record.metadata === undefined ? undefined : requireRecord(record.metadata);
  return wrapContractError(() => createMonitoringRiskEventRequest({
    sequence: requireNumber(record.sequence, "sequence"),
    occurredAt: requireString(record.occurredAt, "occurredAt"),
    type: requireString(record.type, "type") as MonitoringRiskEventRequest["type"],
    source: source as MonitoringEventSource,
    confidence: requireNumber(record.confidence, "confidence"),
    detectorVersion: requireString(record.detectorVersion, "detectorVersion"),
    ...(record.evidenceObjectId === undefined
      ? {}
      : { evidenceObjectId: requireString(record.evidenceObjectId, "evidenceObjectId") }),
    ...(metadata ? { metadata } : {}),
  }));
}

function parseMonitoringStopBody(body: unknown) {
  const record = requireRecord(body);
  const reason = requireString(record.reason, "reason");
  if (!(MONITORING_STOP_REASONS as readonly string[]).includes(reason)) {
    throw new HttpError(400, "BAD_REQUEST", "reason must be a supported monitoring stop reason");
  }
  return wrapContractError(() => createMonitoringStopRequest({
    sequence: requireNumber(record.sequence, "sequence"),
    occurredAt: requireString(record.occurredAt, "occurredAt"),
    reason: reason as MonitoringStopReason,
  }));
}

function normalizeClientRiskEventMetadata(
  input: MonitoringRiskEventRequest,
  monitoringPolicy: NativeMonitoringPolicyManifest,
): Record<string, unknown> | undefined {
  if (input.type === RISK_SIGNAL_TYPES.clientFocusLost) {
    if (input.source !== "desktop_app") {
      throw new HttpError(
        400,
        "MONITORING_EVENT_INVALID",
        "Focus-loss events must come from the desktop application",
      );
    }

    const metadata = requireRecord(input.metadata);
    const reason = requireString(metadata.reason, "reason");
    if (reason !== "document_hidden" && reason !== "window_blur") {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "Focus-loss reason is invalid");
    }
    const startedAt = requireTimestampString(metadata.startedAt, "startedAt");
    const endedAt = requireTimestampString(metadata.endedAt, "endedAt");
    const durationMs = requireBoundedDuration(metadata.durationMs);
    if (new Date(endedAt) <= new Date(startedAt)) {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "Focus-loss end must follow its start");
    }

    return {
      reason,
      startedAt,
      endedAt,
      durationMs,
    };
  }

  if (input.source !== "desktop_native") {
    throw new HttpError(
      400,
      "MONITORING_EVENT_INVALID",
      "Native monitoring events must come from the native desktop detector",
    );
  }
  const nativeMetadata = requireRecord(input.metadata);
  const policyDigestSha256 = requireBoundedString(
    nativeMetadata.policyDigestSha256,
    "policyDigestSha256",
    64,
  ).toLowerCase();
  if (policyDigestSha256 !== monitoringPolicy.digestSha256) {
    throw new HttpError(400, "MONITORING_POLICY_MISMATCH", "Native event policy does not match the active policy");
  }

  if (input.type === RISK_SIGNAL_TYPES.nativeCaptureAffinity) {
    const metadata = nativeMetadata;
    if (metadata.protectedFromCapture !== true) {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "Capture-affinity event must report protection");
    }
    return {
      platform: requireBoundedString(metadata.platform, "platform", 32),
      windowId: requireBoundedString(metadata.windowId, "windowId", 64),
      protectedFromCapture: true,
      policyDigestSha256,
    };
  }

  if (input.type === RISK_SIGNAL_TYPES.nativeRemoteSession) {
    const metadata = nativeMetadata;
    if (metadata.remoteSession !== true) {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "Remote-session event must report an active remote session");
    }
    return {
      platform: requireBoundedString(metadata.platform, "platform", 32),
      remoteSession: true,
      policyDigestSha256,
    };
  }

  if (input.type === RISK_SIGNAL_TYPES.nativeDisplayTopologyChange) {
    const metadata = nativeMetadata;
    const previousMonitorCount = requireBoundedInteger(metadata.previousMonitorCount, "previousMonitorCount", 1, 32);
    const monitorCount = requireBoundedInteger(metadata.monitorCount, "monitorCount", 1, 32);
    if (previousMonitorCount === monitorCount) {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "Display topology did not change");
    }
    return {
      platform: requireBoundedString(metadata.platform, "platform", 32),
      previousMonitorCount,
      monitorCount,
      policyDigestSha256,
    };
  }

  if (input.type === RISK_SIGNAL_TYPES.nativeVmSignal) {
    const metadata = nativeMetadata;
    const platform = requireBoundedString(metadata.platform, "platform", 32);
    const detectedSignals = requireArray(metadata.detectedSignals, "detectedSignals");
    if (detectedSignals.length < 1 || detectedSignals.length > 10) {
      throw new HttpError(400, "MONITORING_EVENT_INVALID", "detectedSignals must contain between 1 and 10 entries");
    }
    return {
      platform,
      detectedSignals: detectedSignals.map((candidate) => {
        const signal = requireRecord(candidate);
        return {
          name: requireBoundedString(signal.name, "detected signal name", 64),
          ...(signal.detail === undefined
            ? {}
            : { detail: requireBoundedString(signal.detail, "detected signal detail", 128) }),
        };
      }),
      policyDigestSha256,
    };
  }

  let match;
  try {
    match = createNativeProhibitedApplicationMatch(nativeMetadata);
  } catch (error) {
    throw new HttpError(
      400,
      "MONITORING_EVENT_INVALID",
      error instanceof Error ? error.message : "Prohibited application event metadata is invalid",
    );
  }
  if (!monitoringPolicy.prohibitedApplicationRules.some((rule) => rule.id === match.ruleId)) {
    throw new HttpError(
      400,
      "MONITORING_RULE_NOT_CONFIGURED",
      "Prohibited application event references an unconfigured rule",
    );
  }

  return {
    ruleId: match.ruleId,
    matchKinds: [...match.matchKinds],
    ...(match.executableSha256 ? { executableSha256: match.executableSha256 } : {}),
    policyDigestSha256,
  };
}

function requireTimestampString(value: unknown, fieldName: string): string {
  const timestamp = requireString(value, fieldName);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "MONITORING_EVENT_INVALID", `${fieldName} must be a valid timestamp`);
  }
  return date.toISOString();
}

function requireBoundedDuration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1_000 || (value as number) > 86_400_000) {
    throw new HttpError(
      400,
      "MONITORING_EVENT_INVALID",
      "Focus-loss duration must be between 1000 and 86400000 milliseconds",
    );
  }
  return value as number;
}

function requireBoundedInteger(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HttpError(
      400,
      "MONITORING_EVENT_INVALID",
      `${fieldName} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value as number;
}

function requireBoundedString(value: unknown, fieldName: string, maximumLength: number): string {
  const normalized = requireString(value, fieldName);
  if (normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new HttpError(400, "MONITORING_EVENT_INVALID", `${fieldName} is invalid`);
  }
  return normalized;
}

function parseTimelineLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMELINE_LIMIT) {
    throw new HttpError(400, "BAD_REQUEST", `limit must be between 1 and ${MAX_TIMELINE_LIMIT}`);
  }
  return parsed;
}

function wrapContractError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new HttpError(400, "BAD_REQUEST", error instanceof Error ? error.message : "Invalid monitoring request");
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an array`);
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number") {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a number`);
  }
  return value;
}

type MonitoringConsentRecord = {
  id: string;
  sessionId: string;
  participantId: string;
  policyVersion: string;
  policyDigestSha256: string | null;
  nativeMonitoringPolicy: Prisma.JsonValue | null;
  scopes: Prisma.JsonValue;
  clientInstanceId: string;
  clientVersion: string;
  grantedAt: Date;
  revokedAt: Date | null;
  monitoringStartedAt: Date;
  monitoringStoppedAt: Date | null;
  stopReason: string | null;
  lastSequence: number;
};

function serializeMonitoringStart(consent: MonitoringConsentRecord) {
  return {
    monitoringConsent: serializeMonitoringConsent(consent),
    monitoringPolicy: requireBoundNativeMonitoringPolicy(consent),
  };
}

function serializeMonitoringConsent(consent: MonitoringConsentRecord) {
  return {
    id: consent.id,
    sessionId: consent.sessionId,
    participantId: consent.participantId,
    policyVersion: consent.policyVersion,
    policyDigestSha256: consent.policyDigestSha256,
    scopes: consent.scopes,
    clientInstanceId: consent.clientInstanceId,
    clientVersion: consent.clientVersion,
    grantedAt: consent.grantedAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    monitoringStartedAt: consent.monitoringStartedAt.toISOString(),
    monitoringStoppedAt: consent.monitoringStoppedAt?.toISOString() ?? null,
    stopReason: consent.stopReason,
    lastSequence: consent.lastSequence,
    nextSequence: consent.lastSequence + 1,
  };
}

function serializeHeartbeat(heartbeat: {
  id: string;
  monitoringConsentId: string;
  participantId: string;
  sequence: number;
  occurredAt: Date;
  createdAt: Date;
}) {
  return {
    id: heartbeat.id,
    monitoringConsentId: heartbeat.monitoringConsentId,
    participantId: heartbeat.participantId,
    sequence: heartbeat.sequence,
    occurredAt: heartbeat.occurredAt.toISOString(),
    receivedAt: heartbeat.createdAt.toISOString(),
  };
}

function serializeRiskEvent(riskEvent: {
  id: string;
  monitoringConsentId: string | null;
  participantId: string | null;
  evidenceObjectId: string | null;
  sequence: number | null;
  type: string;
  source: DbMonitoringEventSource;
  confidence: Prisma.Decimal;
  detectorVersion: string;
  occurredAt: Date;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: riskEvent.id,
    monitoringConsentId: riskEvent.monitoringConsentId,
    participantId: riskEvent.participantId,
    evidenceObjectId: riskEvent.evidenceObjectId,
    sequence: riskEvent.sequence,
    type: riskEvent.type,
    source: DB_TO_API_EVENT_SOURCE[riskEvent.source],
    confidence: Number(riskEvent.confidence),
    detectorVersion: riskEvent.detectorVersion,
    occurredAt: riskEvent.occurredAt.toISOString(),
    metadata: riskEvent.metadata,
    receivedAt: riskEvent.createdAt.toISOString(),
  };
}
