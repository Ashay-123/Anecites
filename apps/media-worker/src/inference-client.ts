import { MEDIA_ANALYSIS_MODES } from "@anecites/shared";
import { MediaWorkerError } from "./errors.js";
import {
  type MediaAdapterRecordingRequest,
  type VideoAnalysisWindow,
  type VideoMediaAdapterRequest,
} from "./index.js";

export interface VoiceActivityWindow {
  startedAtMs: number;
  endedAtMs: number;
}

export interface SpeakerDiarizationSegment {
  speakerId: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface MediaInferenceClient {
  readonly adapterVersion: string;
  analyzeVoiceActivity(request: MediaAdapterRecordingRequest): Promise<readonly VoiceActivityWindow[]>;
  analyzeSpeakerDiarization(request: MediaAdapterRecordingRequest): Promise<readonly SpeakerDiarizationSegment[]>;
  analyzeVideoWindows(request: VideoMediaAdapterRequest): Promise<readonly VideoAnalysisWindow[]>;
  verifyRecording(request: RecordingVerificationRequest): Promise<RecordingVerificationResult>;
}

export interface RecordingVerificationRequest {
  storageBucket: string;
  storageKey: string;
  contentType: string;
  durationMs: number | null;
  requestTimeoutMs: number;
}

export interface RecordingVerificationResult {
  durationMs: number;
  byteSize: number;
}

export interface MediaInferenceClientOptions {
  baseUrl: string;
  authToken: string;
  expectedAdapterVersion: string;
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_VOICE_ACTIVITY_WINDOWS = 100;

export function createMediaInferenceClient(options: MediaInferenceClientOptions): MediaInferenceClient {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const authToken = requireNonEmptyString("authToken", options.authToken);
  const adapterVersion = requireNonEmptyString("expectedAdapterVersion", options.expectedAdapterVersion);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function analyze(
    request: MediaAdapterRecordingRequest,
    analyses: { voiceActivity: boolean; facePresence: boolean; speakerDiarization: boolean },
  ): Promise<ValidatedInferenceResponse> {
    let response: Response;
    try {
      response = await fetchImpl(new URL("v1/analyze", baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          recording: {
            storageBucket: request.storageBucket,
            storageKey: request.storageKey,
            contentType: request.contentType,
            durationMs: request.durationMs,
          },
          sampling: {
            windowMs: request.sampleWindowMs,
            maxWindows: request.maxSamplesPerRecording,
          },
          analyses,
        }),
        signal: AbortSignal.timeout(request.requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "Media inference request timed out", { cause: error });
      }
      throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "Media inference service is unreachable", { cause: error });
    }

    if (response.status === 504) {
      throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "Media inference request timed out");
    }
    if (!response.ok) {
      throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "Media inference service rejected the request");
    }

    const responseText = await readBoundedResponseBody(response);

    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch (error) {
      throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media inference response is not valid JSON", {
        cause: error,
      });
    }

    return validateResponse(responseBody, adapterVersion, request.maxSamplesPerRecording);
  }

  return {
    adapterVersion,
    async analyzeVoiceActivity(request) {
      const result = await analyze(request, { voiceActivity: true, facePresence: false, speakerDiarization: false });
      return result.voiceActivityWindows;
    },
    async analyzeSpeakerDiarization(request) {
      const result = await analyze(request, { voiceActivity: false, facePresence: false, speakerDiarization: true });
      return result.speakerSegments;
    },
    async analyzeVideoWindows(request) {
      if (request.requestedModes.includes(MEDIA_ANALYSIS_MODES.videoGazeOffscreen)) {
        throw new MediaWorkerError(
          "MEDIA_ADAPTER_UNAVAILABLE",
          "Gaze analysis is unavailable without a calibrated inference runtime",
        );
      }
      const result = await analyze(request, { voiceActivity: false, facePresence: true, speakerDiarization: false });
      return result.faceWindows;
    },
    async verifyRecording(request) {
      let response: Response;
      try {
        response = await fetchImpl(new URL("v1/recording-verification", baseUrl), {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1, recording: {
            storageBucket: request.storageBucket,
            storageKey: request.storageKey,
            contentType: request.contentType,
            durationMs: request.durationMs,
          } }),
          signal: AbortSignal.timeout(request.requestTimeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "Recording verification timed out", { cause: error });
        }
        throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "Recording verification service is unreachable", { cause: error });
      }
      if (response.status === 504) {
        throw new MediaWorkerError("MEDIA_ADAPTER_TIMEOUT", "Recording verification timed out");
      }
      if (!response.ok) {
        throw new MediaWorkerError("MEDIA_ADAPTER_FAILED", "Recording verification service rejected the request");
      }
      let value: unknown;
      try {
        value = JSON.parse(await readBoundedResponseBody(response));
      } catch (error) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Recording verification response is invalid", { cause: error });
      }
      if (!isRecord(value) || value.version !== 1 || value.adapterVersion !== adapterVersion) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Recording verification response version is invalid");
      }
      return {
        durationMs: requireNonNegativeInteger("durationMs", value.durationMs),
        byteSize: requireNonNegativeInteger("byteSize", value.byteSize),
      };
    },
  };
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media inference response exceeds the size limit");
    }
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media inference response exceeds the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

