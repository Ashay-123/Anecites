import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaClient } from "@anecites/db";
import { RISK_SIGNAL_TYPES } from "@anecites/shared";
import { createRiskSummary, listRiskSummaries, updateRiskSummaryReview } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const testRunId = `risk-summaries-${Date.now()}`;

test("createRiskSummary persists a composite human-reviewed risk summary", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: testRunId,
        },
      },
    });
    await prisma.$disconnect();
  });

  const session = await prisma.session.create({
    data: {
      title: `${testRunId} composite risk`,
    },
  });

  const summary = await createRiskSummary(prisma, {
    sessionId: session.id,
    windowStartedAt: "2026-07-11T00:00:00.000Z",
    windowEndedAt: "2026-07-11T00:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.editorAtomicInsert,
        weight: 0.8,
        occurredAt: "2026-07-11T00:00:10.000Z",
      },
      {
        type: RISK_SIGNAL_TYPES.timingLagLoop,
        weight: 0.6,
        occurredAt: "2026-07-11T00:00:30.000Z",
      },
    ],
  });

  assert.equal(summary.sessionId, session.id);
  assert.equal(summary.score, 0.7);
  assert.equal(summary.correlatedSignalCount, 2);
  assert.equal(summary.humanReviewRequired, true);
  assert.equal(summary.reviewStatus, "pending_review");
  assert.equal(summary.windowStartedAt, "2026-07-11T00:00:00.000Z");
  assert.equal(summary.windowEndedAt, "2026-07-11T00:01:00.000Z");
  assert.deepEqual(summary.signalBreakdown, [
    {
      category: "editor",
      count: 1,
      maxWeight: 0.8,
      types: [RISK_SIGNAL_TYPES.editorAtomicInsert],
    },
    {
      category: "timing",
      count: 1,
      maxWeight: 0.6,
      types: [RISK_SIGNAL_TYPES.timingLagLoop],
    },
  ]);

  const persisted = await prisma.riskSummary.findUniqueOrThrow({
    where: {
      id: summary.id,
    },
  });
  assert.equal(Number(persisted.score), 0.7);
  assert.equal(persisted.humanReviewRequired, true);
  assert.equal(persisted.reviewStatus, "PENDING_REVIEW");
});

test("createRiskSummary rejects missing sessions and invalid summary input", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.$disconnect();
  });

  await assert.rejects(
    () =>
      createRiskSummary(prisma, {
        sessionId: "missing-session",
        windowStartedAt: "2026-07-11T00:00:00.000Z",
        windowEndedAt: "2026-07-11T00:01:00.000Z",
        signals: [
          {
            type: RISK_SIGNAL_TYPES.nativeVmSignal,
            weight: 0.5,
            occurredAt: "2026-07-11T00:00:10.000Z",
          },
        ],
      }),
    /Session not found/,
  );

  await assert.rejects(
    () =>
      createRiskSummary(prisma, {
        sessionId: "missing-session",
        windowStartedAt: "2026-07-11T00:00:00.000Z",
        windowEndedAt: "2026-07-11T00:01:00.000Z",
        signals: [],
      }),
    /Risk summary requires at least one signal/,
  );

  await assert.rejects(
    () =>
      createRiskSummary(prisma, {
        sessionId: "missing-session",
        windowStartedAt: "2026-07-11T00:01:00.000Z",
        windowEndedAt: "2026-07-11T00:00:00.000Z",
        signals: [
          {
            type: RISK_SIGNAL_TYPES.nativeVmSignal,
            weight: 0.5,
            occurredAt: "2026-07-11T00:00:10.000Z",
          },
        ],
      }),
    /windowEndedAt must be after windowStartedAt/,
  );
});

