import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import test from "node:test";

import { MONITORING_POLICY_VERSION } from "@anecites/shared";
import {
  beginCandidateMonitoringLifecycle,
  verifyNativeMonitoringPolicyManifest,
} from "../dist/monitoring.js";

test("candidate monitoring lifecycle sends consent, ordered heartbeats, and stop to the backend", async () => {
  const calls = [];
  const intervals = [];
  let nowIndex = 0;
  const timestamps = [
    "2026-07-14T10:00:00.000Z",
    "2026-07-14T10:00:01.000Z",
    "2026-07-14T10:00:11.000Z",
    "2026-07-14T10:00:12.000Z",
  ];
  const policyPayload = {
    schemaVersion: 1,
    policyVersion: MONITORING_POLICY_VERSION,
    prohibitedApplicationRules: [
      {
        id: "interview.assistant",
        processNames: ["assistant.exe"],
        windowTitleContains: ["interview helper"],
      },
    ],
  };
  const lifecycle = await beginCandidateMonitoringLifecycle(
    {
      apiBaseUrl: "http://127.0.0.1:3000/",
      authToken: "candidate-token",
      sessionId: "session-1",
      participantId: "participant-1",
      clientInstanceId: "client-1",
      clientVersion: "0.0.0-test",
    },
    {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/monitoring/start")) {
          return jsonResponse(201, {
            monitoringConsent: { id: "consent-1", nextSequence: 1 },
            monitoringPolicy: {
              ...policyPayload,
              digestSha256: createHash("sha256").update(JSON.stringify(policyPayload)).digest("hex"),
              signature: null,
            },
          });
        }
        return jsonResponse(url.endsWith("/stop") ? 200 : 201, { ok: true });
      },
      now: () => new Date(timestamps[nowIndex++]),
      heartbeatIntervalMs: 5_000,
      setInterval: (callback, delay) => {
        intervals.push({ callback, delay, cleared: false });
        return 42;
      },
      clearInterval: () => {
        intervals[0].cleared = true;
      },
      allowUnsignedMonitoringPolicy: true,
      crypto: webcrypto,
    },
  );

  assert.equal(lifecycle.monitoringConsentId, "consent-1");
  assert.deepEqual(lifecycle.prohibitedApplicationRules, [
    {
      id: "interview.assistant",
      processNames: ["assistant.exe"],
      windowTitleContains: ["interview helper"],
    },
  ]);
  assert.equal(lifecycle.monitoringPolicyDigestSha256.length, 64);
  assert.equal(intervals[0].delay, 5_000);
  await lifecycle.heartbeat();
  const nativeSignalCount = await lifecycle.recordNativeRiskReport({
    occurredAt: "2026-07-14T10:00:11.500Z",
    captureAffinityReports: [
      {
        platform: "windows",
        windowId: "window-1",
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
  });
  await lifecycle.recordFocusLoss({
    reason: "document_hidden",
    startedAt: "2026-07-14T10:00:12.000Z",
    endedAt: "2026-07-14T10:00:15.500Z",
    durationMs: 3_500,
  });
  await lifecycle.stop("session_left");

  assert.equal(nativeSignalCount, 3);

  assert.deepEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:3000/sessions/session-1/monitoring/start",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/heartbeat",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/heartbeat",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/events",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/events",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/events",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/events",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/stop",
  ]);
  assert.deepEqual(calls.slice(1).map((call) => JSON.parse(call.init.body).sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(JSON.parse(calls[0].init.body).policyVersion, MONITORING_POLICY_VERSION);
  assert.deepEqual(JSON.parse(calls[0].init.body).scopes, [
    "process.scan",
    "window.scan",
    "capture_affinity.read",
    "vm.detect",
  ]);
  const nativeEvents = calls.slice(3, 6).map((call) => JSON.parse(call.init.body));
  assert.deepEqual(nativeEvents.map((event) => event.type), [
    "risk.native.capture_affinity",
    "risk.native.vm_signal",
    "risk.native.prohibited_application",
  ]);
  assert.equal(nativeEvents.every((event) => event.source === "desktop_native"), true);
  assert.equal(nativeEvents.every((event) => event.detectorVersion === "anecites-native-risk-v1"), true);
  assert.deepEqual(JSON.parse(calls[6].init.body), {
    sequence: 6,
    occurredAt: "2026-07-14T10:00:15.500Z",
    type: "risk.client.focus_lost",
    source: "desktop_app",
    confidence: 0.65,
    detectorVersion: "anecites-focus-v1",
    metadata: {
      reason: "document_hidden",
      startedAt: "2026-07-14T10:00:12.000Z",
      endedAt: "2026-07-14T10:00:15.500Z",
      durationMs: 3_500,
    },
  });
  assert.equal(JSON.parse(calls[7].init.body).reason, "session_left");
  assert.equal(intervals[0].cleared, true);
  assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer candidate-token"), true);
});

