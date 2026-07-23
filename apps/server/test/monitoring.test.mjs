import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";

import { createPrismaClient } from "@anecites/db";
import { MONITORING_POLICY_VERSION, MONITORING_SCOPES, RISK_SIGNAL_TYPES } from "@anecites/shared";
import { createApp, loadServerConfig } from "../dist/index.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `monitoring-${Date.now()}`;

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    JUDGE0_BASE_URL: "http://localhost:2358",
    JUDGE0_ALLOWED_LANGUAGE_IDS: "63,71",
    AUTH_JWT_SECRET: authJwtSecret,
    MONITORING_PROHIBITED_APPLICATION_RULES_JSON: JSON.stringify([
      {
        id: "interview.assistant",
        processNames: ["Assistant.EXE"],
        windowTitleContains: ["Interview Helper"],
      },
    ]),
    ...overrides,
  });
}

function quietLogger() {
  return { info() {}, warn() {}, error() {} };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

async function requestJson(server, path, options = {}) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

async function authorizationHeader(subject, role) {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));
  return { Authorization: `Bearer ${token}` };
}

test("monitoring lifecycle binds candidates, rejects replay, and exposes a reviewer timeline", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const user = await prisma.user.create({
    data: {
      email: `${testRunId}@example.test`,
      displayName: "Monitoring Candidate",
      role: "CANDIDATE",
    },
  });
  const session = await prisma.session.create({
    data: {
      title: `${testRunId} interview`,
      participants: {
        create: { userId: user.id, role: "CANDIDATE", joinedAt: new Date() },
      },
    },
    include: { participants: true },
  });
  const participant = session.participants[0];
  assert.ok(participant);

  t.after(async () => {
    await prisma.session.deleteMany({ where: { id: session.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  const server = await listen(createApp(testConfig(), { logger: quietLogger(), prisma }));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const candidateAuth = await authorizationHeader(user.id, "candidate");

  const start = await requestJson(server, `/sessions/${session.id}/monitoring/start`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      participantId: participant.id,
      policyVersion: MONITORING_POLICY_VERSION,
      scopes: MONITORING_SCOPES,
      clientInstanceId: "desktop-test-1",
      clientVersion: "0.0.0-test",
      grantedAt: "2026-07-14T10:00:00.000Z",
    }),
  });
  assert.equal(start.response.status, 201);
  assert.equal(start.body.monitoringConsent.participantId, participant.id);
  assert.equal(start.body.monitoringConsent.nextSequence, 1);
  assert.deepEqual(start.body.monitoringPolicy.prohibitedApplicationRules, [
    {
      id: "interview.assistant",
      processNames: ["assistant.exe"],
      windowTitleContains: ["interview helper"],
    },
  ]);
  const consentId = start.body.monitoringConsent.id;
  const policyDigestSha256 = start.body.monitoringPolicy.digestSha256;
  assert.equal(policyDigestSha256.length, 64);

  const heartbeat = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/heartbeat`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({ sequence: 1, occurredAt: "2026-07-14T10:00:01.000Z" }),
  });
  assert.equal(heartbeat.response.status, 201);
  assert.equal(heartbeat.body.heartbeat.sequence, 1);

  const heartbeatRetry = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/heartbeat`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({ sequence: 1, occurredAt: "2026-07-14T10:00:01.000Z" }),
  });
  assert.equal(heartbeatRetry.response.status, 201);
  assert.equal(heartbeatRetry.body.heartbeat.id, heartbeat.body.heartbeat.id);

  const replayAsDifferentEvent = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/events`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 1,
      occurredAt: "2026-07-14T10:00:02.000Z",
      type: RISK_SIGNAL_TYPES.nativeVmSignal,
      source: "desktop_native",
      confidence: 0.5,
      detectorVersion: "test-1",
      metadata: {
        platform: "windows",
        detectedSignals: [{ name: "cpuid.hypervisor_present" }],
        policyDigestSha256,
      },
    }),
  });
  assert.equal(replayAsDifferentEvent.response.status, 409);
  assert.equal(replayAsDifferentEvent.body.error.code, "MONITORING_SEQUENCE_REJECTED");

  const gap = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/heartbeat`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({ sequence: 3, occurredAt: "2026-07-14T10:00:03.000Z" }),
  });
  assert.equal(gap.response.status, 409);

  const forbiddenSource = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/events`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 2,
      occurredAt: "2026-07-14T10:00:02.000Z",
      type: RISK_SIGNAL_TYPES.nativeVmSignal,
      source: "server",
      confidence: 0.5,
      detectorVersion: "test-1",
    }),
  });
  assert.equal(forbiddenSource.response.status, 403);

  const forgedMediaSource = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/events`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 2,
      occurredAt: "2026-07-14T10:00:02.000Z",
      type: RISK_SIGNAL_TYPES.mediaSecondVoice,
      source: "desktop_native",
      confidence: 1,
      detectorVersion: "forged-test-1",
    }),
  });
  assert.equal(forgedMediaSource.response.status, 400);
  assert.equal(forgedMediaSource.body.error.code, "MONITORING_EVENT_INVALID");

  const event = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/events`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 2,
      occurredAt: "2026-07-14T10:00:02.000Z",
      type: RISK_SIGNAL_TYPES.nativeVmSignal,
      source: "desktop_native",
      confidence: 0.5,
      detectorVersion: "test-1",
      metadata: {
        platform: "windows",
        detectedSignals: [{ name: "cpuid.hypervisor_present", detail: "vendor=Microsoft Hv" }],
        policyDigestSha256,
      },
    }),
  });
  assert.equal(event.response.status, 201);
  assert.equal(event.body.riskEvent.type, RISK_SIGNAL_TYPES.nativeVmSignal);
  assert.equal(event.body.riskEvent.confidence, 0.35);

  const unknownApplication = await requestJson(
    server,
    `/sessions/${session.id}/monitoring/${consentId}/events`,
    {
      method: "POST",
      headers: candidateAuth,
      body: JSON.stringify({
        sequence: 3,
        occurredAt: "2026-07-14T10:00:03.000Z",
        type: RISK_SIGNAL_TYPES.nativeProhibitedApplication,
        source: "desktop_native",
        confidence: 0.75,
        detectorVersion: "test-1",
        metadata: {
          ruleId: "unknown.application",
          matchKinds: ["process_name"],
          policyDigestSha256,
        },
      }),
    },
  );
  assert.equal(unknownApplication.response.status, 400);
  assert.equal(unknownApplication.body.error.code, "MONITORING_RULE_NOT_CONFIGURED");

  const prohibitedApplication = await requestJson(
    server,
    `/sessions/${session.id}/monitoring/${consentId}/events`,
    {
      method: "POST",
      headers: candidateAuth,
      body: JSON.stringify({
        sequence: 3,
        occurredAt: "2026-07-14T10:00:03.000Z",
        type: RISK_SIGNAL_TYPES.nativeProhibitedApplication,
        source: "desktop_native",
        confidence: 0.85,
        detectorVersion: "test-1",
        metadata: {
          ruleId: "interview.assistant",
          matchKinds: ["process_name", "window_title"],
          processName: "must-not-persist.exe",
          policyDigestSha256,
        },
      }),
    },
  );
  assert.equal(prohibitedApplication.response.status, 201);
  assert.deepEqual(prohibitedApplication.body.riskEvent.metadata, {
    ruleId: "interview.assistant",
    matchKinds: ["process_name", "window_title"],
    policyDigestSha256,
  });

  const focusLoss = await requestJson(
    server,
    `/sessions/${session.id}/monitoring/${consentId}/events`,
    {
      method: "POST",
      headers: candidateAuth,
      body: JSON.stringify({
        sequence: 4,
        occurredAt: "2026-07-14T10:00:04.000Z",
        type: RISK_SIGNAL_TYPES.clientFocusLost,
        source: "desktop_app",
        confidence: 0.65,
        detectorVersion: "anecites-focus-v1",
        metadata: {
          reason: "document_hidden",
          startedAt: "2026-07-14T10:00:02.000Z",
          endedAt: "2026-07-14T10:00:04.000Z",
          durationMs: 2_000,
          rawWindowTitle: "must-not-persist",
        },
      }),
    },
  );
  assert.equal(focusLoss.response.status, 201);
  assert.deepEqual(focusLoss.body.riskEvent.metadata, {
    reason: "document_hidden",
    startedAt: "2026-07-14T10:00:02.000Z",
    endedAt: "2026-07-14T10:00:04.000Z",
    durationMs: 2_000,
  });

  const stop = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/stop`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 5,
      occurredAt: "2026-07-14T10:00:05.000Z",
      reason: "session_left",
    }),
  });
  assert.equal(stop.response.status, 200);
  assert.equal(stop.body.monitoringConsent.lastSequence, 5);
  assert.equal(stop.body.monitoringConsent.monitoringStoppedAt, "2026-07-14T10:00:05.000Z");
  assert.equal(stop.body.monitoringConsent.stopReason, "session_left");

  const afterStop = await requestJson(server, `/sessions/${session.id}/monitoring/${consentId}/heartbeat`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({ sequence: 6, occurredAt: "2026-07-14T10:00:06.000Z" }),
  });
  assert.equal(afterStop.response.status, 404);
  assert.equal(afterStop.body.error.code, "MONITORING_NOT_ACTIVE");

  const candidateTimeline = await requestJson(server, `/sessions/${session.id}/monitoring-timeline`, {
    headers: candidateAuth,
  });
  assert.equal(candidateTimeline.response.status, 403);

  const reviewerTimeline = await requestJson(server, `/sessions/${session.id}/monitoring-timeline?limit=20`, {
    headers: await authorizationHeader(`reviewer-${testRunId}`, "reviewer"),
  });
  assert.equal(reviewerTimeline.response.status, 200);
  assert.equal(reviewerTimeline.body.monitoringConsents.length, 1);
  assert.deepEqual(reviewerTimeline.body.timeline.map((item) => item.kind), [
    "risk_summary",
    "risk_event",
    "risk_event",
    "risk_event",
    "heartbeat",
  ]);
  const correlatedSummary = reviewerTimeline.body.timeline.find((item) => item.kind === "risk_summary");
  assert.ok(correlatedSummary);
  assert.equal(correlatedSummary.participantId, participant.id);
  assert.equal(correlatedSummary.meetsCorrelationPolicy, true);
  assert.equal(correlatedSummary.humanReviewRequired, true);
  assert.deepEqual(
    correlatedSummary.signalBreakdown.map((entry) => entry.category),
    ["client", "native"],
  );

  assert.equal(await prisma.monitoringHeartbeat.count({ where: { monitoringConsentId: consentId } }), 1);
  assert.equal(await prisma.riskEvent.count({ where: { monitoringConsentId: consentId } }), 3);

  const restart = await requestJson(server, `/sessions/${session.id}/monitoring/start`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      participantId: participant.id,
      policyVersion: MONITORING_POLICY_VERSION,
      scopes: MONITORING_SCOPES,
      clientInstanceId: "desktop-test-2",
      clientVersion: "0.0.0-test",
      grantedAt: "2026-07-14T10:01:00.000Z",
    }),
  });
  assert.equal(restart.response.status, 201);
  assert.notEqual(restart.body.monitoringConsent.id, consentId);
  const consentHistory = await prisma.monitoringConsent.findMany({
    where: { sessionId: session.id, participantId: participant.id },
    orderBy: { grantedAt: "asc" },
  });
  assert.equal(consentHistory.length, 2);
  assert.equal(consentHistory[0].stopReason, "session_left");
  assert.equal(consentHistory[1].lastSequence, 0);
});

