import assert from "node:assert/strict";
import test from "node:test";

import { createCandidateFocusMonitor } from "../dist/focus-monitoring.js";

test("candidate focus monitor records a bounded tab switch after focus returns", () => {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let visibilityState = "visible";
  let nowMs = Date.parse("2026-07-16T10:00:00.000Z");
  const events = [];
  const monitor = createCandidateFocusMonitor({
    windowTarget,
    documentTarget,
    getVisibilityState: () => visibilityState,
    now: () => new Date(nowMs),
    minimumDurationMs: 1_000,
    onFocusLoss: (event) => events.push(event),
  });

  windowTarget.dispatchEvent(new Event("blur"));
  nowMs += 100;
  visibilityState = "hidden";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  nowMs += 2_400;
  visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  nowMs += 100;
  windowTarget.dispatchEvent(new Event("focus"));

  assert.deepEqual(events, [
    {
      reason: "document_hidden",
      startedAt: "2026-07-16T10:00:00.000Z",
      endedAt: "2026-07-16T10:00:02.600Z",
      durationMs: 2_600,
    },
  ]);

  nowMs += 400;
  windowTarget.dispatchEvent(new Event("blur"));
  nowMs += 500;
  windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(events.length, 1);

  monitor.stop();
  nowMs += 2_000;
  windowTarget.dispatchEvent(new Event("blur"));
  assert.equal(events.length, 1);
});

