import { Prisma, type PrismaClient } from "@anecites/db";
import {
  RISK_SIGNAL_TYPES,
  buildCompositeRiskSummary,
  createEditorRiskSignals,
  type RiskSignalInput,
  type RiskSignalType,
} from "@anecites/shared";

import { HttpError } from "./http-error.js";

export interface CreateRiskSummaryRequest {
  sessionId: string;
  participantId?: string | null;
  windowStartedAt: string | Date;
  windowEndedAt: string | Date;
  signals: readonly RiskSignalInput[];
  evidenceObjectId?: string | null;
  evidenceReferences?: readonly RiskEvidenceReference[];
  rationale?: string | null;
}

export interface RiskEvidenceReference {
  kind: "risk_event" | "editor_aggregate" | "media_evidence";
  id: string;
  type?: string;
  source?: string;
  occurredAt: string;
  evidenceObjectId?: string | null;
  documentId?: string;
}

export interface ListRiskSummariesRequest {
  sessionId: string;
  reviewStatus?: RiskSummaryReviewStatus;
}

export interface UpdateRiskSummaryReviewRequest {
  sessionId: string;
  riskSummaryId: string;
  reviewerId: string;
  reviewStatus: RiskSummaryReviewStatus;
  reviewedAt?: string | Date;
}

export interface RecordTrustedRiskSignalsRequest {
  sessionId: string;
  participantId?: string | null;
  source: "EDITOR" | "MEDIA_WORKER" | "SERVER";
  detectorVersion: string;
  signals: readonly RiskSignalInput[];
}

export type RiskSummaryReviewStatus = (typeof RISK_SUMMARY_REVIEW_STATUSES)[number];

export const RISK_SUMMARY_REVIEW_STATUSES = [
  "pending_review",
  "confirmed",
  "dismissed",
  "needs_more_context",
] as const;

const API_TO_DB_REVIEW_STATUS = {
  pending_review: "PENDING_REVIEW",
  confirmed: "CONFIRMED",
  dismissed: "DISMISSED",
  needs_more_context: "NEEDS_MORE_CONTEXT",
} as const satisfies Record<RiskSummaryReviewStatus, string>;

const riskSummarySelect = {
  id: true,
  sessionId: true,
  participantId: true,
  correlationKey: true,
  evidenceObjectId: true,
  windowStartedAt: true,
  windowEndedAt: true,
  score: true,
  correlatedSignalCount: true,
  meetsCorrelationPolicy: true,
  humanReviewRequired: true,
  reviewStatus: true,
  reviewerId: true,
  reviewedAt: true,
  rationale: true,
  signalBreakdown: true,
  evidenceReferences: true,
  createdAt: true,
  updatedAt: true,
} as const;

type RiskSummaryRecord = Prisma.RiskSummaryGetPayload<{
  select: typeof riskSummarySelect;
}>;

type RiskSummaryWriter = Pick<PrismaClient, "session" | "participant" | "riskSummary">;
type RiskCorrelationStore = Pick<
  PrismaClient,
  "session" | "participant" | "riskEvent" | "editorTelemetryAggregate" | "riskSummary"
>;

const CORRELATION_WINDOW_MS = 60_000;
const MAX_CORRELATION_RECORDS_PER_SOURCE = 5_000;
const MAX_EVIDENCE_REFERENCES_PER_WINDOW = 200;
const ALLOWED_RISK_SIGNAL_TYPES = new Set<string>(Object.values(RISK_SIGNAL_TYPES));
const ALLOWED_EVIDENCE_REFERENCE_KINDS = new Set<RiskEvidenceReference["kind"]>([
  "risk_event",
  "editor_aggregate",
  "media_evidence",
]);

