import type { RollingEditorTelemetryAggregateInput } from "./telemetry.js";

export const RISK_SIGNAL_TYPES = {
  clientFocusLost: "risk.client.focus_lost",
  editorPasteBlocked: "risk.editor.paste_blocked",
  editorAtomicInsert: "risk.editor.atomic_insert",
  mediaSecondVoice: "risk.media.second_voice",
  mediaFaceMissing: "risk.media.face_missing",
  mediaMultipleFaces: "risk.media.multiple_faces",
  mediaGazeOffscreen: "risk.media.gaze_offscreen",
  nativeCaptureAffinity: "risk.native.capture_affinity",
  nativeRemoteSession: "risk.native.remote_session",
  nativeDisplayTopologyChange: "risk.native.display_topology_change",
  nativeVmSignal: "risk.native.vm_signal",
  nativeProhibitedApplication: "risk.native.prohibited_application",
  timingResponseDelay: "risk.timing.response_delay",
} as const;

export type RiskSignalType = (typeof RISK_SIGNAL_TYPES)[keyof typeof RISK_SIGNAL_TYPES];

export const RISK_DECISION_POLICY = {
  humanReviewRequired: true,
  autoFailAllowed: false,
  minimumCorrelatedSignals: 2,
} as const;

export const RISK_SIGNAL_CATEGORIES = {
  client: "client",
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

export interface ConversationalResponseTimingSample {
  questionEndedAt: string;
  answerStartedAt: string;
}

export interface ResponseDelayDetectionOptions {
  thresholdMs?: number;
  minimumDelayedResponses?: number;
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

export interface NativeEnvironmentReport {
  platform: string;
  remoteSession: boolean;
  monitorCount: number;
  previousMonitorCount?: number;
}

export const NATIVE_APPLICATION_MATCH_KINDS = ["process_name", "window_title"] as const;

export type NativeApplicationMatchKind = (typeof NATIVE_APPLICATION_MATCH_KINDS)[number];

export interface NativeApplicationDetectionRule {
  id: string;
  processNames: readonly string[];
  windowTitleContains: readonly string[];
}

export interface NativeProhibitedApplicationMatch {
  ruleId: string;
  matchKinds: readonly NativeApplicationMatchKind[];
  executableSha256?: string;
}

export interface NativeRiskSignalReport {
  occurredAt: string;
  captureAffinityReports?: readonly NativeCaptureAffinityReport[];
  environmentReports?: readonly NativeEnvironmentReport[];
  virtualizationReports?: readonly NativeVirtualizationReport[];
  prohibitedApplicationMatches?: readonly NativeProhibitedApplicationMatch[];
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
  [RISK_SIGNAL_TYPES.clientFocusLost]: RISK_SIGNAL_CATEGORIES.client,
  [RISK_SIGNAL_TYPES.editorPasteBlocked]: RISK_SIGNAL_CATEGORIES.editor,
  [RISK_SIGNAL_TYPES.editorAtomicInsert]: RISK_SIGNAL_CATEGORIES.editor,
  [RISK_SIGNAL_TYPES.mediaSecondVoice]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaFaceMissing]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaMultipleFaces]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.mediaGazeOffscreen]: RISK_SIGNAL_CATEGORIES.media,
  [RISK_SIGNAL_TYPES.nativeCaptureAffinity]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.nativeRemoteSession]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.nativeDisplayTopologyChange]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.nativeVmSignal]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.nativeProhibitedApplication]: RISK_SIGNAL_CATEGORIES.native,
  [RISK_SIGNAL_TYPES.timingResponseDelay]: RISK_SIGNAL_CATEGORIES.timing,
};

const RISK_SIGNAL_CATEGORY_ORDER: RiskSignalCategory[] = [
  RISK_SIGNAL_CATEGORIES.client,
  RISK_SIGNAL_CATEGORIES.editor,
  RISK_SIGNAL_CATEGORIES.media,
  RISK_SIGNAL_CATEGORIES.native,
  RISK_SIGNAL_CATEGORIES.timing,
];

const RISK_SIGNAL_TYPE_ORDER = Object.values(RISK_SIGNAL_TYPES);

