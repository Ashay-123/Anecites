import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@anecites/db";
import { connect, type ConfirmChannel } from "amqplib";

import {
  createMediaInferenceClient,
  createShadowSecondVoiceAudioAdapter,
  createVideoAnalysisAdapter,
  markRecordingVerificationFailed,
  processMediaAnalysisQueueJob,
  processRecordingVerificationJob,
  startRecordingVerificationConsumer,
  startMediaAnalysisConsumer,
} from "./index.js";
import { loadMediaWorkerConfig, type MediaWorkerConfig } from "./worker-config.js";

export interface RunningMediaWorker {
  stop(): Promise<void>;
}

interface WorkerConnection {
  createConfirmChannel(): Promise<ConfirmChannel>;
  close(): Promise<void>;
}

export async function startMediaWorker(
  config: MediaWorkerConfig = loadMediaWorkerConfig(),
): Promise<RunningMediaWorker> {
  const prisma = createPrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });
  let connection: WorkerConnection | null = null;
  try {
    const connected = await connect(config.rabbitmqUrl, { recovery: true });
    connection = connected;
    const inferenceClient = createMediaInferenceClient({
      baseUrl: config.inferenceBaseUrl,
      authToken: config.inferenceAuthToken,
      expectedAdapterVersion: config.inferenceExpectedAdapterVersion,
    });
    const adapters: {
      audio?: ReturnType<typeof createShadowSecondVoiceAudioAdapter>;
      video: ReturnType<typeof createVideoAnalysisAdapter>;
    } = {
      video: createVideoAnalysisAdapter({
        adapterVersion: inferenceClient.adapterVersion,
        analyzeVideoWindows: (request) => inferenceClient.analyzeVideoWindows(request),
      }),
    };
    if (config.speakerDiarizationEnabled) {
      adapters.audio = createShadowSecondVoiceAudioAdapter({
        adapterVersion: inferenceClient.adapterVersion,
        analyzeSpeakerSegments: (request) => inferenceClient.analyzeSpeakerDiarization(request),
      });
    }
    const processJob = async (job: Parameters<typeof processMediaAnalysisQueueJob>[0]["job"]) => {
      const outcome = await processMediaAnalysisQueueJob({
        prisma,
        job,
        adapters,
        leaseDurationMs: config.jobLeaseMs,
      });
      if (outcome.status === "processed" && Object.keys(outcome.shadowObservationCounts).length > 0) {
        logInfo("media_worker.shadow_observations", {
          observationCounts: outcome.shadowObservationCounts,
        });
      }
      return outcome;
    };
    const queueNames = [config.queueName, config.shadowQueueName];
    const consumers = await Promise.all(queueNames.map(async (queueName) => {
      const channel = await connected.createConfirmChannel();
      return startMediaAnalysisConsumer({
        channel,
        queueName,
        prefetch: config.prefetch,
        maxRetries: config.maxRetries,
        retryDelayMs: config.retryDelayMs,
        processJob,
        logger: {
          info: logInfo,
          error: logError,
        },
      });
    }));
    const verificationChannel = await connected.createConfirmChannel();
    const verificationConsumer = await startRecordingVerificationConsumer({
      channel: verificationChannel,
      queueName: config.recordingVerificationQueueName,
      prefetch: config.prefetch,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      processJob: (job) => processRecordingVerificationJob({
        prisma,
        job,
        verifyRecording: (request) => inferenceClient.verifyRecording(request),
        absoluteToleranceMs: config.recordingVerificationAbsoluteToleranceMs,
        relativeTolerancePercent: config.recordingVerificationRelativeTolerancePercent,
        leaseDurationMs: config.recordingVerificationTimeoutMs,
        requestTimeoutMs: config.recordingVerificationTimeoutMs,
      }),
      markFailed: (job, failureCode) => markRecordingVerificationFailed(prisma, job, failureCode),
    });
    let stopped = false;

    logInfo("media_worker.started", {
      queueName: config.queueName,
      shadowQueueName: config.shadowQueueName,
      prefetch: config.prefetch,
      speakerDiarizationEnabled: config.speakerDiarizationEnabled,
      recordingVerificationQueueName: config.recordingVerificationQueueName,
    });

    return {
      async stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        await Promise.all([...consumers, verificationConsumer].map((consumer) => consumer.stop()));
        await connection?.close();
        await prisma.$disconnect();
        logInfo("media_worker.stopped");
      },
    };
  } catch (error) {
    await connection?.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

function logInfo(event: string, context: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ level: "info", event, ...context }));
}

function logError(event: string, context: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...context }));
}

async function main(): Promise<void> {
  const worker = await startMediaWorker();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await worker.stop();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    logError("media_worker.fatal", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  });
}
