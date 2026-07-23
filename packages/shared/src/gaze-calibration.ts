export const GAZE_CALIBRATION_TARGETS = [
  "center",
  "upper_left",
  "upper_right",
  "lower_left",
  "lower_right",
] as const;

export type GazeCalibrationTarget = (typeof GAZE_CALIBRATION_TARGETS)[number];

export interface GazeCalibrationStep {
  target: GazeCalibrationTarget;
  sequence: number;
}

const MAX_GAZE_CALIBRATION_STEPS = GAZE_CALIBRATION_TARGETS.length;

export function createGazeCalibrationStep(value: unknown): GazeCalibrationStep {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "target" && key !== "sequence")) {
    throw new Error("gaze calibration step contains unsupported fields");
  }
  const sequence = value.sequence;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_GAZE_CALIBRATION_STEPS
  ) {
    throw new Error("gaze calibration sequence is invalid");
  }

  const expectedTarget = GAZE_CALIBRATION_TARGETS[sequence - 1];
  if (!expectedTarget || value.target !== expectedTarget) {
    throw new Error("gaze calibration target order is invalid");
  }
  return {
    target: expectedTarget,
    sequence,
  };
}

export function createGazeCalibrationStepPrefix(value: unknown): GazeCalibrationStep[] {
  if (!Array.isArray(value) || value.length > MAX_GAZE_CALIBRATION_STEPS) {
    throw new Error(`gaze calibration must contain at most ${MAX_GAZE_CALIBRATION_STEPS} steps`);
  }

  return value.map((step, index) => {
    const normalized = createGazeCalibrationStep(step);
    if (normalized.sequence !== index + 1) {
      throw new Error("gaze calibration sequence is invalid");
    }
    return normalized;
  });
}

/**
 * Accepts only the ordered target acknowledgements. Face landmarks and other
 * biometric features remain inside the server-side recording analysis boundary.
 */
export function createGazeCalibrationSteps(value: unknown): GazeCalibrationStep[] {
  if (!Array.isArray(value) || value.length !== MAX_GAZE_CALIBRATION_STEPS) {
    throw new Error(`gaze calibration must contain exactly ${MAX_GAZE_CALIBRATION_STEPS} steps`);
  }
  return createGazeCalibrationStepPrefix(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
