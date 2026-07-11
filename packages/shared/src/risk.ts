export const RISK_SIGNAL_TYPES = {
  editorAtomicInsert: "risk.editor.atomic_insert",
  mediaSecondVoice: "risk.media.second_voice",
  mediaFaceMissing: "risk.media.face_missing",
  mediaMultipleFaces: "risk.media.multiple_faces",
  mediaGazeOffscreen: "risk.media.gaze_offscreen",
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

export const RISK_SIGNAL_CATEGORIES = {
  editor: "editor",
  media: "media",
  native: "native",
  timing: "timing",
} as const;

export type RiskSignalCategory = (typeof RISK_SIGNAL_CATEGORIES)[keyof typeof RISK_SIGNAL_CATEGORIES];

export interface RiskSignalInput {
  type: RiskSignalType;
  weight: number;
  occurredAt: string;
  evidenceObjectId?: string;
  metadata?: Record<string, unknown>;
}

export interface CompositeRiskSignalBreakdown {
  category: RiskSignalCategory;
  count: number;
  maxWeight: number;
  types: RiskSignalType[];
}

export interface CompositeRiskSummary {
  score: number;
  correlatedSignalCount: number;
  meetsCorrelationPolicy: boolean;
  humanReviewRequired: boolean;
  autoFailAllowed: boolean;
  signalBreakdown: CompositeRiskSignalBreakdown[];
}

export interface TimingLagSample {
  occurredAt: string;
  eventLoopLagMs: number;
}

export interface LagLoopDetectionOptions {
  thresholdMs?: number;
  minimumConsecutiveSamples?: number;
}

export interface NativeCaptureAffinityReport {
  platform: string;
  windowId: string;
  protectedFromCapture: boolean;
}

export interface NativeVirtualizationSignal {
  name: string;
  detected: boolean;
  detail?: string;
}

export interface NativeVirtualizationReport {
  platform: string;
  signals: readonly NativeVirtualizationSignal[];
}

export interface NativeRiskSignalReport {
  occurredAt: string;
  captureAffinityReports?: readonly NativeCaptureAffinityReport[];
  virtualizationReports?: readonly NativeVirtualizationReport[];
}

export interface MediaObservationBase {
  confidence: number;
  durationMs: number;
  sampleStartedAt: string;
  sampleEndedAt: string;
  adapterVersion: string;
}

export interface MediaSecondVoiceObservation extends MediaObservationBase {
  kind: "second_voice";
  speakerCount: number;
}

export interface MediaFaceMissingObservation extends MediaObservationBase {
  kind: "face_missing";
}

export interface MediaMultipleFacesObservation extends MediaObservationBase {
  kind: "multiple_faces";
  faceCount: number;
}

export interface MediaGazeOffscreenObservation extends MediaObservationBase {
  kind: "gaze_offscreen";
  calibrationId?: string;
}

export type MediaAudioObservation = MediaSecondVoiceObservation;
export type MediaVideoObservation =
  | MediaFaceMissingObservation
  | MediaMultipleFacesObservation
  | MediaGazeOffscreenObservation;

export interface MediaRiskSignalReport {
  occurredAt: string;
  evidenceObjectId?: string;
  audioObservations?: readonly MediaAudioObservation[];
  videoObservations?: readonly MediaVideoObservation[];
}

const RISK_SIGNAL_CATEGORY_BY_TYPE: Record<RiskSignalType, RiskSignalCategory> = {
  [RISK_SIGNAL_TYPES.editorAtomicInsert]: RISK_SIGNAL_CATEGORIES.editor,
  [RISK_SIGNAL_TYPES.mediaSecondVoice]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaFaceMissing]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaMultipleFaces]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaGazeOffscreen]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.nativeCaptureAffinity]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.nativeVmSignal]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.timingLagLoop]: RISK_SIGNAL_CATEGORIES.timing,
};

const RISK_SIGNAL_CATEGORY_ORDER: RiskSignalCategory[] = [
  RISK_SIGNAL_CATEGORIES.editor,
  RISK_SIGNAL_CATEGORIES.media,
  RISK_SIGNAL_CATEGORIES.native,
  RISK_SIGNAL_CATEGORIES.timing,
];

