import assert from "node:assert/strict";
import test from "node:test";

import {
  collectNativeMonitoringSnapshot,
  isNativeMonitoringRuntimeAvailable,
  submitNativeMonitoringSnapshot,
} from "../dist/native.js";

test("isNativeMonitoringRuntimeAvailable is false outside the Tauri runtime", () => {
  assert.equal(isNativeMonitoringRuntimeAvailable(), false);
});

test("collectNativeMonitoringSnapshot gathers timestamped native risk reports", async () => {
  const calls = [];
  const snapshot = await collectNativeMonitoringSnapshot(
    {
      processLimit: 25,
      windowLimit: 2,
    },
    async (command, args) => {
      calls.push({ command, args });

      if (command === "get_native_capabilities") {
        return [
          {
            name: "process_scanner",
            available: true,
            reason: null,
          },
          {
            name: "window_monitor",
            available: true,
            reason: null,
          },
          {
            name: "capture_affinity",
            available: true,
            reason: null,
          },
          {
            name: "virtualization_detection",
            available: true,
            reason: null,
          },
        ];
      }

      if (command === "scan_processes") {
        assert.deepEqual(args, { limit: 25 });

        return {
          platform: "windows",
          processes: [
            {
              pid: 123,
              name: "candidate.exe",
            },
          ],
          truncated: false,
        };
      }

      if (command === "scan_windows") {
        assert.deepEqual(args, { limit: 2 });

        return {
          platform: "windows",
          windows: [
            {
              id: "1001",
              title: "Candidate editor",
              processName: "candidate.exe",
            },
            {
              id: "1002",
              title: "Overlay",
              processName: "overlay.exe",
            },
          ],
          truncated: true,
        };
      }

      if (command === "check_capture_affinity") {
        return {
          platform: "windows",
          windowId: args.windowId,
          protectedFromCapture: args.windowId === "1002",
        };
      }

      if (command === "detect_virtualization") {
        return {
          platform: "windows",
          signals: [
            {
              name: "cpuid.hypervisor_present",
              detected: true,
              detail: "vendor=Microsoft Hv",
            },
          ],
        };
      }

      throw new Error(`unexpected command ${command}`);
    },
    () => new Date("2026-07-11T01:02:03.000Z"),
  );

  assert.deepEqual(
    calls.map((call) => call.command),
    [
      "get_native_capabilities",
      "scan_processes",
      "scan_windows",
      "check_capture_affinity",
      "check_capture_affinity",
      "detect_virtualization",
    ],
  );
  assert.equal(snapshot.occurredAt, "2026-07-11T01:02:03.000Z");
  assert.equal(snapshot.processReport.processes[0].name, "candidate.exe");
  assert.equal(snapshot.windowReport.truncated, true);
  assert.deepEqual(snapshot.riskSignalReport, {
    occurredAt: "2026-07-11T01:02:03.000Z",
    captureAffinityReports: [
      {
        platform: "windows",
        windowId: "1001",
        protectedFromCapture: false,
      },
      {
        platform: "windows",
        windowId: "1002",
        protectedFromCapture: true,
      },
    ],
    virtualizationReports: [
      {
        platform: "windows",
        signals: [
          {
            name: "cpuid.hypervisor_present",
            detected: true,
            detail: "vendor=Microsoft Hv",
          },
        ],
      },
    ],
  });
});

test("collectNativeMonitoringSnapshot fails closed when native capabilities are unavailable", async () => {
  await assert.rejects(
    () =>
      collectNativeMonitoringSnapshot(
        {},
        async () => [
          {
            name: "process_scanner",
            available: false,
            reason: "Native monitoring is supported only on Windows",
          },
        ],
        () => new Date("2026-07-11T01:02:03.000Z"),
      ),
    /Native capability process_scanner is unavailable/,
  );
});

test("collectNativeMonitoringSnapshot validates scan limits", async () => {
  await assert.rejects(
    () =>
      collectNativeMonitoringSnapshot({
        processLimit: 0,
      }),
    /processLimit must be between 1 and 500/,
  );

  await assert.rejects(
    () =>
      collectNativeMonitoringSnapshot({
        windowLimit: 501,
      }),
    /windowLimit must be between 1 and 500/,
  );
});

test("submitNativeMonitoringSnapshot posts native reports only to the backend", async () => {
  const calls = [];
  const snapshot = {
    occurredAt: "2026-07-11T01:02:03.000Z",
    capabilities: [],
    processReport: {
      platform: "windows",
      processes: [],
      truncated: false,
    },
    windowReport: {
      platform: "windows",
      windows: [],
      truncated: false,
    },
    riskSignalReport: {
      occurredAt: "2026-07-11T01:02:03.000Z",
      captureAffinityReports: [
        {
          platform: "windows",
          windowId: "1002",
          protectedFromCapture: true,
        },
      ],
      virtualizationReports: [],
    },
  };

  const result = await submitNativeMonitoringSnapshot(
    {
      apiBaseUrl: "http://127.0.0.1:3000/",
      authToken: "session-jwt",
      sessionId: "session-a",
      participantId: "participant-a",
      windowStartedAt: "2026-07-11T01:02:00.000Z",
      windowEndedAt: "2026-07-11T01:03:00.000Z",
      snapshot,
    },
    async (url, init) => {
      calls.push({ url, init });

      return new Response(
        JSON.stringify({
          signalCount: 1,
          riskSummary: {
            id: "risk-summary-1",
            reviewStatus: "pending_review",
          },
        }),
        {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  );

  assert.deepEqual(result, {
    signalCount: 1,
    riskSummary: {
      id: "risk-summary-1",
      reviewStatus: "pending_review",
    },
  });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/sessions/session-a/native-risk-report");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer session-jwt");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    participantId: "participant-a",
    windowStartedAt: "2026-07-11T01:02:00.000Z",
    windowEndedAt: "2026-07-11T01:03:00.000Z",
    nativeReport: snapshot.riskSignalReport,
  });
});

test("submitNativeMonitoringSnapshot handles clean native report responses", async () => {
  const result = await submitNativeMonitoringSnapshot(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "session-jwt",
      sessionId: "session-a",
      participantId: "participant-a",
      windowStartedAt: "2026-07-11T01:02:00.000Z",
      windowEndedAt: "2026-07-11T01:03:00.000Z",
      snapshot: {
        occurredAt: "2026-07-11T01:02:03.000Z",
        capabilities: [],
        processReport: {
          platform: "windows",
          processes: [],
          truncated: false,
        },
        windowReport: {
          platform: "windows",
          windows: [],
          truncated: false,
        },
        riskSignalReport: {
          occurredAt: "2026-07-11T01:02:03.000Z",
          captureAffinityReports: [],
          virtualizationReports: [],
        },
      },
    },
    async () =>
      new Response(
        JSON.stringify({
          signalCount: 0,
          riskSummary: null,
        }),
        {
          status: 202,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  );

  assert.deepEqual(result, {
    signalCount: 0,
    riskSummary: null,
  });
});
