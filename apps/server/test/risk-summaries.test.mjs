import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaClient } from "@anecites/db";
import { RISK_SIGNAL_TYPES } from "@anecites/shared";
import { createRiskSummary } from "../dist/index.js";

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