const RISK_SIGNAL_TYPE_ORDER = Object.values(RISK_SIGNAL_TYPES);

const DEFAULT_LAG_LOOP_THRESHOLD_MS = 150;
const DEFAULT_LAG_LOOP_MINIMUM_CONSECUTIVE_SAMPLES = 3;
const MINIMUM_SECOND_VOICE_CONFIDENCE = 0.8;
const MINIMUM_SECOND_VOICE_DURATION_MS = 2_000;
const MINIMUM_FACE_MISSING_CONFIDENCE = 0.8;
const MINIMUM_FACE_MISSING_DURATION_MS = 3_000;
const MINIMUM_MULTIPLE_FACES_CONFIDENCE = 0.8;
const MINIMUM_MULTIPLE_FACES_DURATION_MS = 1_000;
const MINIMUM_GAZE_OFFSCREEN_CONFIDENCE = 0.85;
const MINIMUM_GAZE_OFFSCREEN_DURATION_MS = 2_500;

export function buildCompositeRiskSummary(signals: readonly RiskSignalInput[]): CompositeRiskSummary {
  if (!Array.isArray(signals)) {
    throw new Error("Risk signals must be an array");
  }

  const groupedSignals = new Map<
    RiskSignalCategory,
    {
      count: number;
      maxWeight: number;
      types: Set<RiskSignalType>;
    }
  >();

  for (const signal of signals) {
    const type = requireAllowedRiskSignalType(signal.type);
    const category = RISK_SIGNAL_CATEGORY_BY_TYPE[type];
    const weight = requireRiskSignalWeight(signal.weight);
    requireRiskSignalTimestamp(signal.occurredAt);

    const group =
      groupedSignals.get(category) ??
      {
        count: 0,
        maxWeight: 0,
        types: new Set<RiskSignalType>(),
      };

    group.count += 1;
    group.maxWeight = Math.max(group.maxWeight, weight);
    group.types.add(type);
    groupedSignals.set(category, group);
  }

  const signalBreakdown = RISK_SIGNAL_CATEGORY_ORDER.flatMap((category) => {
    const group = groupedSignals.get(category);

    if (!group) {
      return [];
    }

    return [
      {
        category,
        count: group.count,
        maxWeight: roundRiskScore(group.maxWeight),
        types: [...group.types].sort((left, right) => RISK_SIGNAL_TYPE_ORDER.indexOf(left) - RISK_SIGNAL_TYPE_ORDER.indexOf(right)),
      },
    ];
  });

  const correlatedSignalCount = signalBreakdown.length;
  const score =
    correlatedSignalCount === 0
      ? 0
      : roundRiskScore(signalBreakdown.reduce((sum, signal) => sum + signal.maxWeight, 0) / correlatedSignalCount);

  return {
    score,
    correlatedSignalCount,
    meetsCorrelationPolicy: correlatedSignalCount >= RISK_DECISION_POLICY.minimumCorrelatedSignals,
    humanReviewRequired: RISK_DECISION_POLICY.humanReviewRequired,
    autoFailAllowed: RISK_DECISION_POLICY.autoFailAllowed,
    signalBreakdown,
  };
}