test("monitoring policy verification accepts a trusted Ed25519 signature and rejects tampering", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1,
    policyVersion: "2026-07-17.1",
    prohibitedApplicationRules: [
      { id: "fixture.assistant", processNames: ["fixture.exe"], windowTitleContains: [] },
    ],
  };
  const canonical = JSON.stringify(payload);
  const manifest = {
    ...payload,
    digestSha256: createHash("sha256").update(canonical).digest("hex"),
    signature: {
      algorithm: "Ed25519",
      keyId: "test-key",
      valueBase64: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
    },
  };
  const trustedPublicKeys = {
    "test-key": publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };

  const verified = await verifyNativeMonitoringPolicyManifest(manifest, {
    trustedPublicKeys,
    crypto: webcrypto,
  });
  assert.equal(verified.digestSha256, manifest.digestSha256);
  await assert.rejects(
    () => verifyNativeMonitoringPolicyManifest({
      ...manifest,
      prohibitedApplicationRules: [
        { id: "fixture.replacement", processNames: ["replacement.exe"], windowTitleContains: [] },
      ],
    }, { trustedPublicKeys, crypto: webcrypto }),
    /digest is invalid/,
  );
});

test("candidate monitoring lifecycle does not emit timeline events for clean native reports", async () => {
  const calls = [];
  const lifecycle = await beginCandidateMonitoringLifecycle(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "candidate-token",
      sessionId: "session-1",
      participantId: "participant-1",
      clientInstanceId: "client-1",
      clientVersion: "0.0.0-test",
    },
    {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/monitoring/start")) {
          return jsonResponse(201, { monitoringConsent: { id: "consent-1", nextSequence: 1 } });
        }
        return jsonResponse(url.endsWith("/stop") ? 200 : 201, { ok: true });
      },
      now: () => new Date("2026-07-14T10:00:00.000Z"),
      heartbeatIntervalMs: 5_000,
      setInterval: () => 42,
      clearInterval: () => {},
    },
  );

  assert.deepEqual(lifecycle.prohibitedApplicationRules, []);
  const signalCount = await lifecycle.recordNativeRiskReport({
    occurredAt: "2026-07-14T10:00:01.000Z",
    captureAffinityReports: [],
    virtualizationReports: [],
  });
  await lifecycle.stop("client_shutdown");

  assert.equal(signalCount, 0);
  assert.deepEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:3000/sessions/session-1/monitoring/start",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/heartbeat",
    "http://127.0.0.1:3000/sessions/session-1/monitoring/consent-1/stop",
  ]);
  assert.deepEqual(calls.slice(1).map((call) => JSON.parse(call.init.body).sequence), [1, 2]);
});

test("candidate monitoring lifecycle reports remote sessions and display topology changes once context exists", async () => {
  const events = [];
  const lifecycle = await beginCandidateMonitoringLifecycle(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "candidate-token",
      sessionId: "session-1",
      participantId: "participant-1",
      clientInstanceId: "client-1",
      clientVersion: "0.0.0-test",
    },
    {
      fetch: async (url, init) => {
        if (url.endsWith("/monitoring/start")) {
          return jsonResponse(201, { monitoringConsent: { id: "consent-1", nextSequence: 1 } });
        }
        if (url.endsWith("/events")) {
          events.push(JSON.parse(init.body));
        }
        return jsonResponse(url.endsWith("/stop") ? 200 : 201, { ok: true });
      },
      now: () => new Date("2026-07-14T10:00:00.000Z"),
      heartbeatIntervalMs: 5_000,
      setInterval: () => 42,
      clearInterval: () => {},
    },
  );

  await lifecycle.recordNativeRiskReport({
    occurredAt: "2026-07-14T10:00:01.000Z",
    environmentReports: [{ platform: "windows", remoteSession: false, monitorCount: 1 }],
  });
  await lifecycle.recordNativeRiskReport({
    occurredAt: "2026-07-14T10:00:02.000Z",
    environmentReports: [{ platform: "windows", remoteSession: true, monitorCount: 2 }],
  });
  await lifecycle.stop("client_shutdown");

  assert.deepEqual(events.map((event) => event.type), [
    "risk.native.remote_session",
    "risk.native.display_topology_change",
  ]);
});

test("candidate monitoring lifecycle does not advance sequence after a failed heartbeat", async () => {
  const sequences = [];
  let heartbeatAttempts = 0;
  const lifecycle = await beginCandidateMonitoringLifecycle(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "candidate-token",
      sessionId: "session-1",
      participantId: "participant-1",
      clientInstanceId: "client-1",
      clientVersion: "0.0.0-test",
    },
    {
      fetch: async (url, init) => {
        if (url.endsWith("/monitoring/start")) {
          return jsonResponse(201, { monitoringConsent: { id: "consent-1", nextSequence: 1 } });
        }
        const body = JSON.parse(init.body);
        sequences.push(body.sequence);
        if (url.endsWith("/heartbeat") && heartbeatAttempts++ === 1) {
          return jsonResponse(502, { error: { message: "temporary failure" } });
        }
        return jsonResponse(url.endsWith("/stop") ? 200 : 201, { ok: true });
      },
      now: () => new Date("2026-07-14T10:00:00.000Z"),
      heartbeatIntervalMs: 5_000,
      setInterval: () => 42,
      clearInterval: () => {},
    },
  );

  await assert.rejects(() => lifecycle.heartbeat(), /temporary failure/);
  await lifecycle.heartbeat();
  await lifecycle.stop("client_shutdown");
  assert.deepEqual(sequences, [1, 2, 2, 3]);
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
