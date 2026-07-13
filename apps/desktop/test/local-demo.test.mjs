import assert from "node:assert/strict";
import test from "node:test";

import {
  getLocalDemoWorkspaceState,
  hostLocalDemoMeeting,
  joinLocalDemoMeeting,
  updateLocalDemoWorkspaceState,
} from "../dist/local-demo.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function bootstrapBody(role, includeMeeting = false) {
  return {
    ...(includeMeeting
      ? {
          meeting: {
            code: "123456",
            password: "ABCD2345",
            expiresAt: "2026-07-11T20:00:00.000Z",
          },
        }
      : {}),
    connection: {
      sessionId: "session-a",
      documentId: "document-a",
      participantId: `${role}-a`,
      authToken: `${role}-token`,
      role,
      languageId: 63,
    },
  };
}

test("hostLocalDemoMeeting creates a meeting without exposing technical inputs", async () => {
  const calls = [];
  const result = await hostLocalDemoMeeting(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(bootstrapBody("interviewer", true), 201);
  });

  assert.equal(calls[0].url, "http://127.0.0.1:3000/local-demo/meetings");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
  assert.equal(result.role, "interviewer");
  assert.deepEqual(result.meeting, {
    code: "123456",
    password: "ABCD2345",
    expiresAt: "2026-07-11T20:00:00.000Z",
  });
  assert.equal(result.connection.sessionId, "session-a");
});

test("joinLocalDemoMeeting sends only code and password and returns candidate bootstrap", async () => {
  const calls = [];
  const result = await joinLocalDemoMeeting(
    {
      code: " 123456 ",
      password: " abcd2345 ",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(bootstrapBody("candidate"), 201);
    },
  );

  assert.equal(calls[0].url, "http://127.0.0.1:3000/local-demo/meetings/join");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    code: "123456",
    password: "ABCD2345",
  });
  assert.equal(result.role, "candidate");
  assert.equal(result.meeting, null);
  assert.equal(result.connection.participantId, "candidate-a");
});

test("local demo client validates credentials and surfaces controlled errors", async () => {
  await assert.rejects(
    () => joinLocalDemoMeeting({ code: "12", password: "short" }),
    /6-digit meeting code/,
  );

  await assert.rejects(
    () =>
      joinLocalDemoMeeting(
        { code: "123456", password: "ABCD2345" },
        async () => jsonResponse({ error: { message: "Meeting code or password is incorrect" } }, 401),
      ),
    /Meeting code or password is incorrect/,
  );

  await assert.rejects(
    () => joinLocalDemoMeeting({ code: "123456", password: "ABCD2345" }, async () => {
      throw new TypeError("fetch failed");
    }),
    /Local demo server is not running/,
  );
});

test("local demo workspace state uses authenticated backend-only controls", async () => {
  const calls = [];
  const state = await getLocalDemoWorkspaceState(
    {
      sessionId: "session-a",
      authToken: "candidate-token",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        state: {
          codeEditorOpen: false,
        },
      });
    },
  );

  assert.deepEqual(state, {
    codeEditorOpen: false,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/local-demo/meetings/state?sessionId=session-a");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer candidate-token");

  const updatedState = await updateLocalDemoWorkspaceState(
    {
      sessionId: "session-a",
      authToken: "interviewer-token",
      codeEditorOpen: true,
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        state: {
          codeEditorOpen: true,
        },
      });
    },
  );

  assert.deepEqual(updatedState, {
    codeEditorOpen: true,
  });
  assert.equal(calls[1].url, "http://127.0.0.1:3000/local-demo/meetings/state");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.headers.Authorization, "Bearer interviewer-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    sessionId: "session-a",
    codeEditorOpen: true,
  });
});
