import assert from "node:assert/strict";
import test from "node:test";

import {
  getMediaConsentRequirements,
  grantMediaConsent,
  hasCurrentMediaConsent,
  revokeMediaConsent,
} from "../dist/media-consent.js";

const request = {
  apiBaseUrl: "https://api.example.test/",
  authToken: "test-token",
  sessionId: "session-a",
};

test("media consent client fetches requirements and recognizes the current scoped consent", async () => {
  const calls = [];
  const requirements = await getMediaConsentRequirements(request, async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      requirements: {
        noticeVersion: "notice-v2",
        noticeText: "Recording and review notice.",
        requiredScopes: ["session_recording", "video_face_analysis"],
        mediaConsent: {
          id: "consent-a",
          noticeVersion: "notice-v2",
          scopes: ["session_recording", "video_face_analysis"],
          grantedAt: "2026-07-17T10:00:00.000Z",
          revokedAt: null,
        },
      },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/sessions/session-a/media-consent-requirements");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(hasCurrentMediaConsent(requirements), true);
});

test("media consent client grants only explicit requested scopes and can revoke the returned consent", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST" && url.endsWith("/media-consent")) {
      return jsonResponse({
        mediaConsent: {
          id: "consent-a",
          noticeVersion: "notice-v2",
          scopes: ["session_recording"],
          grantedAt: "2026-07-17T10:00:00.000Z",
          revokedAt: null,
        },
      });
    }

    return jsonResponse({
      mediaConsent: {
        id: "consent-a",
        noticeVersion: "notice-v2",
        scopes: ["session_recording"],
        grantedAt: "2026-07-17T10:00:00.000Z",
        revokedAt: "2026-07-17T10:01:00.000Z",
      },
    });
  };

  const granted = await grantMediaConsent({
    ...request,
    scopes: ["session_recording"],
  }, fetchImpl);
  const revoked = await revokeMediaConsent({
    ...request,
    mediaConsentId: granted.id,
  }, fetchImpl);

  assert.equal(granted.revokedAt, null);
  assert.equal(revoked.revokedAt, "2026-07-17T10:01:00.000Z");
  assert.equal(calls[0].url, "https://api.example.test/sessions/session-a/media-consent");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    accepted: true,
    scopes: ["session_recording"],
  });
  assert.equal(
    calls[1].url,
    "https://api.example.test/sessions/session-a/media-consent/consent-a/revoke",
  );
});

test("media consent client fails closed on malformed or rejected responses", async () => {
  await assert.rejects(
    () =>
      getMediaConsentRequirements(request, async () =>
        jsonResponse({ requirements: { noticeVersion: "notice-v2" } }),
      ),
    /Media consent requirements response is invalid/,
  );

  await assert.rejects(
    () =>
      grantMediaConsent(
        { ...request, scopes: ["session_recording"] },
        async () => jsonResponse({ error: { message: "Consent is required" } }, 409),
      ),
    /Consent is required/,
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
