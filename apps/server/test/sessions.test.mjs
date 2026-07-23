import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, jwtVerify } from "jose";

import { createPrismaClient } from "@anecites/db";
import {
  MEDIA_CONSENT_SCOPES,
  MONITORING_POLICY_VERSION,
  MONITORING_SCOPES,
  RISK_SIGNAL_TYPES,
} from "@anecites/shared";
import { createApp, createRiskSummary, loadServerConfig } from "../dist/index.js";
import { requireActiveRecordingConsents } from "../dist/media-consent.js";

const databaseUrl = "postgresql://anecites:anecites_dev_password@localhost:5432/anecites";
const authJwtSecret = "test_auth_secret_minimum_32_characters";
const testRunId = `sessions-${Date.now()}`;

function testConfig(overrides = {}) {
  return loadServerConfig({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    APP_ORIGIN: "http://localhost:5173",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://anecites:anecites_dev_password@localhost:5672",
    LIVEKIT_RECORDING_S3_ENDPOINT: "http://minio:9000",
    JUDGE0_BASE_URL: "http://localhost:2358",
    JUDGE0_ALLOWED_LANGUAGE_IDS: "63,71",
    AUTH_JWT_SECRET: authJwtSecret,
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

async function jsonRequest(server, path, options = {}) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const body = await response.json();
  return { response, body };
}

async function authorizationHeader(role = "interviewer", subject = `test-user-${testRunId}`) {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(authJwtSecret));

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function startMonitoringForParticipant(server, sessionId, participant, clientInstanceId) {
  const headers = await authorizationHeader("candidate", participant.user.id);
  const result = await jsonRequest(server, `/sessions/${sessionId}/monitoring/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      participantId: participant.id,
      policyVersion: MONITORING_POLICY_VERSION,
      scopes: MONITORING_SCOPES,
      clientInstanceId,
      clientVersion: "0.0.0-test",
      grantedAt: "2026-07-14T10:00:00.000Z",
    }),
  });

  assert.equal(result.response.status, 201);
  return {
    headers,
    monitoringConsentId: result.body.monitoringConsent.id,
  };
}

async function createRecordingParticipants(prisma, sessionId, label) {
  const interviewerUser = await prisma.user.create({
    data: {
      email: `interviewer.${label}.${testRunId}@example.test`,
      displayName: `Interviewer ${label}`,
      role: "INTERVIEWER",
    },
  });
  const candidateUser = await prisma.user.create({
    data: {
      email: `candidate.${label}.${testRunId}@example.test`,
      displayName: `Candidate ${label}`,
      role: "CANDIDATE",
    },
  });
  const interviewerParticipant = await prisma.participant.create({
    data: {
      sessionId,
      userId: interviewerUser.id,
      role: "INTERVIEWER",
      joinedAt: new Date(),
    },
  });
  const candidateParticipant = await prisma.participant.create({
    data: {
      sessionId,
      userId: candidateUser.id,
      role: "CANDIDATE",
      joinedAt: new Date(),
    },
  });
  const interviewerHeaders = await authorizationHeader("interviewer", interviewerUser.id);
  const candidateHeaders = await authorizationHeader("candidate", candidateUser.id);

  return {
    interviewerUser,
    candidateUser,
    interviewerParticipant,
    candidateParticipant,
    interviewerHeaders,
    candidateHeaders,
  };
}

async function createConsentedRecordingParticipants(prisma, server, sessionId, label, options = {}) {
  const participants = await createRecordingParticipants(prisma, sessionId, label);

  const interviewerConsent = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [MEDIA_CONSENT_SCOPES.sessionRecording],
    }),
  });
  assert.equal(interviewerConsent.response.status, 201);

  const candidateConsent = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [
        MEDIA_CONSENT_SCOPES.sessionRecording,
        MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
        ...(options.includeGazeCalibration ? [MEDIA_CONSENT_SCOPES.videoGazeCalibration] : []),
      ],
    }),
  });
  assert.equal(candidateConsent.response.status, 201);

  return {
    ...participants,
    interviewerConsent: interviewerConsent.body.mediaConsent,
    candidateConsent: candidateConsent.body.mediaConsent,
  };
}

test("session routes create, read, join, start, and end a session", async (t) => {
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
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId} API interview`,
      scheduledAt: "2026-07-08T10:00:00.000Z",
    }),
  });

  assert.equal(createResult.response.status, 201);
  assert.equal(createResult.body.session.title, `${testRunId} API interview`);
  assert.equal(createResult.body.session.state, "created");
  assert.equal(createResult.body.session.participants.length, 0);

  const sessionId = createResult.body.session.id;

  const readResult = await jsonRequest(server, `/sessions/${sessionId}`, {
    headers: await authorizationHeader(),
  });
  assert.equal(readResult.response.status, 200);
  assert.equal(readResult.body.session.id, sessionId);
  assert.equal(readResult.body.session.state, "created");

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.${testRunId}@example.test`,
        displayName: "Candidate One",
      },
    }),
  });

  assert.equal(joinResult.response.status, 201);
  assert.equal(joinResult.body.participant.role, "candidate");
  assert.equal(joinResult.body.participant.user.email, `candidate.${testRunId}@example.test`);

  for (const state of ["scheduled", "lobby", "active", "ended"]) {
    const transitionResult = await jsonRequest(server, `/sessions/${sessionId}/state`, {
      method: "PATCH",
      headers: await authorizationHeader(),
      body: JSON.stringify({ state }),
    });

    assert.equal(transitionResult.response.status, 200);
    assert.equal(transitionResult.body.session.state, state);
  }

  const endedResult = await jsonRequest(server, `/sessions/${sessionId}`, {
    headers: await authorizationHeader(),
  });
  assert.equal(endedResult.response.status, 200);
  assert.equal(endedResult.body.session.state, "ended");
  assert.equal(endedResult.body.session.participants.length, 1);
  assert.equal(typeof endedResult.body.session.startedAt, "string");
  assert.equal(typeof endedResult.body.session.endedAt, "string");
});

test("session routes reject invalid transitions and missing sessions", async (t) => {
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
          startsWith: `${testRunId}-invalid`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-invalid transition interview`,
    }),
  });

  const sessionId = createResult.body.session.id;
  const invalidTransition = await jsonRequest(server, `/sessions/${sessionId}/state`, {
    method: "PATCH",
    headers: await authorizationHeader(),
    body: JSON.stringify({ state: "active" }),
  });

  assert.equal(invalidTransition.response.status, 409);
  assert.deepEqual(invalidTransition.body, {
    error: {
      code: "INVALID_SESSION_TRANSITION",
      message: "Cannot transition session from created to active",
    },
  });

  const missingRead = await jsonRequest(server, "/sessions/missing-session-id", {
    headers: await authorizationHeader(),
  });
  assert.equal(missingRead.response.status, 404);
  assert.deepEqual(missingRead.body, {
    error: {
      code: "SESSION_NOT_FOUND",
      message: "Session not found",
    },
  });
});

