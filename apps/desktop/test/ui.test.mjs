import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../dist/App.js";

test("desktop app starts with the basic local demo host and join choices", () => {
  const html = renderToStaticMarkup(React.createElement(App));

  assert.match(html, /data-anecites-desktop="landing-page"/);
  assert.match(html, /A fair interview for everyone in it/);
  assert.match(html, /Anecites Agent/);
  assert.match(html, /Built to be minimal, by design/);
  assert.match(html, /Join interview/);
  assert.match(html, /Host interview/);
  assert.doesNotMatch(html, /Interview problem/);
  assert.doesNotMatch(html, /Two Sum/);
  assert.doesNotMatch(html, /API URL/);
  assert.doesNotMatch(html, /Collaboration URL/);
  assert.doesNotMatch(html, /Session ID/);
  assert.doesNotMatch(html, /Document ID/);
  assert.doesNotMatch(html, /Participant ID/);
  assert.doesNotMatch(html, /Auth token/);
});
