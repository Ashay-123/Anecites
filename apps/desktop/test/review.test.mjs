import assert from "node:assert/strict";
import test from "node:test";

import {
  listSessionRiskSummaries,
  updateRiskSummaryReview,
} from "../dist/review.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("listSessionRiskSummaries requests reviewer summaries only from the backend", async () => {
  const calls = [];
  const result = await listSessionRiskSummaries(
    {
      apiBaseUrl: "http://127.0.0.1:3000/",
      authToken: "review-token",
      sessionId: "session-a",
      reviewStatus: "pending_review",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        riskSummaries: [
          {
            id: "risk-1",
            sessionId: "session-a",
            participantId: "participant-a",
            evidenceObjectId: null,
            windowStartedAt: "2026-07-11T00:00:00.000Z",
            windowEndedAt: "2026-07-11T00:01:00.000Z",
            score: 0.7,
            correlatedSignalCount: 2,
            meetsCorrelationPolicy: true,
            humanReviewRequired: true,
            reviewStatus: "pending_review",
            reviewerId: null,
            reviewedAt: null,
            rationale: "Native monitoring snapshot",
            signalBreakdown: [
              {
                category: "native",
                count: 2,
                maxWeight: 0.7,
                types: ["risk.native.vm_signal"],
              },
            ],
            evidenceReferences: [
              {
                kind: "risk_event",
                id: "event-1",
                type: "risk.native.vm_signal",
                source: "desktop_native",
                occurredAt: "2026-07-11T00:00:30.000Z",
                evidenceObjectId: null,
              },
            ],
            createdAt: "2026-07-11T00:01:01.000Z",
            updatedAt: "2026-07-11T00:01:01.000Z",
          },
        ],
      });
    },
  );

  assert.equal(
    calls[0].url,
    "http://127.0.0.1:3000/sessions/session-a/risk-summaries?reviewStatus=pending_review",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer review-token");
  assert.equal(result.riskSummaries.length, 1);
  assert.equal(result.riskSummaries[0].id, "risk-1");
  assert.equal(result.riskSummaries[0].reviewStatus, "pending_review");
});

test("updateRiskSummaryReview patches review status only through the backend", async () => {
  const calls = [];
  const result = await updateRiskSummaryReview(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "review-token",
      sessionId: "session-a",
      riskSummaryId: "risk-1",
      reviewStatus: "dismissed",
    },
    async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        riskSummary: {
          id: "risk-1",
          sessionId: "session-a",
          participantId: "participant-a",
          evidenceObjectId: null,
          windowStartedAt: "2026-07-11T00:00:00.000Z",
          windowEndedAt: "2026-07-11T00:01:00.000Z",
          score: 0.7,
          correlatedSignalCount: 2,
          meetsCorrelationPolicy: true,
          humanReviewRequired: true,
          reviewStatus: "dismissed",
          reviewerId: "reviewer-1",
          reviewedAt: "2026-07-11T00:02:00.000Z",
          rationale: null,
          signalBreakdown: [],
          evidenceReferences: [],
          createdAt: "2026-07-11T00:01:01.000Z",
          updatedAt: "2026-07-11T00:02:00.000Z",
        },
      });
    },
  );

  assert.equal(
    calls[0].url,
    "http://127.0.0.1:3000/sessions/session-a/risk-summaries/risk-1/review",
  );
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers.Authorization, "Bearer review-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    reviewStatus: "dismissed",
  });
  assert.equal(result.riskSummary.reviewStatus, "dismissed");
});

test("reviewer client surfaces backend errors", async () => {
  await assert.rejects(
    () =>
      listSessionRiskSummaries(
        {
          apiBaseUrl: "http://127.0.0.1:3000",
          authToken: "candidate-token",
          sessionId: "session-a",
        },
        async () =>
          jsonResponse(
            {
              error: {
                code: "FORBIDDEN",
                message: "Reviewer access is required",
              },
            },
            { status: 403 },
          ),
      ),
    /Reviewer access is required/,
  );
});
