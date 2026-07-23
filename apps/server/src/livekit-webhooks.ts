import { type RequestHandler } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { type PrismaClient } from "@anecites/db";

import { type ServerConfig } from "./config.js";
import { HttpError, isHttpError } from "./http-error.js";
import { type MediaAnalysisPublisher } from "./media-analysis-publisher.js";
import { type RecordingVerificationPublisher } from "./recording-verification-publisher.js";
import { createSessionRecordingVerificationJob, markSessionRecordingCompleted } from "./recording-lifecycle.js";
import {
  LIVEKIT_EGRESS_COMPLETE,
  publishRecordingMediaAnalysisJob,
} from "./recording-analysis.js";

interface LiveKitWebhookEvent {
  event: string;
  egressInfo?: {
    egressId: string;
    status: number;
  };
}

export interface LiveKitWebhookReceiver {
  receive(body: string, authorizationHeader?: string): Promise<LiveKitWebhookEvent>;
}

export function createLiveKitWebhookHandler(
  prisma: PrismaClient,
  config: ServerConfig,
  mediaAnalysisPublisher?: MediaAnalysisPublisher,
  recordingVerificationPublisher?: RecordingVerificationPublisher,
  webhookReceiver: LiveKitWebhookReceiver = createWebhookReceiver(config),
): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!request.is("application/webhook+json") || !Buffer.isBuffer(request.body)) {
        throw new HttpError(
          415,
          "LIVEKIT_WEBHOOK_CONTENT_TYPE_REQUIRED",
          "LiveKit webhook content type is required",
        );
      }

      const rawBody = request.body.toString("utf8");
      if (rawBody.length === 0) {
        throw new HttpError(400, "LIVEKIT_WEBHOOK_INVALID", "LiveKit webhook body is required");
      }

      let event: LiveKitWebhookEvent;
      try {
        event = await webhookReceiver.receive(rawBody, request.get("Authorization"));
      } catch {
        throw new HttpError(
          401,
          "LIVEKIT_WEBHOOK_UNAUTHORIZED",
          "LiveKit webhook could not be verified",
        );
      }

      if (event.event !== "egress_ended") {
        response.sendStatus(204);
        return;
      }

      const egressInfo = event.egressInfo;
      if (!egressInfo?.egressId) {
        throw new HttpError(400, "LIVEKIT_WEBHOOK_INVALID", "LiveKit egress information is required");
      }

      if (egressInfo.status !== LIVEKIT_EGRESS_COMPLETE) {
        response.sendStatus(204);
        return;
      }

      await markSessionRecordingCompleted(prisma, egressInfo.egressId);

      const verificationJob = await createSessionRecordingVerificationJob(prisma, egressInfo.egressId);
      if (verificationJob && recordingVerificationPublisher) {
        await recordingVerificationPublisher.publish(verificationJob);
      }

      if (!config.mediaAnalysisEnabled) {
        response.sendStatus(204);
        return;
      }

      try {
        await publishRecordingMediaAnalysisJob(
          prisma,
          config,
          mediaAnalysisPublisher,
          { egressId: egressInfo.egressId },
        );
      } catch (error) {
        if (isHttpError(error) && error.code === "MEDIA_ANALYSIS_EVIDENCE_NOT_FOUND") {
          throw new HttpError(
            503,
            "MEDIA_ANALYSIS_EVIDENCE_NOT_READY",
            "Recording evidence is not ready",
          );
        }
        if (
          isHttpError(error) &&
          (error.code === "MEDIA_CONSENT_REQUIRED" ||
            error.code === "MEDIA_ANALYSIS_CANDIDATE_SOURCE_REQUIRED")
        ) {
          response.sendStatus(204);
          return;
        }
        throw error;
      }

      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  };
}

function createWebhookReceiver(config: ServerConfig): LiveKitWebhookReceiver {
  if (!config.livekitApiKey || !config.livekitApiSecret) {
    throw new Error("LiveKit webhook receiver requires configured API credentials");
  }

  return new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);
}
