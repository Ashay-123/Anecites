import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  NativeCaptureAffinityReport,
  NativeRiskSignalReport,
  NativeVirtualizationReport,
} from "@anecites/shared";

export interface NativeCapability {
  name: string;
  available: boolean;
  reason: string | null;
}

export interface NativeProcessInfo {
  pid: number;
  name: string;
}

export interface NativeProcessScanReport {
  platform: string;
  processes: NativeProcessInfo[];
  truncated: boolean;
}

export interface NativeWindowInfo {
  id: string;
  title: string;
  processName: string | null;
}

export interface NativeWindowScanReport {
  platform: string;
  windows: NativeWindowInfo[];
  truncated: boolean;
}

export interface NativeMonitoringSnapshot {
  occurredAt: string;
  capabilities: NativeCapability[];
  processReport: NativeProcessScanReport;
  windowReport: NativeWindowScanReport;
  riskSignalReport: NativeRiskSignalReport;
}

export interface NativeMonitoringOptions {
  processLimit?: number;
  windowLimit?: number;
}

export interface SubmitNativeMonitoringSnapshotRequest {
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  participantId: string;
  windowStartedAt: string;
  windowEndedAt: string;
  snapshot: NativeMonitoringSnapshot;
}

export interface NativeMonitoringSubmissionResult {
  signalCount: number;
  riskSummary: unknown | null;
}

export type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_PROCESS_SCAN_LIMIT = 100;
const DEFAULT_WINDOW_SCAN_LIMIT = 100;
const MAX_NATIVE_SCAN_LIMIT = 500;

const REQUIRED_NATIVE_CAPABILITIES = [
  "process_scanner",
  "window_monitor",
  "capture_affinity",
  "virtualization_detection",
] as const;

export function isNativeMonitoringRuntimeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function collectNativeMonitoringSnapshot(
  options: NativeMonitoringOptions = {},
  invokeImpl: NativeInvoke = tauriInvoke,
  now: () => Date = () => new Date(),
): Promise<NativeMonitoringSnapshot> {
  const processLimit = requireScanLimit(
    "processLimit",
    options.processLimit ?? DEFAULT_PROCESS_SCAN_LIMIT,
  );
  const windowLimit = requireScanLimit("windowLimit", options.windowLimit ?? DEFAULT_WINDOW_SCAN_LIMIT);
  const occurredAt = requireTimestamp(now());
  const capabilities = await invokeImpl<NativeCapability[]>("get_native_capabilities");
  requireAvailableCapabilities(capabilities);

  const processReport = await invokeImpl<NativeProcessScanReport>("scan_processes", {
    limit: processLimit,
  });
  const windowReport = await invokeImpl<NativeWindowScanReport>("scan_windows", {
    limit: windowLimit,
  });

  const captureAffinityReports: NativeCaptureAffinityReport[] = [];

  for (const window of windowReport.windows) {
    try {
      captureAffinityReports.push(
        await invokeImpl<NativeCaptureAffinityReport>("check_capture_affinity", {
          windowId: window.id,
        }),
      );
    } catch {
      // Windows can close between enumeration and affinity lookup; the next snapshot will retry.
    }
  }

  const virtualizationReport = await invokeImpl<NativeVirtualizationReport>("detect_virtualization");

  return {
    occurredAt,
    capabilities,
    processReport,
    windowReport,
    riskSignalReport: {
      occurredAt,
      captureAffinityReports,
      virtualizationReports: [virtualizationReport],
    },
  };
}

export async function submitNativeMonitoringSnapshot(
  request: SubmitNativeMonitoringSnapshotRequest,
  fetchImpl: FetchLike = fetch,
): Promise<NativeMonitoringSubmissionResult> {
  const response = await fetchImpl(
    `${trimTrailingSlash(request.apiBaseUrl)}/sessions/${encodeURIComponent(request.sessionId)}/native-risk-report`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.authToken}`,
      },
      body: JSON.stringify({
        participantId: request.participantId,
        windowStartedAt: request.windowStartedAt,
        windowEndedAt: request.windowEndedAt,
        nativeReport: request.snapshot.riskSignalReport,
      }),
    },
  );

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body) ?? "Native monitoring submission failed");
  }

  return parseNativeMonitoringSubmissionResult(body);
}

function requireScanLimit(fieldName: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_NATIVE_SCAN_LIMIT) {
    throw new Error(`${fieldName} must be between 1 and ${MAX_NATIVE_SCAN_LIMIT}`);
  }

  return value;
}

function requireTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Native monitoring timestamp must be valid");
  }

  return value.toISOString();
}

function requireAvailableCapabilities(capabilities: NativeCapability[]): void {
  if (!Array.isArray(capabilities)) {
    throw new Error("Native capabilities response is invalid");
  }

  for (const capabilityName of REQUIRED_NATIVE_CAPABILITIES) {
    const capability = capabilities.find((candidate) => candidate.name === capabilityName);

    if (!capability || capability.available !== true) {
      const reason = capability?.reason ? `: ${capability.reason}` : "";
      throw new Error(`Native capability ${capabilityName} is unavailable${reason}`);
    }
  }
}

function parseNativeMonitoringSubmissionResult(body: unknown): NativeMonitoringSubmissionResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Native monitoring submission response is invalid");
  }

  const record = body as Record<string, unknown>;
  const signalCount = record.signalCount;

  if (typeof signalCount !== "number" || !Number.isSafeInteger(signalCount) || signalCount < 0) {
    throw new Error("Native monitoring submission response is invalid");
  }

  return {
    signalCount,
    riskSummary: record.riskSummary ?? null,
  };
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const error = (body as { error?: unknown }).error;

  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