test("session routes issue LiveKit tokens for existing participants", async (t) => {
  const livekitApiKey = "test_livekit_key";
  const livekitApiSecret = "test_livekit_secret_minimum_32_characters";
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
          startsWith: `${testRunId}-livekit`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.livekit.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: livekitApiKey,
      LIVEKIT_API_SECRET: livekitApiSecret,
      LIVEKIT_TOKEN_TTL_SECONDS: "900",
    }),
    {
      logger: quietLogger(),
      prisma,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-livekit interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.livekit.${testRunId}@example.test`,
        displayName: "Candidate LiveKit",
      },
    }),
  });
  const participantId = joinResult.body.participant.id;

  const tokenResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-token`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({ participantId }),
  });

  assert.equal(tokenResult.response.status, 201);
  assert.equal(tokenResult.body.livekit.url, "ws://127.0.0.1:7880");
  assert.equal(tokenResult.body.livekit.roomName, `session-${sessionId}`);
  assert.equal(tokenResult.body.livekit.participantIdentity, `participant-${participantId}`);
  assert.equal(typeof tokenResult.body.livekit.token, "string");

  const verified = await jwtVerify(
    tokenResult.body.livekit.token,
    new TextEncoder().encode(livekitApiSecret),
    {
      algorithms: ["HS256"],
    },
  );
  assert.equal(verified.payload.iss, livekitApiKey);
  assert.equal(verified.payload.sub, `participant-${participantId}`);
  assert.equal(verified.payload.video.room, `session-${sessionId}`);
  assert.equal(verified.payload.video.roomJoin, true);
});

test("session routes fail closed when LiveKit credentials are unavailable", async (t) => {
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
          startsWith: `${testRunId}-missing-livekit`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.missing-livekit.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-missing-livekit interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "interviewer",
      user: {
        email: `interviewer.missing-livekit.${testRunId}@example.test`,
        displayName: "Interviewer Missing LiveKit",
      },
    }),
  });

  const tokenResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-token`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({ participantId: joinResult.body.participant.id }),
  });

  assert.equal(tokenResult.response.status, 503);
  assert.deepEqual(tokenResult.body, {
    error: {
      code: "LIVEKIT_NOT_CONFIGURED",
      message: "LiveKit is not configured",
    },
  });
});

test("session routes record media consent only for the authenticated participant", async (t) => {
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
          startsWith: `${testRunId}-media-consent`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const noticeText = "Test recording notice for media-consent route coverage.";
  const app = createApp(testConfig({
    MEDIA_ANALYSIS_ENABLED: "true",
    MEDIA_CONSENT_NOTICE_TEXT: noticeText,
  }), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sessionResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-media-consent interview`,
    }),
  });
  const sessionId = sessionResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "media-consent",
  );

  const requirementsResult = await jsonRequest(
    server,
    `/sessions/${sessionId}/media-consent-requirements`,
    { headers: participants.candidateHeaders },
  );
  assert.equal(requirementsResult.response.status, 200);
  assert.deepEqual(requirementsResult.body.requirements.requiredScopes, [
    "session_recording",
    "video_face_analysis",
  ]);
  assert.equal(requirementsResult.body.requirements.noticeText, noticeText);
  assert.equal(requirementsResult.body.requirements.mediaConsent.id, participants.candidateConsent.id);

  const repeatGrantResult = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [
        MEDIA_CONSENT_SCOPES.sessionRecording,
        MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
      ],
    }),
  });
  assert.equal(repeatGrantResult.response.status, 201);
  assert.equal(repeatGrantResult.body.mediaConsent.id, participants.candidateConsent.id);

  const unacknowledgedResult = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({
      accepted: false,
      scopes: [MEDIA_CONSENT_SCOPES.sessionRecording],
    }),
  });
  assert.equal(unacknowledgedResult.response.status, 400);
  assert.equal(unacknowledgedResult.body.error.code, "BAD_REQUEST");

  const revokeResult = await jsonRequest(
    server,
    `/sessions/${sessionId}/media-consent/${participants.candidateConsent.id}/revoke`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({}),
    },
  );
  assert.equal(revokeResult.response.status, 200);
  assert.equal(typeof revokeResult.body.mediaConsent.revokedAt, "string");

  const requirementsAfterRevoke = await jsonRequest(
    server,
    `/sessions/${sessionId}/media-consent-requirements`,
    { headers: participants.candidateHeaders },
  );
  assert.equal(requirementsAfterRevoke.response.status, 200);
  assert.equal(requirementsAfterRevoke.body.requirements.mediaConsent, null);
});

