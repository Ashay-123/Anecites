export const RISK_SIGNAL_TYPES = {
  editorAtomicInsert: "risk.editor.atomic_insert",
  mediaSecondVoice: "risk.media.second_voice",
  nativeCaptureAffinity: "risk.native.capture_affinity",
  nativeVmSignal: "risk.native.vm_signal",
  timingLagLoop: "risk.timing.lag_loop",
} as const;

export type RiskSignalType = (typeof RISK_SIGNAL_TYPES)[keyof typeof RISK_SIGNAL_TYPES];

export const RISK_DECISION_POLICY = {
  humanReviewRequired: true,
  autoFailAllowed: false,
  minimumCorrelatedSignals: 2,
} as const;
