import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompositeRiskSummary,
  createMediaRiskSignals,
  createNativeRiskSignals,
  detectLagLoopRiskSignal,
  NATIVE_PERMISSION_SCOPES,
  RISK_DECISION_POLICY,
  RISK_SIGNAL_TYPES,
} from "../dist/index.js";

test("risk signal types cover editor, media, native, and timing inputs", () => {
  assert.equal(RISK_SIGNAL_TYPES.editorAtomicInsert, "risk.editor.atomic_insert");
  assert.equal(RISK_SIGNAL_TYPES.mediaSecondVoice, "risk.media.second_voice");
  assert.equal(RISK_SIGNAL_TYPES.mediaFaceMissing, "risk.media.face_missing");
  assert.equal(RISK_SIGNAL_TYPES.mediaMultipleFaces, "risk.media.multiple_faces");
  assert.equal(RISK_SIGNAL_TYPES.mediaGazeOffscreen, "risk.media.gaze_offscreen");
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

test("lag-loop detector emits timing risk signal for sustained delay", () => {
  const signal = detectLagLoopRiskSignal([
    {
      occurredAt: "2026-07-11T00:00:01.000Z",
      eventLoopLagMs: 180,
    },
    {
      occurredAt: "2026-07-11T00:00:02.000Z",
      eventLoopLagMs: 220,
    },
    {
      occurredAt: "2026-07-11T00:00:03.000Z",
      eventLoopLagMs: 260,
    },
  ]);

  assert.deepEqual(signal, {
    type: RISK_SIGNAL_TYPES.timingLagLoop,
    weight: 0.65,
    occurredAt: "2026-07-11T00:00:03.000Z",
    metadata: {
      sampleCount: 3,
      thresholdMs: 150,
      minimumConsecutiveSamples: 3,
      consecutiveLagCount: 3,
      maxLagMs: 260,
    },
  });
});

test("lag-loop detector ignores isolated delay spikes", () => {
  const signal = detectLagLoopRiskSignal([
    {
      occurredAt: "2026-07-11T00:00:01.000Z",
      eventLoopLagMs: 200,
    },
    {
      occurredAt: "2026-07-11T00:00:02.000Z",
      eventLoopLagMs: 30,
    },
    {
      occurredAt: "2026-07-11T00:00:03.000Z",
      eventLoopLagMs: 210,
    },
  ]);

  assert.equal(signal, null);
});

test("lag-loop detector rejects invalid timing samples", () => {
  assert.throws(
    () =>
      detectLagLoopRiskSignal([
        {
          occurredAt: "not-a-date",
          eventLoopLagMs: 200,
        },
        {
          occurredAt: "2026-07-11T00:00:02.000Z",
          eventLoopLagMs: 200,
        },
        {
          occurredAt: "2026-07-11T00:00:03.000Z",
          eventLoopLagMs: 200,
        },
      ]),
    /occurredAt must be a valid timestamp/,
  );

  assert.throws(
    () =>
      detectLagLoopRiskSignal([
        {
          occurredAt: "2026-07-11T00:00:01.000Z",
          eventLoopLagMs: -1,
        },
      ]),
    /eventLoopLagMs must be a non-negative number/,
  );
});

test("native risk mapper emits capture-affinity and VM signals", () => {
  const signals = createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
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
            name: "hypervisor",
            detected: true,
            detail: "hypervisor bit set",
          },
          {
            name: "sandbox",
            detected: false,
          },
        ],
      },
    ],
  });

  assert.deepEqual(signals, [
    {
      type: RISK_SIGNAL_TYPES.nativeCaptureAffinity,
      weight: 0.6,
      occurredAt: "2026-07-11T00:00:01.000Z",
      metadata: {
        platform: "windows",
        windowId: "window-1",
        protectedFromCapture: true,
      },
    },
    {
      type: RISK_SIGNAL_TYPES.nativeVmSignal,
      weight: 0.5,
      occurredAt: "2026-07-11T00:00:01.000Z",
      metadata: {
        platform: "windows",
        detectedSignals: [
          {
            name: "hypervisor",
            detail: "hypervisor bit set",
          },
        ],
      },
    },
  ]);
});

