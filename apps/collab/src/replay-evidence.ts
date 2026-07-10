import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface ReplayEvidenceUpdateRecord {
  sessionId: string;
  documentId: string;
  participantId: string;
  occurredAt: string;
  updateBase64: string;
}

export type ReplayEvidenceSink = (
  record: ReplayEvidenceUpdateRecord,
) => Promise<void>;

export interface ReplayEvidenceOptions {
  now?: () => Date;
  recordUpdate?: ReplayEvidenceSink;
}

export interface ObjectStoragePutObjectInput {
  bucket: string;
  key: string;
  body: string;
  contentType: string;
}

export interface ObjectStorageClient {
  putObject(input: ObjectStoragePutObjectInput): Promise<void>;
}

export interface ObjectStorageReplayEvidenceSinkOptions {
  bucket: string;
  keyPrefix?: string;
}

export interface S3ReplayObjectStoreOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let replaySequence = 0;

export function createObjectStorageReplayEvidenceSink(
  objectStore: ObjectStorageClient,
  options: ObjectStorageReplayEvidenceSinkOptions,
): ReplayEvidenceSink {
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix ?? "replay/editor");

  return async (record) => {
    const key = [
      keyPrefix,
      safeKeySegment(record.sessionId),
      safeKeySegment(record.documentId),
      `${safeTimestamp(record.occurredAt)}-${nextReplaySequence()}.ndjson`,
    ].join("/");

    await objectStore.putObject({
      bucket: options.bucket,
      key,
      body: `${JSON.stringify({
        type: "editor.yjs_update",
        sessionId: record.sessionId,
        documentId: record.documentId,
        participantId: record.participantId,
        occurredAt: record.occurredAt,
        updateBase64: record.updateBase64,
      })}\n`,
      contentType: "application/x-ndjson",
    });
  };
}

export function createS3ReplayObjectStore(options: S3ReplayObjectStoreOptions): {
  objectStore: ObjectStorageClient;
  close(): void;
} {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  return {
    objectStore: {
      async putObject(input) {
        await client.send(new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }));
      },
    },
    close() {
      client.destroy();
    },
  };
}

function normalizeKeyPrefix(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");

  if (!trimmed) {
    throw new Error("Replay evidence key prefix is required");
  }

  return trimmed;
}

function safeKeySegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function safeTimestamp(value: string): string {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}

function nextReplaySequence(): string {
  replaySequence = (replaySequence + 1) % 1_000_000;
  return String(replaySequence).padStart(6, "0");
}
