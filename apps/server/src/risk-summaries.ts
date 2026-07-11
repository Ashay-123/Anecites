import { Prisma, type PrismaClient } from "@anecites/db";
import { buildCompositeRiskSummary, type RiskSignalInput } from "@anecites/shared";

import { HttpError } from "./http-error.js";

export interface CreateRiskSummaryRequest {
  sessionId: string;
  windowStartedAt: string | Date;
  windowEndedAt: string | Date;
  signals: readonly RiskSignalInput[];
  evidenceObjectId?: string | null;
  rationale?: string | null;
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
  evidenceObjectId: true,
  windowStartedAt: true,
  windowEndedAt: true,
  score: true,
  correlatedSignalCount: true,
  humanReviewRequired: true,
  reviewStatus: true,
  reviewerId: true,
  reviewedAt: true,
  rationale: true,
  signalBreakdown: true,
  createdAt: true,
  updatedAt: true,
} as const;

type RiskSummaryRecord = Prisma.RiskSummaryGetPayload<{
  select: typeof riskSummarySelect;
}>;

export async function createRiskSummary(prisma: PrismaClient, request: CreateRiskSummaryRequest) {
  const sessionId = requireNonEmptyString(request.sessionId, "sessionId");
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

  const riskSummary = await prisma.riskSummary.create({
    data: {
      sessionId,
      evidenceObjectId: normalizeOptionalString(request.evidenceObjectId),
      windowStartedAt,
      windowEndedAt,
      score: new Prisma.Decimal(compositeSummary.score),
      correlatedSignalCount: compositeSummary.correlatedSignalCount,
      humanReviewRequired: compositeSummary.humanReviewRequired,
      rationale: normalizeOptionalString(request.rationale),
      signalBreakdown: compositeSummary.signalBreakdown as unknown as Prisma.InputJsonValue,
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
    evidenceObjectId: riskSummary.evidenceObjectId,
    windowStartedAt: riskSummary.windowStartedAt.toISOString(),
    windowEndedAt: riskSummary.windowEndedAt.toISOString(),
    score: Number(riskSummary.score),
    correlatedSignalCount: riskSummary.correlatedSignalCount,
    humanReviewRequired: riskSummary.humanReviewRequired,
    reviewStatus: riskSummary.reviewStatus.toLowerCase(),
    reviewerId: riskSummary.reviewerId,
    reviewedAt: serializeOptionalDate(riskSummary.reviewedAt),
    rationale: riskSummary.rationale,
    signalBreakdown: riskSummary.signalBreakdown,
    createdAt: riskSummary.createdAt.toISOString(),
    updatedAt: riskSummary.updatedAt.toISOString(),
  };
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
