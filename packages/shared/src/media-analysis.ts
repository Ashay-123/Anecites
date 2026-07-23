export const MEDIA_ANALYSIS_MODES = {
  audioSecondVoice: "audio.second_voice",
  videoFacePresence: "video.face_presence",
  videoGazeOffscreen: "video.gaze_offscreen",
} as const;

export type MediaAnalysisMode = (typeof MEDIA_ANALYSIS_MODES)[keyof typeof MEDIA_ANALYSIS_MODES];

export const MEDIA_RECORDING_SCOPES = {
  roomComposite: "room_composite",
  candidateTrack: "candidate_track",
} as const;

export type MediaRecordingScope = (typeof MEDIA_RECORDING_SCOPES)[keyof typeof MEDIA_RECORDING_SCOPES];

export const MEDIA_CONSENT_SCOPES = {
  sessionRecording: "session_recording",
  videoFaceAnalysis: "video_face_analysis",
  videoGazeCalibration: "video_gaze_calibration",
} as const;

export type MediaConsentScope = (typeof MEDIA_CONSENT_SCOPES)[keyof typeof MEDIA_CONSENT_SCOPES];

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
  shadowModes?: readonly MediaAnalysisMode[];
}

export interface NormalizedMediaAnalysisJobOptions extends MediaAnalysisJobOptions {
  shadowModes: readonly MediaAnalysisMode[];
}

export interface MediaAnalysisJobInput {
  jobId: string;
  sessionId: string;
  participantId: string;
  recordingEvidenceObjectId: string;
  requestedModes: readonly MediaAnalysisMode[];
  options: MediaAnalysisJobOptions;
}

export interface MediaAnalysisJob {
  version: 1;
  jobId: string;
  sessionId: string;
  participantId: string;
  recordingEvidenceObjectId: string;
  requestedModes: readonly MediaAnalysisMode[];
  options: NormalizedMediaAnalysisJobOptions;
}

const MEDIA_ANALYSIS_MODE_VALUES = Object.values(MEDIA_ANALYSIS_MODES);
const MEDIA_CONSENT_SCOPE_VALUES = Object.values(MEDIA_CONSENT_SCOPES);
const MAX_MEDIA_CONSENT_SCOPE_INPUT_COUNT = 16;

export function createMediaAnalysisJob(input: MediaAnalysisJobInput): MediaAnalysisJob {
  const jobId = requireBoundedIdentifier("jobId", input.jobId);
  const sessionId = requireNonEmptyString("sessionId", input.sessionId);
  const participantId = requireBoundedIdentifier("participantId", input.participantId);
  const recordingEvidenceObjectId = requireNonEmptyString(
    "recordingEvidenceObjectId",
    input.recordingEvidenceObjectId,
  );
  const requestedModes = parseRequestedModes(input.requestedModes);
  const shadowModes = parseShadowModes(input.options.shadowModes, requestedModes);

  return {
    version: 1,
    jobId,
    sessionId,
    participantId,
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
      shadowModes,
    },
  };
}

export function getCandidateTrackRecordingParticipantId(metadata: unknown): string | null {
  if (!isRecord(metadata) || !isRecord(metadata.livekit)) {
    return null;
  }

  const livekit = metadata.livekit;
  if (livekit.recordingScope !== MEDIA_RECORDING_SCOPES.candidateTrack) {
    return null;
  }

  try {
    return requireBoundedIdentifier("participantId", livekit.participantId as string);
  } catch {
    return null;
  }
}

function requireBoundedIdentifier(fieldName: string, value: string): string {
  const normalized = requireNonEmptyString(fieldName, value);
  if (normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error(`${fieldName} must contain at most 128 letters, numbers, dots, underscores, colons, or hyphens`);
  }
  return normalized;
}

export function isMediaAnalysisMode(value: string): value is MediaAnalysisMode {
  return MEDIA_ANALYSIS_MODE_VALUES.includes(value as MediaAnalysisMode);
}

export function createMediaConsentScopes(value: unknown): MediaConsentScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("media consent scopes must contain at least one scope");
  }

  if (value.length > MAX_MEDIA_CONSENT_SCOPE_INPUT_COUNT) {
    throw new Error(`media consent scopes must contain at most ${MAX_MEDIA_CONSENT_SCOPE_INPUT_COUNT} scopes`);
  }

  const scopes = value.map((scope) => {
    if (typeof scope !== "string" || !MEDIA_CONSENT_SCOPE_VALUES.includes(scope as MediaConsentScope)) {
      throw new Error("media consent scopes contains an unsupported scope");
    }

    return scope as MediaConsentScope;
  });

  return [...new Set(scopes)];
}

export function hasMediaConsentScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
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

function parseShadowModes(
  modes: readonly MediaAnalysisMode[] | undefined,
  requestedModes: readonly MediaAnalysisMode[],
): MediaAnalysisMode[] {
  if (modes === undefined) {
    return [];
  }

  if (!Array.isArray(modes)) {
    throw new Error("shadowModes must be an array of media-analysis modes");
  }

  const parsedModes = modes.map((mode) => {
    if (typeof mode !== "string" || !isMediaAnalysisMode(mode)) {
      throw new Error("shadowModes contains an unsupported media-analysis mode");
    }
    if (!requestedModes.includes(mode)) {
      throw new Error("shadowModes must contain only requested media-analysis modes");
    }
    if (mode !== MEDIA_ANALYSIS_MODES.audioSecondVoice) {
      throw new Error("shadowModes currently supports only audio.second_voice");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