const DEFAULT_RESPONSE_DELAY_THRESHOLD_MS = 3_000;
const DEFAULT_MINIMUM_DELAYED_RESPONSES = 3;
const MINIMUM_SECOND_VOICE_CONFIDENCE = 0.8;
const MINIMUM_SECOND_VOICE_DURATION_MS = 2_000;
const MINIMUM_FACE_MISSING_CONFIDENCE = 0.8;
const MINIMUM_FACE_MISSING_DURATION_MS = 3_000;
const MINIMUM_MULTIPLE_FACES_CONFIDENCE = 0.8;
const MINIMUM_MULTIPLE_FACES_DURATION_MS = 1_000;
const MINIMUM_GAZE_OFFSCREEN_CONFIDENCE = 0.85;
const MINIMUM_GAZE_OFFSCREEN_DURATION_MS = 2_500;
const MAX_NATIVE_APPLICATION_RULES = 100;
const MAX_NATIVE_APPLICATION_MATCHERS_PER_RULE = 20;
const MAX_NATIVE_APPLICATION_MATCHER_LENGTH = 128;
const NATIVE_APPLICATION_RULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function createNativeApplicationDetectionRules(value: unknown): NativeApplicationDetectionRule[] {
  if (!Array.isArray(value)) {
    throw new Error("Prohibited application rules must be an array");
  }
  if (value.length > MAX_NATIVE_APPLICATION_RULES) {
    throw new Error(`Prohibited application rules cannot exceed ${MAX_NATIVE_APPLICATION_RULES}`);
  }

  const seenRuleIds = new Set<string>();
  return value.map((candidate, index) => {
    const record = requireUnknownRecord(`rule ${index}`, candidate);
    const id = normalizeNativeApplicationRuleId(record.id);
    if (seenRuleIds.has(id)) {
      throw new Error(`Prohibited application rule id ${id} is duplicated`);
    }
    seenRuleIds.add(id);

    const processNames = normalizeNativeApplicationMatchers(
      record.processNames,
      `rule ${id} processNames`,
      1,
      true,
    );
    const windowTitleContains = normalizeNativeApplicationMatchers(
      record.windowTitleContains,
      `rule ${id} windowTitleContains`,
      3,
      false,
    );
    if (processNames.length === 0 && windowTitleContains.length === 0) {
      throw new Error(`Prohibited application rule ${id} must contain at least one matcher`);
    }

    return {
      id,
      processNames,
      windowTitleContains,
    };
  });
}

export function createNativeProhibitedApplicationMatch(value: unknown): NativeProhibitedApplicationMatch {
  const record = requireUnknownRecord("prohibited application match", value);
  const ruleId = normalizeNativeApplicationRuleId(record.ruleId);
  if (!Array.isArray(record.matchKinds) || record.matchKinds.length === 0) {
    throw new Error("Prohibited application matchKinds must be a non-empty array");
  }

  const matchKinds = Array.from(new Set(record.matchKinds.map((candidate) => {
    if (
      typeof candidate !== "string" ||
      !(NATIVE_APPLICATION_MATCH_KINDS as readonly string[]).includes(candidate)
    ) {
      throw new Error("Prohibited application match kind is not supported");
    }
    return candidate as NativeApplicationMatchKind;
  })));

  return {
    ruleId,
    matchKinds,
    ...(record.executableSha256 === undefined
      ? {}
      : { executableSha256: normalizeSha256(record.executableSha256) }),
  };
}

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

