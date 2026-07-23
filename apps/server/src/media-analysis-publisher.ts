import { connect, type ConfirmChannel } from "amqplib";
import { createMediaAnalysisJob, type MediaAnalysisJob } from "@anecites/shared";

import { type ServerConfig } from "./config.js";

type PublisherConfig = Pick<
  ServerConfig,
  "rabbitmqUrl" | "mediaAnalysisQueueName" | "mediaAnalysisShadowQueueName"
>;

type PublisherChannel = Pick<
  ConfirmChannel,
  "assertQueue" | "sendToQueue" | "waitForConfirms" | "close"
>;

export interface MediaAnalysisConnection {
  createConfirmChannel(): Promise<PublisherChannel>;
  close(): Promise<void>;
}

export type ConnectMediaAnalysisBroker = (url: string) => Promise<MediaAnalysisConnection>;

export interface MediaAnalysisPublisher {
  publish(job: MediaAnalysisJob): Promise<void>;
  close(): Promise<void>;
}

export function createRabbitMediaAnalysisPublisher(
  config: PublisherConfig,
  connectBroker: ConnectMediaAnalysisBroker = connect,
): MediaAnalysisPublisher {
  let connection: MediaAnalysisConnection | null = null;
  let channel: PublisherChannel | null = null;
  let setupPromise: Promise<PublisherChannel> | null = null;
  let closed = false;

  async function getChannel(): Promise<PublisherChannel> {
    if (closed) {
      throw new Error("Media-analysis publisher is closed");
    }
    if (channel) {
      return channel;
    }
    setupPromise ??= (async () => {
      const nextConnection = await connectBroker(config.rabbitmqUrl);
      try {
        const nextChannel = await nextConnection.createConfirmChannel();
        await nextChannel.assertQueue(config.mediaAnalysisQueueName, { durable: true });
        await nextChannel.assertQueue(config.mediaAnalysisShadowQueueName, { durable: true });
        connection = nextConnection;
        channel = nextChannel;
        return nextChannel;
      } catch (error) {
        await nextConnection.close().catch(() => undefined);
        throw error;
      }
    })();

    try {
      return await setupPromise;
    } finally {
      setupPromise = null;
    }
  }

  return {
    async publish(input) {
      const job = createMediaAnalysisJob(input);
      const activeChannel = await getChannel();
      const queueName = job.options.shadowModes.length > 0
        ? config.mediaAnalysisShadowQueueName
        : config.mediaAnalysisQueueName;
      try {
        activeChannel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(job)),
          {
            contentType: "application/json",
            persistent: true,
            messageId: job.jobId,
          },
        );
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
      await setupPromise?.catch(() => undefined);
      await closeResources();
    },
  };

  async function closeResources(): Promise<void> {
    const activeChannel = channel;
    const activeConnection = connection;
    channel = null;
    connection = null;
    await activeChannel?.close().catch(() => undefined);
    await activeConnection?.close().catch(() => undefined);
  }
}
