import {
  createGazeCalibrationStepPrefix,
  type GazeCalibrationStep,
  type GazeCalibrationTarget,
} from "@anecites/shared";

const REQUEST_TIMEOUT_MS = 10_000;

export interface GazeCalibrationStepRecord extends GazeCalibrationStep {
  acknowledgedAt: string;
}

export interface GazeCalibration {
  id: string;
  state: "active" | "completed" | "abandoned";
  startedAt: string;
  completedAt: string | null;
  steps: GazeCalibrationStepRecord[];
}

export interface StartGazeCalibrationRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
}

export interface AcknowledgeGazeCalibrationStepRequest extends StartGazeCalibrationRequest {
  gazeCalibrationId: string;
  target: GazeCalibrationTarget;
  sequence: number;
}

export async function startGazeCalibration(
  request: StartGazeCalibrationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GazeCalibration> {
  const response = await requestGazeCalibration(
    buildSessionUrl(request, "gaze-calibrations"),
    {
      method: "POST",
      headers: authorizationHeaders(request.authToken),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  return parseGazeCalibrationResponse(response);
}

export async function acknowledgeGazeCalibrationStep(
  request: AcknowledgeGazeCalibrationStepRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GazeCalibration> {
  const response = await requestGazeCalibration(
    buildSessionUrl(request, `gaze-calibrations/${encodeURIComponent(requireIdentifier(request.gazeCalibrationId))}/steps`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authorizationHeaders(request.authToken),
      },
      body: JSON.stringify({
        target: request.target,
        sequence: request.sequence,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
    fetchImpl,
  );
  return parseGazeCalibrationResponse(response);
}

async function requestGazeCalibration(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("Gaze calibration service timed out");
    }
    throw new Error("Gaze calibration service is unavailable");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Gaze calibration request failed");
  }
  return body;
}

function parseGazeCalibrationResponse(value: unknown): GazeCalibration {
  const root = requireRecord(value, "Gaze calibration response is invalid");
  const calibration = requireRecord(root.gazeCalibration, "Gaze calibration response is invalid");
  const id = requireIdentifier(calibration.id);
  const state = calibration.state;
  if (state !== "active" && state !== "completed" && state !== "abandoned") {
    throw new Error("Gaze calibration response is invalid");
  }

  const startedAt = requireIsoTimestamp(calibration.startedAt, "Gaze calibration response is invalid");
  const completedAt = calibration.completedAt === null
    ? null
    : requireIsoTimestamp(calibration.completedAt, "Gaze calibration response is invalid");
  if (!Array.isArray(calibration.steps)) {
    throw new Error("Gaze calibration response is invalid");
  }

  const rawSteps = calibration.steps.map((step) => {
    const record = requireRecord(step, "Gaze calibration response is invalid");
    return {
      target: record.target,
      sequence: record.sequence,
      acknowledgedAt: requireIsoTimestamp(record.acknowledgedAt, "Gaze calibration response is invalid"),
    };
  });
  let steps: GazeCalibrationStep[];
  try {
    steps = createGazeCalibrationStepPrefix(rawSteps.map(({ target, sequence }) => ({ target, sequence })));
  } catch {
    throw new Error("Gaze calibration response is invalid");
  }
  if (
    (state === "active" && (completedAt !== null || steps.length >= 5)) ||
    (state === "completed" && (completedAt === null || steps.length !== 5)) ||
    (state === "abandoned" && (completedAt === null || steps.length >= 5))
  ) {
    throw new Error("Gaze calibration response is invalid");
  }

  return {
    id,
    state,
    startedAt,
    completedAt,
    steps: steps.map((step, index) => ({
      ...step,
      acknowledgedAt: rawSteps[index]?.acknowledgedAt ?? "",
    })),
  };
}

function buildSessionUrl(request: StartGazeCalibrationRequest, path: string): string {
  const apiBaseUrl = requireIdentifier(request.apiBaseUrl);
  const sessionId = requireIdentifier(request.sessionId);
  requireIdentifier(request.authToken);
  return `${apiBaseUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(sessionId)}/${path}`;
}

function authorizationHeaders(authToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${requireIdentifier(authToken)}`,
  };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4_096) {
    throw new Error("Gaze calibration request is invalid");
  }
  return value.trim();
}

function requireIsoTimestamp(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new Error(message);
  }
  return value;
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}