test("session routes persist bounded candidate gaze calibration acknowledgements", async (t) => {
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
          startsWith: `${testRunId}-gaze-calibration`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig({
    MEDIA_ANALYSIS_ENABLED: "true",
    MEDIA_ANALYSIS_GAZE_MODE: "shadow",
  }), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sessionResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-gaze-calibration interview`,
    }),
  });
  const sessionId = sessionResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "gaze-calibration",
  );

  const interviewerStart = await jsonRequest(server, `/sessions/${sessionId}/gaze-calibrations`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(interviewerStart.response.status, 403);

  const missingCalibrationConsent = await jsonRequest(server, `/sessions/${sessionId}/gaze-calibrations`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(missingCalibrationConsent.response.status, 409);
  assert.equal(missingCalibrationConsent.body.error.code, "MEDIA_CONSENT_REQUIRED");

  const calibrationConsent = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [
        MEDIA_CONSENT_SCOPES.sessionRecording,
        MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
        MEDIA_CONSENT_SCOPES.videoGazeCalibration,
      ],
    }),
  });
  assert.equal(calibrationConsent.response.status, 201);

  const start = await jsonRequest(server, `/sessions/${sessionId}/gaze-calibrations`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(start.response.status, 409);
  assert.equal(start.body.error.code, "GAZE_CALIBRATION_RECORDING_REQUIRED");

  const evidenceObject = await prisma.evidenceObject.create({
    data: {
      sessionId,
      kind: "SESSION_RECORDING",
      storageBucket: "test-recordings",
      storageKey: `gaze-calibration/${sessionId}.mp4`,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          recordingScope: "candidate_track",
          participantId: participants.candidateParticipant.id,
        },
      },
    },
  });
  const recording = await prisma.sessionRecording.create({
    data: {
      sessionId,
      egressId: `gaze-calibration-${sessionId}`,
      evidenceObjectId: evidenceObject.id,
      startedAt: new Date(),
    },
  });

  const recordedStart = await jsonRequest(server, `/sessions/${sessionId}/gaze-calibrations`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(recordedStart.response.status, 201);
  assert.equal(recordedStart.body.gazeCalibration.state, "active");

  const storedStart = await prisma.gazeCalibration.findUniqueOrThrow({
    where: { id: recordedStart.body.gazeCalibration.id },
  });
  assert.equal(storedStart.sessionRecordingId, recording.id);
  assert.deepEqual(recordedStart.body.gazeCalibration.steps, []);

  let calibrationId = recordedStart.body.gazeCalibration.id;
  const firstStep = await jsonRequest(
    server,
    `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({ target: "center", sequence: 1 }),
    },
  );
  assert.equal(firstStep.response.status, 200);
  assert.equal(firstStep.body.gazeCalibration.steps.length, 1);
  assert.equal(typeof firstStep.body.gazeCalibration.steps[0].acknowledgedAt, "string");

  await prisma.sessionRecording.update({
    where: { id: recording.id },
    data: {
      state: "COMPLETED",
      completedAt: new Date(),
    },
  });
  const stoppedRecordingStep = await jsonRequest(
    server,
    `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({ target: "upper_left", sequence: 2 }),
    },
  );
  assert.equal(stoppedRecordingStep.response.status, 409);
  assert.equal(stoppedRecordingStep.body.error.code, "GAZE_CALIBRATION_RECORDING_REQUIRED");
  const abandonedCalibration = await prisma.gazeCalibration.findUniqueOrThrow({
    where: { id: calibrationId },
  });
  assert.equal(abandonedCalibration.state, "ABANDONED");

  const replacementEvidenceObject = await prisma.evidenceObject.create({
    data: {
      sessionId,
      kind: "SESSION_RECORDING",
      storageBucket: "test-recordings",
      storageKey: `gaze-calibration/${sessionId}-replacement.mp4`,
      contentType: "video/mp4",
      metadata: {
        livekit: {
          recordingScope: "candidate_track",
          participantId: participants.candidateParticipant.id,
        },
      },
    },
  });
  const replacementRecording = await prisma.sessionRecording.create({
    data: {
      sessionId,
      egressId: `gaze-calibration-${sessionId}-replacement`,
      evidenceObjectId: replacementEvidenceObject.id,
      startedAt: new Date(),
    },
  });
  const restarted = await jsonRequest(server, `/sessions/${sessionId}/gaze-calibrations`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(restarted.response.status, 201);
  calibrationId = restarted.body.gazeCalibration.id;
  const restartedCalibration = await prisma.gazeCalibration.findUniqueOrThrow({
    where: { id: calibrationId },
  });
  assert.equal(restartedCalibration.sessionRecordingId, replacementRecording.id);

  const restartedFirstStep = await jsonRequest(
    server,
    `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({ target: "center", sequence: 1 }),
    },
  );
  assert.equal(restartedFirstStep.response.status, 200);

  const revokeCalibrationConsent = await jsonRequest(
    server,
    `/sessions/${sessionId}/media-consent/${calibrationConsent.body.mediaConsent.id}/revoke`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({}),
    },
  );
  assert.equal(revokeCalibrationConsent.response.status, 200);

  const blockedAfterRevoke = await jsonRequest(
    server,
    `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({ target: "upper_left", sequence: 2 }),
    },
  );
  assert.equal(blockedAfterRevoke.response.status, 409);
  assert.equal(blockedAfterRevoke.body.error.code, "MEDIA_CONSENT_REQUIRED");

  const renewedCalibrationConsent = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [
        MEDIA_CONSENT_SCOPES.sessionRecording,
        MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
        MEDIA_CONSENT_SCOPES.videoGazeCalibration,
      ],
    }),
  });
  assert.equal(renewedCalibrationConsent.response.status, 201);

  const invalidStep = await jsonRequest(
    server,
    `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({ target: "upper_right", sequence: 2, faceLandmarks: ["blocked"] }),
    },
  );
  assert.equal(invalidStep.response.status, 400);
  assert.equal(invalidStep.body.error.code, "BAD_REQUEST");

  for (const step of [
    { target: "upper_left", sequence: 2 },
    { target: "upper_right", sequence: 3 },
    { target: "lower_left", sequence: 4 },
    { target: "lower_right", sequence: 5 },
  ]) {
    const result = await jsonRequest(
      server,
      `/sessions/${sessionId}/gaze-calibrations/${calibrationId}/steps`,
      {
        method: "POST",
        headers: participants.candidateHeaders,
        body: JSON.stringify(step),
      },
    );
    assert.equal(result.response.status, 200);
  }

  const complete = await prisma.gazeCalibration.findUnique({
    where: { id: calibrationId },
  });
  assert.equal(complete?.state, "COMPLETED");
  assert.equal(complete?.steps.length, 5);
});

