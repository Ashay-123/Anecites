import assert from "node:assert/strict";
import test from "node:test";

import { createRabbitMediaAnalysisPublisher } from "../dist/index.js";

test("RabbitMQ media publisher confirms bounded persistent jobs", async () => {
  const calls = [];
  const channel = {
    async assertQueue(name, options) {
      calls.push({ type: "assertQueue", name, options });
    },
    sendToQueue(name, content, options) {
      calls.push({ type: "sendToQueue", name, content, options });
      return true;
    },
    async waitForConfirms() {
      calls.push({ type: "waitForConfirms" });
    },
    async close() {
      calls.push({ type: "channel.close" });
    },
  };
  const connection = {
    async createConfirmChannel() {
      calls.push({ type: "createConfirmChannel" });
      return channel;
    },
    async close() {
      calls.push({ type: "connection.close" });
    },
  };
  const publisher = createRabbitMediaAnalysisPublisher(
    {
      rabbitmqUrl: "amqp://127.0.0.1:5672",
      mediaAnalysisQueueName: "media-analysis.jobs",
      mediaAnalysisShadowQueueName: "media-analysis.shadow.v1.jobs",
    },
    async (url) => {
      calls.push({ type: "connect", url });
      return connection;
    },
  );
  const job = {
    version: 1,
    jobId: "media-analysis:evidence-1",
    sessionId: "session-1",
    participantId: "candidate-participant-1",
    recordingEvidenceObjectId: "evidence-1",
    requestedModes: ["video.face_presence"],
    options: {
      sampleWindowMs: 10_000,
      maxSamplesPerRecording: 12,
      requestTimeoutMs: 30_000,
      confidenceThresholds: {
        secondVoice: 0.8,
        faceMissing: 0.8,
        multipleFaces: 0.8,
        gazeOffscreen: 0.85,
      },
      shadowModes: [],
    },
  };

  await publisher.publish(job);
  await publisher.publish({
    ...job,
    jobId: "media-analysis:evidence-shadow-1",
    requestedModes: ["audio.second_voice"],
    options: {
      ...job.options,
      shadowModes: ["audio.second_voice"],
    },
  });
  await publisher.close();

  const publishCalls = calls.filter((call) => call.type === "sendToQueue");
  assert.equal(publishCalls[0].name, "media-analysis.jobs");
  assert.deepEqual(JSON.parse(publishCalls[0].content.toString("utf8")), job);
  assert.equal(publishCalls[1].name, "media-analysis.shadow.v1.jobs");
  assert.deepEqual(publishCalls[1].options, {
    contentType: "application/json",
    persistent: true,
    messageId: "media-analysis:evidence-shadow-1",
  });
  assert.deepEqual(calls.map((call) => call.type), [
    "connect",
    "createConfirmChannel",
    "assertQueue",
    "assertQueue",
    "sendToQueue",
    "waitForConfirms",
    "sendToQueue",
    "waitForConfirms",
    "channel.close",
    "connection.close",
  ]);
});
