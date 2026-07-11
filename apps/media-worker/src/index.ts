import { type PrismaClient } from "@anecites/db";
import { createRiskSummary } from "@anecites/server";
import {
  MEDIA_ANALYSIS_MODES,
  createMediaAnalysisJob,
  createMediaRiskSignals,
  type MediaAnalysisConfidenceThresholds,
  type MediaAnalysisJob,
  type MediaAnalysisMode,
  type MediaAudioObservation,
  type MediaRiskSignalReport,
  type MediaVideoObservation,
  type RiskSignalInput,
} from "@anecites/shared";

export type MediaWorkerErrorCode =
  | "MEDIA_EVIDENCE_NOT_FOUND"
  | "MEDIA_EVIDENCE_INVALID"
  | "MEDIA_ADAPTER_UNAVAILABLE"
  | "MEDIA_ADAPTER_TIMEOUT"
  | "MEDIA_ADAPTER_FAILED"
  | "MEDIA_ADAPTER_INVALID_RESPONSE";

export class MediaWorkerError extends Error {
  readonly code: MediaWorkerErrorCode;

  constructor(code: MediaWorkerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaWorkerError";
    this.code = code;
  }
}

export interface MediaAdapterRecordingRequest {
  sessionId: string;
  recordingEvidenceObjectId: string;
  storageBucket: string;
  storageKey: string;
  contentType: string;
  durationMs: number | null;
  sampleWindowMs: number;
  maxSamplesPerRecording: number;
  requestTimeoutMs: number;
  confidenceThresholds: MediaAnalysisConfidenceThresholds;
}

export interface VideoMediaAdapterRequest extends MediaAdapterRecordingRequest {
  requestedModes: readonly MediaAnalysisMode[];
}

export interface MediaWorkerAudioAdapter {
  analyzeSecondVoice(request: MediaAdapterRecordingRequest): Promise<readonly MediaAudioObservation[]>;
}

export interface MediaWorkerVideoAdapter {
  analyzeVideo(request: VideoMediaAdapterRequest): Promise<readonly MediaVideoObservation[]>;
}

export interface MediaWorkerAdapters {
  audio?: MediaWorkerAudioAdapter;
  video?: MediaWorkerVideoAdapter;
}

export interface ProcessMediaAnalysisJobRequest {
  prisma: PrismaClient;
  job: MediaAnalysisJob;
  adapters: MediaWorkerAdapters;
  now?: () => Date;
}

export interface ProcessMediaAnalysisJobResult {
  job: MediaAnalysisJob;
  report: MediaRiskSignalReport;
  riskSignals: readonly RiskSignalInput[];
  riskSummary: Awaited<ReturnType<typeof createRiskSummary>> | null;
}

export interface AudioVoiceSegment {
  speakerId: string;
  confidence: number;
  startedAtMs: number;
  endedAtMs: number;
}

export interface SecondVoiceAudioAdapterOptions {
  adapterVersion: string;
  minimumSecondVoiceDurationMs?: number;
  analyzeVoiceSegments(request: MediaAdapterRecordingRequest): Promise<readonly AudioVoiceSegment[]>;
}

export interface VideoAnalysisWindow {
  faceCount: number;
  faceConfidence: number;
  gazeOffscreenConfidence?: number;
  startedAtMs: number;
  endedAtMs: number;
}

export interface VideoAnalysisAdapterOptions {
  adapterVersion: string;
  calibrationId?: string;
  minimumFaceMissingDurationMs?: number;
  minimumMultipleFacesDurationMs?: number;
  minimumGazeOffscreenDurationMs?: number;
  analyzeVideoWindows(request: VideoMediaAdapterRequest): Promise<readonly VideoAnalysisWindow[]>;
}

const DEFAULT_MINIMUM_SECOND_VOICE_DURATION_MS = 2_000;
const DEFAULT_MINIMUM_FACE_MISSING_DURATION_MS = 3_000;
const DEFAULT_MINIMUM_MULTIPLE_FACES_DURATION_MS = 1_000;
const DEFAULT_MINIMUM_GAZE_OFFSCREEN_DURATION_MS = 2_500;