test("monitoring keeps an active consent bound to its original policy after a rotation", async (t) => {
  const prisma = createPrismaClient({ datasources: { db: { url: databaseUrl } } });
  const user = await prisma.user.create({
    data: {
      email: `${testRunId}-policy-rotation@example.test`,
      displayName: "Policy Rotation Candidate",
      role: "CANDIDATE",
    },
  });
  const session = await prisma.session.create({
    data: {
      title: `${testRunId} policy rotation interview`,
      participants: {
        create: { userId: user.id, role: "CANDIDATE", joinedAt: new Date() },
      },
    },
    include: { participants: true },
  });
  const participant = session.participants[0];
  assert.ok(participant);

  t.after(async () => {
    await prisma.session.deleteMany({ where: { id: session.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  const originalServer = await listen(createApp(testConfig(), { logger: quietLogger(), prisma }));
  t.after(() => new Promise((resolve) => originalServer.close(resolve)));
  const candidateAuth = await authorizationHeader(user.id, "candidate");
  const startBody = {
    participantId: participant.id,
    policyVersion: MONITORING_POLICY_VERSION,
    scopes: MONITORING_SCOPES,
    clientInstanceId: "desktop-policy-rotation",
    clientVersion: "0.0.0-test",
    grantedAt: "2026-07-17T10:00:00.000Z",
  };

  const start = await requestJson(originalServer, `/sessions/${session.id}/monitoring/start`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify(startBody),
  });
  assert.equal(start.response.status, 201);
  const consentId = start.body.monitoringConsent.id;
  const originalPolicyDigestSha256 = start.body.monitoringPolicy.digestSha256;
  const persistedConsent = await prisma.monitoringConsent.findUniqueOrThrow({ where: { id: consentId } });
  assert.equal(persistedConsent.policyVersion, MONITORING_POLICY_VERSION);
  assert.equal(persistedConsent.policyDigestSha256, originalPolicyDigestSha256);
  assert.deepEqual(persistedConsent.nativeMonitoringPolicy, start.body.monitoringPolicy);

  const rotatedServer = await listen(createApp(testConfig({
    MONITORING_POLICY_VERSION: "2026-07-18.1",
    MONITORING_PROHIBITED_APPLICATION_RULES_JSON: "[]",
  }), { logger: quietLogger(), prisma }));
  t.after(() => new Promise((resolve) => rotatedServer.close(resolve)));

  const mismatchedStart = await requestJson(rotatedServer, `/sessions/${session.id}/monitoring/start`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify(startBody),
  });
  assert.equal(mismatchedStart.response.status, 409);
  assert.equal(mismatchedStart.body.error.code, "MONITORING_POLICY_VERSION_MISMATCH");

  const conflictingServer = await listen(createApp(testConfig({
    MONITORING_PROHIBITED_APPLICATION_RULES_JSON: "[]",
  }), { logger: quietLogger(), prisma }));
  t.after(() => new Promise((resolve) => conflictingServer.close(resolve)));
  const bindingConflict = await requestJson(conflictingServer, `/sessions/${session.id}/monitoring/start`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify(startBody),
  });
  assert.equal(bindingConflict.response.status, 409);
  assert.equal(bindingConflict.body.error.code, "MONITORING_POLICY_BINDING_CONFLICT");

  const event = await requestJson(rotatedServer, `/sessions/${session.id}/monitoring/${consentId}/events`, {
    method: "POST",
    headers: candidateAuth,
    body: JSON.stringify({
      sequence: 1,
      occurredAt: "2026-07-17T10:00:01.000Z",
      type: RISK_SIGNAL_TYPES.nativeProhibitedApplication,
      source: "desktop_native",
      confidence: 1,
      detectorVersion: "test-policy-rotation",
      metadata: {
        ruleId: "interview.assistant",
        matchKinds: ["process_name", "window_title"],
        policyDigestSha256: originalPolicyDigestSha256,
      },
    }),
  });
  assert.equal(event.response.status, 201);
  assert.equal(event.body.riskEvent.metadata.ruleId, "interview.assistant");
  assert.equal(event.body.riskEvent.metadata.policyDigestSha256, originalPolicyDigestSha256);
});