test("session routes require an active interviewer and current media consent before recording", async (t) => {
  const fakeEgressClient = {
    startCalls: [],
    async startParticipantEgress(...args) {
      this.startCalls.push(args);
      return {
        egressId: "egress-should-not-start",
        roomName: args[0],
        status: 1,
      };
    },
  };
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
          startsWith: `${testRunId}-recording-consent-gate`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sessionResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording-consent-gate interview`,
    }),
  });
  const sessionId = sessionResult.body.session.id;
  const participants = await createRecordingParticipants(prisma, sessionId, "recording-consent-gate");

  const candidateResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.candidateHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(candidateResult.response.status, 403);
  assert.equal(candidateResult.body.error.code, "RECORDING_INTERVIEWER_REQUIRED");

  const noConsentResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(noConsentResult.response.status, 409);
  assert.equal(noConsentResult.body.error.code, "MEDIA_CONSENT_REQUIRED");
  assert.equal(fakeEgressClient.startCalls.length, 0);
});

test("recording consent requires an active interviewer and candidate before recording can start", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  const config = testConfig();
  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-recording-roles interview`,
    },
  });
  const interviewer = await prisma.user.create({
    data: {
      email: `interviewer.recording-roles.${testRunId}@example.test`,
      displayName: "Interviewer recording roles",
      role: "INTERVIEWER",
    },
  });
  const participant = await prisma.participant.create({
    data: {
      sessionId: session.id,
      userId: interviewer.id,
      role: "INTERVIEWER",
      joinedAt: new Date(),
    },
  });
  await prisma.mediaConsent.create({
    data: {
      sessionId: session.id,
      participantId: participant.id,
      noticeVersion: config.mediaConsentNoticeVersion,
      noticeFingerprint: config.mediaConsentNoticeFingerprint,
      scopes: [MEDIA_CONSENT_SCOPES.sessionRecording],
      grantedAt: new Date(),
    },
  });
  t.after(async () => {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: interviewer.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  await assert.rejects(
    () => requireActiveRecordingConsents(prisma, config, session.id),
    /An active interviewer and candidate must consent before recording or media analysis/,
  );
});

test("session routes block late participants after recording begins", async (t) => {
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  const session = await prisma.session.create({
    data: {
      title: `${testRunId}-recording-join-lock interview`,
    },
  });
  const evidence = await prisma.evidenceObject.create({
    data: {
      sessionId: session.id,
      kind: "SESSION_RECORDING",
      storageBucket: "anecites-test",
      storageKey: `recordings/${session.id}/join-lock.mp4`,
      contentType: "video/mp4",
    },
  });
  await prisma.sessionRecording.create({
    data: {
      sessionId: session.id,
      egressId: `egress-${session.id}-join-lock`,
      evidenceObjectId: evidence.id,
      state: "ACTIVE",
      startedAt: new Date(),
    },
  });
  t.after(async () => {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: {
        email: `late-participant.${testRunId}@example.test`,
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const joinResult = await jsonRequest(server, `/sessions/${session.id}/participants`, {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `late-participant.${testRunId}@example.test`,
        displayName: "Late participant",
      },
    }),
  });

  assert.equal(joinResult.response.status, 409);
  assert.deepEqual(joinResult.body, {
    error: {
      code: "RECORDING_PARTICIPANT_JOIN_BLOCKED",
      message: "Participants cannot join while a session recording is active",
    },
  });
  assert.equal(
    await prisma.user.count({
      where: {
        email: `late-participant.${testRunId}@example.test`,
      },
    }),
    0,
  );
});