test("listRiskSummaries filters by review status", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: `${testRunId}-risk-list`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-risk-list interview`,
    },
  });

  const pendingSummary = await createRiskSummary(prisma, {
    sessionId: session.id,
    windowStartedAt: "2026-07-11T00:00:00.000Z",
    windowEndedAt: "2026-07-11T00:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.editorAtomicInsert,
        weight: 0.8,
        occurredAt: "2026-07-11T00:00:10.000Z",
      },
    ],
  });
  const confirmedSummary = await createRiskSummary(prisma, {
    sessionId: session.id,
    windowStartedAt: "2026-07-11T00:02:00.000Z",
    windowEndedAt: "2026-07-11T00:03:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.timingLagLoop,
        weight: 0.6,
        occurredAt: "2026-07-11T00:02:10.000Z",
      },
    ],
  });
  await prisma.riskSummary.update({
    where: {
      id: confirmedSummary.id,
    },
    data: {
      reviewStatus: "CONFIRMED",
    },
  });

  const pendingSummaries = await listRiskSummaries(prisma, {
    sessionId: session.id,
    reviewStatus: "pending_review",
  });

  assert.deepEqual(
    pendingSummaries.map((summary) => summary.id),
    [pendingSummary.id],
  );
});

test("updateRiskSummaryReview persists reviewer identity and timestamp", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: `${testRunId}-risk-review-update`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.risk-review-update.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const reviewer = await prisma.user.create({
    data: {
      email: `reviewer.risk-review-update.${testRunId}@example.test`,
      displayName: "Risk Reviewer",
      role: "REVIEWER",
    },
  });
  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-risk-review-update interview`,
    },
  });
  const summary = await createRiskSummary(prisma, {
    sessionId: session.id,
    windowStartedAt: "2026-07-11T00:00:00.000Z",
    windowEndedAt: "2026-07-11T00:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: 0.5,
        occurredAt: "2026-07-11T00:00:30.000Z",
      },
    ],
  });

  const reviewed = await updateRiskSummaryReview(prisma, {
    sessionId: session.id,
    riskSummaryId: summary.id,
    reviewerId: reviewer.id,
    reviewStatus: "confirmed",
    reviewedAt: "2026-07-11T00:05:00.000Z",
  });

  assert.equal(reviewed.id, summary.id);
  assert.equal(reviewed.reviewStatus, "confirmed");
  assert.equal(reviewed.reviewerId, reviewer.id);
  assert.equal(reviewed.reviewedAt, "2026-07-11T00:05:00.000Z");
  assert.equal(reviewed.score, summary.score);
  assert.deepEqual(reviewed.signalBreakdown, summary.signalBreakdown);

  const persisted = await prisma.riskSummary.findUniqueOrThrow({
    where: {
      id: summary.id,
    },
  });
  assert.equal(persisted.reviewStatus, "CONFIRMED");
  assert.equal(persisted.reviewerId, reviewer.id);
  assert.equal(persisted.reviewedAt?.toISOString(), "2026-07-11T00:05:00.000Z");
});

test("updateRiskSummaryReview rejects non-privileged reviewers and mismatched sessions", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: {
        title: {
          startsWith: `${testRunId}-risk-review-reject`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.risk-review-reject.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const candidate = await prisma.user.create({
    data: {
      email: `candidate.risk-review-reject.${testRunId}@example.test`,
      displayName: "Candidate Reviewer",
      role: "CANDIDATE",
    },
  });
  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-risk-review-reject interview`,
    },
  });
  const otherSession = await prisma.session.create({
    data: {
      title: `${testRunId}-risk-review-reject other interview`,
    },
  });
  const summary = await createRiskSummary(prisma, {
    sessionId: session.id,
    windowStartedAt: "2026-07-11T00:00:00.000Z",
    windowEndedAt: "2026-07-11T00:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: 0.5,
        occurredAt: "2026-07-11T00:00:30.000Z",
      },
    ],
  });

  await assert.rejects(
    () =>
      updateRiskSummaryReview(prisma, {
        sessionId: session.id,
        riskSummaryId: summary.id,
        reviewerId: candidate.id,
        reviewStatus: "dismissed",
      }),
    /Reviewer access is required/,
  );

  await assert.rejects(
    () =>
      updateRiskSummaryReview(prisma, {
        sessionId: otherSession.id,
        riskSummaryId: summary.id,
        reviewerId: candidate.id,
        reviewStatus: "dismissed",
      }),
    /Risk summary not found/,
  );
});
