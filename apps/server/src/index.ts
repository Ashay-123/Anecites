import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { consoleLogger } from "./logger.js";
import { createRabbitMediaAnalysisPublisher } from "./media-analysis-publisher.js";
import { createRabbitRecordingVerificationPublisher } from "./recording-verification-publisher.js";

export { createApp } from "./app.js";
export { issueAuthToken, requireAuth, type AuthenticatedPrincipal } from "./auth.js";
export { createCodeExecutionRouter } from "./code-executions.js";
export { type FetchLike } from "./code-execution-provider.js";
export { loadServerConfig, type CodeExecutionProviderName, type ServerConfig, type NodeEnv } from "./config.js";
export { HttpError } from "./http-error.js";
export {
  createLiveKitJoinToken,
  createLiveKitParticipantIdentity,
  createLiveKitRoomName,
  startLiveKitCandidateRecording,
  startLiveKitRoomRecording,
  stopLiveKitRoomRecording,
  type LiveKitEgressClient,
  type LiveKitJoinTokenRequest,
  type LiveKitJoinTokenResponse,
  type LiveKitRecordingInfo,
  type LiveKitRecordingResponse,
} from "./livekit.js";
export {
  createLiveKitWebhookHandler,
  type LiveKitWebhookReceiver,
} from "./livekit-webhooks.js";
export { createLocalDemoRouter } from "./local-demo.js";
export { consoleLogger, type Logger } from "./logger.js";
export {
  createRabbitMediaAnalysisPublisher,
  type ConnectMediaAnalysisBroker,
  type MediaAnalysisConnection,
  type MediaAnalysisPublisher,
} from "./media-analysis-publisher.js";
export {
  getMediaConsentRequirements,
  grantMediaConsent,
  requireActiveInterviewerRecordingAccess,
  requireActiveMediaAnalysisConsents,
  requireActiveRecordingConsents,
  revokeMediaConsent,
  type MediaConsentRequirements,
  type MediaConsentSnapshot,
  type SerializedMediaConsent,
} from "./media-consent.js";
export { buildNativeMonitoringPolicyManifest } from "./native-monitoring-policy.js";
export {
  LIVEKIT_EGRESS_COMPLETE,
  publishRecordingMediaAnalysisJob,
} from "./recording-analysis.js";
export {
  markSessionRecordingCompleted,
  startSessionRecording,
  stopSessionRecording,
  type SerializedSessionRecording,
  type StartSessionRecordingResult,
  type StopSessionRecordingResult,
} from "./recording-lifecycle.js";
export {
  createRabbitRecordingVerificationPublisher,
  type RecordingVerificationPublisher,
} from "./recording-verification-publisher.js";
export {
  listMonitoringTimeline,
  recordCandidateMonitoringHeartbeat,
  recordCandidateRiskEvent,
  startCandidateMonitoring,
  stopCandidateMonitoring,
} from "./monitoring.js";
export {
  createRiskSummary,
  isRiskSummaryReviewStatus,
  listRiskSummaries,
  recordTrustedRiskSignals,
  synchronizeCorrelatedRiskSummaries,
  updateRiskSummaryReview,
  type CreateRiskSummaryRequest,
  type ListRiskSummariesRequest,
  type RecordTrustedRiskSignalsRequest,
  type RiskEvidenceReference,
  type RiskSummaryReviewStatus,
  type UpdateRiskSummaryReviewRequest,
} from "./risk-summaries.js";
export { createSessionRouter } from "./sessions.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const mediaAnalysisPublisher = config.mediaAnalysisEnabled
    ? createRabbitMediaAnalysisPublisher(config)
    : undefined;
  const recordingVerificationPublisher = createRabbitRecordingVerificationPublisher(config);
  const app = createApp(
    config,
    {
      ...(mediaAnalysisPublisher ? { mediaAnalysisPublisher } : {}),
      recordingVerificationPublisher,
    },
  );

  const server = app.listen(config.apiPort, config.apiHost, () => {
    consoleLogger.info("server.started", {
      host: config.apiHost,
      port: config.apiPort,
      env: config.nodeEnv,
    });
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await new Promise<void>((resolveShutdown) => server.close(() => resolveShutdown()));
    await mediaAnalysisPublisher?.close();
    await recordingVerificationPublisher.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
