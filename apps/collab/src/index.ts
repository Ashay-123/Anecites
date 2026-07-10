import { pathToFileURL } from "node:url";
import { createPrismaClient } from "@anecites/db";
import { createClient } from "redis";

import { loadCollabConfig } from "./config.js";
import {
  createObjectStorageReplayEvidenceSink,
  createS3ReplayObjectStore,
} from "./replay-evidence.js";
import { createSessionParticipantAuthorizer } from "./room-authorization.js";
import { createCollabServer } from "./server.js";
import {
  createPrismaTelemetryAggregateSink,
  createRedisRawTelemetrySink,
} from "./telemetry.js";

export { loadCollabConfig, type CollabConfig } from "./config.js";
export {
  createObjectStorageReplayEvidenceSink,
  createS3ReplayObjectStore,
  type ObjectStorageClient,
  type ReplayEvidenceOptions,
  type ReplayEvidenceSink,
  type ReplayEvidenceUpdateRecord,
} from "./replay-evidence.js";
export { createSessionParticipantAuthorizer } from "./room-authorization.js";
export {
  createPrismaTelemetryAggregateSink,
  createRedisRawTelemetrySink,
  type CollabTelemetryOptions,
  type TelemetryAggregateSink,
  type TelemetryRawEventSink,
} from "./telemetry.js";
export {
  createCollabServer,
  type AuthenticatedPrincipal,
  type AuthorizeRoom,
  type CollabServer,
} from "./server.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startStandaloneServer();
}

async function startStandaloneServer(): Promise<void> {
  const config = loadCollabConfig();
  const prisma = createPrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });
  const redis = createClient({
    url: config.redisUrl,
  });
  const replayObjectStore = createS3ReplayObjectStore({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  });

  redis.on("error", (error) => {
    console.error("Redis client error", error);
  });

  await redis.connect();

  const server = createCollabServer({
    authJwtSecret: config.authJwtSecret,
    authorizeRoom: createSessionParticipantAuthorizer(prisma),
    telemetry: {
      recordRawEvent: createRedisRawTelemetrySink(redis, {
        streamKey: config.telemetryRawStreamKey,
      }),
      flushAggregate: createPrismaTelemetryAggregateSink(prisma),
    },
    replayEvidence: {
      recordUpdate: createObjectStorageReplayEvidenceSink(replayObjectStore.objectStore, {
        bucket: config.s3Bucket,
        keyPrefix: config.replayEvidenceKeyPrefix,
      }),
    },
  });

  server.httpServer.listen(config.port, config.host, () => {
    console.log(`Collaboration server listening on http://${config.host}:${config.port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void Promise.all([server.close(), prisma.$disconnect(), redis.quit()]).finally(() => {
        replayObjectStore.close();
        process.exit(0);
      });
    });
  }
}