test("candidate-scoped recording rejects sessions with multiple active candidates", async (t) => {
  const fakeEgressClient = {
    startCalls: [],
    async startParticipantEgress(...args) {
      this.startCalls.push(args);
      return {
        egressId: "egress-multiple-candidates",
        roomName: args[0],
        status: 1,
      };
    },
  };
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
          startsWith: `${testRunId}-multiple-candidates`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-multiple-candidates interview`,
    }),
  });
  const sessionId = createResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "multiple-candidates-primary",
  );
  const secondCandidateUser = await prisma.user.create({
    data: {
      email: `candidate.multiple-candidates-secondary.${testRunId}@example.test`,
      displayName: "Second Candidate",
      role: "CANDIDATE",
    },
  });
  await prisma.participant.create({
    data: {
      sessionId,
      userId: secondCandidateUser.id,
      role: "CANDIDATE",
      joinedAt: new Date(),
    },
  });
  const secondCandidateHeaders = await authorizationHeader("candidate", secondCandidateUser.id);
  const secondCandidateConsent = await jsonRequest(server, `/sessions/${sessionId}/media-consent`, {
    method: "POST",
    headers: secondCandidateHeaders,
    body: JSON.stringify({
      accepted: true,
      scopes: [
        MEDIA_CONSENT_SCOPES.sessionRecording,
        MEDIA_CONSENT_SCOPES.videoFaceAnalysis,
      ],
    }),
  });
  assert.equal(secondCandidateConsent.response.status, 201);

  const startResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 409);
  assert.equal(startResult.body.error.code, "LIVEKIT_RECORDING_CANDIDATE_REQUIRED");
  assert.equal(fakeEgressClient.startCalls.length, 0);
});

test("session routes start and stop candidate-scoped LiveKit recordings", async (t) => {
  const fakeMediaAnalysisPublisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  const fakeEgressClient = {
    startCalls: [],
    stopCalls: [],
    async startParticipantEgress(roomName, participantIdentity, output, options) {
      this.startCalls.push({ roomName, participantIdentity, output, options });
      return {
        egressId: "egress-test-1",
        roomName,
        status: 1,
      };
    },
    async stopEgress(egressId) {
      this.stopCalls.push(egressId);
      return {
        egressId,
        roomName: "session-stopped",
        status: 3,
      };
    },
  };
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
          startsWith: `${testRunId}-recording`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      LIVEKIT_RECORDING_KEY_PREFIX: "recordings/livekit",
      MEDIA_ANALYSIS_ENABLED: "true",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
      mediaAnalysisPublisher: fakeMediaAnalysisPublisher,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording interview`,
    }),
  });
  const sessionId = createResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "recording",
  );

  const startResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 201);
  assert.equal(startResult.body.recording.egressId, "egress-test-1");
  assert.equal(startResult.body.recording.roomName, `session-${sessionId}`);
  assert.equal(startResult.body.recording.status, 1);
  assert.equal(typeof startResult.body.recording.evidenceObjectId, "string");
  assert.match(
    startResult.body.recording.storageKey,
    new RegExp(`^recordings/livekit/${sessionId}/[0-9a-f-]{36}\\.mp4$`),
  );
  assert.equal(startResult.body.sessionRecording.egressId, "egress-test-1");
  assert.equal(startResult.body.sessionRecording.evidenceObjectId, startResult.body.recording.evidenceObjectId);
  assert.equal(startResult.body.sessionRecording.state, "active");
  assert.equal(fakeEgressClient.startCalls.length, 1);

  const interviewerRecordingStatus = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    headers: participants.interviewerHeaders,
  });
  assert.equal(interviewerRecordingStatus.response.status, 200);
  assert.deepEqual(interviewerRecordingStatus.body.recordingStatus, {
    state: "active",
    startedAt: startResult.body.sessionRecording.startedAt,
    stopRequestedAt: null,
    completedAt: null,
  });
  assert.deepEqual(interviewerRecordingStatus.body.recordingControl, {
    egressId: "egress-test-1",
  });

  const candidateRecordingStatus = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    headers: participants.candidateHeaders,
  });
  assert.equal(candidateRecordingStatus.response.status, 200);
  assert.deepEqual(candidateRecordingStatus.body.recordingStatus, interviewerRecordingStatus.body.recordingStatus);
  assert.equal(candidateRecordingStatus.body.recordingControl, null);
  assert.doesNotMatch(JSON.stringify(candidateRecordingStatus.body.recordingStatus), /egress|evidence/i);

  assert.equal(fakeEgressClient.startCalls[0].roomName, `session-${sessionId}`);
  assert.equal(
    fakeEgressClient.startCalls[0].participantIdentity,
    `participant-${participants.candidateParticipant.id}`,
  );
  assert.equal(fakeEgressClient.startCalls[0].options.screenShare, false);
  assert.match(
    fakeEgressClient.startCalls[0].output.file.filepath,
    new RegExp(`^recordings/livekit/${sessionId}/[0-9a-f-]{36}\\.mp4$`),
  );
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.case, "s3");
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.value.endpoint, "http://minio:9000");
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.value.bucket, "anecites-dev");
  assert.equal(fakeEgressClient.startCalls[0].output.file.output.value.forcePathStyle, true);

  const recordingEvidence = await prisma.evidenceObject.findUniqueOrThrow({
    where: {
      id: startResult.body.recording.evidenceObjectId,
    },
  });
  assert.equal(recordingEvidence.sessionId, sessionId);
  assert.equal(recordingEvidence.kind, "SESSION_RECORDING");
  assert.equal(recordingEvidence.storageBucket, "anecites-dev");
  assert.equal(recordingEvidence.storageKey, startResult.body.recording.storageKey);
  assert.equal(recordingEvidence.contentType, "video/mp4");
  assert.deepEqual(recordingEvidence.metadata.livekit, {
    egressId: "egress-test-1",
    roomName: `session-${sessionId}`,
    status: 1,
    recordingScope: "candidate_track",
    participantId: participants.candidateParticipant.id,
  });
  assert.deepEqual(
    recordingEvidence.metadata.mediaConsent.participants.map((consent) => consent.participantRole),
    ["interviewer", "candidate"],
  );
  assert.deepEqual(
    recordingEvidence.metadata.mediaConsent.participants.map((consent) => consent.scopes),
    [["session_recording"], ["session_recording", "video_face_analysis"]],
  );
  assert.equal(
    recordingEvidence.metadata.mediaConsent.participants.every(
      (consent) => /^[a-f0-9]{64}$/.test(consent.noticeFingerprint),
    ),
    true,
  );

  const duplicateStartResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(duplicateStartResult.response.status, 409);
  assert.equal(duplicateStartResult.body.error.code, "LIVEKIT_RECORDING_ALREADY_ACTIVE");
  assert.equal(fakeEgressClient.startCalls.length, 1);

  const stopResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording/egress-test-1/stop`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });

  assert.equal(stopResult.response.status, 200);
  assert.deepEqual(fakeEgressClient.stopCalls, ["egress-test-1"]);
  assert.equal(stopResult.body.recording.egressId, "egress-test-1");
  assert.equal(stopResult.body.recording.status, 3);
  assert.equal(stopResult.body.sessionRecording.state, "completed");
  assert.equal(stopResult.body.mediaAnalysis.status, "queued");
  assert.equal(fakeMediaAnalysisPublisher.calls.length, 1);

  const completedRecordingStatus = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    headers: participants.candidateHeaders,
  });
  assert.equal(completedRecordingStatus.response.status, 200);
  assert.equal(completedRecordingStatus.body.recordingStatus.state, "completed");
  assert.equal(completedRecordingStatus.body.recordingControl, null);
  assert.deepEqual(fakeMediaAnalysisPublisher.calls[0], {
    version: 1,
    jobId: `media-analysis:${recordingEvidence.id}`,
    sessionId,
    participantId: participants.candidateParticipant.id,
    recordingEvidenceObjectId: recordingEvidence.id,
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
    JSON.stringify(fakeMediaAnalysisPublisher.calls[0]),
    /accessKey|secret|rawMedia|storageKey/i,
  );
});

test("session routes stop recording but skip media analysis after consent is withdrawn", async (t) => {
  const fakeMediaAnalysisPublisher = {
    calls: [],
    async publish(job) {
      this.calls.push(job);
    },
  };
  const fakeEgressClient = {
    stopCalls: [],
    async startParticipantEgress(roomName) {
      return {
        egressId: "egress-withdrawal",
        roomName,
        status: 1,
      };
    },
    async stopEgress(egressId) {
      this.stopCalls.push(egressId);
      return {
        egressId,
        roomName: "session-withdrawal",
        status: 3,
      };
    },
  };
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
          startsWith: `${testRunId}-recording-withdrawal`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      MEDIA_ANALYSIS_ENABLED: "true",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
      mediaAnalysisPublisher: fakeMediaAnalysisPublisher,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sessionResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording-withdrawal interview`,
    }),
  });
  const sessionId = sessionResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "recording-withdrawal",
  );

  const startResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(startResult.response.status, 201);

  const revokeResult = await jsonRequest(
    server,
    `/sessions/${sessionId}/media-consent/${participants.candidateConsent.id}/revoke`,
    {
      method: "POST",
      headers: participants.candidateHeaders,
      body: JSON.stringify({}),
    },
  );
  assert.equal(revokeResult.response.status, 200);

  const stopResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording/egress-withdrawal/stop`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(stopResult.response.status, 200);
  assert.equal(stopResult.body.mediaAnalysis.status, "not_published_consent_required");
  assert.deepEqual(fakeEgressClient.stopCalls, ["egress-withdrawal"]);
  assert.equal(fakeMediaAnalysisPublisher.calls.length, 0);
});

test("session state transitions start and stop one consented recording when automatic lifecycle is enabled", async (t) => {
  const fakeEgressClient = {
    startCalls: [],
    stopCalls: [],
    async startParticipantEgress(roomName, participantIdentity, output, options) {
      this.startCalls.push({ roomName, participantIdentity, output, options });
      return {
        egressId: "egress-auto-lifecycle",
        roomName,
        status: 1,
      };
    },
    async stopEgress(egressId) {
      this.stopCalls.push(egressId);
      return {
        egressId,
        roomName: "session-auto-lifecycle",
        status: 3,
      };
    },
  };
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
          startsWith: `${testRunId}-auto-recording`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      LIVEKIT_RECORDING_AUTO_LIFECYCLE_ENABLED: "true",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sessionResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-auto-recording interview`,
    }),
  });
  const sessionId = sessionResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "auto-recording",
  );

  for (const state of ["scheduled", "lobby"]) {
    const transitionResult = await jsonRequest(server, `/sessions/${sessionId}/state`, {
      method: "PATCH",
      headers: participants.interviewerHeaders,
      body: JSON.stringify({ state }),
    });
    assert.equal(transitionResult.response.status, 200);
  }

  const activeResult = await jsonRequest(server, `/sessions/${sessionId}/state`, {
    method: "PATCH",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({ state: "active" }),
  });
  assert.equal(activeResult.response.status, 200);
  assert.equal(activeResult.body.session.state, "active");
  assert.equal(activeResult.body.recording.egressId, "egress-auto-lifecycle");
  assert.equal(activeResult.body.sessionRecording.state, "active");
  assert.equal(fakeEgressClient.startCalls.length, 1);

  const endedResult = await jsonRequest(server, `/sessions/${sessionId}/state`, {
    method: "PATCH",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({ state: "ended" }),
  });
  assert.equal(endedResult.response.status, 200);
  assert.equal(endedResult.body.session.state, "ended");
  assert.equal(endedResult.body.recording.egressId, "egress-auto-lifecycle");
  assert.equal(endedResult.body.sessionRecording.state, "completed");
  assert.deepEqual(fakeEgressClient.stopCalls, ["egress-auto-lifecycle"]);

  const recording = await prisma.sessionRecording.findUniqueOrThrow({
    where: {
      egressId: "egress-auto-lifecycle",
    },
  });
  assert.equal(recording.state, "COMPLETED");
});