export async function processMediaAnalysisJob(
  request: ProcessMediaAnalysisJobRequest,
): Promise<ProcessMediaAnalysisJobResult> {
  const job = createMediaAnalysisJob(request.job);
  const evidenceObject = await request.prisma.evidenceObject.findUnique({
    where: {
      id: job.recordingEvidenceObjectId,
    },
  });

  if (!evidenceObject) {
    throw new MediaWorkerError("MEDIA_EVIDENCE_NOT_FOUND", "Recording evidence object was not found");
  }

  if (evidenceObject.sessionId !== job.sessionId || evidenceObject.kind !== "SESSION_RECORDING") {
    throw new MediaWorkerError("MEDIA_EVIDENCE_INVALID", "Media-analysis job must reference a session recording evidence object");
  }

  const baseAdapterRequest: MediaAdapterRecordingRequest = {
    sessionId: job.sessionId,
    recordingEvidenceObjectId: job.recordingEvidenceObjectId,
    storageBucket: evidenceObject.storageBucket,
    storageKey: evidenceObject.storageKey,
    contentType: evidenceObject.contentType,
    durationMs: evidenceObject.durationMs,
    sampleWindowMs: job.options.sampleWindowMs,
    maxSamplesPerRecording: job.options.maxSamplesPerRecording,
    requestTimeoutMs: job.options.requestTimeoutMs,
    confidenceThresholds: job.options.confidenceThresholds,
  };

  const audioObservations: MediaAudioObservation[] = [];
  const videoObservations: MediaVideoObservation[] = [];

  if (job.requestedModes.includes(MEDIA_ANALYSIS_MODES.audioSecondVoice)) {
    if (!request.adapters.audio) {
      throw new MediaWorkerError("MEDIA_ADAPTER_UNAVAILABLE", "Audio media adapter is unavailable");
    }

    const adapterObservations = await runAdapterWithTimeout(
      () => request.adapters.audio?.analyzeSecondVoice(baseAdapterRequest),
      job.options.requestTimeoutMs,
    );
    requireArrayResponse(adapterObservations);
    audioObservations.push(...sanitizeAudioObservations(adapterObservations));
  }

  const requestedVideoModes = job.requestedModes.filter((mode) => mode.startsWith("video."));
  if (requestedVideoModes.length > 0) {
    if (!request.adapters.video) {
      throw new MediaWorkerError("MEDIA_ADAPTER_UNAVAILABLE", "Video media adapter is unavailable");
    }

    const adapterObservations = await runAdapterWithTimeout(
      () =>
        request.adapters.video?.analyzeVideo({
          ...baseAdapterRequest,
          requestedModes: requestedVideoModes,
        }),
      job.options.requestTimeoutMs,
    );
    requireArrayResponse(adapterObservations);
    videoObservations.push(...sanitizeVideoObservations(adapterObservations));
  }

  const report: MediaRiskSignalReport = {
    occurredAt: (request.now?.() ?? new Date()).toISOString(),
    evidenceObjectId: job.recordingEvidenceObjectId,
    ...(audioObservations.length > 0 ? { audioObservations } : {}),
    ...(videoObservations.length > 0 ? { videoObservations } : {}),
  };

  let riskSignals: RiskSignalInput[];
  try {
    riskSignals = createMediaRiskSignals(report);
  } catch (error) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media adapter returned invalid observations", {
      cause: error,
    });
  }

  const riskSummary = riskSignals.length > 0
    ? await createRiskSummary(request.prisma, {
        sessionId: job.sessionId,
        evidenceObjectId: job.recordingEvidenceObjectId,
        signals: riskSignals,
        ...deriveRiskSummaryWindow(riskSignals, report.occurredAt),
      })
    : null;

  return {
    job,
    report,
    riskSignals,
    riskSummary,
  };
}

