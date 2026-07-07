import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { consoleLogger } from "./logger.js";

export { createApp } from "./app.js";
export { requireAuth, type AuthenticatedPrincipal } from "./auth.js";
export { createCodeExecutionRouter, type FetchLike } from "./code-executions.js";
export { loadServerConfig, type ServerConfig, type NodeEnv } from "./config.js";
export { HttpError } from "./http-error.js";
export { consoleLogger, type Logger } from "./logger.js";
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
