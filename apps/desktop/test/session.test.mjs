import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeJoinSessionInput,
  validateJoinSessionInput,
} from "../dist/session.js";

test("join session validation rejects missing required fields", () => {
  const result = validateJoinSessionInput({
    apiBaseUrl: "",
    collabBaseUrl: "",
    sessionId: "",
    documentId: "",
    participantId: "",
    authToken: "",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, {
    apiBaseUrl: "API URL is required",
    authToken: "Auth token is required",
    collabBaseUrl: "Collaboration URL is required",
    documentId: "Document ID is required",
    participantId: "Participant ID is required",
    sessionId: "Session ID is required",
  });
});

test("join session validation normalizes valid connection input", () => {
  const result = normalizeJoinSessionInput({
    apiBaseUrl: " http://127.0.0.1:3000/ ",
    collabBaseUrl: " ws://127.0.0.1:3001/ ",
    sessionId: " session-a ",
    documentId: " document-a ",
    participantId: " candidate-a ",
    authToken: " token-a ",
    languageId: 63,
  });

  assert.deepEqual(result, {
    apiBaseUrl: "http://127.0.0.1:3000",
    collabBaseUrl: "ws://127.0.0.1:3001",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "candidate-a",
    authToken: "token-a",
    languageId: 63,
  });
});