test("session routes do not create recording evidence when LiveKit egress start fails", async (t) => {
  const fakeEgressClient = {
    async startParticipantEgress() {
      throw new Error("egress unavailable");
    },
  };
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
          startsWith: `${testRunId}-recording-egress-fail`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "anecites-dev",
      S3_ACCESS_KEY_ID: "anecites",
      S3_SECRET_ACCESS_KEY: "anecites_dev_password",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      LIVEKIT_RECORDING_KEY_PREFIX: "recordings/livekit",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording-egress-fail interview`,
    }),
  });
  const sessionId = createResult.body.session.id;
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    sessionId,
    "recording-egress-fail",
  );

  const startResult = await jsonRequest(server, `/sessions/${sessionId}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 502);

  const evidenceCount = await prisma.evidenceObject.count({
    where: {
      sessionId,
      kind: "SESSION_RECORDING",
    },
  });
  assert.equal(evidenceCount, 0);
});

test("session routes fail closed when LiveKit recording storage is unavailable", async (t) => {
  const fakeEgressClient = {
    async startParticipantEgress() {
      throw new Error("should not be called");
    },
  };
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
          startsWith: `${testRunId}-recording-missing`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(
    testConfig({
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test_livekit_key",
      LIVEKIT_API_SECRET: "test_livekit_secret_minimum_32_characters",
    }),
    {
      logger: quietLogger(),
      prisma,
      liveKitEgressClient: fakeEgressClient,
    },
  );
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-recording-missing interview`,
    }),
  });
  const participants = await createConsentedRecordingParticipants(
    prisma,
    server,
    createResult.body.session.id,
    "recording-missing",
  );

  const startResult = await jsonRequest(server, `/sessions/${createResult.body.session.id}/livekit-recording`, {
    method: "POST",
    headers: participants.interviewerHeaders,
    body: JSON.stringify({}),
  });

  assert.equal(startResult.response.status, 503);
  assert.deepEqual(startResult.body, {
    error: {
      code: "LIVEKIT_RECORDING_NOT_CONFIGURED",
      message: "LiveKit recording storage is not configured",
    },
  });
});

test("session routes persist native monitoring risk reports", async (t) => {
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
          startsWith: `${testRunId}-native-risk`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.native-risk.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig({
    MONITORING_PROHIBITED_APPLICATION_RULES_JSON: JSON.stringify([
      {
        id: "interview.assistant",
        processNames: ["assistant.exe"],
        windowTitleContains: ["interview helper"],
      },
    ]),
  }), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-native-risk interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader("candidate"),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.native-risk.${testRunId}@example.test`,
        displayName: "Candidate Native Risk",
      },
    }),
  });
  const participant = joinResult.body.participant;
  const monitoring = await startMonitoringForParticipant(
    server,
    sessionId,
    participant,
    `native-risk-${testRunId}`,
  );
  const nativeRiskRequestBody = {
    participantId: participant.id,
    monitoringConsentId: monitoring.monitoringConsentId,
    windowStartedAt: "2026-07-11T01:02:00.000Z",
    windowEndedAt: "2026-07-11T01:03:00.000Z",
    nativeReport: {
      occurredAt: "2026-07-11T01:02:30.000Z",
      captureAffinityReports: [
        {
          platform: "windows",
          windowId: "1002",
          protectedFromCapture: true,
        },
      ],
      virtualizationReports: [
        {
          platform: "windows",
          signals: [
            {
              name: "cpuid.hypervisor_present",
              detected: true,
              detail: "vendor=Microsoft Hv",
            },
          ],
        },
      ],
      prohibitedApplicationMatches: [
        {
          ruleId: "interview.assistant",
          matchKinds: ["process_name", "window_title"],
        },
      ],
    },
  };

  const forgedRiskResult = await jsonRequest(server, `/sessions/${sessionId}/native-risk-report`, {
    method: "POST",
    headers: await authorizationHeader("candidate", `other-candidate-${testRunId}`),
    body: JSON.stringify(nativeRiskRequestBody),
  });
  assert.equal(forgedRiskResult.response.status, 403);
  assert.equal(forgedRiskResult.body.error.code, "MONITORING_PARTICIPANT_FORBIDDEN");

  const nativeRiskResult = await jsonRequest(server, `/sessions/${sessionId}/native-risk-report`, {
    method: "POST",
    headers: monitoring.headers,
    body: JSON.stringify(nativeRiskRequestBody),
  });

  assert.equal(nativeRiskResult.response.status, 201);
  assert.equal(nativeRiskResult.body.signalCount, 3);
  assert.equal(nativeRiskResult.body.riskSummary.sessionId, sessionId);
  assert.equal(nativeRiskResult.body.riskSummary.reviewStatus, "pending_review");
  assert.equal(nativeRiskResult.body.riskSummary.score, 0.85);
  assert.deepEqual(nativeRiskResult.body.riskSummary.signalBreakdown, [
    {
      category: "native",
      count: 3,
      maxWeight: 0.85,
      types: [
        "risk.native.capture_affinity",
        "risk.native.vm_signal",
        "risk.native.prohibited_application",
      ],
    },
  ]);

  const persisted = await prisma.riskSummary.findUniqueOrThrow({
    where: {
      id: nativeRiskResult.body.riskSummary.id,
    },
  });
  assert.equal(persisted.reviewStatus, "PENDING_REVIEW");
});