export function detectResponseDelayRiskSignal(
  samples: readonly ConversationalResponseTimingSample[],
  options: ResponseDelayDetectionOptions = {},
): RiskSignalInput | null {
  if (!Array.isArray(samples)) {
    throw new Error("Conversational timing samples must be an array");
  }

  const thresholdMs = options.thresholdMs ?? DEFAULT_RESPONSE_DELAY_THRESHOLD_MS;
  const minimumDelayedResponses =
    options.minimumDelayedResponses ?? DEFAULT_MINIMUM_DELAYED_RESPONSES;
  requirePositiveNumber("thresholdMs", thresholdMs);
  requirePositiveInteger("minimumDelayedResponses", minimumDelayedResponses);

  const delayedResponses: Array<{ delayMs: number; answerStartedAt: string }> = [];

  for (const sample of samples) {
    requireNamedTimestamp("questionEndedAt", sample.questionEndedAt);
    requireNamedTimestamp("answerStartedAt", sample.answerStartedAt);
    const delayMs = Date.parse(sample.answerStartedAt) - Date.parse(sample.questionEndedAt);
    if (delayMs <= 0) {
      throw new Error("answerStartedAt must be after questionEndedAt");
    }
    if (delayMs >= thresholdMs) {
      delayedResponses.push({ delayMs, answerStartedAt: sample.answerStartedAt });
    }
  }

  if (delayedResponses.length < minimumDelayedResponses) {
    return null;
  }

  const sortedDelays = delayedResponses.map((sample) => sample.delayMs).sort((left, right) => left - right);
  const medianIndex = Math.floor(sortedDelays.length / 2);
  const medianResponseDelayMs = sortedDelays.length % 2 === 0
    ? Math.round((sortedDelays[medianIndex - 1]! + sortedDelays[medianIndex]!) / 2)
    : sortedDelays[medianIndex]!;
  const occurredAt = delayedResponses
    .map((sample) => sample.answerStartedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1);

  if (!occurredAt) {
    return null;
  }

  return {
    type: RISK_SIGNAL_TYPES.timingResponseDelay,
    weight: 0.45,
    occurredAt,
    metadata: {
      sampleCount: samples.length,
      delayedResponseCount: delayedResponses.length,
      thresholdMs,
      medianResponseDelayMs,
    },
  };
}

export function createEditorRiskSignals(
  aggregate: RollingEditorTelemetryAggregateInput,
): RiskSignalInput[] {
  requireNonEmptyString("sessionId", aggregate.sessionId);
  requireNonEmptyString("participantId", aggregate.participantId);
  const documentId = requireNonEmptyString("documentId", aggregate.documentId);
  requireNamedTimestamp("windowStartedAt", aggregate.windowStartedAt);
  requireNamedTimestamp("windowEndedAt", aggregate.windowEndedAt);
  if (Date.parse(aggregate.windowEndedAt) <= Date.parse(aggregate.windowStartedAt)) {
    throw new Error("windowEndedAt must be after windowStartedAt");
  }

  requireNonNegativeInteger("insertEventCount", aggregate.insertEventCount);
  requireNonNegativeInteger("deleteEventCount", aggregate.deleteEventCount);
  requireNonNegativeInteger("pasteBlockedCount", aggregate.pasteBlockedCount);
  requireNonNegativeInteger("atomicInsertCount", aggregate.atomicInsertCount);
  requireNonNegativeInteger("maxInsertSize", aggregate.maxInsertSize);

  const signals: RiskSignalInput[] = [];
  if (aggregate.pasteBlockedCount > 0) {
    signals.push({
      type: RISK_SIGNAL_TYPES.editorPasteBlocked,
      weight: roundRiskScore(Math.min(0.85, 0.6 + aggregate.pasteBlockedCount * 0.05)),
      occurredAt: aggregate.windowEndedAt,
      metadata: {
        documentId,
        pasteBlockedCount: aggregate.pasteBlockedCount,
      },
    });
  }
  if (aggregate.atomicInsertCount > 0) {
    signals.push({
      type: RISK_SIGNAL_TYPES.editorAtomicInsert,
      weight: roundRiskScore(Math.min(0.9, 0.5 + Math.min(aggregate.maxInsertSize, 160) / 400)),
      occurredAt: aggregate.windowEndedAt,
      metadata: {
        documentId,
        atomicInsertCount: aggregate.atomicInsertCount,
        maxInsertSize: aggregate.maxInsertSize,
      },
    });
  }

  return signals;
}