export function createSecondVoiceAudioAdapter(
  options: SecondVoiceAudioAdapterOptions,
): MediaWorkerAudioAdapter {
  const adapterVersion = requireNonEmptyString("adapterVersion", options.adapterVersion);
  const minimumSecondVoiceDurationMs = requireBoundedInteger(
    "minimumSecondVoiceDurationMs",
    options.minimumSecondVoiceDurationMs ?? DEFAULT_MINIMUM_SECOND_VOICE_DURATION_MS,
    1,
    60_000,
  );

  return {
    async analyzeSecondVoice(request) {
      const segments = await options.analyzeVoiceSegments(request);
      if (!Array.isArray(segments)) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Voice segment analyzer response must be an array");
      }

      const qualifiedSegments = segments
        .map(normalizeVoiceSegment)
        .filter((segment) => segment.confidence >= request.confidenceThresholds.secondVoice);
      const speakerTotals = new Map<
        string,
        {
          durationMs: number;
          confidenceSum: number;
          segmentCount: number;
          startedAtMs: number;
          endedAtMs: number;
        }
      >();

      for (const segment of qualifiedSegments) {
        const durationMs = segment.endedAtMs - segment.startedAtMs;
        const current =
          speakerTotals.get(segment.speakerId) ??
          {
            durationMs: 0,
            confidenceSum: 0,
            segmentCount: 0,
            startedAtMs: segment.startedAtMs,
            endedAtMs: segment.endedAtMs,
          };

        current.durationMs += durationMs;
        current.confidenceSum += segment.confidence;
        current.segmentCount += 1;
        current.startedAtMs = Math.min(current.startedAtMs, segment.startedAtMs);
        current.endedAtMs = Math.max(current.endedAtMs, segment.endedAtMs);
        speakerTotals.set(segment.speakerId, current);
      }

      const qualifiedSpeakers = [...speakerTotals.values()]
        .filter((speaker) => speaker.durationMs >= minimumSecondVoiceDurationMs)
        .sort((left, right) => right.durationMs - left.durationMs);

      if (qualifiedSpeakers.length < 2) {
        return [];
      }

      const secondVoiceSpeaker = qualifiedSpeakers[1];
      if (!secondVoiceSpeaker) {
        return [];
      }

      return [
        {
          kind: "second_voice",
          confidence: roundConfidence(secondVoiceSpeaker.confidenceSum / secondVoiceSpeaker.segmentCount),
          durationMs: secondVoiceSpeaker.durationMs,
          sampleStartedAt: new Date(secondVoiceSpeaker.startedAtMs).toISOString(),
          sampleEndedAt: new Date(secondVoiceSpeaker.endedAtMs).toISOString(),
          adapterVersion,
          speakerCount: qualifiedSpeakers.length,
        },
      ];
    },
  };
}