test("native risk mapper ignores clean native reports", () => {
  const signals = createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
    captureAffinityReports: [
      {
        platform: "windows",
        windowId: "window-1",
        protectedFromCapture: false,
      },
    ],
    virtualizationReports: [
      {
        platform: "windows",
        signals: [
          {
            name: "hypervisor",
            detected: false,
          },
        ],
      },
    ],
  });

  assert.deepEqual(signals, []);
});

test("native risk mapper rejects invalid native reports", () => {
  assert.throws(
    () =>
      createNativeRiskSignals({
        occurredAt: "not-a-date",
        captureAffinityReports: [],
        virtualizationReports: [],
      }),
    /occurredAt must be a valid timestamp/,
  );

  assert.throws(
    () =>
      createNativeRiskSignals({
        occurredAt: "2026-07-11T00:00:01.000Z",
        captureAffinityReports: [
          {
            platform: "windows",
            windowId: "",
            protectedFromCapture: true,
          },
        ],
        virtualizationReports: [],
      }),
    /windowId must be a non-empty string/,
  );
});

test("media risk mapper emits bounded media signals", () => {
  const signals = createMediaRiskSignals({
    occurredAt: "2026-07-11T00:00:10.000Z",
    evidenceObjectId: "recording-evidence-1",
    audioObservations: [
      {
        kind: "second_voice",
        confidence: 0.92,
        durationMs: 4_200,
        speakerCount: 2,
        sampleStartedAt: "2026-07-11T00:00:01.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.200Z",
        adapterVersion: "vad-test-1",
        rawTranscript: "this must not be copied",
      },
    ],
    videoObservations: [
      {
        kind: "face_missing",
        confidence: 0.88,
        durationMs: 3_500,
        sampleStartedAt: "2026-07-11T00:00:02.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.500Z",
        adapterVersion: "face-test-1",
      },
      {
        kind: "multiple_faces",
        confidence: 0.91,
        durationMs: 1_600,
        faceCount: 2,
        sampleStartedAt: "2026-07-11T00:00:03.000Z",
        sampleEndedAt: "2026-07-11T00:00:04.600Z",
        adapterVersion: "face-test-1",
        rawFrame: "this must not be copied",
      },
      {
        kind: "gaze_offscreen",
        confidence: 0.94,
        durationMs: 2_800,
        sampleStartedAt: "2026-07-11T00:00:04.000Z",
        sampleEndedAt: "2026-07-11T00:00:06.800Z",
        adapterVersion: "gaze-test-1",
        calibrationId: "calibration-1",
        landmarks: [1, 2, 3],
      },
    ],
  });

  assert.deepEqual(signals, [
    {
      type: RISK_SIGNAL_TYPES.mediaSecondVoice,
      weight: 0.86,
      occurredAt: "2026-07-11T00:00:10.000Z",
      evidenceObjectId: "recording-evidence-1",
      metadata: {
        confidence: 0.92,
        durationMs: 4_200,
        sampleStartedAt: "2026-07-11T00:00:01.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.200Z",
        adapterVersion: "vad-test-1",
        speakerCount: 2,
      },
    },
    {
      type: RISK_SIGNAL_TYPES.mediaFaceMissing,
      weight: 0.752,
      occurredAt: "2026-07-11T00:00:10.000Z",
      evidenceObjectId: "recording-evidence-1",
      metadata: {
        confidence: 0.88,
        durationMs: 3_500,
        sampleStartedAt: "2026-07-11T00:00:02.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.500Z",
        adapterVersion: "face-test-1",
      },
    },
    {
      type: RISK_SIGNAL_TYPES.mediaMultipleFaces,
      weight: 0.855,
      occurredAt: "2026-07-11T00:00:10.000Z",
      evidenceObjectId: "recording-evidence-1",
      metadata: {
        confidence: 0.91,
        durationMs: 1_600,
        sampleStartedAt: "2026-07-11T00:00:03.000Z",
        sampleEndedAt: "2026-07-11T00:00:04.600Z",
        adapterVersion: "face-test-1",
        faceCount: 2,
      },
    },
    {
      type: RISK_SIGNAL_TYPES.mediaGazeOffscreen,
      weight: 0.823,
      occurredAt: "2026-07-11T00:00:10.000Z",
      evidenceObjectId: "recording-evidence-1",
      metadata: {
        confidence: 0.94,
        durationMs: 2_800,
        sampleStartedAt: "2026-07-11T00:00:04.000Z",
        sampleEndedAt: "2026-07-11T00:00:06.800Z",
        adapterVersion: "gaze-test-1",
        calibrationId: "calibration-1",
      },
    },
  ]);
});

