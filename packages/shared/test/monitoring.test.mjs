import assert from "node:assert/strict";
import test from "node:test";

import {
  MONITORING_POLICY_VERSION,
  MONITORING_SCOPES,
  RISK_SIGNAL_TYPES,
  createMonitoringHeartbeatRequest,
  createMonitoringRiskEventRequest,
  createMonitoringStartRequest,
  createMonitoringStopRequest,
  canonicalizeNativeMonitoringPolicyPayload,
  createNativeMonitoringPolicyManifest,
} from "../dist/index.js";

test("monitoring contracts normalize explicit consent and remove duplicate scopes", () => {
  assert.deepEqual(createMonitoringStartRequest({
    participantId: " candidate-1 ",
    policyVersion: MONITORING_POLICY_VERSION,
    scopes: [MONITORING_SCOPES[0], MONITORING_SCOPES[0], MONITORING_SCOPES[1]],
    clientInstanceId: " client-1 ",
    clientVersion: " 0.0.0 ",
    grantedAt: "2026-07-14T10:00:00Z",
  }), {
    participantId: "candidate-1",
    policyVersion: MONITORING_POLICY_VERSION,
    scopes: ["process.scan", "window.scan"],
    clientInstanceId: "client-1",
    clientVersion: "0.0.0",
    grantedAt: "2026-07-14T10:00:00.000Z",
  });
});

test("native monitoring policy manifests are versioned, canonical, and bounded", () => {
  const manifest = createNativeMonitoringPolicyManifest({
    schemaVersion: 1,
    policyVersion: "2026-07-17.1",
    prohibitedApplicationRules: [
      {
        id: "Interview.Assistant",
        processNames: ["Assistant.EXE"],
        windowTitleContains: [],
      },
    ],
    digestSha256: "a".repeat(64),
    signature: {
      algorithm: "Ed25519",
      keyId: "monitoring-policy-2026-01",
      valueBase64: Buffer.alloc(64, 7).toString("base64"),
    },
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.prohibitedApplicationRules[0].id, "interview.assistant");
  assert.equal(canonicalizeNativeMonitoringPolicyPayload(manifest), JSON.stringify({
    schemaVersion: 1,
    policyVersion: "2026-07-17.1",
    prohibitedApplicationRules: [
      {
        id: "interview.assistant",
        processNames: ["assistant.exe"],
        windowTitleContains: [],
      },
    ],
  }));
});

test("native monitoring policy manifests reject malformed integrity metadata", () => {
  assert.throws(() => createNativeMonitoringPolicyManifest({
    schemaVersion: 2,
    policyVersion: "2026-07-17.1",
    prohibitedApplicationRules: [],
    digestSha256: "a".repeat(64),
    signature: null,
  }), /schemaVersion/);
  assert.throws(() => createNativeMonitoringPolicyManifest({
    schemaVersion: 1,
    policyVersion: "2026-07-17.1",
    prohibitedApplicationRules: [],
    digestSha256: "not-a-digest",
    signature: null,
  }), /digestSha256/);
});

test("monitoring contracts enforce ordered sequence inputs and bounded risk events", () => {
  assert.deepEqual(createMonitoringHeartbeatRequest({ sequence: 1, occurredAt: "2026-07-14T10:00:01Z" }), {
    sequence: 1,
    occurredAt: "2026-07-14T10:00:01.000Z",
  });
  assert.deepEqual(createMonitoringRiskEventRequest({
    sequence: 2,
    occurredAt: "2026-07-14T10:00:02Z",
    type: RISK_SIGNAL_TYPES.nativeVmSignal,
    source: "desktop_native",
    confidence: 0.6,
    detectorVersion: "native-1",
    metadata: { signalCount: 2 },
  }), {
    sequence: 2,
    occurredAt: "2026-07-14T10:00:02.000Z",
    type: "risk.native.vm_signal",
    source: "desktop_native",
    confidence: 0.6,
    detectorVersion: "native-1",
    metadata: { signalCount: 2 },
  });
  assert.deepEqual(createMonitoringStopRequest({
    sequence: 3,
    occurredAt: "2026-07-14T10:00:03Z",
    reason: "session_left",
  }), {
    sequence: 3,
    occurredAt: "2026-07-14T10:00:03.000Z",
    reason: "session_left",
  });
});

test("monitoring contracts reject invalid scope, sequence, and confidence values", () => {
  assert.throws(() => createMonitoringStartRequest({
    participantId: "candidate-1",
    policyVersion: MONITORING_POLICY_VERSION,
    scopes: ["camera.read"],
    clientInstanceId: "client-1",
    clientVersion: "0.0.0",
    grantedAt: "2026-07-14T10:00:00Z",
  }), /unsupported monitoring scope/);
  assert.throws(
    () => createMonitoringHeartbeatRequest({ sequence: 0, occurredAt: "2026-07-14T10:00:01Z" }),
    /sequence must be a positive integer/,
  );
  assert.throws(() => createMonitoringRiskEventRequest({
    sequence: 1,
    occurredAt: "2026-07-14T10:00:01Z",
    type: RISK_SIGNAL_TYPES.nativeVmSignal,
    source: "desktop_native",
    confidence: 1.1,
    detectorVersion: "native-1",
  }), /confidence must be between 0 and 1/);
});
