import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTICIPANT_ROLES,
  ROOM_TYPES,
  USER_ROLES,
  buildSessionRoomName,
  isPrivilegedUserRole,
} from "../dist/index.js";

test("user and participant roles are explicit", () => {
  assert.deepEqual(USER_ROLES, [
    "candidate",
    "interviewer",
    "reviewer",
    "admin",
  ]);

  assert.deepEqual(PARTICIPANT_ROLES, [
    "candidate",
    "interviewer",
  ]);
});

test("room types cover editor, video, and review flows", () => {
  assert.deepEqual(ROOM_TYPES, [
    "editor",
    "video",
    "review",
  ]);
});

test("session room names are deterministic and namespaced", () => {
  assert.equal(
    buildSessionRoomName("session-1", "editor"),
    "session:session-1:editor",
  );
});

test("privileged user role detection excludes candidates", () => {
  assert.equal(isPrivilegedUserRole("candidate"), false);
  assert.equal(isPrivilegedUserRole("reviewer"), true);
  assert.equal(isPrivilegedUserRole("admin"), true);
});
