export const MEDIA_ANALYSIS_MODES = {
  audioSecondVoice: "audio.second_voice",
  videoFacePresence: "video.face_presence",
  videoGazeOffscreen: "video.gaze_offscreen",
} as const;

export type MediaAnalysisMode = (typeof MEDIA_ANALYSIS_MODES)[keyof typeof MEDIA_ANALYSIS_MODES];

export interface MediaAnalysisConfidenceThresholds {
  secondVoice: number;
  faceMissing: number;
  multipleFaces: number;
  gazeOffscreen: number;
}

export interface MediaAnalysisJobOptions {
  sampleWindowMs: number;
  maxSamplesPerRecording: number;
  requestTimeoutMs: number;
  confidenceThresholds: MediaAnalysisConfidenceThresholds;
}

export interface MediaAnalysisJobInput {
  sessionId: string;
  recordingEvidenceObjectId: string;
  requestedModes: readonly MediaAnalysisMode[];
  options: MediaAnalysisJobOptions;
}

export interface MediaAnalysisJob {
  version: 1;
  sessionId: string;
  recordingEvidenceObjectId: string;
  requestedModes: readonly MediaAnalysisMode[];
  options: MediaAnalysisJobOptions;
}

const MEDIA_ANALYSIS_MODE_VALUES = Object.values(MEDIA_ANALYSIS_MODES);

export function createMediaAnalysisJob(input: MediaAnalysisJobInput): MediaAnalysisJob {
  const sessionId = requireNonEmptyString("sessionId", input.sessionId);
  const recordingEvidenceObjectId = requireNonEmptyString(
    "recordingEvidenceObjectId",
    input.recordingEvidenceObjectId,
  );
  const requestedModes = parseRequestedModes(input.requestedModes);

  return {
    version: 1,
    sessionId,
    recordingEvidenceObjectId,
    requestedModes,
    options: {
      sampleWindowMs: requireBoundedInteger("sampleWindowMs", input.options.sampleWindowMs, 1, 60_000),
      maxSamplesPerRecording: requireBoundedInteger(
        "maxSamplesPerRecording",
        input.options.maxSamplesPerRecording,
        1,
        100,
      ),
      requestTimeoutMs: requireBoundedInteger("requestTimeoutMs", input.options.requestTimeoutMs, 1, 300_000),
      confidenceThresholds: {
        secondVoice: requireConfidenceThreshold("secondVoice", input.options.confidenceThresholds.secondVoice),
        faceMissing: requireConfidenceThreshold("faceMissing", input.options.confidenceThresholds.faceMissing),
        multipleFaces: requireConfidenceThreshold(
          "multipleFaces",
          input.options.confidenceThresholds.multipleFaces,
        ),
        gazeOffscreen: requireConfidenceThreshold("gazeOffscreen", input.options.confidenceThresholds.gazeOffscreen),
      },
    },
  };
}

export function isMediaAnalysisMode(value: string): value is MediaAnalysisMode {
  return MEDIA_ANALYSIS_MODE_VALUES.includes(value as MediaAnalysisMode);
}

function parseRequestedModes(modes: readonly MediaAnalysisMode[]): MediaAnalysisMode[] {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error("requestedModes must contain at least one media-analysis mode");
  }

  const parsedModes = modes.map((mode) => {
    if (typeof mode !== "string" || !isMediaAnalysisMode(mode)) {
      throw new Error("requestedModes contains an unsupported media-analysis mode");
    }

    return mode;
  });

  return [...new Set(parsedModes)];
}

function requireNonEmptyString(fieldName: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function requireBoundedInteger(fieldName: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${fieldName} must be greater than or equal to ${minimum}`);
  }

  if (value > maximum) {
    throw new Error(`${fieldName} must be less than or equal to ${maximum}`);
  }

  return value;
}

function requireConfidenceThreshold(fieldName: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1`);
  }

  return value;
}
