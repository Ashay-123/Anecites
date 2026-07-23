import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompositeRiskSummary,
  createNativeApplicationDetectionRules,
  createNativeProhibitedApplicationMatch,
  createMediaRiskSignals,
  createNativeRiskSignals,
  createEditorRiskSignals,
  detectResponseDelayRiskSignal,
  NATIVE_PERMISSION_SCOPES,
  RISK_DECISION_POLICY,
  RISK_SIGNAL_TYPES,
} from "../dist/index.js";

test("risk signal types cover client, editor, media, native, and timing inputs", () => {
  assert.equal(RISK_SIGNAL_TYPES.clientFocusLost, "risk.client.focus_lost");
  assert.equal(RISK_SIGNAL_TYPES.editorAtomicInsert, "risk.editor.atomic_insert");
  assert.equal(RISK_SIGNAL_TYPES.mediaSecondVoice, "risk.media.second_voice");
  assert.equal(RISK_SIGNAL_TYPES.mediaFaceMissing, "risk.media.face_missing");
  assert.equal(RISK_SIGNAL_TYPES.mediaMultipleFaces, "risk.media.multiple_faces");
  assert.equal(RISK_SIGNAL_TYPES.mediaGazeOffscreen, "risk.media.gaze_offscreen");
  assert.equal(RISK_SIGNAL_TYPES.nativeCaptureAffinity, "risk.native.capture_affinity");
  assert.equal(RISK_SIGNAL_TYPES.nativeRemoteSession, "risk.native.remote_session");
  assert.equal(RISK_SIGNAL_TYPES.nativeDisplayTopologyChange, "risk.native.display_topology_change");
  assert.equal(RISK_SIGNAL_TYPES.nativeProhibitedApplication, "risk.native.prohibited_application");
  assert.equal(RISK_SIGNAL_TYPES.editorPasteBlocked, "risk.editor.paste_blocked");
  assert.equal(RISK_SIGNAL_TYPES.timingResponseDelay, "risk.timing.response_delay");
});

test("prohibited application rules are bounded and normalized without regex matching", () => {
  assert.deepEqual(createNativeApplicationDetectionRules([
    {
      id: " Interview.Assistant ",
      processNames: ["Assistant.EXE", "assistant.exe"],
      windowTitleContains: [" Interview Helper "],
    },
  ]), [
    {
      id: "interview.assistant",
      processNames: ["assistant.exe"],
      windowTitleContains: ["interview helper"],
    },
  ]);

  assert.deepEqual(createNativeProhibitedApplicationMatch({
    ruleId: "INTERVIEW.ASSISTANT",
    matchKinds: ["process_name", "window_title", "process_name"],
  }), {
    ruleId: "interview.assistant",
    matchKinds: ["process_name", "window_title"],
  });

  assert.throws(
    () => createNativeApplicationDetectionRules([{ id: "empty-rule", processNames: [] }]),
    /must contain at least one matcher/,
  );
  assert.throws(
    () => createNativeApplicationDetectionRules([{ id: "path-rule", processNames: ["C:\\tools\\assistant.exe"] }]),
    /executable basenames, not paths/,
  );
  assert.throws(
    () => createNativeProhibitedApplicationMatch({ ruleId: "rule-1", matchKinds: ["unknown"] }),
    /match kind is not supported/,
  );
  assert.equal(createNativeProhibitedApplicationMatch({
    ruleId: "rule-1",
    matchKinds: ["process_name"],
    executableSha256: "A".repeat(64),
  }).executableSha256, "a".repeat(64));
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
          type: RISK_SIGNAL_TYPES.timingResponseDelay,
          weight: 1.5,
          occurredAt: "2026-07-11T00:00:01.000Z",
        },
      ]),
    /Risk signal weight must be between 0 and 1/,
  );
});

test("response-delay detector emits only for repeated conversational delays", () => {
  const signal = detectResponseDelayRiskSignal([
    {
      questionEndedAt: "2026-07-11T00:00:01.000Z",
      answerStartedAt: "2026-07-11T00:00:05.000Z",
    },
    {
      questionEndedAt: "2026-07-11T00:00:10.000Z",
      answerStartedAt: "2026-07-11T00:00:14.500Z",
    },
    {
      questionEndedAt: "2026-07-11T00:00:20.000Z",
      answerStartedAt: "2026-07-11T00:00:25.000Z",
    },
  ]);

  assert.deepEqual(signal, {
    type: RISK_SIGNAL_TYPES.timingResponseDelay,
    weight: 0.45,
    occurredAt: "2026-07-11T00:00:25.000Z",
    metadata: {
      sampleCount: 3,
      delayedResponseCount: 3,
      thresholdMs: 3_000,
      medianResponseDelayMs: 4_500,
    },
  });
});

