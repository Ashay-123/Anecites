import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalDemoEditorDocument,
  createLocalDemoJoinLink,
  getLocalDemoWorkspaceState,
  hostLocalDemoMeeting,
  joinLocalDemoMeeting,
  readLocalDemoJoinCode,
  resolveLocalDemoServiceUrls,
  selectLocalDemoEditorDocument,
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
    joinUrl: null,
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

test("local demo join links contain only a validated meeting code", () => {
  const link = createLocalDemoJoinLink(
    " 123456 ",
    "http://127.0.0.1:5173/?password=ABCD2345#old-fragment",
  );

  assert.equal(link, "http://127.0.0.1:5173/#join?code=123456");
  assert.equal(readLocalDemoJoinCode(link), "123456");
  assert.equal(readLocalDemoJoinCode("http://127.0.0.1:5173/#join?code=invalid"), null);
  assert.equal(readLocalDemoJoinCode("http://127.0.0.1:5173/#other?code=123456"), null);
  assert.equal(readLocalDemoJoinCode("http://127.0.0.1:5173/#join?code=123456&password=ABCD2345"), null);
  assert.doesNotMatch(link, /password|ABCD2345/);
  assert.throws(() => createLocalDemoJoinLink("123"), /meeting code is invalid/);
});

test("public demo pages use same-origin API and secure WebSocket routes", () => {
  assert.deepEqual(resolveLocalDemoServiceUrls("https://demo.trycloudflare.com/#join?code=123456"), {
    apiBaseUrl: "https://demo.trycloudflare.com/api",
    collabBaseUrl: "wss://demo.trycloudflare.com/collab",
  });
  assert.deepEqual(resolveLocalDemoServiceUrls("http://127.0.0.1:5173/"), {
    apiBaseUrl: "http://127.0.0.1:5173/api",
    collabBaseUrl: "ws://127.0.0.1:5173/collab",
  });
  assert.deepEqual(resolveLocalDemoServiceUrls("tauri://localhost"), {
    apiBaseUrl: "http://127.0.0.1:3000",
    collabBaseUrl: "ws://127.0.0.1:3001",
  });
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
          activeDocumentId: "document-a",
          documents: [{ id: "document-a", label: "Solution 1" }],
        },
      });
    },
  );

  assert.deepEqual(state, {
    codeEditorOpen: false,
    activeDocumentId: "document-a",
    documents: [{ id: "document-a", label: "Solution 1" }],
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
          activeDocumentId: "document-a",
          documents: [{ id: "document-a", label: "Solution 1" }],
        },
      });
    },
  );

  assert.deepEqual(updatedState, {
    codeEditorOpen: true,
    activeDocumentId: "document-a",
    documents: [{ id: "document-a", label: "Solution 1" }],
  });
  assert.equal(calls[1].url, "http://127.0.0.1:3000/local-demo/meetings/state");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.headers.Authorization, "Bearer interviewer-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    sessionId: "session-a",
    codeEditorOpen: true,
  });

  const createdState = await createLocalDemoEditorDocument(
    {
      sessionId: "session-a",
      authToken: "candidate-token",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        state: {
          codeEditorOpen: true,
          activeDocumentId: "document-b",
          documents: [
            { id: "document-a", label: "Solution 1" },
            { id: "document-b", label: "Solution 2" },
          ],
        },
      }, 201);
    },
  );

  assert.equal(createdState.activeDocumentId, "document-b");
  assert.equal(createdState.documents.length, 2);
  assert.equal(calls[2].url, "http://127.0.0.1:3000/local-demo/meetings/documents");
  assert.deepEqual(JSON.parse(calls[2].init.body), { sessionId: "session-a" });

  const selectedState = await selectLocalDemoEditorDocument(
    {
      sessionId: "session-a",
      authToken: "interviewer-token",
      documentId: "document-a",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        state: {
          codeEditorOpen: true,
          activeDocumentId: "document-a",
          documents: [
            { id: "document-a", label: "Solution 1" },
            { id: "document-b", label: "Solution 2" },
          ],
        },
      });
    },
  );

  assert.equal(selectedState.activeDocumentId, "document-a");
  assert.equal(calls[3].url, "http://127.0.0.1:3000/local-demo/meetings/documents/active");
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    sessionId: "session-a",
    documentId: "document-a",
  });
});
