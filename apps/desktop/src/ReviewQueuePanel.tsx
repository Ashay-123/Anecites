import { type ReactElement } from "react";

import {
  type ReviewerRiskSummary,
  type RiskSummaryReviewStatus,
} from "./review.js";
import { type ReviewQueueStatus } from "./meeting-types.js";

export interface ReviewQueuePanelProps {
  status: ReviewQueueStatus;
  error: string | null;
  riskSummaries: readonly ReviewerRiskSummary[];
  onRefresh: () => void;
  onApplyReviewStatus: (riskSummaryId: string, reviewStatus: RiskSummaryReviewStatus) => void;
}

export function ReviewQueuePanel({
  status,
  error,
  riskSummaries,
  onRefresh,
  onApplyReviewStatus,
}: ReviewQueuePanelProps): ReactElement {
  return (
    <section className="review-pane" id="review-queue" aria-label="Reviewer queue">
      <header>
        <h2>Reviewer queue</h2>
        <span aria-live="polite">{status}</span>
      </header>
      <div className="review-actions">
        <button type="button" onClick={onRefresh} disabled={status === "loading" || status === "updating"}>
          Refresh reviews
        </button>
      </div>
      <div className="review-list">
        {riskSummaries.length === 0 ? (
          <p className="review-empty">No risk summaries loaded</p>
        ) : (
          riskSummaries.map((summary) => (
            <article className="review-item" key={summary.id}>
              <div className="review-item-header">
                <strong>{Math.round(summary.score * 100)}%</strong>
                <span>{summary.reviewStatus}</span>
              </div>
              <p>{summary.rationale ?? "Review required"}</p>
              <dl>
                <div>
                  <dt>Signals</dt>
                  <dd>{summary.correlatedSignalCount}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>{formatReviewWindow(summary.windowStartedAt, summary.windowEndedAt)}</dd>
                </div>
              </dl>
              <div className="review-item-actions">
                <button
                  type="button"
                  onClick={() => onApplyReviewStatus(summary.id, "confirmed")}
                  disabled={status === "updating"}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => onApplyReviewStatus(summary.id, "dismissed")}
                  disabled={status === "updating"}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => onApplyReviewStatus(summary.id, "needs_more_context")}
                  disabled={status === "updating"}
                >
                  Need context
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      {error ? (
        <p className="review-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatReviewWindow(windowStartedAt: string, windowEndedAt: string): string {
  const start = new Date(windowStartedAt);
  const end = new Date(windowEndedAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "-";
  }

  return `${start.toLocaleTimeString()}-${end.toLocaleTimeString()}`;
}
