import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../dist/App.js";

test("desktop app renders the interview shell", () => {
  const html = renderToStaticMarkup(React.createElement(App));

  assert.match(html, /data-anecites-desktop="interview-shell"/);
  assert.match(html, /Session/);
  assert.match(html, /Candidate editor/);
  assert.match(html, /Video call/);
  assert.match(html, /Connect video/);
  assert.match(html, /Check screen/);
  assert.match(html, /Share screen/);
  assert.match(html, /Output/);
  assert.match(html, /data-anecites-editor="monaco-collab"/);
});
