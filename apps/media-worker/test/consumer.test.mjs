import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaClient } from "@anecites/db";
import { MEDIA_ANALYSIS_MODES, createMediaAnalysisJob } from "@anecites/shared";
import {
  MediaWorkerError,
  processMediaAnalysisQueueJob,
  startMediaAnalysisConsumer,
} from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const testRunId = `media-consumer-${Date.now()}`;

test("consumer acknowledges a successfully processed job", async () => {
  const channel = new FakeChannel();
  const processed = [];
  const consumer = await startConsumer(channel, async (job) => {
    processed.push(job);
  });

  await channel.deliver(message(validJob("success")));

  assert.equal(processed.length, 1);
  assert.equal(channel.acked.length, 1);
  assert.equal(channel.nacked.length, 0);
  assert.equal(channel.published.length, 0);
  await consumer.stop();
});

test("consumer confirm-publishes transient failures to the delayed retry queue before acknowledging", async () => {
  const channel = new FakeChannel();
  const consumer = await startConsumer(channel, async () => {
    throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "private timeout detail");
  });

  await channel.deliver(message(validJob("retry")));

  assert.equal(channel.published.length, 1);
  assert.equal(channel.published[0].queue, "media-analysis.jobs.retry");
  assert.equal(channel.published[0].options.headers["x-anecites-retry-count"], 1);
  assert.equal(channel.confirmCount, 1);
  assert.equal(channel.acked.length, 1);
  assert.equal(channel.nacked.length, 0);
  await consumer.stop();
});

test("consumer dead-letters invalid jobs and exhausted retries without leaking error details", async () => {
  const channel = new FakeChannel();
  const consumer = await startConsumer(channel, async () => {
    throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "secret upstream response");
  });

  await channel.deliver(message(validJob("exhausted"), 2));
  await channel.deliver(messageBuffer(Buffer.from("not-json")));

  assert.equal(channel.published.length, 2);
  assert.deepEqual(channel.published.map((entry) => entry.queue), [
    "media-analysis.jobs.dead",
    "media-analysis.jobs.dead",
  ]);
  assert.equal(channel.published[0].options.headers["x-anecites-failure-code"], "MEDIA_ADAPTER_FAILED");
  assert.equal(channel.published[1].options.headers["x-anecites-failure-code"], "MEDIA_JOB_INVALID");
  assert.equal(JSON.stringify(channel.published).includes("secret upstream response"), false);
  assert.equal(channel.acked.length, 2);
  await consumer.stop();
});

test("consumer requeues the original delivery when retry publication is not confirmed", async () => {
  const channel = new FakeChannel();
  channel.failConfirmation = true;
  const consumer = await startConsumer(channel, async () => {
    throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "timeout");
  });

  await channel.deliver(message(validJob("confirm-failure")));

  assert.equal(channel.acked.length, 0);
  assert.equal(channel.nacked.length, 1);
  assert.equal(channel.nacked[0].requeue, true);
  await consumer.stop();
});

test("consumer shutdown cancels new deliveries and waits for the active job before closing", async () => {
  const channel = new FakeChannel();
  let release;
  const processing = new Promise((resolve) => {
    release = resolve;
  });
  const consumer = await startConsumer(channel, async () => processing);

  const delivery = channel.deliver(message(validJob("shutdown")));
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = consumer.stop();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(channel.cancelled, ["test-consumer"]);
  assert.equal(channel.closed, false);

  release();
  await delivery;
  await stopping;

  assert.equal(channel.acked.length, 1);
  assert.equal(channel.closed, true);
});

