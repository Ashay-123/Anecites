import { Prisma, type PrismaClient } from "@anecites/db";
import {
  createGazeCalibrationStep,
  createGazeCalibrationStepPrefix,
  getCandidateTrackRecordingParticipantId,
  type GazeCalibrationStep,
  type GazeCalibrationTarget,
} from "@anecites/shared";

import { type AuthenticatedPrincipal } from "./auth.js";
import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";
import { requireActiveGazeCalibrationConsents } from "./media-consent.js";

type GazeCalibrationConsentConfig = Pick<
  ServerConfig,
  | "mediaAnalysisEnabled"
  | "mediaAnalysisGazeMode"
  | "mediaConsentNoticeVersion"
  | "mediaConsentNoticeText"
  | "mediaConsentNoticeFingerprint"
>;

export interface GazeCalibrationStepInput {
  target: GazeCalibrationTarget;
  sequence: number;
}

export interface SerializedGazeCalibrationStep extends GazeCalibrationStep {
  acknowledgedAt: string;
}

export interface SerializedGazeCalibration {
  id: string;
  state: "active" | "completed" | "abandoned";
  startedAt: string;
  completedAt: string | null;
  steps: SerializedGazeCalibrationStep[];
}

export interface StartGazeCalibrationResult {
  created: boolean;
  gazeCalibration: SerializedGazeCalibration;
}

