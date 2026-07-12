import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ApplicationShell,
  getShellNavigation,
  isNavigationItemActive,
  readShellIdentity,
} from "../dist/ui/app-shell.js";
import { Dialog } from "../dist/ui/dialog.js";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Menu,
  Select,
  Separator,
  StatePanel,
  Switch,
  Textarea,
  Tooltip,
} from "../dist/ui/primitives.js";

test("shell identity reads supported JWT display claims without inventing a role", () => {
  const reviewerToken = createUnsignedDisplayToken({
    sub: "reviewer-user-1",
    role: "reviewer",
  });

  assert.deepEqual(readShellIdentity(reviewerToken, "reviewer-participant-1"), {
    subject: "reviewer-user-1",
    displayName: "reviewer-participant-1",
    role: "reviewer",
  });
  assert.equal(readShellIdentity("not-a-jwt", "candidate-1"), null);
  assert.equal(
    readShellIdentity(createUnsignedDisplayToken({ sub: "user-1", role: "owner" }), "user-1"),
    null,
  );
});

test("shell navigation is role-aware and supports nested active paths", () => {
  assert.deepEqual(
    getShellNavigation("candidate").map((item) => item.label),
    ["Meeting", "Interview workspace", "Native monitor"],
  );
  assert.deepEqual(
    getShellNavigation("reviewer").map((item) => item.label),
    ["Meeting", "Interview workspace", "Native monitor", "Review queue"],
  );
  assert.deepEqual(
    getShellNavigation("candidate", { showNativeMonitor: false }).map((item) => item.label),
    ["Meeting", "Interview workspace"],
  );
  assert.equal(isNavigationItemActive("/review/sessions/session-a", "/review"), true);
  assert.equal(isNavigationItemActive("/workspace/interview", "/review"), false);
});

test("application shell exposes landmarks and active reviewer navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      ApplicationShell,
      {
        identity: {
          subject: "reviewer-user-1",
          displayName: "reviewer-participant-1",
          role: "reviewer",
        },
        activePath: "/review/sessions/session-a",
        contextLabel: "session-a",
      },
      React.createElement("p", null, "Current functional content"),
    ),
  );

  assert.match(html, /data-shell-role="reviewer"/);
  assert.match(html, /aria-label="Workspace navigation"/);
  assert.match(html, /aria-current="page"[^>]*>.*Review queue/s);
  assert.match(html, /<main[^>]*id="main-content"/);
  assert.match(html, /reviewer-participant-1/);
  assert.match(html, /Session session-a/);
});

test("UI primitives render native semantics and accessible state", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      "div",
      null,
      React.createElement(Button, null, "Continue"),
      React.createElement(
        Field,
        { label: "Email", htmlFor: "email", error: "Email is required", required: true },
        React.createElement(Input, {
          id: "email",
          "aria-invalid": true,
          "aria-describedby": "email-error",
        }),
      ),
      React.createElement(Textarea, { "aria-label": "Notes" }),
      React.createElement(
        Select,
        { "aria-label": "Language", defaultValue: "63" },
        React.createElement("option", { value: "63" }, "JavaScript"),
      ),
      React.createElement(Badge, { tone: "success" }, "Configured"),
      React.createElement(Card, null, "Panel"),
      React.createElement(Separator, null),
      React.createElement(Switch, { checked: true, label: "Enable alerts" }),
      React.createElement(
        Tooltip,
        { content: "Open settings" },
        React.createElement("button", { type: "button" }, "Settings"),
      ),
      React.createElement(Menu, {
        label: "Actions",
        items: [{ id: "refresh", label: "Refresh", onSelect() {} }],
      }),
      React.createElement(StatePanel, {
        title: "No sessions",
        description: "No sessions are available.",
      }),
    ),
  );

  assert.match(html, /<button type="button" class="ui-button"/);
  assert.match(html, /<label class="ui-label" for="email"/);
  assert.match(html, /id="email-error" role="alert"/);
  assert.match(html, /role="switch" aria-checked="true"/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /role="separator"/);
});

test("dialog renders labelled modal semantics when open", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Dialog,
      {
        open: true,
        title: "End session",
        description: "This action ends the active interview.",
        onOpenChange() {},
      },
      React.createElement(Button, null, "Confirm"),
    ),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /aria-label="Close End session"/);
});

function createUnsignedDisplayToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