export async function createRiskSummary(prisma: RiskSummaryWriter, request: CreateRiskSummaryRequest) {
  const sessionId = requireNonEmptyString(request.sessionId, "sessionId");
  const participantId = normalizeOptionalString(request.participantId);
  const windowStartedAt = parseDate(request.windowStartedAt, "windowStartedAt");
  const windowEndedAt = parseDate(request.windowEndedAt, "windowEndedAt");

  if (windowEndedAt <= windowStartedAt) {
    throw new HttpError(400, "BAD_REQUEST", "windowEndedAt must be after windowStartedAt");
  }

  if (!Array.isArray(request.signals) || request.signals.length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "Risk summary requires at least one signal");
  }

  const compositeSummary = buildCompositeRiskSummaryOrThrow(request.signals);
  const existingSession = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
    },
  });

  if (!existingSession) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }

  if (participantId) {
    const participant = await prisma.participant.findFirst({
      where: {
        id: participantId,
        sessionId,
      },
      select: {
        id: true,
      },
    });
    if (!participant) {
      throw new HttpError(404, "PARTICIPANT_NOT_FOUND", "Participant not found for this session");
    }
  }

  const evidenceReferences = normalizeEvidenceReferences(request.evidenceReferences ?? []);

  const riskSummary = await prisma.riskSummary.create({
    data: {
      sessionId,
      participantId,
      evidenceObjectId: normalizeOptionalString(request.evidenceObjectId),
      windowStartedAt,
      windowEndedAt,
      score: new Prisma.Decimal(compositeSummary.score),
      correlatedSignalCount: compositeSummary.correlatedSignalCount,
      meetsCorrelationPolicy: compositeSummary.meetsCorrelationPolicy,
      humanReviewRequired: compositeSummary.humanReviewRequired,
      rationale: normalizeOptionalString(request.rationale),
      signalBreakdown: compositeSummary.signalBreakdown as unknown as Prisma.InputJsonValue,
      evidenceReferences: evidenceReferences as unknown as Prisma.InputJsonValue,
    },
    select: riskSummarySelect,
  });

  return serializeRiskSummary(riskSummary);
}

export async function listRiskSummaries(prisma: PrismaClient, request: ListRiskSummariesRequest) {
  const sessionId = requireNonEmptyString(request.sessionId, "sessionId");
  const existingSession = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
    },
  });

  if (!existingSession) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }


  await synchronizeCorrelatedRiskSummaries(prisma, sessionId);

  const riskSummaries = await prisma.riskSummary.findMany({
    where: {
      sessionId,
      ...(request.reviewStatus ? { reviewStatus: API_TO_DB_REVIEW_STATUS[request.reviewStatus] } : {}),
    },
    orderBy: [
      {
        windowStartedAt: "desc",
      },
      {
        createdAt: "desc",
      },
      {
        id: "asc",
      },
    ],
    select: riskSummarySelect,
  });

  return riskSummaries.map(serializeRiskSummary);
}

export async function recordTrustedRiskSignals(
  prisma: RiskCorrelationStore,
  request: RecordTrustedRiskSignalsRequest,
) {
  const sessionId = requireNonEmptyString(request.sessionId, "sessionId");
  const participantId = normalizeOptionalString(request.participantId);
  const detectorVersion = requireNonEmptyString(request.detectorVersion, "detectorVersion");
  if (!Array.isArray(request.signals) || request.signals.length === 0) {
    return [];
  }
  const existingSession = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!existingSession) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }
  if (participantId) {
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionId },
      select: { id: true },
    });
    if (!participant) {
      throw new HttpError(404, "PARTICIPANT_NOT_FOUND", "Participant not found for this session");
    }
  }

  for (const signal of request.signals) {
    buildCompositeRiskSummaryOrThrow([signal]);
  }
  await prisma.riskEvent.createMany({
    data: request.signals.map((signal) => ({
      sessionId,
      participantId,
      evidenceObjectId: signal.evidenceObjectId ?? null,
      type: signal.type,
      source: request.source,
      confidence: new Prisma.Decimal(signal.weight),
      detectorVersion,
      occurredAt: new Date(signal.occurredAt),
      ...(signal.metadata
        ? { metadata: signal.metadata as Prisma.InputJsonObject }
        : {}),
    })),
  });

  await synchronizeCorrelatedRiskSummaries(prisma, sessionId);
  const correlationKeys = Array.from(new Set(request.signals.map((signal) => {
    const occurredAt = new Date(signal.occurredAt);
    const windowStartedAtMs = Math.floor(occurredAt.getTime() / CORRELATION_WINDOW_MS) * CORRELATION_WINDOW_MS;
    return `risk-correlation-v1:${sessionId}:${participantId ?? "session"}:${windowStartedAtMs}`;
  })));
  const summaries = await prisma.riskSummary.findMany({
    where: {
      correlationKey: {
        in: correlationKeys,
      },
    },
    orderBy: {
      windowStartedAt: "asc",
    },
    select: riskSummarySelect,
  });
  return summaries.map(serializeRiskSummary);
}