interface ValidatedInferenceResponse {
  voiceActivityWindows: VoiceActivityWindow[];
  speakerSegments: SpeakerDiarizationSegment[];
  faceWindows: VideoAnalysisWindow[];
}

function validateResponse(
  value: unknown,
  expectedAdapterVersion: string,
  maxFaceWindows: number,
): ValidatedInferenceResponse {
  if (!isRecord(value) || value.version !== 1 || value.adapterVersion !== expectedAdapterVersion) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media inference response version is invalid");
  }
  if (!Array.isArray(value.voiceActivityWindows) || value.voiceActivityWindows.length > MAX_VOICE_ACTIVITY_WINDOWS) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Voice activity response is invalid");
  }
  if (!Array.isArray(value.faceWindows) || value.faceWindows.length > maxFaceWindows) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Face analysis response is invalid");
  }
  if (!Array.isArray(value.speakerSegments) || value.speakerSegments.length > MAX_VOICE_ACTIVITY_WINDOWS) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Speaker diarization response is invalid");
  }

  return {
    voiceActivityWindows: value.voiceActivityWindows.map((window) => {
      const parsed = parseWindowBounds(window);
      return parsed;
    }),
    speakerSegments: value.speakerSegments.map((segment) => {
      if (!isRecord(segment)) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Speaker diarization segment is invalid");
      }
      return {
        speakerId: requireSpeakerId(segment.speakerId),
        ...parseWindowBounds(segment),
      };
    }),
    faceWindows: value.faceWindows.map((window) => {
      if (!isRecord(window)) {
        throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Face analysis window is invalid");
      }
      return {
        faceCount: requireNonNegativeInteger("faceCount", window.faceCount),
        conditionSupport: requireConfidence("conditionSupport", window.conditionSupport),
        ...parseWindowBounds(window),
      };
    }),
  };
}

function parseWindowBounds(value: unknown): { startedAtMs: number; endedAtMs: number } {
  if (!isRecord(value)) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media analysis window is invalid");
  }
  const startedAtMs = requireNonNegativeInteger("startedAtMs", value.startedAtMs);
  const endedAtMs = requireNonNegativeInteger("endedAtMs", value.endedAtMs);
  if (endedAtMs <= startedAtMs) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Media analysis window timestamps are invalid");
  }
  return { startedAtMs, endedAtMs };
}

function parseBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(requireNonEmptyString("baseUrl", value));
  } catch (error) {
    throw new Error("baseUrl must be a valid HTTP URL", { cause: error });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must be a valid HTTP URL");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function requireNonEmptyString(fieldName: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireNonNegativeInteger(fieldName: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", `${fieldName} must be a non-negative integer`);
  }
  return value as number;
}

function requireConfidence(fieldName: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", `${fieldName} must be between 0 and 1`);
  }
  return value;
}

function requireSpeakerId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 128) {
    throw new MediaWorkerError("MEDIA_ADAPTER_INVALID_RESPONSE", "Speaker diarization speaker id is invalid");
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
