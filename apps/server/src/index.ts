import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { consoleLogger } from "./logger.js";

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
  startLiveKitRoomRecording,
  stopLiveKitRoomRecording,
  type LiveKitEgressClient,
  type LiveKitJoinTokenRequest,
  type LiveKitJoinTokenResponse,
  type LiveKitRecordingInfo,
  type LiveKitRecordingResponse,
} from "./livekit.js";
export { createLocalDemoRouter } from "./local-demo.js";
export { consoleLogger, type Logger } from "./logger.js";
export {
  createRiskSummary,
  isRiskSummaryReviewStatus,
  listRiskSummaries,
  updateRiskSummaryReview,
  type CreateRiskSummaryRequest,
  type ListRiskSummariesRequest,
  type RiskSummaryReviewStatus,
  type UpdateRiskSummaryReviewRequest,
} from "./risk-summaries.js";
export { createSessionRouter } from "./sessions.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const app = createApp(config);

  app.listen(config.apiPort, config.apiHost, () => {
    consoleLogger.info("server.started", {
      host: config.apiHost,
      port: config.apiPort,
      env: config.nodeEnv,
    });
  });
}
