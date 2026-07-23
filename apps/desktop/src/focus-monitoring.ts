import { type CandidateFocusLossEvent } from "./monitoring.js";

interface EventTargetLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface CandidateFocusMonitorOptions {
  windowTarget?: EventTargetLike;
  documentTarget?: EventTargetLike;
  getVisibilityState?: () => DocumentVisibilityState;
  now?: () => Date;
  minimumDurationMs?: number;
  onFocusLoss(event: CandidateFocusLossEvent): void;
}

export interface CandidateFocusMonitor {
  stop(): void;
}

export function createCandidateFocusMonitor(
  options: CandidateFocusMonitorOptions,
): CandidateFocusMonitor {
  const windowTarget = options.windowTarget ?? window;
  const documentTarget = options.documentTarget ?? document;
  const getVisibilityState = options.getVisibilityState ?? (() => document.visibilityState);
  const now = options.now ?? (() => new Date());
  const minimumDurationMs = options.minimumDurationMs ?? 1_000;
  if (!Number.isSafeInteger(minimumDurationMs) || minimumDurationMs < 1) {
    throw new Error("minimumDurationMs must be a positive integer");
  }

  let windowFocused = true;
  let hidden = getVisibilityState() === "hidden";
  let focusLoss: { reason: CandidateFocusLossEvent["reason"]; startedAt: Date } | null = null;
  let stopped = false;

  const beginFocusLoss = (reason: CandidateFocusLossEvent["reason"]) => {
    if (!focusLoss) {
      focusLoss = { reason, startedAt: requireValidDate(now()) };
      return;
    }
    if (reason === "document_hidden") {
      focusLoss.reason = reason;
    }
  };

  const finishFocusLoss = () => {
    if (!focusLoss || hidden || !windowFocused) {
      return;
    }
    const endedAt = requireValidDate(now());
    const durationMs = Math.max(0, endedAt.getTime() - focusLoss.startedAt.getTime());
    const completed = focusLoss;
    focusLoss = null;
    if (durationMs < minimumDurationMs) {
      return;
    }
    options.onFocusLoss({
      reason: completed.reason,
      startedAt: completed.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs,
    });
  };

  const handleBlur: EventListener = () => {
    windowFocused = false;
    beginFocusLoss("window_blur");
  };
  const handleFocus: EventListener = () => {
    windowFocused = true;
    finishFocusLoss();
  };
  const handleVisibilityChange: EventListener = () => {
    hidden = getVisibilityState() === "hidden";
    if (hidden) {
      beginFocusLoss("document_hidden");
      return;
    }
    finishFocusLoss();
  };

  windowTarget.addEventListener("blur", handleBlur);
  windowTarget.addEventListener("focus", handleFocus);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      windowTarget.removeEventListener("blur", handleBlur);
      windowTarget.removeEventListener("focus", handleFocus);
      documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
      focusLoss = null;
    },
  };
}

function requireValidDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Focus monitoring timestamp must be valid");
  }
  return value;
}
