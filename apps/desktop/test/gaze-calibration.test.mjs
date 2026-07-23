import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeGazeCalibrationStep,
  startGazeCalibration,
} from "../dist/gaze-calibration.js";

const request = {
  apiBaseUrl: "https://api.example.test/",
  authToken: "test-token",
  sessionId: "session-a",
};

test("gaze calibration client starts a candidate calibration and posts ordered acknowledgements", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/gaze-calibrations")) {
      return jsonResponse({
        gazeCalibration: calibration("active", []),
      }, 201);
    }
    return jsonResponse({
      gazeCalibration: calibration("active", [{
        target: "center",
        sequence: 1,
        acknowledgedAt: "2026-07-19T10:00:02.000Z",
      }]),
    });
  };

  const started = await startGazeCalibration(request, fetchImpl);
  const acknowledged = await acknowledgeGazeCalibrationStep({
    ...request,
    gazeCalibrationId: started.id,
    target: "center",
    sequence: 1,
  }, fetchImpl);

  assert.equal(started.state, "active");
  assert.equal(acknowledged.steps.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/sessions/session-a/gaze-calibrations");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(
    calls[1].url,
    "https://api.example.test/sessions/session-a/gaze-calibrations/calibration-a/steps",
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    target: "center",
    sequence: 1,
  });
});

test("gaze calibration client fails closed on malformed and rejected responses", async () => {
  await assert.rejects(
    () => startGazeCalibration(request, async () => jsonResponse({ gazeCalibration: { id: "calibration-a" } })),
    /Gaze calibration response is invalid/,
  );
  await assert.rejects(
    () =>
      acknowledgeGazeCalibrationStep({
        ...request,
        gazeCalibrationId: "calibration-a",
        target: "center",
        sequence: 1,
      }, async () => jsonResponse({ error: { message: "Calibration is unavailable" } }, 409)),
    /Calibration is unavailable/,
  );
});

test("gaze calibration client accepts an abandoned calibration without offering it as active", async () => {
  const abandoned = await startGazeCalibration(
    request,
    async () => jsonResponse({ gazeCalibration: calibration("abandoned", []) }),
  );

  assert.equal(abandoned.state, "abandoned");
  assert.equal(abandoned.completedAt, "2026-07-19T10:00:10.000Z");
  assert.deepEqual(abandoned.steps, []);
});

function calibration(state, steps) {
  return {
    id: "calibration-a",
    state,
    startedAt: "2026-07-19T10:00:00.000Z",
    completedAt: state === "active" ? null : "2026-07-19T10:00:10.000Z",
    steps,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