export function detectLagLoopRiskSignal(
  samples: readonly TimingLagSample[],
  options: LagLoopDetectionOptions = {},
): RiskSignalInput | null {
  if (!Array.isArray(samples)) {
    throw new Error("Timing lag samples must be an array");
  }

  const thresholdMs = options.thresholdMs ?? DEFAULT_LAG_LOOP_THRESHOLD_MS;
  const minimumConsecutiveSamples =
    options.minimumConsecutiveSamples ?? DEFAULT_LAG_LOOP_MINIMUM_CONSECUTIVE_SAMPLES;
  requirePositiveNumber("thresholdMs", thresholdMs);
  requirePositiveInteger("minimumConsecutiveSamples", minimumConsecutiveSamples);

  let consecutiveLagCount = 0;
  let maxConsecutiveLagCount = 0;
  let maxLagMs = 0;
  let lastLagOccurredAt: string | null = null;

  for (const sample of samples) {
    requireRiskSignalTimestamp(sample.occurredAt);
    requireNonNegativeNumber("eventLoopLagMs", sample.eventLoopLagMs);

    if (sample.eventLoopLagMs >= thresholdMs) {
      consecutiveLagCount += 1;
      maxConsecutiveLagCount = Math.max(maxConsecutiveLagCount, consecutiveLagCount);
      maxLagMs = Math.max(maxLagMs, sample.eventLoopLagMs);
      lastLagOccurredAt = sample.occurredAt;
      continue;
    }

    consecutiveLagCount = 0;
  }

  if (maxConsecutiveLagCount < minimumConsecutiveSamples || !lastLagOccurredAt) {
    return null;
  }

  return {
    type: RISK_SIGNAL_TYPES.timingLagLoop,
    weight: roundRiskScore(Math.min(1, maxLagMs / (thresholdMs * 2) * 0.75)),
    occurredAt: lastLagOccurredAt,
    metadata: {
      sampleCount: samples.length,
      thresholdMs,
      minimumConsecutiveSamples,
      consecutiveLagCount: maxConsecutiveLagCount,
      maxLagMs,
    },
  };
}

export function createNativeRiskSignals(report: NativeRiskSignalReport): RiskSignalInput[] {
  requireRiskSignalTimestamp(report.occurredAt);

  const riskSignals: RiskSignalInput[] = [];
  const captureAffinityReports = report.captureAffinityReports ?? [];
  const virtualizationReports = report.virtualizationReports ?? [];

  for (const captureReport of captureAffinityReports) {
    const platform = requireNonEmptyString("platform", captureReport.platform);
    const windowId = requireNonEmptyString("windowId", captureReport.windowId);

    if (captureReport.protectedFromCapture === true) {
      riskSignals.push({
        type: RISK_SIGNAL_TYPES.nativeCaptureAffinity,
        weight: 0.6,
        occurredAt: report.occurredAt,
        metadata: {
          platform,
          windowId,
          protectedFromCapture: true,
        },
      });
    }
  }

  for (const virtualizationReport of virtualizationReports) {
    const platform = requireNonEmptyString("platform", virtualizationReport.platform);
    const detectedSignals = virtualizationReport.signals
      .filter((signal) => signal.detected)
      .map((signal) => {
        const name = requireNonEmptyString("name", signal.name);

        return signal.detail
          ? {
              name,
              detail: signal.detail,
            }
          : {
              name,
            };
      });

    if (detectedSignals.length > 0) {
      riskSignals.push({
        type: RISK_SIGNAL_TYPES.nativeVmSignal,
        weight: roundRiskScore(Math.min(1, 0.4 + detectedSignals.length * 0.1)),
        occurredAt: report.occurredAt,
        metadata: {
          platform,
          detectedSignals,
        },
      });
    }
  }

  return riskSignals;
}

