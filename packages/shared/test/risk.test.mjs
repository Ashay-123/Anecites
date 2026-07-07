import test from "node:test";
import assert from "node:assert/strict";

import {
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