test("session routes ignore clean native monitoring reports", async (t) => {
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
          startsWith: `${testRunId}-native-clean`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.native-clean.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-native-clean interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const joinResult = await jsonRequest(server, `/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: await authorizationHeader("candidate"),
    body: JSON.stringify({
      role: "candidate",
      user: {
        email: `candidate.native-clean.${testRunId}@example.test`,
        displayName: "Candidate Native Clean",
      },
    }),
  });
  const monitoring = await startMonitoringForParticipant(
    server,
    sessionId,
    joinResult.body.participant,
    `native-clean-${testRunId}`,
  );

  const nativeRiskResult = await jsonRequest(server, `/sessions/${sessionId}/native-risk-report`, {
    method: "POST",
    headers: monitoring.headers,
    body: JSON.stringify({
      participantId: joinResult.body.participant.id,
      monitoringConsentId: monitoring.monitoringConsentId,
      windowStartedAt: "2026-07-11T01:02:00.000Z",
      windowEndedAt: "2026-07-11T01:03:00.000Z",
      nativeReport: {
        occurredAt: "2026-07-11T01:02:30.000Z",
        captureAffinityReports: [
          {
            platform: "windows",
            windowId: "1001",
            protectedFromCapture: false,
          },
        ],
        virtualizationReports: [
          {
            platform: "windows",
            signals: [
              {
                name: "cpuid.hypervisor_present",
                detected: false,
              },
            ],
          },
        ],
      },
    }),
  });

  assert.equal(nativeRiskResult.response.status, 202);
  assert.deepEqual(nativeRiskResult.body, {
    signalCount: 0,
    riskSummary: null,
  });
});

test("session routes list risk summaries for privileged reviewers", async (t) => {
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
          startsWith: `${testRunId}-risk-review`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-risk-review interview`,
    }),
  });
  const sessionId = createResult.body.session.id;

  const olderSummary = await createRiskSummary(prisma, {
    sessionId,
    windowStartedAt: "2026-07-11T01:00:00.000Z",
    windowEndedAt: "2026-07-11T01:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.editorAtomicInsert,
        weight: 0.8,
        occurredAt: "2026-07-11T01:00:10.000Z",
      },
    ],
  });
  const newerSummary = await createRiskSummary(prisma, {
    sessionId,
    windowStartedAt: "2026-07-11T01:02:00.000Z",
    windowEndedAt: "2026-07-11T01:03:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: 0.5,
        occurredAt: "2026-07-11T01:02:30.000Z",
      },
    ],
  });

  const listResult = await jsonRequest(server, `/sessions/${sessionId}/risk-summaries`, {
    headers: await authorizationHeader("reviewer"),
  });

  assert.equal(listResult.response.status, 200);
  assert.deepEqual(
    listResult.body.riskSummaries.map((summary) => summary.id),
    [newerSummary.id, olderSummary.id],
  );
  assert.equal(listResult.body.riskSummaries[0].reviewStatus, "pending_review");
  assert.equal("rawEvidence" in listResult.body.riskSummaries[0], false);

  const invalidFilterResult = await jsonRequest(server, `/sessions/${sessionId}/risk-summaries?reviewStatus=invalid`, {
    headers: await authorizationHeader("reviewer"),
  });

  assert.equal(invalidFilterResult.response.status, 400);
});

