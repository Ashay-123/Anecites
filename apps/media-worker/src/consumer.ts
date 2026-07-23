import { createMediaAnalysisJob, type MediaAnalysisJob } from "@anecites/shared";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import { MediaWorkerError } from "./errors.js";

export const MEDIA_ANALYSIS_RETRY_COUNT_HEADER = "x-anecites-retry-count";
export const MEDIA_ANALYSIS_FAILURE_CODE_HEADER = "x-anecites-failure-code";

const MAX_JOB_BYTES = 65_536;

export type MediaAnalysisMessage = ConsumeMessage;

export type MediaAnalysisConfirmChannel = Pick<
  ConfirmChannel,
  | "assertQueue"
  | "prefetch"
  | "consume"
  | "cancel"
  | "sendToQueue"
  | "waitForConfirms"
  | "ack"
  | "nack"
  | "close"
>;

export interface MediaAnalysisConsumerLogger {
  info(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}

export interface StartMediaAnalysisConsumerOptions {
  channel: MediaAnalysisConfirmChannel;
  queueName: string;
  prefetch: number;
  maxRetries: number;
  retryDelayMs: number;
  processJob(job: MediaAnalysisJob): Promise<unknown>;
  logger?: MediaAnalysisConsumerLogger;
}

export interface MediaAnalysisConsumer {
  consumerTag: string;
  stop(): Promise<void>;
}

export async function startMediaAnalysisConsumer(
  options: StartMediaAnalysisConsumerOptions,
): Promise<MediaAnalysisConsumer> {
  const queueName = requireQueueName(options.queueName);
  const retryQueueName = `${queueName}.retry`;
  const deadQueueName = `${queueName}.dead`;
  const prefetch = requireInteger("prefetch", options.prefetch, 1, 32);
  const maxRetries = requireInteger("maxRetries", options.maxRetries, 0, 20);
  const retryDelayMs = requireInteger("retryDelayMs", options.retryDelayMs, 100, 900_000);
  const inFlight = new Set<Promise<void>>();
  let stopping = false;

  await options.channel.assertQueue(queueName, { durable: true });
  await options.channel.assertQueue(deadQueueName, { durable: true });
  await options.channel.assertQueue(retryQueueName, {
    durable: true,
    messageTtl: retryDelayMs,
    deadLetterExchange: "",
    deadLetterRoutingKey: queueName,
  });
  await options.channel.prefetch(prefetch);

  const consumeResult = await options.channel.consume(
    queueName,
    (message) => {
      if (!message || stopping) {
        return;
      }
      const delivery = handleDelivery(message).finally(() => {
        inFlight.delete(delivery);
      });
      inFlight.add(delivery);
      return delivery;
    },
    { noAck: false },
  );

  async function handleDelivery(message: MediaAnalysisMessage): Promise<void> {
    let job: MediaAnalysisJob;
    let retryCount: number;
    try {
      retryCount = readRetryCount(message);
      job = parseJob(message.content);
    } catch {
      await publishOrRequeueOriginal(message, deadQueueName, createDeadLetterBody(message, null, "MEDIA_JOB_INVALID"), {
        [MEDIA_ANALYSIS_FAILURE_CODE_HEADER]: "MEDIA_JOB_INVALID",
      });
      return;
    }

    try {
      await options.processJob(job);
      options.channel.ack(message);
      options.logger?.info("media_analysis_job.succeeded", { jobId: job.jobId });
    } catch (error) {
      const failureCode = classifyFailureCode(error);
      const permanent = isPermanentFailure(error);
      if (!permanent && retryCount < maxRetries) {
        await publishOrRequeueOriginal(message, retryQueueName, Buffer.from(JSON.stringify(job)), {
          [MEDIA_ANALYSIS_RETRY_COUNT_HEADER]: retryCount + 1,
        }, job.jobId);
        return;
      }

      await publishOrRequeueOriginal(
        message,
        deadQueueName,
        createDeadLetterBody(message, job, failureCode),
        {
          [MEDIA_ANALYSIS_RETRY_COUNT_HEADER]: retryCount,
          [MEDIA_ANALYSIS_FAILURE_CODE_HEADER]: failureCode,
        },
        job.jobId,
      );
    }
  }

  async function publishOrRequeueOriginal(
    original: MediaAnalysisMessage,
    destination: string,
    content: Buffer,
    headers: Record<string, string | number>,
    messageId?: string,
  ): Promise<void> {
    try {
      options.channel.sendToQueue(destination, content, {
        contentType: "application/json",
        persistent: true,
        messageId: messageId ?? readMessageId(original),
        headers,
      });
      await options.channel.waitForConfirms();
      options.channel.ack(original);
    } catch {
      options.channel.nack(original, false, true);
      options.logger?.error("media_analysis_job.publish_failed", { destination });
    }
  }

  return {
    consumerTag: consumeResult.consumerTag,
    async stop() {
      if (stopping) {
        return;
      }
      stopping = true;
      await options.channel.cancel(consumeResult.consumerTag);
      await Promise.allSettled([...inFlight]);
      await options.channel.close();
    },
  };
}

function parseJob(content: Buffer): MediaAnalysisJob {
  if (content.byteLength === 0 || content.byteLength > MAX_JOB_BYTES) {
    throw new Error("Media-analysis job body is invalid");
  }
  const value: unknown = JSON.parse(content.toString("utf8"));
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Media-analysis job version is invalid");
  }
  return createMediaAnalysisJob(value as unknown as MediaAnalysisJob);
}

function readRetryCount(message: MediaAnalysisMessage): number {
  const value = message.properties.headers?.[MEDIA_ANALYSIS_RETRY_COUNT_HEADER] ?? 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw new Error("Media-analysis retry count is invalid");
  }
  return value as number;
}

function createDeadLetterBody(
  message: MediaAnalysisMessage,
  job: MediaAnalysisJob | null,
  failureCode: string,
): Buffer {
  return Buffer.from(JSON.stringify({
    version: 1,
    failureCode,
    messageId: job?.jobId ?? readMessageId(message),
    ...(job ? { job } : {}),
  }));
}

function readMessageId(message: MediaAnalysisMessage): string {
  return typeof message.properties.messageId === "string" && message.properties.messageId.length <= 128
    ? message.properties.messageId
    : "unknown";
}

function classifyFailureCode(error: unknown): string {
  return error instanceof MediaWorkerError ? error.code : "MEDIA_JOB_FAILED";
}

function isPermanentFailure(error: unknown): boolean {
  return error instanceof MediaWorkerError && [
    "MEDIA_JOB_CONFLICT",
    "MEDIA_EVIDENCE_NOT_FOUND",
    "MEDIA_EVIDENCE_INVALID",
    "MEDIA_PARTICIPANT_INVALID",
    "MEDIA_ADAPTER_UNAVAILABLE",
    "MEDIA_ADAPTER_INVALID_RESPONSE",
  ].includes(error.code);
}

function requireQueueName(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new Error("queueName must contain at most 128 letters, numbers, dots, underscores, or hyphens");
  }
  return value;
}

function requireInteger(fieldName: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