export async function synchronizeCorrelatedRiskSummaries(
  prisma: RiskCorrelationStore,
  rawSessionId: string,
): Promise<void> {
  const sessionId = requireNonEmptyString(rawSessionId, "sessionId");
  const existingSession = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
    },
  });
  if (!existingSession) {
    throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found");
  }

  const [riskEvents, editorAggregates] = await Promise.all([
    prisma.riskEvent.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        occurredAt: "desc",
      },
      take: MAX_CORRELATION_RECORDS_PER_SOURCE,
      select: {
        id: true,
        participantId: true,
        evidenceObjectId: true,
        type: true,
        source: true,
        confidence: true,
        occurredAt: true,
      },
    }),
    prisma.editorTelemetryAggregate.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        windowStartedAt: "desc",
      },
      take: MAX_CORRELATION_RECORDS_PER_SOURCE,
      select: {
        id: true,
        sessionId: true,
        participantId: true,
        documentId: true,
        windowStartedAt: true,
        windowEndedAt: true,
        insertEventCount: true,
        deleteEventCount: true,
        pasteBlockedCount: true,
        atomicInsertCount: true,
        maxInsertSize: true,
      },
    }),
  ]);

  const windows = new Map<string, CorrelationWindow>();
  for (const riskEvent of riskEvents) {
    if (!isRiskSignalType(riskEvent.type)) {
      continue;
    }
    const occurredAt = riskEvent.occurredAt.toISOString();
    const window = getOrCreateCorrelationWindow(
      windows,
      sessionId,
      riskEvent.participantId,
      riskEvent.occurredAt,
    );
    window.signals.push({
      type: riskEvent.type,
      weight: Number(riskEvent.confidence),
      occurredAt,
      ...(riskEvent.evidenceObjectId ? { evidenceObjectId: riskEvent.evidenceObjectId } : {}),
    });
    pushEvidenceReference(window, {
      kind: "risk_event",
      id: riskEvent.id,
      type: riskEvent.type,
      source: riskEvent.source.toLowerCase(),
      occurredAt,
      evidenceObjectId: riskEvent.evidenceObjectId,
    });
  }

  for (const aggregate of editorAggregates) {
    if (!aggregate.participantId) {
      continue;
    }
    const signals = createEditorRiskSignals({
      sessionId: aggregate.sessionId,
      participantId: aggregate.participantId,
      documentId: aggregate.documentId,
      windowStartedAt: aggregate.windowStartedAt.toISOString(),
      windowEndedAt: aggregate.windowEndedAt.toISOString(),
      insertEventCount: aggregate.insertEventCount,
      deleteEventCount: aggregate.deleteEventCount,
      pasteBlockedCount: aggregate.pasteBlockedCount,
      atomicInsertCount: aggregate.atomicInsertCount,
      maxInsertSize: aggregate.maxInsertSize,
    });
    if (signals.length === 0) {
      continue;
    }
    const window = getOrCreateCorrelationWindow(
      windows,
      sessionId,
      aggregate.participantId,
      aggregate.windowEndedAt,
    );
    window.signals.push(...signals);
    pushEvidenceReference(window, {
      kind: "editor_aggregate",
      id: aggregate.id,
      occurredAt: aggregate.windowEndedAt.toISOString(),
      documentId: aggregate.documentId,
    });
  }

  for (const window of windows.values()) {
    if (window.signals.length === 0) {
      continue;
    }
    const compositeSummary = buildCompositeRiskSummaryOrThrow(window.signals);
    const rationale = createCorrelationRationale(compositeSummary.signalBreakdown.map((entry) => entry.category));
    const evidenceObjectId = window.signals.find((signal) => signal.evidenceObjectId)?.evidenceObjectId ?? null;
    const existing = await prisma.riskSummary.findUnique({
      where: {
        correlationKey: window.correlationKey,
      },
      select: {
        reviewStatus: true,
        evidenceReferences: true,
      },
    });
    const evidenceChanged = countJsonArray(existing?.evidenceReferences) !== window.evidenceReferences.length;
    const reviewNeedsContext = Boolean(
      existing && existing.reviewStatus !== "PENDING_REVIEW" && evidenceChanged,
    );
    const updateReviewFields = reviewNeedsContext
      ? {
          reviewStatus: "NEEDS_MORE_CONTEXT" as const,
          reviewerId: null,
          reviewedAt: null,
        }
      : {};

    await prisma.riskSummary.upsert({
      where: {
        correlationKey: window.correlationKey,
      },
      create: {
        sessionId,
        participantId: window.participantId,
        correlationKey: window.correlationKey,
        evidenceObjectId,
        windowStartedAt: window.windowStartedAt,
        windowEndedAt: window.windowEndedAt,
        score: new Prisma.Decimal(compositeSummary.score),
        correlatedSignalCount: compositeSummary.correlatedSignalCount,
        meetsCorrelationPolicy: compositeSummary.meetsCorrelationPolicy,
        humanReviewRequired: compositeSummary.humanReviewRequired,
        rationale,
        signalBreakdown: compositeSummary.signalBreakdown as unknown as Prisma.InputJsonValue,
        evidenceReferences: window.evidenceReferences as unknown as Prisma.InputJsonValue,
      },
      update: {
        evidenceObjectId,
        score: new Prisma.Decimal(compositeSummary.score),
        correlatedSignalCount: compositeSummary.correlatedSignalCount,
        meetsCorrelationPolicy: compositeSummary.meetsCorrelationPolicy,
        humanReviewRequired: compositeSummary.humanReviewRequired,
        rationale,
        signalBreakdown: compositeSummary.signalBreakdown as unknown as Prisma.InputJsonValue,
        evidenceReferences: window.evidenceReferences as unknown as Prisma.InputJsonValue,
        ...updateReviewFields,
      },
    });
  }
}

