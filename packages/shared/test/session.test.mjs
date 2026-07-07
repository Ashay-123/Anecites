import test from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_STATES,
  isTerminalSessionState,
  isValidSessionTransition,
} from "../dist/index.js";

test("session states expose the lifecycle needed by Phase 1", () => {
  assert.deepEqual(SESSION_STATES, [
    "created",
    "scheduled",
    "lobby",
    "active",
    "ended",
    "cancelled",
  ]);
});

test("session state machine allows only forward safe transitions", () => {
  assert.equal(isValidSessionTransition("created", "scheduled"), true);
  assert.equal(isValidSessionTransition("scheduled", "lobby"), true);
  assert.equal(isValidSessionTransition("lobby", "active"), true);
  assert.equal(isValidSessionTransition("active", "ended"), true);
  assert.equal(isValidSessionTransition("ended", "active"), false);
  assert.equal(isValidSessionTransition("cancelled", "active"), false);
});

test("terminal session states cannot transition again", () => {
  assert.equal(isTerminalSessionState("ended"), true);
  assert.equal(isTerminalSessionState("cancelled"), true);
  assert.equal(isTerminalSessionState("active"), false);
});
