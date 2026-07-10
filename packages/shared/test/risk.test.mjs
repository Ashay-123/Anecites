import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompositeRiskSummary,
  NATIVE_PERMISSION_SCOPES,
  RISK_DECISION_POLICY,
  RISK_SIGNAL_TYPES,
} from "../dist/index.js";

test("risk signal types cover editor, media, native, and timing inputs", () => {
  assert.equal(RISK_SIGNAL_TYPES.editorAtomicInsert, "risk.editor.atomic_insert");
  assert.equal(RISK_SIGNAL_TYPES.mediaSecondVoice, "risk.media.second_voice");
  assert.equal(RISK_SIGNAL_TYPES.nativeCaptureAffinity, "risk.native.capture_affinity");
  assert.equal(RISK_SIGNAL_TYPES.timingLagLoop, "risk.timing.lag_loop");
});

test("risk policy requires composite human-reviewed decisions", () => {
  assert.equal(RISK_DECISION_POLICY.humanReviewRequired, true);
  assert.equal(RISK_DECISION_POLICY.autoFailAllowed, false);
  assert.equal(RISK_DECISION_POLICY.minimumCorrelatedSignals, 2);
});

test("native permission scopes stay explicit and user-mode", () => {
  assert.deepEqual(NATIVE_PERMISSION_SCOPES, [
    "process.scan",
    "window.scan",
    "capture_affinity.read",
    "vm.detect",
  ]);
});

test("composite risk summary groups signals without allowing auto-fail", () => {
  const summary = buildCompositeRiskSummary([
    {
      type: RISK_SIGNAL_TYPES.editorAtomicInsert,
      weight: 0.7,
      occurredAt: "2026-07-11T00:00:01.000Z",
    },
    {
      type: RISK_SIGNAL_TYPES.nativeCaptureAffinity,
      weight: 0.5,
      occurredAt: "2026-07-11T00:00:02.000Z",
      evidenceObjectId: "evidence-native-1",
    },
    {
      type: RISK_SIGNAL_TYPES.editorAtomicInsert,
      weight: 0.4,
      occurredAt: "2026-07-11T00:00:03.000Z",
    },
  ]);

  assert.equal(summary.score, 0.6);
  assert.equal(summary.correlatedSignalCount, 2);
  assert.equal(summary.meetsCorrelationPolicy, true);
  assert.equal(summary.humanReviewRequired, true);
  assert.equal(summary.autoFailAllowed, false);
  assert.deepEqual(summary.signalBreakdown, [
    {
      category: "editor",
      count: 2,
      maxWeight: 0.7,
      types: [RISK_SIGNAL_TYPES.editorAtomicInsert],
    },
    {
      category: "native",
      count: 1,
      maxWeight: 0.5,
      types: [RISK_SIGNAL_TYPES.nativeCaptureAffinity],
    },
  ]);
});

test("composite risk summary does not treat one signal category as correlation", () => {
  const summary = buildCompositeRiskSummary([
    {
      type: RISK_SIGNAL_TYPES.mediaSecondVoice,
      weight: 0.9,
      occurredAt: "2026-07-11T00:00:01.000Z",
    },
  ]);

  assert.equal(summary.score, 0.9);
  assert.equal(summary.correlatedSignalCount, 1);
  assert.equal(summary.meetsCorrelationPolicy, false);
  assert.equal(summary.humanReviewRequired, true);
  assert.equal(summary.autoFailAllowed, false);
});

test("composite risk summary rejects invalid signal input", () => {
  assert.throws(
    () =>
      buildCompositeRiskSummary([
        {
          type: "risk.unknown",
          weight: 0.5,
          occurredAt: "2026-07-11T00:00:01.000Z",
        },
      ]),
    /Risk signal type is not allowed/,
  );

  assert.throws(
    () =>
      buildCompositeRiskSummary([
        {
          type: RISK_SIGNAL_TYPES.timingLagLoop,
          weight: 1.5,
          occurredAt: "2026-07-11T00:00:01.000Z",
        },
      ]),
    /Risk signal weight must be between 0 and 1/,
  );
});