test("durable job processing does not repeat inference or summaries after successful redelivery", async (t) => {
  const prisma = createPrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  t.after(async () => {
    await prisma.session.deleteMany({
      where: { title: { startsWith: testRunId } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: testRunId } },
    });
    await prisma.$disconnect();
  });

  const session = await prisma.session.create({
    data: { title: `${testRunId}-idempotency` },
  });
  const candidate = await prisma.user.create({
    data: {
      email: `candidate.idempotency.${testRunId}@example.test`,
      displayName: "Media Consumer Candidate",
      role: "CANDIDATE",
    },
  });
  const candidateParticipant = await prisma.participant.create({
    data: {
      sessionId: session.id,
      userId: candidate.id,
      role: "CANDIDATE",
      joinedAt: new Date(),
    },
  });
  const evidence = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-dev",
      storageKey: `recordings/${testRunId}.mp4`,
      contentType: "video/mp4",
      durationMs: 4000,
      metadata: {
        livekit: {
          recordingScope: "candidate_track",
          participantId: candidateParticipant.id,
        },
      },
    },
  });
  const job = validJob("idempotency", session.id, evidence.id, candidateParticipant.id);
  let inferenceCalls = 0;
  const adapters = {
    video: {
      async analyzeVideo() {
        inferenceCalls += 1;
        return [{
          kind: "face_missing",
          confidence: 0.95,
          durationMs: 4000,
          sampleStartedAt: "2026-07-15T00:00:00.000Z",
          sampleEndedAt: "2026-07-15T00:00:04.000Z",
          adapterVersion: "test-video-v1",
        }];
      },
    },
  };

  const first = await processMediaAnalysisQueueJob({ prisma, job, adapters, leaseDurationMs: 60_000 });
  const duplicate = await processMediaAnalysisQueueJob({ prisma, job, adapters, leaseDurationMs: 60_000 });
  await assert.rejects(
    () => processMediaAnalysisQueueJob({
      prisma,
      job: {
        ...job,
        options: {
          ...job.options,
          maxSamplesPerRecording: 2,
        },
      },
      adapters,
      leaseDurationMs: 60_000,
    }),
    (error) => error instanceof MediaWorkerError && error.code === "MEDIA_JOB_CONFLICT",
  );

  assert.equal(first.status, "processed");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(inferenceCalls, 1);
  assert.equal(await prisma.riskSummary.count({ where: { sessionId: session.id } }), 1);
  const run = await prisma.mediaAnalysisJobRun.findUniqueOrThrow({ where: { jobId: job.jobId } });
  assert.equal(run.status, "SUCCEEDED");
  assert.notEqual(run.riskSummaryId, null);
});

async function startConsumer(channel, processJob) {
  return startMediaAnalysisConsumer({
    channel,
    queueName: "media-analysis.jobs",
    prefetch: 1,
    maxRetries: 2,
    retryDelayMs: 1000,
    processJob,
  });
}

function validJob(
  suffix,
  sessionId = "session-1",
  evidenceId = "recording-1",
  participantId = "candidate-participant-1",
) {
  return createMediaAnalysisJob({
    jobId: `${testRunId}-${suffix}`,
    sessionId,
    participantId,
    recordingEvidenceObjectId: evidenceId,
    requestedModes: [MEDIA_ANALYSIS_MODES.videoFacePresence],
    options: {
      sampleWindowMs: 4000,
      maxSamplesPerRecording: 1,
      requestTimeoutMs: 30000,
      confidenceThresholds: {
        secondVoice: 0.8,
        faceMissing: 0.8,
        multipleFaces: 0.8,
        gazeOffscreen: 0.85,
      },
    },
  });
}

function message(job, retryCount = 0) {
  return messageBuffer(Buffer.from(JSON.stringify(job)), retryCount, job.jobId);
}

function messageBuffer(content, retryCount = 0, messageId = "invalid-message") {
  return {
    content,
    properties: {
      contentType: "application/json",
      deliveryMode: 2,
      headers: { "x-anecites-retry-count": retryCount },
      messageId,
    },
    fields: {},
  };
}

class FakeChannel {
  acked = [];
  nacked = [];
  published = [];
  cancelled = [];
  confirmCount = 0;
  closed = false;
  failConfirmation = false;
  handler = null;

  async assertExchange() {}
  async assertQueue() {}
  async bindQueue() {}
  async prefetch() {}
  async consume(_queue, handler) {
    this.handler = handler;
    return { consumerTag: "test-consumer" };
  }
  ack(messageValue) {
    this.acked.push(messageValue);
  }
  nack(messageValue, _allUpTo, requeue) {
    this.nacked.push({ message: messageValue, requeue });
  }
  sendToQueue(queue, content, options) {
    this.published.push({ queue, content: content.toString("utf8"), options });
    return true;
  }
  async waitForConfirms() {
    this.confirmCount += 1;
    if (this.failConfirmation) {
      throw new Error("confirmation failed");
    }
  }
  async cancel(consumerTag) {
    this.cancelled.push(consumerTag);
  }
  async close() {
    this.closed = true;
  }
  async deliver(messageValue) {
    assert.notEqual(this.handler, null);
    return this.handler(messageValue);
  }
}