export async function startGazeCalibration(
  prisma: PrismaClient,
  config: GazeCalibrationConsentConfig,
  principal: AuthenticatedPrincipal,
  sessionId: string,
): Promise<StartGazeCalibrationResult> {
  const participant = await requireCandidateParticipant(prisma, principal, sessionId);
  await requireActiveGazeCalibrationConsents(prisma, config, sessionId);

  const existing = await prisma.gazeCalibration.findFirst({
    where: {
      sessionId,
      participantId: participant.id,
      state: "ACTIVE",
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  if (existing) {
    const activeRecording = await findActiveCandidateRecording(prisma, sessionId, participant.id);
    if (activeRecording && existing.sessionRecordingId === activeRecording.id) {
      return {
        created: false,
        gazeCalibration: serializeGazeCalibration(existing),
      };
    }

    await abandonActiveCalibration(prisma, existing.id, existing.updatedAt);
  }

  const activeRecording = await requireActiveCandidateRecording(prisma, sessionId, participant.id);

  try {
    const gazeCalibration = await prisma.gazeCalibration.create({
      data: {
        sessionId,
        participantId: participant.id,
        sessionRecordingId: activeRecording.id,
        steps: [],
      },
    });
    return {
      created: true,
      gazeCalibration: serializeGazeCalibration(gazeCalibration),
    };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    const concurrent = await prisma.gazeCalibration.findFirst({
      where: {
        sessionId,
        participantId: participant.id,
        state: "ACTIVE",
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    if (!concurrent) {
      throw new HttpError(409, "GAZE_CALIBRATION_CONFLICT", "Gaze calibration changed concurrently; retry the request");
    }
    const concurrentRecording = await findActiveCandidateRecording(prisma, sessionId, participant.id);
    if (!concurrentRecording || concurrent.sessionRecordingId !== concurrentRecording.id) {
      throw new HttpError(
        409,
        "GAZE_CALIBRATION_CONFLICT",
        "Gaze calibration changed concurrently; retry the request",
      );
    }
    return {
      created: false,
      gazeCalibration: serializeGazeCalibration(concurrent),
    };
  }
}

export async function acknowledgeGazeCalibrationStep(
  prisma: PrismaClient,
  config: GazeCalibrationConsentConfig,
  principal: AuthenticatedPrincipal,
  sessionId: string,
  gazeCalibrationId: string,
  input: GazeCalibrationStepInput,
  now: () => Date = () => new Date(),
): Promise<SerializedGazeCalibration> {
  const participant = await requireCandidateParticipant(prisma, principal, sessionId);
  await requireActiveGazeCalibrationConsents(prisma, config, sessionId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await prisma.gazeCalibration.findFirst({
      where: {
        id: gazeCalibrationId,
        sessionId,
        participantId: participant.id,
      },
    });
    if (!current) {
      throw new HttpError(404, "GAZE_CALIBRATION_NOT_FOUND", "Gaze calibration was not found");
    }
    if (current.state !== "ACTIVE") {
      throw new HttpError(409, "GAZE_CALIBRATION_COMPLETE", "Gaze calibration is already complete");
    }
    const activeRecording = await findActiveCandidateRecording(prisma, sessionId, participant.id);
    if (!activeRecording || current.sessionRecordingId !== activeRecording.id) {
      await abandonActiveCalibration(prisma, current.id, current.updatedAt);
      throw new HttpError(
        409,
        "GAZE_CALIBRATION_RECORDING_REQUIRED",
        "The candidate recording changed; start gaze calibration again",
      );
    }

    const currentSteps = parseStoredGazeCalibrationSteps(current.steps);
    let nextStep: GazeCalibrationStep;
    try {
      nextStep = createGazeCalibrationStep(input);
    } catch (error) {
      throw new HttpError(
        400,
        "GAZE_CALIBRATION_INVALID",
        error instanceof Error ? error.message : "Gaze calibration step is invalid",
      );
    }
    if (nextStep.sequence !== currentSteps.length + 1) {
      throw new HttpError(400, "GAZE_CALIBRATION_INVALID", "Gaze calibration sequence is invalid");
    }

    const acknowledgedAt = now();
    if (Number.isNaN(acknowledgedAt.getTime())) {
      throw new Error("Gaze calibration clock returned an invalid timestamp");
    }
    const nextSteps = [
      ...currentSteps,
      {
        ...nextStep,
        acknowledgedAt: acknowledgedAt.toISOString(),
      },
    ];
    const complete = nextSteps.length === 5;
    const updated = await prisma.gazeCalibration.updateMany({
      where: {
        id: current.id,
        state: "ACTIVE",
        updatedAt: current.updatedAt,
      },
      data: {
        steps: toGazeCalibrationStepsJson(nextSteps),
        ...(complete
          ? {
              state: "COMPLETED",
              completedAt: acknowledgedAt,
            }
          : {}),
      },
    });
    if (updated.count === 1) {
      const persisted = await prisma.gazeCalibration.findUnique({
        where: {
          id: current.id,
        },
      });
      if (!persisted) {
        throw new Error("Gaze calibration was not persisted");
      }
      return serializeGazeCalibration(persisted);
    }
  }

  throw new HttpError(409, "GAZE_CALIBRATION_CONFLICT", "Gaze calibration changed concurrently; retry the request");
}

async function requireCandidateParticipant(
  prisma: PrismaClient,
  principal: AuthenticatedPrincipal,
  sessionId: string,
): Promise<{ id: string }> {
  const participant = await prisma.participant.findFirst({
    where: {
      sessionId,
      userId: principal.subject,
      role: "CANDIDATE",
      leftAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!participant || principal.role !== "candidate") {
    throw new HttpError(403, "GAZE_CALIBRATION_CANDIDATE_REQUIRED", "Candidate access is required for gaze calibration");
  }
  return participant;
}

function parseStoredGazeCalibrationSteps(value: Prisma.JsonValue): SerializedGazeCalibrationStep[] {
  if (!Array.isArray(value)) {
    throw new HttpError(409, "GAZE_CALIBRATION_INVALID", "Gaze calibration data is invalid");
  }

  const steps = value.map((step) => {
    if (!isRecord(step) || Object.keys(step).some((key) => !["target", "sequence", "acknowledgedAt"].includes(key))) {
      throw new HttpError(409, "GAZE_CALIBRATION_INVALID", "Gaze calibration data is invalid");
    }
    if (typeof step.target !== "string" || !Number.isSafeInteger(step.sequence) || typeof step.acknowledgedAt !== "string") {
      throw new HttpError(409, "GAZE_CALIBRATION_INVALID", "Gaze calibration data is invalid");
    }
    const acknowledgedAt = new Date(step.acknowledgedAt);
    if (Number.isNaN(acknowledgedAt.getTime())) {
      throw new HttpError(409, "GAZE_CALIBRATION_INVALID", "Gaze calibration data is invalid");
    }
    return {
      target: step.target,
      sequence: step.sequence,
      acknowledgedAt: acknowledgedAt.toISOString(),
    };
  });

  try {
    const normalized = createGazeCalibrationStepPrefix(steps.map(({ target, sequence }) => ({ target, sequence })));
    return normalized.map((step, index) => ({
      ...step,
      acknowledgedAt: steps[index]?.acknowledgedAt ?? "",
    }));
  } catch {
    throw new HttpError(409, "GAZE_CALIBRATION_INVALID", "Gaze calibration data is invalid");
  }
}

function serializeGazeCalibration(calibration: {
  id: string;
  state: "ACTIVE" | "COMPLETED" | "ABANDONED";
  startedAt: Date;
  completedAt: Date | null;
  steps: Prisma.JsonValue;
}): SerializedGazeCalibration {
  return {
    id: calibration.id,
    state: calibration.state.toLowerCase() as SerializedGazeCalibration["state"],
    startedAt: calibration.startedAt.toISOString(),
    completedAt: calibration.completedAt?.toISOString() ?? null,
    steps: parseStoredGazeCalibrationSteps(calibration.steps),
  };
}

async function findActiveCandidateRecording(
  prisma: PrismaClient,
  sessionId: string,
  participantId: string,
): Promise<{ id: string } | null> {
  const recordings = await prisma.sessionRecording.findMany({
    where: {
      sessionId,
      state: "ACTIVE",
    },
    select: {
      id: true,
      evidenceObject: {
        select: {
          metadata: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  const matchingRecordings = recordings.filter(
    (recording) => getCandidateTrackRecordingParticipantId(recording.evidenceObject.metadata) === participantId,
  );

  return matchingRecordings.length === 1 ? matchingRecordings[0] ?? null : null;
}

async function requireActiveCandidateRecording(
  prisma: PrismaClient,
  sessionId: string,
  participantId: string,
): Promise<{ id: string }> {
  const recording = await findActiveCandidateRecording(prisma, sessionId, participantId);
  if (!recording) {
    throw new HttpError(
      409,
      "GAZE_CALIBRATION_RECORDING_REQUIRED",
      "An active candidate recording is required for gaze calibration",
    );
  }

  return recording;
}

async function abandonActiveCalibration(
  prisma: PrismaClient,
  calibrationId: string,
  updatedAt: Date,
): Promise<void> {
  await prisma.gazeCalibration.updateMany({
    where: {
      id: calibrationId,
      state: "ACTIVE",
      updatedAt,
    },
    data: {
      state: "ABANDONED",
      completedAt: new Date(),
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toGazeCalibrationStepsJson(
  steps: readonly SerializedGazeCalibrationStep[],
): Prisma.InputJsonArray {
  return steps.map((step) => ({
    target: step.target,
    sequence: step.sequence,
    acknowledgedAt: step.acknowledgedAt,
  }));
}
