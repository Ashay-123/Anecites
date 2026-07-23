import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createPrismaClient } from "@anecites/db";
import { MEDIA_CONSENT_SCOPES } from "@anecites/shared";
import { AccessToken } from "livekit-server-sdk";

import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const liveKitApiKey = "test_livekit_webhook_key";
const liveKitApiSecret = "test_livekit_webhook_secret_minimum_32_characters";
const testRunId = `livekit-webhooks-${Date.now()}`;
const mediaConsentNoticeText = "Test-only recording and media-analysis notice.";
const mediaConsentNoticeFingerprint = createHash("sha256")
  .update(mediaConsentNoticeText, "utf8")
  .digest("hex");

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    CODE_EXECUTION_ALLOWED_LANGUAGE_IDS: "63,71",
    PISTON_BASE_URL: "http://127.0.0.1:2000",
    AUTH_JWT_SECRET: "test_auth_secret_minimum_32_characters",
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: liveKitApiKey,
    LIVEKIT_API_SECRET: liveKitApiSecret,
    MEDIA_ANALYSIS_ENABLED: "true",
    MEDIA_CONSENT_NOTICE_TEXT: mediaConsentNoticeText,
    ...overrides,
  });
}

function quietLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

async function signedWebhookRequest(server, body, options = {}) {
  const token = new AccessToken(liveKitApiKey, liveKitApiSecret);
  token.sha256 = createHash("sha256")
    .update(options.signedBody ?? body)
    .digest("base64");
  const { port } = server.address();

  return fetch(`http://127.0.0.1:${port}/webhooks/livekit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/webhook+json",
      Authorization: await token.toJwt(),
    },
    body,
  });
}

function completeEgressBody(egressId, overrides = {}) {
  return JSON.stringify({
    event: "egress_ended",
    id: `event-${egressId}`,
    createdAt: Math.floor(Date.now() / 1_000),
    egressInfo: {
      egressId,
      roomName: `session-${testRunId}`,
      status: 3,
      ...overrides,
    },
  });
}

test("LiveKit egress webhook verifies the raw body and publishes a candidate-scoped media job", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const publisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  const session = await prisma.session.create({
    data: { title: `${testRunId}-complete` },
  });
  const interviewer = await prisma.user.create({
    data: {
      email: `interviewer.${testRunId}@example.test`,
      displayName: "Webhook Interviewer",
      role: "INTERVIEWER",
    },
  });
  const candidate = await prisma.user.create({
    data: {
      email: `candidate.${testRunId}@example.test`,
      displayName: "Webhook Candidate",
      role: "CANDIDATE",
    },
  });
  const interviewerParticipant = await prisma.participant.create({
    data: {
      sessionId: session.id,
      userId: interviewer.id,
      role: "INTERVIEWER",
      joinedAt: new Date(),
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
  await prisma.mediaConsent.createMany({
    data: [
      {
        sessionId: session.id,
        participantId: interviewerParticipant.id,
        noticeVersion: "development-v1",
        noticeFingerprint: mediaConsentNoticeFingerprint,
        scopes: [MEDIA_CONSENT_SCOPES.sessionRecording],
        grantedAt: new Date(),
      },
      {
        sessionId: session.id,
        participantId: candidateParticipant.id,
        noticeVersion: "development-v1",
        noticeFingerprint: mediaConsentNoticeFingerprint,
        scopes: [
          MEDIA_CONSENT_SCOPES.sessionRecording,
          MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
        ],
        grantedAt: new Date(),
      },
    ],
  });
  const evidence = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-dev",
      storageKey: `recordings/livekit/${session.id}/complete.mp4`,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          egressId: "egress-webhook-complete",
          roomName: `session-${session.id}`,
          status: 1,
          recordingScope: "candidate_track",
          participantId: candidateParticipant.id,
        },
      },
    },
  });
  await prisma.sessionRecording.create({
    data: {
      sessionId: session.id,
      egressId: "egress-webhook-complete",
      evidenceObjectId: evidence.id,
      state: "STOP_REQUESTED",
      startedAt: new Date(Date.now() - 1_000),
      stopRequestedAt: new Date(),
    },
  });
  t.after(async () => {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    mediaAnalysisPublisher: publisher,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const body = completeEgressBody("egress-webhook-complete", {
    roomName: `session-${session.id}`,
  });
  const firstResponse = await signedWebhookRequest(server, body);
  const retryResponse = await signedWebhookRequest(server, body);

  assert.equal(firstResponse.status, 204);
  assert.equal(retryResponse.status, 204);
  assert.equal(publisher.calls.length, 2);
  assert.deepEqual(publisher.calls[0], publisher.calls[1]);
  assert.deepEqual(publisher.calls[0], {
    version: 1,
    jobId: `media-analysis:${evidence.id}`,
    sessionId: session.id,
    participantId: candidateParticipant.id,
    recordingEvidenceObjectId: evidence.id,
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
  });
  assert.doesNotMatch(
    JSON.stringify(publisher.calls),
    /accessKey|secret|rawMedia|storageKey/i,
  );
  const sessionRecording = await prisma.sessionRecording.findUniqueOrThrow({
    where: {
      egressId: "egress-webhook-complete",
    },
  });
  assert.equal(sessionRecording.state, "COMPLETED");
  assert.equal(typeof sessionRecording.completedAt?.toISOString(), "string");

  const roomCompositeEvidence = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-dev",
      storageKey: `recordings/livekit/${session.id}/room-composite.mp4`,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          egressId: "egress-webhook-room-composite",
          roomName: `session-${session.id}`,
          status: 1,
          recordingScope: "room_composite",
        },
      },
    },
  });
  await prisma.sessionRecording.create({
    data: {
      sessionId: session.id,
      egressId: "egress-webhook-room-composite",
      evidenceObjectId: roomCompositeEvidence.id,
      state: "STOP_REQUESTED",
      startedAt: new Date(Date.now() - 1_000),
      stopRequestedAt: new Date(),
    },
  });

  const roomCompositeResponse = await signedWebhookRequest(
    server,
    completeEgressBody("egress-webhook-room-composite", {
      roomName: `session-${session.id}`,
    }),
  );
  assert.equal(roomCompositeResponse.status, 204);
  assert.equal(publisher.calls.length, 2);
});

test("LiveKit webhook acknowledges completed recordings without publishing after consent is unavailable", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const publisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  const session = await prisma.session.create({
    data: { title: `${testRunId}-consent-withdrawn` },
  });
  await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-dev",
      storageKey: `recordings/livekit/${session.id}/consent-withdrawn.mp4`,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          egressId: "egress-webhook-consent-withdrawn",
          roomName: `session-${session.id}`,
          status: 1,
        },
      },
    },
  });
  t.after(async () => {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    mediaAnalysisPublisher: publisher,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await signedWebhookRequest(
    server,
    completeEgressBody("egress-webhook-consent-withdrawn", {
      roomName: `session-${session.id}`,
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(publisher.calls.length, 0);
});

test("LiveKit webhook rejects an invalid body signature without publishing", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const publisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  t.after(async () => prisma.$disconnect());
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    mediaAnalysisPublisher: publisher,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const body = completeEgressBody("egress-invalid-signature");
  const response = await signedWebhookRequest(server, body, {
    signedBody: `${body}tampered`,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "LIVEKIT_WEBHOOK_UNAUTHORIZED",
      message: "LiveKit webhook could not be verified",
    },
  });
  assert.equal(publisher.calls.length, 0);
});

test("LiveKit webhook acknowledges non-complete egress and retries missing evidence", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const publisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  t.after(async () => prisma.$disconnect());
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    mediaAnalysisPublisher: publisher,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const failedBody = completeEgressBody("egress-failed", { status: 4 });
  const failedResponse = await signedWebhookRequest(server, failedBody);
  assert.equal(failedResponse.status, 204);

  const irrelevantBody = JSON.stringify({
    event: "room_finished",
    id: "event-room-finished",
    createdAt: Math.floor(Date.now() / 1_000),
    room: {
      sid: "RM_test",
      name: `session-${testRunId}`,
    },
  });
  const irrelevantResponse = await signedWebhookRequest(server, irrelevantBody);
  assert.equal(irrelevantResponse.status, 204);

  const missingBody = completeEgressBody("egress-evidence-not-ready");
  const missingResponse = await signedWebhookRequest(server, missingBody);
  assert.equal(missingResponse.status, 503);
  assert.deepEqual(await missingResponse.json(), {
    error: {
      code: "MEDIA_ANALYSIS_EVIDENCE_NOT_READY",
      message: "Recording evidence is not ready",
    },
  });
  assert.equal(publisher.calls.length, 0);
});

test("LiveKit webhook requires its signed raw-body content type", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => prisma.$disconnect());
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
    mediaAnalysisPublisher: {
      async publish() {
        throw new Error("should not publish");
      },
    },
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/webhooks/livekit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: completeEgressBody("egress-wrong-content-type"),
  });

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: {
      code: "LIVEKIT_WEBHOOK_CONTENT_TYPE_REQUIRED",
      message: "LiveKit webhook content type is required",
    },
  });
});