test("response-delay detector ignores isolated conversational delay", () => {
  const signal = detectResponseDelayRiskSignal([
    {
      questionEndedAt: "2026-07-11T00:00:01.000Z",
      answerStartedAt: "2026-07-11T00:00:05.000Z",
    },
    {
      questionEndedAt: "2026-07-11T00:00:10.000Z",
      answerStartedAt: "2026-07-11T00:00:10.500Z",
    },
    {
      questionEndedAt: "2026-07-11T00:00:20.000Z",
      answerStartedAt: "2026-07-11T00:00:20.800Z",
    },
  ]);

  assert.equal(signal, null);
});

test("response-delay detector rejects invalid conversational samples", () => {
  assert.throws(
    () =>
      detectResponseDelayRiskSignal([
        {
          questionEndedAt: "not-a-date",
          answerStartedAt: "2026-07-11T00:00:03.000Z",
        },
      ]),
    /questionEndedAt must be a valid timestamp/,
  );

  assert.throws(
    () =>
      detectResponseDelayRiskSignal([
        {
          questionEndedAt: "2026-07-11T00:00:03.000Z",
          answerStartedAt: "2026-07-11T00:00:01.000Z",
        },
      ]),
    /answerStartedAt must be after questionEndedAt/,
  );
});

test("editor aggregate mapper emits bounded derived signals without raw text", () => {
  const signals = createEditorRiskSignals({
    sessionId: "session-1",
    participantId: "participant-1",
    documentId: "document-1",
    windowStartedAt: "2026-07-11T00:00:00.000Z",
    windowEndedAt: "2026-07-11T00:00:02.000Z",
    insertEventCount: 2,
    deleteEventCount: 0,
    pasteBlockedCount: 1,
    atomicInsertCount: 1,
    maxInsertSize: 80,
  });

  assert.deepEqual(signals, [
    {
      type: RISK_SIGNAL_TYPES.editorPasteBlocked,
      weight: 0.65,
      occurredAt: "2026-07-11T00:00:02.000Z",
      metadata: {
        documentId: "document-1",
        pasteBlockedCount: 1,
      },
    },
    {
      type: RISK_SIGNAL_TYPES.editorAtomicInsert,
      weight: 0.7,
      occurredAt: "2026-07-11T00:00:02.000Z",
      metadata: {
        documentId: "document-1",
        atomicInsertCount: 1,
        maxInsertSize: 80,
      },
    },
  ]);
  assert.equal(JSON.stringify(signals).includes("sourceCode"), false);
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
    prohibitedApplicationMatches: [
      {
        ruleId: "interview.assistant",
        matchKinds: ["process_name", "window_title"],
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
      weight: 0.35,
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
    {
      type: RISK_SIGNAL_TYPES.nativeProhibitedApplication,
      weight: 0.85,
      occurredAt: "2026-07-11T00:00:01.000Z",
      metadata: {
        ruleId: "interview.assistant",
        matchKinds: ["process_name", "window_title"],
      },
    },
  ]);
});

test("native environment mapper reports remote sessions and topology changes without flagging a stable multi-monitor setup", () => {
  const remoteSignals = createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
    environmentReports: [
      {
        platform: "windows",
        remoteSession: true,
        monitorCount: 2,
        previousMonitorCount: 1,
      },
    ],
  });

  assert.deepEqual(remoteSignals.map((signal) => signal.type), [
    RISK_SIGNAL_TYPES.nativeRemoteSession,
    RISK_SIGNAL_TYPES.nativeDisplayTopologyChange,
  ]);
  assert.deepEqual(createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
    environmentReports: [
      {
        platform: "windows",
        remoteSession: false,
        monitorCount: 2,
      },
    ],
  }), []);
});

test("native VM scoring keeps a lone hypervisor bit weak and raises confidence only for corroborated indicators", () => {
  const lone = createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
    virtualizationReports: [{
      platform: "windows",
      signals: [{ name: "cpuid.hypervisor_present", detected: true, detail: "vendor=Microsoft Hv" }],
    }],
  });
  const corroborated = createNativeRiskSignals({
    occurredAt: "2026-07-11T00:00:01.000Z",
    virtualizationReports: [{
      platform: "windows",
      signals: [
        { name: "cpuid.hypervisor_present", detected: true, detail: "vendor=VMwareVMware" },
        { name: "firmware.virtual_machine_marker", detected: true, detail: "vendor=vmware" },
      ],
    }],
  });

  assert.equal(lone[0].weight, 0.35);
  assert.equal(corroborated[0].weight, 0.65);
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
      occurredAt: "2026-07-11T00:00:05.200Z",
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
      occurredAt: "2026-07-11T00:00:05.500Z",
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
      occurredAt: "2026-07-11T00:00:04.600Z",
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
      occurredAt: "2026-07-11T00:00:06.800Z",
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
