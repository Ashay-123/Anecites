import { connect, type ConfirmChannel } from "amqplib";
import { createRecordingVerificationJob, type RecordingVerificationJob } from "@anecites/shared";

import { type ServerConfig } from "./config.js";

type PublisherConfig = Pick<ServerConfig, "rabbitmqUrl" | "recordingVerificationQueueName">;
type PublisherChannel = Pick<ConfirmChannel, "assertQueue" | "sendToQueue" | "waitForConfirms" | "close">;

interface PublisherConnection {
  createConfirmChannel(): Promise<PublisherChannel>;
  close(): Promise<void>;
}

export interface RecordingVerificationPublisher {
  publish(job: RecordingVerificationJob): Promise<void>;
  close(): Promise<void>;
}

export function createRabbitRecordingVerificationPublisher(
  config: PublisherConfig,
  connectBroker: (url: string) => Promise<PublisherConnection> = connect,
): RecordingVerificationPublisher {
  let connection: PublisherConnection | null = null;
  let channel: PublisherChannel | null = null;
  let setup: Promise<PublisherChannel> | null = null;
  let closed = false;

  async function getChannel(): Promise<PublisherChannel> {
    if (closed) {
      throw new Error("Recording-verification publisher is closed");
    }
    if (channel) {
      return channel;
    }
    setup ??= (async () => {
      const nextConnection = await connectBroker(config.rabbitmqUrl);
      try {
        const nextChannel = await nextConnection.createConfirmChannel();
        await nextChannel.assertQueue(config.recordingVerificationQueueName, { durable: true });
        connection = nextConnection;
        channel = nextChannel;
        return nextChannel;
      } catch (error) {
        await nextConnection.close().catch(() => undefined);
        throw error;
      }
    })();
    try {
      return await setup;
    } finally {
      setup = null;
    }
  }

  async function closeResources(): Promise<void> {
    const activeChannel = channel;
    const activeConnection = connection;
    channel = null;
    connection = null;
    await activeChannel?.close().catch(() => undefined);
    await activeConnection?.close().catch(() => undefined);
  }

  return {
    async publish(input) {
      const job = createRecordingVerificationJob(input);
      try {
        const activeChannel = await getChannel();
        activeChannel.sendToQueue(config.recordingVerificationQueueName, Buffer.from(JSON.stringify(job)), {
          contentType: "application/json",
          persistent: true,
          messageId: job.jobId,
        });
        await activeChannel.waitForConfirms();
      } catch (error) {
        await closeResources();
        throw error;
      }
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await setup?.catch(() => undefined);
      await closeResources();
    },
  };
}