export function createMediaRiskSignals(report: MediaRiskSignalReport): RiskSignalInput[] {
  requireRiskSignalTimestamp(report.occurredAt);
  const evidenceObjectId = report.evidenceObjectId
    ? requireNonEmptyString("evidenceObjectId", report.evidenceObjectId)
    : undefined;
  const riskSignals: RiskSignalInput[] = [];

  for (const observation of report.audioObservations ?? []) {
    requireMediaObservationBase(observation);

    if (observation.kind !== "second_voice") {
      throw new Error("Audio observation kind is not allowed");
    }

    const speakerCount = requireMinimumInteger("speakerCount", observation.speakerCount, 2);
    if (
      observation.confidence >= MINIMUM_SECOND_VOICE_CONFIDENCE &&
      observation.durationMs >= MINIMUM_SECOND_VOICE_DURATION_MS
    ) {
      riskSignals.push({
        type: RISK_SIGNAL_TYPES.mediaSecondVoice,
        weight: roundRiskScore(Math.min(1, 0.4 + observation.confidence * 0.5)),
        occurredAt: report.occurredAt,
        ...(evidenceObjectId ? { evidenceObjectId } : {}),
        metadata: createMediaMetadata(observation, {
          speakerCount,
        }),
      });
    }
  }

  for (const observation of report.videoObservations ?? []) {
    requireMediaObservationBase(observation);

    if (observation.kind === "face_missing") {
      if (
        observation.confidence >= MINIMUM_FACE_MISSING_CONFIDENCE &&
        observation.durationMs >= MINIMUM_FACE_MISSING_DURATION_MS
      ) {
        riskSignals.push({
          type: RISK_SIGNAL_TYPES.mediaFaceMissing,
          weight: roundRiskScore(Math.min(1, 0.4 + observation.confidence * 0.4)),
          occurredAt: report.occurredAt,
          ...(evidenceObjectId ? { evidenceObjectId } : {}),
          metadata: createMediaMetadata(observation),
        });
      }
      continue;
    }

    if (observation.kind === "multiple_faces") {
      const faceCount = requireMinimumInteger("faceCount", observation.faceCount, 2);
      if (
        observation.confidence >= MINIMUM_MULTIPLE_FACES_CONFIDENCE &&
        observation.durationMs >= MINIMUM_MULTIPLE_FACES_DURATION_MS
      ) {
        riskSignals.push({
          type: RISK_SIGNAL_TYPES.mediaMultipleFaces,
          weight: roundRiskScore(Math.min(1, 0.4 + observation.confidence * 0.5)),
          occurredAt: report.occurredAt,
          ...(evidenceObjectId ? { evidenceObjectId } : {}),
          metadata: createMediaMetadata(observation, {
            faceCount,
          }),
        });
      }
      continue;
    }

    if (observation.kind === "gaze_offscreen") {
      const calibrationId = observation.calibrationId
        ? requireNonEmptyString("calibrationId", observation.calibrationId)
        : undefined;
      if (
        calibrationId &&
        observation.confidence >= MINIMUM_GAZE_OFFSCREEN_CONFIDENCE &&
        observation.durationMs >= MINIMUM_GAZE_OFFSCREEN_DURATION_MS
      ) {
        riskSignals.push({
          type: RISK_SIGNAL_TYPES.mediaGazeOffscreen,
          weight: roundRiskScore(Math.min(1, 0.4 + observation.confidence * 0.45)),
          occurredAt: report.occurredAt,
          ...(evidenceObjectId ? { evidenceObjectId } : {}),
          metadata: createMediaMetadata(observation, calibrationId ? { calibrationId } : {}),
        });
      }
      continue;
    }

    throw new Error("Video observation kind is not allowed");
  }

  return riskSignals;
}

function requireMediaObservationBase(observation: MediaObservationBase): void {
  requireRiskSignalConfidence(observation.confidence);
  requirePositiveInteger("durationMs", observation.durationMs);
  requireRiskSignalTimestamp(observation.sampleStartedAt);
  requireRiskSignalTimestamp(observation.sampleEndedAt);

  if (new Date(observation.sampleEndedAt) <= new Date(observation.sampleStartedAt)) {
    throw new Error("sampleEndedAt must be after sampleStartedAt");
  }

  requireNonEmptyString("adapterVersion", observation.adapterVersion);
}

function createMediaMetadata(
  observation: MediaObservationBase,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    confidence: observation.confidence,
    durationMs: observation.durationMs,
    sampleStartedAt: observation.sampleStartedAt,
    sampleEndedAt: observation.sampleEndedAt,
    adapterVersion: observation.adapterVersion,
    ...extra,
  };
}

function requireAllowedRiskSignalType(type: RiskSignalType): RiskSignalType {
  if (!RISK_SIGNAL_TYPE_ORDER.includes(type)) {
    throw new Error("Risk signal type is not allowed");
  }

  return type;
}

function requireRiskSignalWeight(weight: number): number {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error("Risk signal weight must be between 0 and 1");
  }

  return weight;
}

function requireRiskSignalConfidence(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }

  return confidence;
}

function requireMinimumInteger(fieldName: string, value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${fieldName} must be at least ${minimum}`);
  }

  return value;
}

function requireRiskSignalTimestamp(occurredAt: string): void {
  if (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("Risk signal occurredAt must be a valid timestamp");
  }
}

function requirePositiveNumber(fieldName: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be positive`);
  }
}

function requirePositiveInteger(fieldName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be positive`);
  }
}

function requireNonNegativeNumber(fieldName: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
}

function requireNonEmptyString(fieldName: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function roundRiskScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}
