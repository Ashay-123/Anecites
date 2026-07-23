import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionRecordingStatus,
  startSessionRecording,
  stopSessionRecording,
} from "../dist/recording.js";

const request = {
  apiBaseUrl: "https://api.example.test/",
  authToken: "test-token",
  sessionId: "session-a",
};

test("recording client reads a redacted status and only uses an interviewer control handle", async () => {
  const calls = [];
  const status = await getSessionRecordingStatus(request, async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      recordingStatus: {
        state: "active",
        startedAt: "2026-07-19T10:00:00.000Z",
        stopRequestedAt: null,
        completedAt: null,
      },
      recordingControl: {
        egressId: "egress-a",
      },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/sessions/session-a/livekit-recording");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(status.recordingStatus?.state, "active");
  assert.equal(status.recordingControl?.egressId, "egress-a");
});

test("recording client starts and stops a consented recording without parsing evidence identifiers", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST" && url.endsWith("/livekit-recording")) {
      return jsonResponse({
        sessionRecording: {
          id: "recording-a",
          egressId: "egress-a",
          evidenceObjectId: "evidence-a",
          state: "active",
          startedAt: "2026-07-19T10:00:00.000Z",
          stopRequestedAt: null,
          completedAt: null,
        },
      }, 201);
    }

    return jsonResponse({
      sessionRecording: {
        id: "recording-a",
        egressId: "egress-a",
        evidenceObjectId: "evidence-a",
        state: "completed",
        startedAt: "2026-07-19T10:00:00.000Z",
        stopRequestedAt: "2026-07-19T10:05:00.000Z",
        completedAt: "2026-07-19T10:05:01.000Z",
      },
      mediaAnalysis: {
        status: "queued",
      },
    });
  };

  const started = await startSessionRecording(request, fetchImpl);
  const stopped = await stopSessionRecording({ ...request, egressId: started.egressId }, fetchImpl);

  assert.equal(started.state, "active");
  assert.equal(started.egressId, "egress-a");
  assert.equal(stopped.recording.state, "completed");
  assert.equal(stopped.mediaAnalysisStatus, "queued");
  assert.equal(calls[0].url, "https://api.example.test/sessions/session-a/livekit-recording");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "https://api.example.test/sessions/session-a/livekit-recording/egress-a/stop");
  assert.equal(calls[1].init.method, "POST");
});

test("recording client fails closed on malformed or rejected responses", async () => {
  await assert.rejects(
    () => getSessionRecordingStatus(request, async () => jsonResponse({ recordingStatus: { state: "active" } })),
    /Recording status response is invalid/,
  );

  await assert.rejects(
    () => startSessionRecording(request, async () => jsonResponse({ error: { message: "Consent is required" } }, 409)),
    /Consent is required/,
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
