import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from "livekit-server-sdk";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

export interface LiveKitJoinTokenRequest {
  sessionId: string;
  participantId: string;
  participantName: string;
}

export interface LiveKitJoinTokenResponse {
  url: string;
  roomName: string;
  participantIdentity: string;
  token: string;
}

export interface LiveKitEgressClient {
  startRoomCompositeEgress(
    roomName: string,
    output: { file: EncodedFileOutput },
    options: { layout: string },
  ): Promise<LiveKitRecordingInfo>;
  stopEgress(egressId: string): Promise<LiveKitRecordingInfo>;
}

export interface LiveKitRecordingInfo {
  egressId: string;
  roomName: string;
  status: number;
}

export interface LiveKitRecordingResponse {
  egressId: string;
  roomName: string;
  status: number;
  filepath?: string;
  evidenceObjectId?: string;
  storageKey?: string;
}

export async function createLiveKitJoinToken(
  config: ServerConfig,
  request: LiveKitJoinTokenRequest,
): Promise<LiveKitJoinTokenResponse> {
  if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    throw new HttpError(503, "LIVEKIT_NOT_CONFIGURED", "LiveKit is not configured");
  }

  const roomName = createLiveKitRoomName(request.sessionId);
  const participantIdentity = createLiveKitParticipantIdentity(request.participantId);
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: participantIdentity,
    name: request.participantName,
    ttl: config.livekitTokenTtlSeconds,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    url: config.livekitUrl,
    roomName,
    participantIdentity,
    token: await token.toJwt(),
  };
}

export function createLiveKitRoomName(sessionId: string): string {
  return `session-${sessionId}`;
}

export function createLiveKitParticipantIdentity(participantId: string): string {
  return `participant-${participantId}`;
}

export async function startLiveKitRoomRecording(
  config: ServerConfig,
  request: { sessionId: string },
  egressClient: LiveKitEgressClient = createLiveKitEgressClient(config),
): Promise<LiveKitRecordingResponse> {
  ensureLiveKitRecordingStorage(config);

  const roomName = createLiveKitRoomName(request.sessionId);
  const file = createLiveKitRecordingOutput(config, request.sessionId);

  try {
    const recording = await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file,
      },
      {
        layout: "grid",
      },
    );

    return {
      egressId: recording.egressId,
      roomName: recording.roomName || roomName,
      status: recording.status,
      filepath: file.filepath,
    };
  } catch {
    throw new HttpError(502, "LIVEKIT_UPSTREAM_ERROR", "LiveKit recording service failed");
  }
}

export async function stopLiveKitRoomRecording(
  config: ServerConfig,
  egressId: string,
  egressClient: LiveKitEgressClient = createLiveKitEgressClient(config),
): Promise<LiveKitRecordingResponse> {
  ensureLiveKitConfigured(config);

  try {
    const recording = await egressClient.stopEgress(egressId);

    return {
      egressId: recording.egressId,
      roomName: recording.roomName,
      status: recording.status,
    };
  } catch {
    throw new HttpError(502, "LIVEKIT_UPSTREAM_ERROR", "LiveKit recording service failed");
  }
}

function createLiveKitEgressClient(config: ServerConfig): LiveKitEgressClient {
  ensureLiveKitConfigured(config);
  return new EgressClient(config.livekitApiUrl, config.livekitApiKey, config.livekitApiSecret);
}

function createLiveKitRecordingOutput(config: ServerConfig, sessionId: string): EncodedFileOutput {
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `${config.livekitRecordingKeyPrefix}/${sessionId}/${Date.now()}.mp4`,
    output: {
      case: "s3",
      value: new S3Upload({
        endpoint: config.livekitRecordingS3Endpoint ?? "",
        bucket: config.livekitRecordingS3Bucket ?? "",
        accessKey: config.livekitRecordingS3AccessKeyId ?? "",
        secret: config.livekitRecordingS3SecretAccessKey ?? "",
        region: config.livekitRecordingS3Region,
        forcePathStyle: config.livekitRecordingS3ForcePathStyle,
      }),
    },
  });
}

function ensureLiveKitConfigured(config: ServerConfig): asserts config is ServerConfig & {
  livekitApiUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
} {
  if (!config.livekitApiUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    throw new HttpError(503, "LIVEKIT_NOT_CONFIGURED", "LiveKit is not configured");
  }
}

function ensureLiveKitRecordingStorage(config: ServerConfig): void {
  ensureLiveKitConfigured(config);

  if (
    !config.livekitRecordingS3Endpoint ||
    !config.livekitRecordingS3Bucket ||
    !config.livekitRecordingS3AccessKeyId ||
    !config.livekitRecordingS3SecretAccessKey
  ) {
    throw new HttpError(503, "LIVEKIT_RECORDING_NOT_CONFIGURED", "LiveKit recording storage is not configured");
  }
}