export function createVideoAnalysisAdapter(options: VideoAnalysisAdapterOptions): MediaWorkerVideoAdapter {
  const adapterVersion = requireNonEmptyString("adapterVersion", options.adapterVersion);
  const calibrationId = options.calibrationId
    ? requireNonEmptyString("calibrationId", options.calibrationId)
    : null;
  const minimumFaceMissingDurationMs = requireBoundedInteger(
    "minimumFaceMissingDurationMs",
    options.minimumFaceMissingDurationMs ?? DEFAULT_MINIMUM_FACE_MISSING_DURATION_MS,
    1,
    60_000,
  );
  const minimumMultipleFacesDurationMs = requireBoundedInteger(
    "minimumMultipleFacesDurationMs",
    options.minimumMultipleFacesDurationMs ?? DEFAULT_MINIMUM_MULTIPLE_FACES_DURATION_MS,
    1,
    60_000,
  );
  const minimumGazeOffscreenDurationMs = requireBoundedInteger(
    "minimumGazeOffscreenDurationMs",
    options.minimumGazeOffscreenDurationMs ?? DEFAULT_MINIMUM_GAZE_OFFSCREEN_DURATION_MS,
    1,
    60_000,
  );

  return {
    async analyzeVideo(request) {
      const windows = await options.analyzeVideoWindows(request);
      if (!Array.isArray(windows)) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Video window analyzer response must be an array");
      }

      const observations: MediaVideoObservation[] = [];
      const normalizedWindows = windows.map(normalizeVideoWindow);
      const facePresenceRequested = request.requestedModes.includes(MEDIA_ANALYSIS_MODES.videoFacePresence);
      const gazeRequested = request.requestedModes.includes(MEDIA_ANALYSIS_MODES.videoGazeOffscreen);

      for (const window of normalizedWindows) {
        const durationMs = window.endedAtMs - window.startedAtMs;
        const sampleStartedAt = new Date(window.startedAtMs).toISOString();
        const sampleEndedAt = new Date(window.endedAtMs).toISOString();

        if (
          facePresenceRequested &&
          window.faceCount === 0 &&
          window.faceConfidence >= request.confidenceThresholds.faceMissing &&
          durationMs >= minimumFaceMissingDurationMs
        ) {
          observations.push({
            kind: "face_missing",
            confidence: window.faceConfidence,
            durationMs,
            sampleStartedAt,
            sampleEndedAt,
            adapterVersion,
          });
          continue;
        }

        if (
          facePresenceRequested &&
          window.faceCount >= 2 &&
          window.faceConfidence >= request.confidenceThresholds.multipleFaces &&
          durationMs >= minimumMultipleFacesDurationMs
        ) {
          observations.push({
            kind: "multiple_faces",
            confidence: window.faceConfidence,
            durationMs,
            sampleStartedAt,
            sampleEndedAt,
            adapterVersion,
            faceCount: window.faceCount,
          });
          continue;
        }

        if (
          gazeRequested &&
          calibrationId &&
          window.faceCount === 1 &&
          window.gazeOffscreenConfidence !== undefined &&
          window.gazeOffscreenConfidence >= request.confidenceThresholds.gazeOffscreen &&
          durationMs >= minimumGazeOffscreenDurationMs
        ) {
          observations.push({
            kind: "gaze_offscreen",
            confidence: window.gazeOffscreenConfidence,
            durationMs,
            sampleStartedAt,
            sampleEndedAt,
            adapterVersion,
            calibrationId,
          });
        }
      }

      return observations;
    },
  };
}

