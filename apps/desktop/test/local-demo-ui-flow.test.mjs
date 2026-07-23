import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../dist/App.js";

test("local demo starts joined candidates in video-first mode before the editor opens", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      initialSession: createSession("candidate"),
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, /data-anecites-desktop="interview-shell"/);
  assert.match(html, /data-meeting-role="candidate"/);
  assert.match(html, /data-code-editor-open="false"/);
  assert.match(html, /Video call first\. The editor opens when the interviewer starts it\./);
  assert.match(html, /aria-label="Interview video call"/);
  assert.match(html, /Waiting for video/);
  assert.doesNotMatch(html, /aria-label="Shared code editor"/);
  assert.doesNotMatch(html, /class="candidate-run-button"/);
  assert.doesNotMatch(html, />Start recording</);
  assert.doesNotMatch(html, /Native monitor/);
});

test("local demo interviewer sees only candidate joining credentials and the editor control", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      initialSession: createSession("interviewer"),
      initialHostedMeeting: {
        code: "123456",
        password: "ABCD2345",
        expiresAt: "2026-07-11T20:00:00.000Z",
      },
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, /data-meeting-role="interviewer"/);
  assert.match(html, /aria-label="Candidate joining credentials"/);
  assert.match(html, />123456</);
  assert.match(html, />ABCD2345</);
  assert.match(html, /aria-label="Copy candidate join link"/);
  assert.match(html, />Copy link</);
  assert.match(html, />Start recording</);
  assert.match(html, />Code editor</);
  assert.doesNotMatch(html, /Session ID/);
  assert.doesNotMatch(html, /Document ID/);
  assert.doesNotMatch(html, /Participant ID/);
  assert.doesNotMatch(html, /Auth token/);
});

test("local demo join links open the candidate form with only the meeting code prefilled", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      initialJoinCode: "123456",
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, /<h1 id="demo-title">Join interview<\/h1>/);
  assert.match(html, /id="meeting-code"[^>]*value="123456"/);
  assert.match(html, /id="meeting-password"[^>]*value=""/);
  assert.doesNotMatch(html, /ABCD2345/);
});

test("public demo landing is join-only", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      hostInterviewAvailableOverride: false,
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, />Join interview</);
  assert.doesNotMatch(html, />Host interview<\/button>/);
});

test("local demo editor-open state renders a simple editor and output surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      initialSession: createSession("candidate"),
      initialCodeEditorOpen: true,
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, /data-code-editor-open="true"/);
  assert.match(html, /aria-label="Interview workspace"/);
  assert.doesNotMatch(html, /aria-label="Interview problem"/);
  assert.doesNotMatch(html, /Local testcases/);
  assert.doesNotMatch(html, /Two Sum/);
  assert.doesNotMatch(html, /Submissions/);
  assert.doesNotMatch(html, />Submit</);
  assert.match(html, /aria-label="Shared code editor"/);
  assert.match(html, /role="tablist"[^>]*aria-label="Code editor tabs"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Solution 1</);
  assert.match(html, /aria-label="New editor tab"/);
  assert.match(html, /data-anecites-editor="monaco-collab"/);
  assert.match(html, /data-document-id="document-a"/);
  assert.match(html, /data-paste-disabled="true"/);
  assert.match(html, /data-anecites-editor-input="true"/);
  assert.match(html, />Code editor</);
  assert.match(html, /class="candidate-run-button"[^>]*>Run</);
  assert.match(html, /aria-label="Execution output"/);
  assert.match(html, /Run code to see output/);
  assert.doesNotMatch(html, /class="candidate-submit-button"/);
  assert.doesNotMatch(html, /Testcase/);
  assert.match(html, /aria-label="Interview video call"/);
  assert.doesNotMatch(html, /aria-label="Video call"/);
});

test("interviewer code editor control toggles the open workspace", () => {
  const html = renderToStaticMarkup(
    React.createElement(App, {
      initialSession: createSession("interviewer"),
      initialCodeEditorOpen: true,
      nativeMonitoringAvailableOverride: false,
    }),
  );

  assert.match(html, />Close editor</);
  assert.match(html, /data-paste-disabled="false"/);
  assert.doesNotMatch(html, />Editor open</);
});

function createSession(role) {
  return {
    apiBaseUrl: "http://127.0.0.1:3000",
    collabBaseUrl: "ws://127.0.0.1:3001",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: `${role}-a`,
    authToken: createUnsignedDisplayToken({
      sub: `${role}-user-a`,
      role,
    }),
    languageId: 63,
  };
}

function createUnsignedDisplayToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