export function createNativeRiskSignals(report: NativeRiskSignalReport): RiskSignalInput[] {
  requireRiskSignalTimestamp(report.occurredAt);

  const riskSignals: RiskSignalInput[] = [];
  const captureAffinityReports = report.captureAffinityReports ?? [];
  const environmentReports = report.environmentReports ?? [];
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

  for (const environmentReport of environmentReports) {
    const platform = requireNonEmptyString("platform", environmentReport.platform);
    const monitorCount = requireMinimumInteger("monitorCount", environmentReport.monitorCount, 1);
    const previousMonitorCount = environmentReport.previousMonitorCount === undefined
      ? undefined
      : requireMinimumInteger("previousMonitorCount", environmentReport.previousMonitorCount, 1);

    if (environmentReport.remoteSession === true) {
      riskSignals.push({
        type: RISK_SIGNAL_TYPES.nativeRemoteSession,
        weight: 0.8,
        occurredAt: report.occurredAt,
        metadata: {
          platform,
          remoteSession: true,
        },
      });
    }

    if (previousMonitorCount !== undefined && previousMonitorCount !== monitorCount) {
      riskSignals.push({
        type: RISK_SIGNAL_TYPES.nativeDisplayTopologyChange,
        weight: 0.45,
        occurredAt: report.occurredAt,
        metadata: {
          platform,
          previousMonitorCount,
          monitorCount,
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
        weight: roundRiskScore(Math.min(0.95, 0.35 + (detectedSignals.length - 1) * 0.3)),
        occurredAt: report.occurredAt,
        metadata: {
          platform,
          detectedSignals,
        },
      });
    }
  }

  for (const rawMatch of report.prohibitedApplicationMatches ?? []) {
    const match = createNativeProhibitedApplicationMatch(rawMatch);
    const processNameMatched = match.matchKinds.includes("process_name");
    const windowTitleMatched = match.matchKinds.includes("window_title");
    const weight = processNameMatched && windowTitleMatched
      ? 0.85
      : processNameMatched
        ? 0.75
        : 0.5;

    riskSignals.push({
      type: RISK_SIGNAL_TYPES.nativeProhibitedApplication,
      weight,
      occurredAt: report.occurredAt,
      metadata: {
        ruleId: match.ruleId,
        matchKinds: [...match.matchKinds],
        ...(match.executableSha256 ? { executableSha256: match.executableSha256 } : {}),
      },
    });
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
        occurredAt: observation.sampleEndedAt,
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
          occurredAt: observation.sampleEndedAt,
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
          occurredAt: observation.sampleEndedAt,
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
          occurredAt: observation.sampleEndedAt,
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

function requireNamedTimestamp(fieldName: string, value: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid timestamp`);
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

function requireNonNegativeInteger(fieldName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function requireNonEmptyString(fieldName: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function requireUnknownRecord(fieldName: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeNativeApplicationRuleId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Prohibited application rule id must be a non-empty string");
  }
  const id = value.trim().toLowerCase();
  if (!NATIVE_APPLICATION_RULE_ID_PATTERN.test(id)) {
    throw new Error("Prohibited application rule id must contain only lowercase letters, numbers, dots, underscores, or hyphens");
  }
  return id;
}

function normalizeNativeApplicationMatchers(
  value: unknown,
  fieldName: string,
  minimumLength: number,
  rejectPathSeparators: boolean,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (value.length > MAX_NATIVE_APPLICATION_MATCHERS_PER_RULE) {
    throw new Error(`${fieldName} cannot exceed ${MAX_NATIVE_APPLICATION_MATCHERS_PER_RULE} entries`);
  }

  const normalized = value.map((candidate) => {
    if (typeof candidate !== "string") {
      throw new Error(`${fieldName} must contain only strings`);
    }
    const matcher = candidate.trim().toLowerCase();
    if (matcher.length < minimumLength || matcher.length > MAX_NATIVE_APPLICATION_MATCHER_LENGTH) {
      throw new Error(`${fieldName} entries must be between ${minimumLength} and ${MAX_NATIVE_APPLICATION_MATCHER_LENGTH} characters`);
    }
    if (CONTROL_CHARACTER_PATTERN.test(matcher)) {
      throw new Error(`${fieldName} entries cannot contain control characters`);
    }
    if (rejectPathSeparators && (matcher.includes("/") || matcher.includes("\\"))) {
      throw new Error(`${fieldName} entries must be executable basenames, not paths`);
    }
    return matcher;
  });

  return Array.from(new Set(normalized));
}

function normalizeSha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error("Executable SHA-256 must contain exactly 64 hexadecimal characters");
  }
  return value.trim().toLowerCase();
}

function roundRiskScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}