export async function updateRiskSummaryReview(prisma: PrismaClient, request: UpdateRiskSummaryReviewRequest) {
  const sessionId = requireNonEmptyString(request.sessionId, "sessionId");
  const riskSummaryId = requireNonEmptyString(request.riskSummaryId, "riskSummaryId");
  const reviewerId = requireNonEmptyString(request.reviewerId, "reviewerId");
  const reviewedAt = request.reviewedAt ? parseDate(request.reviewedAt, "reviewedAt") : new Date();

  const existingRiskSummary = await prisma.riskSummary.findUnique({
    where: {
      id: riskSummaryId,
    },
    select: {
      id: true,
      sessionId: true,
    },
  });

  if (!existingRiskSummary || existingRiskSummary.sessionId !== sessionId) {
    throw new HttpError(404, "RISK_SUMMARY_NOT_FOUND", "Risk summary not found");
  }

  const reviewer = await prisma.user.findUnique({
    where: {
      id: reviewerId,
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (!reviewer || !isPrivilegedDbUserRole(reviewer.role)) {
    throw new HttpError(403, "FORBIDDEN", "Reviewer access is required");
  }

  const riskSummary = await prisma.riskSummary.update({
    where: {
      id: riskSummaryId,
    },
    data: {
      reviewStatus: API_TO_DB_REVIEW_STATUS[request.reviewStatus],
      reviewerId,
      reviewedAt,
    },
    select: riskSummarySelect,
  });

  return serializeRiskSummary(riskSummary);
}

export function isRiskSummaryReviewStatus(value: unknown): value is RiskSummaryReviewStatus {
  return typeof value === "string" && (RISK_SUMMARY_REVIEW_STATUSES as readonly string[]).includes(value);
}

function isPrivilegedDbUserRole(role: string): boolean {
  return role === "INTERVIEWER" || role === "REVIEWER" || role === "ADMIN";
}

function buildCompositeRiskSummaryOrThrow(signals: readonly RiskSignalInput[]) {
  try {
    return buildCompositeRiskSummary(signals);
  } catch (error) {
    throw new HttpError(
      400,
      "INVALID_RISK_SIGNAL",
      error instanceof Error ? error.message : "Risk signal is invalid",
    );
  }
}

function serializeRiskSummary(riskSummary: RiskSummaryRecord) {
  return {
    id: riskSummary.id,
    sessionId: riskSummary.sessionId,
    participantId: riskSummary.participantId,
    evidenceObjectId: riskSummary.evidenceObjectId,
    windowStartedAt: riskSummary.windowStartedAt.toISOString(),
    windowEndedAt: riskSummary.windowEndedAt.toISOString(),
    score: Number(riskSummary.score),
    correlatedSignalCount: riskSummary.correlatedSignalCount,
    meetsCorrelationPolicy: riskSummary.meetsCorrelationPolicy,
    humanReviewRequired: riskSummary.humanReviewRequired,
    reviewStatus: riskSummary.reviewStatus.toLowerCase(),
    reviewerId: riskSummary.reviewerId,
    reviewedAt: serializeOptionalDate(riskSummary.reviewedAt),
    rationale: riskSummary.rationale,
    signalBreakdown: riskSummary.signalBreakdown,
    evidenceReferences: riskSummary.evidenceReferences,
    createdAt: riskSummary.createdAt.toISOString(),
    updatedAt: riskSummary.updatedAt.toISOString(),
  };
}

interface CorrelationWindow {
  participantId: string | null;
  correlationKey: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
  signals: RiskSignalInput[];
  evidenceReferences: RiskEvidenceReference[];
}

function getOrCreateCorrelationWindow(
  windows: Map<string, CorrelationWindow>,
  sessionId: string,
  participantId: string | null,
  occurredAt: Date,
): CorrelationWindow {
  const windowStartedAtMs = Math.floor(occurredAt.getTime() / CORRELATION_WINDOW_MS) * CORRELATION_WINDOW_MS;
  const correlationKey = `risk-correlation-v1:${sessionId}:${participantId ?? "session"}:${windowStartedAtMs}`;
  const existing = windows.get(correlationKey);
  if (existing) {
    return existing;
  }
  const window = {
    participantId,
    correlationKey,
    windowStartedAt: new Date(windowStartedAtMs),
    windowEndedAt: new Date(windowStartedAtMs + CORRELATION_WINDOW_MS),
    signals: [],
    evidenceReferences: [],
  } satisfies CorrelationWindow;
  windows.set(correlationKey, window);
  return window;
}

function pushEvidenceReference(window: CorrelationWindow, reference: RiskEvidenceReference): void {
  if (
    window.evidenceReferences.length >= MAX_EVIDENCE_REFERENCES_PER_WINDOW ||
    window.evidenceReferences.some((existing) => existing.kind === reference.kind && existing.id === reference.id)
  ) {
    return;
  }
  window.evidenceReferences.push(reference);
}

function isRiskSignalType(value: string): value is RiskSignalType {
  return ALLOWED_RISK_SIGNAL_TYPES.has(value);
}

function createCorrelationRationale(categories: readonly string[]): string {
  const categoryList = categories.join(", ");
  if (categories.length < 2) {
    return `Single ${categoryList} signal family requires contextual human review; no automatic adverse action is allowed.`;
  }
  return `Correlated ${categoryList} signal families require human review; no automatic adverse action is allowed.`;
}

function normalizeEvidenceReferences(
  references: readonly RiskEvidenceReference[],
): RiskEvidenceReference[] {
  if (!Array.isArray(references) || references.length > MAX_EVIDENCE_REFERENCES_PER_WINDOW) {
    throw new HttpError(400, "BAD_REQUEST", "evidenceReferences is invalid");
  }
  return references.map((reference) => {
    if (!ALLOWED_EVIDENCE_REFERENCE_KINDS.has(reference.kind)) {
      throw new HttpError(400, "BAD_REQUEST", "evidence reference kind is invalid");
    }
    return {
      kind: reference.kind,
      id: requireNonEmptyString(reference.id, "evidence reference id"),
      ...(reference.type ? { type: requireNonEmptyString(reference.type, "evidence reference type") } : {}),
      ...(reference.source ? { source: requireNonEmptyString(reference.source, "evidence reference source") } : {}),
      occurredAt: parseDate(reference.occurredAt, "evidence reference occurredAt").toISOString(),
      ...(reference.evidenceObjectId !== undefined
        ? { evidenceObjectId: normalizeOptionalString(reference.evidenceObjectId) }
        : {}),
      ...(reference.documentId
        ? { documentId: requireNonEmptyString(reference.documentId, "evidence reference documentId") }
        : {}),
    };
  });
}

function countJsonArray(value: Prisma.JsonValue | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

function serializeOptionalDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseDate(value: string | Date, fieldName: string): Date {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be an ISO timestamp`);
  }

  return date;
}

function requireNonEmptyString(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", `${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