async function runAdapterWithTimeout<T>(
  run: () => Promise<T> | undefined,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "Media adapter timed out"));
    }, timeoutMs);
  });

  try {
    const adapterPromise = run();
    if (!adapterPromise) {
      throw new MediaWorkerError("MEDIA_ADAPTER_UNAVAILABLE", "Media adapter is unavailable");
    }

    return await Promise.race([adapterPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof MediaWorkerError) {
      throw error;
    }

    throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "Media adapter failed", {
      cause: error,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function requireArrayResponse(value: unknown): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media adapter response must be an array");
  }
}

function sanitizeAudioObservations(observations: readonly unknown[]): MediaAudioObservation[] {
  return observations.map((observation) => {
    if (!isRecord(observation) || observation.kind !== "second_voice") {
      throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Audio adapter returned an unsupported observation");
    }

    return {
      kind: "second_voice",
      confidence: observation.confidence as number,
      durationMs: observation.durationMs as number,
      sampleStartedAt: observation.sampleStartedAt as string,
      sampleEndedAt: observation.sampleEndedAt as string,
      adapterVersion: observation.adapterVersion as string,
      speakerCount: observation.speakerCount as number,
    };
  });
}

function normalizeVoiceSegment(segment: AudioVoiceSegment): AudioVoiceSegment {
  if (!isRecord(segment)) {
    throw new Error("Voice segment must be an object");
  }

  const speakerId = requireNonEmptyString("speakerId", segment.speakerId);
  const confidence = requireConfidence("confidence", segment.confidence);
  const startedAtMs = requireNonNegativeInteger("startedAtMs", segment.startedAtMs);
  const endedAtMs = requireNonNegativeInteger("endedAtMs", segment.endedAtMs);

  if (endedAtMs <= startedAtMs) {
    throw new Error("endedAtMs must be greater than startedAtMs");
  }

  return {
    speakerId,
    confidence,
    startedAtMs,
    endedAtMs,
  };
}

function normalizeVideoWindow(window: VideoAnalysisWindow): VideoAnalysisWindow {
  if (!isRecord(window)) {
    throw new Error("Video analysis window must be an object");
  }

  const faceCount = requireNonNegativeInteger("faceCount", window.faceCount);
  const faceConfidence = requireConfidence("faceConfidence", window.faceConfidence);
  const gazeOffscreenConfidence = window.gazeOffscreenConfidence === undefined
    ? undefined
    : requireConfidence("gazeOffscreenConfidence", window.gazeOffscreenConfidence);
  const startedAtMs = requireNonNegativeInteger("startedAtMs", window.startedAtMs);
  const endedAtMs = requireNonNegativeInteger("endedAtMs", window.endedAtMs);

  if (endedAtMs <= startedAtMs) {
    throw new Error("endedAtMs must be greater than startedAtMs");
  }

  return {
    faceCount,
    faceConfidence,
    ...(gazeOffscreenConfidence === undefined ? {} : { gazeOffscreenConfidence }),
    startedAtMs,
    endedAtMs,
  };
}

function sanitizeVideoObservations(observations: readonly unknown[]): MediaVideoObservation[] {
  return observations.map((observation) => {
    if (!isRecord(observation)) {
      throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Video adapter returned an unsupported observation");
    }

    if (observation.kind === "face_missing") {
      return {
        kind: "face_missing",
        confidence: observation.confidence as number,
        durationMs: observation.durationMs as number,
        sampleStartedAt: observation.sampleStartedAt as string,
        sampleEndedAt: observation.sampleEndedAt as string,
        adapterVersion: observation.adapterVersion as string,
      };
    }

    if (observation.kind === "multiple_faces") {
      return {
        kind: "multiple_faces",
        confidence: observation.confidence as number,
        durationMs: observation.durationMs as number,
        sampleStartedAt: observation.sampleStartedAt as string,
        sampleEndedAt: observation.sampleEndedAt as string,
        adapterVersion: observation.adapterVersion as string,
        faceCount: observation.faceCount as number,
      };
    }

    if (observation.kind === "gaze_offscreen") {
      return {
        kind: "gaze_offscreen",
        confidence: observation.confidence as number,
        durationMs: observation.durationMs as number,
        sampleStartedAt: observation.sampleStartedAt as string,
        sampleEndedAt: observation.sampleEndedAt as string,
        adapterVersion: observation.adapterVersion as string,
        ...(typeof observation.calibrationId === "string" ? { calibrationId: observation.calibrationId } : {}),
      };
    }

    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Video adapter returned an unsupported observation");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deriveRiskSummaryWindow(
  riskSignals: readonly RiskSignalInput[],
  fallbackOccurredAt: string,
): { windowStartedAt: string; windowEndedAt: string } {
  const sampleStarts: Date[] = [];
  const sampleEnds: Date[] = [];

  for (const signal of riskSignals) {
    const metadata = signal.metadata;
    if (!metadata) {
      continue;
    }

    if (typeof metadata.sampleStartedAt === "string") {
      const sampleStartedAt = new Date(metadata.sampleStartedAt);
      if (!Number.isNaN(sampleStartedAt.getTime())) {
        sampleStarts.push(sampleStartedAt);
      }
    }

    if (typeof metadata.sampleEndedAt === "string") {
      const sampleEndedAt = new Date(metadata.sampleEndedAt);
      if (!Number.isNaN(sampleEndedAt.getTime())) {
        sampleEnds.push(sampleEndedAt);
      }
    }
  }

  if (sampleStarts.length > 0 && sampleEnds.length > 0) {
    const windowStartedAt = new Date(Math.min(...sampleStarts.map((date) => date.getTime())));
    const windowEndedAt = new Date(Math.max(...sampleEnds.map((date) => date.getTime())));

    if (windowEndedAt > windowStartedAt) {
      return {
        windowStartedAt: windowStartedAt.toISOString(),
        windowEndedAt: windowEndedAt.toISOString(),
      };
    }
  }

  const fallbackStart = new Date(fallbackOccurredAt);
  if (Number.isNaN(fallbackStart.getTime())) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media risk signal timestamps are invalid");
  }

  return {
    windowStartedAt: fallbackStart.toISOString(),
    windowEndedAt: new Date(fallbackStart.getTime() + 1).toISOString(),
  };
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

function requireNonNegativeInteger(fieldName: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function requireConfidence(fieldName: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1`);
  }

  return value;
}

function roundConfidence(confidence: number): number {
  return Math.round(confidence * 10_000) / 10_000;
}
