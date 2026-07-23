import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

export interface EvidenceObjectReference {
  bucket: string;
  key: string;
  contentType: string;
}

export interface EvidenceObjectMetadata {
  byteSize: bigint | null;
  checksumSha256: string | null;
}

export interface EvidenceStorage {
  createRecordingKey(sessionId: string): string;
  headObject(reference: EvidenceObjectReference): Promise<EvidenceObjectMetadata>;
  createPresignedReadUrl(reference: EvidenceObjectReference, expiresInSeconds: number): Promise<string>;
  close(): void;
}

export function createEvidenceStorage(config: ServerConfig): EvidenceStorage {
  const endpoint = requireConfiguredValue(config.objectStorageEndpoint, "S3_ENDPOINT");
  const bucket = requireConfiguredValue(config.objectStorageBucket, "S3_BUCKET");
  const accessKeyId = requireConfiguredValue(config.objectStorageAccessKeyId, "S3_ACCESS_KEY_ID");
  const secretAccessKey = requireConfiguredValue(config.objectStorageSecretAccessKey, "S3_SECRET_ACCESS_KEY");
  const client = new S3Client({
    endpoint,
    region: config.objectStorageRegion,
    forcePathStyle: config.objectStorageForcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return {
    createRecordingKey(sessionId) {
      return createRecordingStorageKey(config, sessionId);
    },
    async headObject(reference) {
      const resolved = normalizeReference(reference, bucket);
      try {
        const result = await client.send(new HeadObjectCommand({
          Bucket: resolved.bucket,
          Key: resolved.key,
        }));
        return {
          byteSize: typeof result.ContentLength === "number" ? BigInt(result.ContentLength) : null,
          checksumSha256: result.ChecksumSHA256 ?? null,
        };
      } catch {
        throw new HttpError(502, "EVIDENCE_STORAGE_UNAVAILABLE", "Evidence storage is unavailable");
      }
    },
    async createPresignedReadUrl(reference, expiresInSeconds) {
      const resolved = normalizeReference(reference, bucket);
      if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3_600) {
        throw new Error("Evidence URL expiry must be between 60 and 3600 seconds");
      }
      try {
        return await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: resolved.bucket,
            Key: resolved.key,
            ResponseContentType: resolved.contentType,
          }),
          { expiresIn: expiresInSeconds },
        );
      } catch {
        throw new HttpError(502, "EVIDENCE_STORAGE_UNAVAILABLE", "Evidence storage is unavailable");
      }
    },
    close() {
      client.destroy();
    },
  };
}

export function createRecordingStorageKey(config: Pick<ServerConfig, "recordingStorageKeyPrefix">, sessionId: string): string {
  const normalizedSessionId = requireKeySegment(sessionId, "sessionId");
  return `${config.recordingStorageKeyPrefix}/${normalizedSessionId}/${randomUUID()}.mp4`;
}

function normalizeReference(reference: EvidenceObjectReference, configuredBucket: string): EvidenceObjectReference {
  if (reference.bucket !== configuredBucket) {
    throw new HttpError(409, "EVIDENCE_STORAGE_BUCKET_MISMATCH", "Evidence storage is unavailable");
  }
  return {
    bucket: configuredBucket,
    key: requireNonEmptyString(reference.key, "evidence key"),
    contentType: requireNonEmptyString(reference.contentType, "evidence content type"),
  };
}

function requireConfiguredValue(value: string | null, fieldName: string): string {
  if (!value) {
    throw new HttpError(503, "EVIDENCE_STORAGE_NOT_CONFIGURED", "Evidence storage is not configured");
  }
  return value;
}

function requireKeySegment(value: string, fieldName: string): string {
  const normalized = requireNonEmptyString(value, fieldName);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return normalized;
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}
