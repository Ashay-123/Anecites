import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaClient } from "@anecites/db";
import {
  MEDIA_ANALYSIS_MODES,
  RISK_SIGNAL_TYPES,
  createMediaAnalysisJob,
} from "@anecites/shared";
import { processMediaAnalysisJob } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const testRunId = `media-summary-${Date.now()}`;

test("processMediaAnalysisJob persists media-derived pending-review risk summaries", async (t) => {
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

  const { session, evidence } = await createRecordingEvidence(prisma, "signals");
  const result = await processMediaAnalysisJob({
    prisma,
    job: createMediaAnalysisJob({
      sessionId: session.id,
      recordingEvidenceObjectId: evidence.id,
      requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
      options: validOptions(),
    }),
    adapters: {
      audio: {
        async analyzeSecondVoice() {
          return [
            {
              kind: "second_voice",
              confidence: 0.91,
              durationMs: 4200,
              sampleStartedAt: "2026-07-11T00:00:01.000Z",
              sampleEndedAt: "2026-07-11T00:00:05.200Z",
              adapterVersion: "summary-audio-v1",
              speakerCount: 2,
              transcript: "must-not-be-persisted",
            },
          ];
        },
      },
    },
    now: () => new Date("2026-07-11T00:01:00.000Z"),
  });

  assert.equal(result.riskSignals.length, 1);
  assert.equal(result.riskSignals[0].type, RISK_SIGNAL_TYPES.mediaSecondVoice);
  assert.equal(result.riskSummary.evidenceObjectId, evidence.id);
  assert.equal(result.riskSummary.reviewStatus, "pending_review");
  assert.equal(result.riskSummary.humanReviewRequired, true);
  assert.equal(result.riskSummary.correlatedSignalCount, 1);
  assert.deepEqual(result.riskSummary.signalBreakdown, [
    {
      category: "media",
      count: 1,
      maxWeight: 0.855,
      types: [RISK_SIGNAL_TYPES.mediaSecondVoice],
    },
  ]);
  assert.equal(result.riskSummary.windowStartedAt, "2026-07-11T00:00:01.000Z");
  assert.equal(result.riskSummary.windowEndedAt, "2026-07-11T00:00:05.200Z");

  const persistedSummary = await prisma.riskSummary.findUniqueOrThrow({
    where: {
      id: result.riskSummary.id,
    },
  });
  assert.equal(persistedSummary.evidenceObjectId, evidence.id);
  assert.equal(persistedSummary.reviewStatus, "PENDING_REVIEW");
  assert.equal(persistedSummary.humanReviewRequired, true);
  assert.equal(JSON.stringify(persistedSummary).includes("transcript"), false);
  assert.equal(JSON.stringify(persistedSummary).includes("rawFrame"), false);
});

test("processMediaAnalysisJob does not persist empty risk summaries for clean media reports", async (t) => {
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

  const { session, evidence } = await createRecordingEvidence(prisma, "clean");
  const result = await processMediaAnalysisJob({
    prisma,
    job: createMediaAnalysisJob({
      sessionId: session.id,
      recordingEvidenceObjectId: evidence.id,
      requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
      options: validOptions(),
    }),
    adapters: {
      audio: {
        async analyzeSecondVoice() {
          return [];
        },
      },
    },
    now: () => new Date("2026-07-11T00:01:00.000Z"),
  });

  assert.equal(result.riskSignals.length, 0);
  assert.equal(result.riskSummary, null);

  const persistedSummaries = await prisma.riskSummary.findMany({
    where: {
      sessionId: session.id,
    },
  });
  assert.deepEqual(persistedSummaries, []);
});

test("processMediaAnalysisJob preserves evidence links without persisting raw media payloads", async (t) => {
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

  const { session, evidence } = await createRecordingEvidence(prisma, "bounded");
  const result = await processMediaAnalysisJob({
    prisma,
    job: createMediaAnalysisJob({
      sessionId: session.id,
      recordingEvidenceObjectId: evidence.id,
      requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
      options: validOptions(),
    }),
    adapters: {
      video: {
        async analyzeVideo() {
          return [
            {
              kind: "multiple_faces",
              confidence: 0.9,
              durationMs: 1600,
              sampleStartedAt: "2026-07-11T00:00:10.000Z",
              sampleEndedAt: "2026-07-11T00:00:11.600Z",
              adapterVersion: "summary-video-v1",
              faceCount: 2,
              rawFrame: "must-not-be-persisted",
              landmarks: [1, 2, 3],
            },
          ];
        },
      },
    },
    now: () => new Date("2026-07-11T00:01:00.000Z"),
  });

  assert.equal(result.riskSummary.evidenceObjectId, evidence.id);
  assert.equal(result.riskSummary.humanReviewRequired, true);
  assert.equal(result.riskSummary.reviewStatus, "pending_review");

  const serializedSummary = JSON.stringify(result.riskSummary);
  assert.equal(serializedSummary.includes("rawFrame"), false);
  assert.equal(serializedSummary.includes("landmarks"), false);
  assert.equal(serializedSummary.includes("storageKey"), false);
});

async function createRecordingEvidence(prisma, suffix) {
  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-${suffix} interview`,
    },
  });
  const evidence = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-dev",
      storageKey: `recordings/${testRunId}-${suffix}.mp4`,
      contentType: "video/mp4",
      durationMs: 60000,
    },
  });

  return { session, evidence };
}

function validOptions() {
  return {
    sampleWindowMs: 10000,
    maxSamplesPerRecording: 12,
    requestTimeoutMs: 30000,
    confidenceThresholds: {
      secondVoice: 0.8,
      faceMissing: 0.8,
      multipleFaces: 0.8,
      gazeOffscreen: 0.85,
    },
  };
}
