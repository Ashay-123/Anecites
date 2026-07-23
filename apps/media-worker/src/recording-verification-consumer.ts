import { createRecordingVerificationJob, type RecordingVerificationJob } from "@anecites/shared";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";

export interface RecordingVerificationConsumer {
  stop(): Promise<void>;
}

export async function startRecordingVerificationConsumer(options: {
  channel: Pick<ConfirmChannel, "assertQueue" | "prefetch" | "consume" | "cancel" | "sendToQueue" | "waitForConfirms" | "ack" | "nack" | "close">;
  queueName: string;
  prefetch: number;
  maxRetries: number;
  retryDelayMs: number;
  processJob(job: RecordingVerificationJob): Promise<unknown>;
  markFailed(job: RecordingVerificationJob, failureCode: string): Promise<void>;
}): Promise<RecordingVerificationConsumer> {
  const retryQueue = `${options.queueName}.retry`;
  const deadQueue = `${options.queueName}.dead`;
  await options.channel.assertQueue(options.queueName, { durable: true });
  await options.channel.assertQueue(retryQueue, { durable: true, messageTtl: options.retryDelayMs, deadLetterExchange: "", deadLetterRoutingKey: options.queueName });
  await options.channel.assertQueue(deadQueue, { durable: true });
  await options.channel.prefetch(options.prefetch);
  let stopping = false;
  const result = await options.channel.consume(options.queueName, (message) => {
    if (!message || stopping) return;
    return void handle(message);
  }, { noAck: false });

  async function handle(message: ConsumeMessage): Promise<void> {
    let job: RecordingVerificationJob;
    let retries = 0;
    try {
      retries = Number(message.properties.headers?.["x-anecites-retry-count"] ?? 0);
      if (!Number.isSafeInteger(retries) || retries < 0 || retries > 20) throw new Error("invalid retry count");
      job = createRecordingVerificationJob(JSON.parse(message.content.toString("utf8")) as RecordingVerificationJob);
    } catch {
      await move(message, deadQueue, message.content, { "x-anecites-failure-code": "RECORDING_VERIFICATION_INVALID" });
      return;
    }
    try {
      await options.processJob(job);
      options.channel.ack(message);
    } catch (error) {
      const failureCode = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code : "RECORDING_VERIFICATION_FAILED";
      if (retries < options.maxRetries) {
        await move(message, retryQueue, Buffer.from(JSON.stringify(job)), { "x-anecites-retry-count": retries + 1 }, job.jobId);
        return;
      }
      await options.markFailed(job, failureCode).catch(() => undefined);
      await move(message, deadQueue, Buffer.from(JSON.stringify({ version: 1, job, failureCode })), { "x-anecites-failure-code": failureCode }, job.jobId);
    }
  }

  async function move(message: ConsumeMessage, destination: string, content: Buffer, headers: Record<string, string | number>, messageId?: string): Promise<void> {
    try {
      options.channel.sendToQueue(destination, content, { contentType: "application/json", persistent: true, messageId: messageId ?? message.properties.messageId, headers });
      await options.channel.waitForConfirms();
      options.channel.ack(message);
    } catch {
      options.channel.nack(message, false, true);
    }
  }

  return { async stop() { stopping = true; await options.channel.cancel(result.consumerTag); await options.channel.close(); } };
}