test("session routes reject candidate access to reviewer risk summaries", async (t) => {
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
          startsWith: `${testRunId}-risk-forbidden`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-risk-forbidden interview`,
    }),
  });

  const listResult = await jsonRequest(server, `/sessions/${createResult.body.session.id}/risk-summaries`, {
    headers: await authorizationHeader("candidate"),
  });

  assert.equal(listResult.response.status, 403);
  assert.deepEqual(listResult.body, {
    error: {
      code: "FORBIDDEN",
      message: "Reviewer access is required",
    },
  });
});

test("session routes allow privileged reviewer users to update risk summary review status", async (t) => {
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
          startsWith: `${testRunId}-risk-action`,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: `.risk-action.${testRunId}@example.test`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const reviewer = await prisma.user.create({
    data: {
      email: `reviewer.risk-action.${testRunId}@example.test`,
      displayName: "Reviewer Action",
      role: "REVIEWER",
    },
  });
  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-risk-action interview`,
    }),
  });
  const sessionId = createResult.body.session.id;
  const summary = await createRiskSummary(prisma, {
    sessionId,
    windowStartedAt: "2026-07-11T01:00:00.000Z",
    windowEndedAt: "2026-07-11T01:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: 0.5,
        occurredAt: "2026-07-11T01:00:30.000Z",
      },
    ],
  });

  const reviewResult = await jsonRequest(server, `/sessions/${sessionId}/risk-summaries/${summary.id}/review`, {
    method: "PATCH",
    headers: await authorizationHeader("reviewer", reviewer.id),
    body: JSON.stringify({
      reviewStatus: "needs_more_context",
    }),
  });

  assert.equal(reviewResult.response.status, 200);
  assert.equal(reviewResult.body.riskSummary.id, summary.id);
  assert.equal(reviewResult.body.riskSummary.reviewStatus, "needs_more_context");
  assert.equal(reviewResult.body.riskSummary.reviewerId, reviewer.id);
  assert.equal(typeof reviewResult.body.riskSummary.reviewedAt, "string");
  assert.equal(reviewResult.body.riskSummary.score, summary.score);
  assert.deepEqual(reviewResult.body.riskSummary.signalBreakdown, summary.signalBreakdown);

  const invalidStatusResult = await jsonRequest(server, `/sessions/${sessionId}/risk-summaries/${summary.id}/review`, {
    method: "PATCH",
    headers: await authorizationHeader("reviewer", reviewer.id),
    body: JSON.stringify({
      reviewStatus: "invalid",
    }),
  });

  assert.equal(invalidStatusResult.response.status, 400);
});

test("session routes reject candidate review status updates", async (t) => {
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
          startsWith: `${testRunId}-risk-action-forbidden`,
        },
      },
    });
    await prisma.$disconnect();
  });

  const app = createApp(testConfig(), {
    logger: quietLogger(),
    prisma,
  });
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const createResult = await jsonRequest(server, "/sessions", {
    method: "POST",
    headers: await authorizationHeader(),
    body: JSON.stringify({
      title: `${testRunId}-risk-action-forbidden interview`,
    }),
  });
  const sessionId = createResult.body.session.id;
  const summary = await createRiskSummary(prisma, {
    sessionId,
    windowStartedAt: "2026-07-11T01:00:00.000Z",
    windowEndedAt: "2026-07-11T01:01:00.000Z",
    signals: [
      {
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: 0.5,
        occurredAt: "2026-07-11T01:00:30.000Z",
      },
    ],
  });

  const reviewResult = await jsonRequest(server, `/sessions/${sessionId}/risk-summaries/${summary.id}/review`, {
    method: "PATCH",
    headers: await authorizationHeader("candidate"),
    body: JSON.stringify({
      reviewStatus: "dismissed",
    }),
  });

  assert.equal(reviewResult.response.status, 403);
  assert.deepEqual(reviewResult.body, {
    error: {
      code: "FORBIDDEN",
      message: "Reviewer access is required",
    },
  });
});
