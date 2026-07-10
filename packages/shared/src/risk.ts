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

const RISK_SIGNAL_CATEGORY_BY_TYPE: Record<RiskSignalType, RiskSignalCategory> = {
  [RISK_SIGNAL_TYPES.editorAtomicInsert]: RISK_SIGNAL_CATEGORIES.editor,
  [RISK_SIGNAL_TYPES.mediaSecondVoice]: RISK_SIGNAL_CATEGORIES.media,
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

function requireRiskSignalTimestamp(occurredAt: string): void {
  if (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("Risk signal occurredAt must be a valid timestamp");
  }
}

function roundRiskScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}
