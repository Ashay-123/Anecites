import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

import { createPrismaClient } from "@anecites/db";
import { MEDIA_ANALYSIS_MODES, createMediaAnalysisJob } from "@anecites/shared";
import { connect } from "amqplib";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const rabbitmqUrl = process.env.RABBITMQ_URL ?? "amqp://anecites:anecites_dev_password@localhost:5672";
const queueName = process.env.MEDIA_ANALYSIS_QUEUE_NAME ?? "media-analysis.jobs";
const containerName = process.env.MEDIA_INFERENCE_CONTAINER_NAME ?? "anecites-media-inference-1";
const runId = crypto.randomUUID();
const storageKey = `smoke/media-worker-${runId}.mp4`;
const jobId = `media-worker-smoke-${runId}`;
const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
let connection;
let sessionId = null;
let candidateUserId = null;

try {
  const prepared = runInferenceFixture("--prepare");
  const session = await prisma.session.create({
    data: { title: `media-worker-smoke-${runId}` },
  });
  sessionId = session.id;
  const candidate = await prisma.user.create({
    data: {
      email: `media-worker-smoke-${runId}@example.test`,
      displayName: "Media Worker Smoke Candidate",
      role: "CANDIDATE",
    },
  });
  candidateUserId = candidate.id;
  const candidateParticipant = await prisma.participant.create({
    data: {
      sessionId,
      userId: candidate.id,
      role: "CANDIDATE",
      joinedAt: new Date(),
    },
  });
  const evidence = await prisma.evidenceObject.create({
    data: {
      sessionId,
      kind: "SESSION_RECORDING",
      storageBucket: prepared.bucket,
      storageKey: prepared.key,
      contentType: "video/mp4",
      durationMs: prepared.durationMs,
      metadata: {
        livekit: {
          recordingScope: "candidate_track",
          participantId: candidateParticipant.id,
        },
      },
    },
  });
  const job = createMediaAnalysisJob({
    jobId,
    sessionId,
    participantId: candidateParticipant.id,
    recordingEvidenceObjectId: evidence.id,
    requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
    options: {
      sampleWindowMs: 4000,
      maxSamplesPerRecording: 1,
      requestTimeoutMs: 120000,
      confidenceThresholds: {
        secondVoice: 0.8,
        faceMissing: 0.8,
        multipleFaces: 0.8,
        gazeOffscreen: 0.85,
      },
    },
  });

  connection = await connect(rabbitmqUrl);
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(queueName, { durable: true });
  await publishJob(channel, queueName, job);
  const completed = await waitForCompletedRun(jobId, 180000);

  assert(completed.riskSummaryId, "worker completed without the expected no-face risk summary");
  const firstSummaryCount = await prisma.riskSummary.count({ where: { sessionId } });
  assert(firstSummaryCount === 1, `expected one risk summary, received ${firstSummaryCount}`);

  await publishJob(channel, queueName, job);
  await waitForQueueToDrain(channel, queueName, 15000);
  const duplicateSummaryCount = await prisma.riskSummary.count({ where: { sessionId } });
  assert(duplicateSummaryCount === 1, `duplicate delivery created ${duplicateSummaryCount} summaries`);

  await channel.close();
  console.log("RabbitMQ media-worker smoke passed with real MediaPipe inference and idempotent redelivery.");
} finally {
  await connection?.close().catch(() => undefined);
  if (sessionId) {
    await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => undefined);
  }
  if (candidateUserId) {
    await prisma.user.deleteMany({ where: { id: candidateUserId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
  runInferenceFixture("--cleanup", false);
}

async function publishJob(channel, destination, job) {
  channel.sendToQueue(destination, Buffer.from(JSON.stringify(job)), {
    contentType: "application/json",
    persistent: true,
    messageId: job.jobId,
  });
  await channel.waitForConfirms();
}

async function waitForCompletedRun(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.mediaAnalysisJobRun.findUnique({ where: { jobId: id } });
    if (run?.status === "SUCCEEDED") {
      return run;
    }
    await delay(500);
  }
  throw new Error("media-worker did not complete the RabbitMQ job before the smoke timeout");
}

async function waitForQueueToDrain(channel, destination, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const queue = await channel.checkQueue(destination);
    if (queue.messageCount === 0) {
      await delay(500);
      return;
    }
    await delay(250);
  }
  throw new Error("media-worker did not acknowledge the duplicate delivery before the smoke timeout");
}

function runInferenceFixture(action, throwOnFailure = true) {
  const result = spawnSync(
    process.platform === "win32" ? "docker.exe" : "docker",
    [
      "exec",
      "-e",
      `MEDIA_INFERENCE_SMOKE_STORAGE_KEY=${storageKey}`,
      containerName,
      "python",
      "/app/scripts/smoke.py",
      action,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  if (result.status !== 0) {
    if (throwOnFailure) {
      throw new Error(`failed to ${action.slice(2)} the media smoke fixture`);
    }
    return null;
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  return output ? JSON.parse(output) : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
