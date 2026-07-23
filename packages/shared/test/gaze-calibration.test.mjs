import test from "node:test";
import assert from "node:assert/strict";

import {
  GAZE_CALIBRATION_TARGETS,
  createGazeCalibrationSteps,
} from "../dist/index.js";

test("gaze calibration accepts one bounded step for each canonical target", () => {
  const steps = createGazeCalibrationSteps([
    { target: "center", sequence: 1 },
    { target: "upper_left", sequence: 2 },
    { target: "upper_right", sequence: 3 },
    { target: "lower_left", sequence: 4 },
    { target: "lower_right", sequence: 5 },
  ]);

  assert.deepEqual(GAZE_CALIBRATION_TARGETS, [
    "center",
    "upper_left",
    "upper_right",
    "lower_left",
    "lower_right",
  ]);
  assert.deepEqual(steps, [
    { target: "center", sequence: 1 },
    { target: "upper_left", sequence: 2 },
    { target: "upper_right", sequence: 3 },
    { target: "lower_left", sequence: 4 },
    { target: "lower_right", sequence: 5 },
  ]);
});

test("gaze calibration rejects incomplete, reordered, duplicate, and unbounded client data", () => {
  assert.throws(
    () => createGazeCalibrationSteps([{ target: "center", sequence: 1 }]),
    /must contain exactly 5 steps/,
  );
  assert.throws(
    () =>
      createGazeCalibrationSteps([
        { target: "upper_left", sequence: 1 },
        { target: "center", sequence: 2 },
        { target: "upper_right", sequence: 3 },
        { target: "lower_left", sequence: 4 },
        { target: "lower_right", sequence: 5 },
      ]),
    /target order is invalid/,
  );
  assert.throws(
    () =>
      createGazeCalibrationSteps([
        { target: "center", sequence: 1 },
        { target: "upper_left", sequence: 2 },
        { target: "upper_right", sequence: 3 },
        { target: "lower_left", sequence: 4 },
        { target: "lower_left", sequence: 5 },
      ]),
    /target order is invalid/,
  );
  assert.throws(
    () =>
      createGazeCalibrationSteps([
        { target: "center", sequence: 1, faceLandmarks: ["must-not-be-accepted"] },
        { target: "upper_left", sequence: 2 },
        { target: "upper_right", sequence: 3 },
        { target: "lower_left", sequence: 4 },
        { target: "lower_right", sequence: 5 },
      ]),
    /contains unsupported fields/,
  );
  assert.throws(
    () =>
      createGazeCalibrationSteps([
        { target: "center", sequence: 1 },
        { target: "upper_left", sequence: 2 },
        { target: "upper_right", sequence: 3 },
        { target: "lower_left", sequence: 4 },
        { target: "lower_right", sequence: 7 },
      ]),
    /sequence is invalid/,
  );
});