test("media risk mapper ignores low-confidence or short-duration observations", () => {
  const signals = createMediaRiskSignals({
    occurredAt: "2026-07-11T00:00:10.000Z",
    audioObservations: [
      {
        kind: "second_voice",
        confidence: 0.6,
        durationMs: 4_000,
        speakerCount: 2,
        sampleStartedAt: "2026-07-11T00:00:01.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.000Z",
        adapterVersion: "vad-test-1",
      },
    ],
    videoObservations: [
      {
        kind: "multiple_faces",
        confidence: 0.9,
        durationMs: 400,
        faceCount: 2,
        sampleStartedAt: "2026-07-11T00:00:01.000Z",
        sampleEndedAt: "2026-07-11T00:00:01.400Z",
        adapterVersion: "face-test-1",
      },
    ],
  });

  assert.deepEqual(signals, []);
});

test("media risk mapper does not emit uncalibrated gaze signals", () => {
  const signals = createMediaRiskSignals({
    occurredAt: "2026-07-11T00:00:10.000Z",
    evidenceObjectId: "recording-evidence-1",
    videoObservations: [
      {
        kind: "gaze_offscreen",
        confidence: 0.99,
        durationMs: 4_000,
        sampleStartedAt: "2026-07-11T00:00:01.000Z",
        sampleEndedAt: "2026-07-11T00:00:05.000Z",
        adapterVersion: "gaze-test-1",
      },
    ],
  });

  assert.deepEqual(signals, []);
});

test("media risk mapper rejects invalid media reports", () => {
  assert.throws(
    () =>
      createMediaRiskSignals({
        occurredAt: "not-a-date",
        audioObservations: [],
        videoObservations: [],
      }),
    /occurredAt must be a valid timestamp/,
  );

  assert.throws(
    () =>
      createMediaRiskSignals({
        occurredAt: "2026-07-11T00:00:10.000Z",
        audioObservations: [
          {
            kind: "second_voice",
            confidence: 1.5,
            durationMs: 4_000,
            speakerCount: 2,
            sampleStartedAt: "2026-07-11T00:00:01.000Z",
            sampleEndedAt: "2026-07-11T00:00:05.000Z",
            adapterVersion: "vad-test-1",
          },
        ],
      }),
    /confidence must be between 0 and 1/,
  );

  assert.throws(
    () =>
      createMediaRiskSignals({
        occurredAt: "2026-07-11T00:00:10.000Z",
        videoObservations: [
          {
            kind: "multiple_faces",
            confidence: 0.9,
            durationMs: 1_000,
            faceCount: 1,
            sampleStartedAt: "2026-07-11T00:00:01.000Z",
            sampleEndedAt: "2026-07-11T00:00:02.000Z",
            adapterVersion: "face-test-1",
          },
        ],
      }),
    /faceCount must be at least 2/,
  );
});
