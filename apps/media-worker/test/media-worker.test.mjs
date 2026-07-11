import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaClient } from "@anecites/db";
import {
  MEDIA_ANALYSIS_MODES,
  createMediaAnalysisJob,
  RISK_SIGNAL_TYPES,
} from "@anecites/shared";
import {
  MediaWorkerError,
  processMediaAnalysisJob,
} from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const testRunId = `media-worker-${Date.now()}`;

test("processMediaAnalysisJob loads recording evidence and sends bounded requests to injected adapters", async (t) => {
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
  const audioRequests = [];
  const videoRequests = [];
  const adapters = {
    audio: {
      async analyzeSecondVoice(request) {
        audioRequests.push(request);
        return [
          {
            kind: "second_voice",
            confidence: 0.91,
            durationMs: 4100,
            sampleStartedAt: "2026-07-11T00:00:00.000Z",
            sampleEndedAt: "2026-07-11T00:00:04.100Z",
            adapterVersion: "test-audio-v1",
            speakerCount: 2,
            rawTranscript: "must-not-be-copied",
          },
        ];
      },
    },
    video: {
      async analyzeVideo(request) {
        videoRequests.push(request);
        return [
          {
            kind: "face_missing",
            confidence: 0.89,
            durationMs: 3500,
            sampleStartedAt: "2026-07-11T00:00:05.000Z",
            sampleEndedAt: "2026-07-11T00:00:08.500Z",
            adapterVersion: "test-video-v1",
            rawFrame: "must-not-be-copied",
          },
        ];
      },
    },
  };

  const job = createMediaAnalysisJob({
    sessionId: session.id,
    recordingEvidenceObjectId: evidence.id,
    requestedModes: [
      MEDIA_ANALYSIS_MODES.audioSecondVoice,
      MEDIA_ANALYSIS_MODES.videoFacePresence,
    ],
    options: validOptions(),
  });

  const result = await processMediaAnalysisJob({
    prisma,
    job,
    adapters,
    now: () => new Date("2026-07-11T00:01:00.000Z"),
  });

  assert.equal(audioRequests.length, 1);
  assert.equal(videoRequests.length, 1);
  assert.deepEqual(audioRequests[0], {
    sessionId: session.id,
    recordingEvidenceObjectId: evidence.id,
    storageBucket: "anecites-dev",
    storageKey: `recordings/${testRunId}-bounded.mp4`,
    contentType: "video/mp4",
    durationMs: 60000,
    sampleWindowMs: 10000,
    maxSamplesPerRecording: 12,
    requestTimeoutMs: 30000,
    confidenceThresholds: {
      secondVoice: 0.8,
      faceMissing: 0.8,
      multipleFaces: 0.8,
      gazeOffscreen: 0.85,
    },
  });
  assert.deepEqual(videoRequests[0], {
    ...audioRequests[0],
    requestedModes: [
      MEDIA_ANALYSIS_MODES.videoFacePresence,
    ],
  });

  assert.equal(result.report.evidenceObjectId, evidence.id);
  assert.equal(result.riskSignals.length, 2);
  assert.deepEqual(
    result.riskSignals.map((signal) => signal.type),
    [
      RISK_SIGNAL_TYPES.mediaSecondVoice,
      RISK_SIGNAL_TYPES.mediaFaceMissing,
    ],
  );

  const persistedEvidence = await prisma.evidenceObject.findMany({
    where: {
      sessionId: session.id,
    },
  });
  assert.equal(persistedEvidence.length, 1);
  assert.equal(JSON.stringify(result).includes("rawTranscript"), false);
  assert.equal(JSON.stringify(result).includes("rawFrame"), false);
});

test("processMediaAnalysisJob rejects missing or wrong-kind recording evidence", async (t) => {
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

  const { session } = await createRecordingEvidence(prisma, "missing");
  await assert.rejects(
    () =>
      processMediaAnalysisJob({
        prisma,
        job: createMediaAnalysisJob({
          sessionId: session.id,
          recordingEvidenceObjectId: "missing-evidence",
          requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
          options: validOptions(),
        }),
        adapters: emptyAdapters(),
      }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_EVIDENCE_NOT_FOUND",
  );

  const wrongKind = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "CODE_OUTPUT",
      storageBucket: "anecites-dev",
      storageKey: `code-output/${testRunId}.txt`,
      contentType: "text/plain",
    },
  });

  await assert.rejects(
    () =>
      processMediaAnalysisJob({
        prisma,
        job: createMediaAnalysisJob({
          sessionId: session.id,
          recordingEvidenceObjectId: wrongKind.id,
          requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
          options: validOptions(),
        }),
        adapters: emptyAdapters(),
      }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_EVIDENCE_INVALID",
  );
});

test("processMediaAnalysisJob fails closed on adapter timeout and malformed adapter output", async (t) => {
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

  const { session, evidence } = await createRecordingEvidence(prisma, "adapter-failures");
  const job = createMediaAnalysisJob({
    sessionId: session.id,
    recordingEvidenceObjectId: evidence.id,
    requestedModes: [MEDIA_ANALYSIS_MODES.audioSecondVoice],
    options: {
      ...validOptions(),
      requestTimeoutMs: 5,
    },
  });

  await assert.rejects(
    () =>
      processMediaAnalysisJob({
        prisma,
        job,
        adapters: {
          audio: {
            async analyzeSecondVoice() {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return [];
            },
          },
        },
      }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_TIMEOUT",
  );

  await assert.rejects(
    () =>
      processMediaAnalysisJob({
        prisma,
        job: {
          ...job,
          options: validOptions(),
        },
        adapters: {
          audio: {
            async analyzeSecondVoice() {
              return [
                {
                  kind: "second_voice",
                  confidence: 1.5,
                  durationMs: 4100,
                  sampleStartedAt: "2026-07-11T00:00:00.000Z",
                  sampleEndedAt: "2026-07-11T00:00:04.100Z",
                  adapterVersion: "bad-audio-v1",
                  speakerCount: 2,
                },
              ];
            },
          },
        },
      }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_ADAPTER_INVALID_RESPONSE",
  );
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

function emptyAdapters() {
  return {};
}
