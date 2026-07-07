-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CANDIDATE', 'INTERVIEWER', 'REVIEWER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('CANDIDATE', 'INTERVIEWER');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('CREATED', 'SCHEDULED', 'LOBBY', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('EDITOR_REPLAY', 'SESSION_RECORDING', 'SCREEN_RECORDING', 'RISK_CLIP', 'CODE_OUTPUT');

-- CreateEnum
CREATE TYPE "CodeSubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'ACCEPTED', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "RiskReviewStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DISMISSED', 'NEEDS_MORE_CONTEXT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'CREATED',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceObject" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" BIGINT,
    "checksumSha256" TEXT,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorDocument" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "initialContent" TEXT NOT NULL DEFAULT '',
    "finalContent" TEXT,
    "replayObjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorTelemetryAggregate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndedAt" TIMESTAMP(3) NOT NULL,
    "insertEventCount" INTEGER NOT NULL DEFAULT 0,
    "deleteEventCount" INTEGER NOT NULL DEFAULT 0,
    "pasteBlockedCount" INTEGER NOT NULL DEFAULT 0,
    "atomicInsertCount" INTEGER NOT NULL DEFAULT 0,
    "maxInsertSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorTelemetryAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT,
    "documentId" TEXT NOT NULL,
    "languageId" INTEGER NOT NULL,
    "sourceHashSha256" TEXT NOT NULL,
    "stdin" TEXT,
    "stdout" TEXT,
    "stderr" TEXT,
    "status" "CodeSubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "judge0Token" TEXT,
    "timeMs" INTEGER,
    "memoryKb" INTEGER,
    "outputEvidenceObjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSummary" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "evidenceObjectId" TEXT,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndedAt" TIMESTAMP(3) NOT NULL,
    "score" DECIMAL(5,4) NOT NULL,
    "correlatedSignalCount" INTEGER NOT NULL,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "reviewStatus" "RiskReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rationale" TEXT,
    "signalBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Session_state_idx" ON "Session"("state");

-- CreateIndex
CREATE INDEX "Session_scheduledAt_idx" ON "Session"("scheduledAt");

-- CreateIndex
CREATE INDEX "Participant_sessionId_idx" ON "Participant"("sessionId");

-- CreateIndex
CREATE INDEX "Participant_userId_idx" ON "Participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_sessionId_userId_role_key" ON "Participant"("sessionId", "userId", "role");

-- CreateIndex
CREATE INDEX "EvidenceObject_sessionId_kind_idx" ON "EvidenceObject"("sessionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObject_storageBucket_storageKey_key" ON "EvidenceObject"("storageBucket", "storageKey");

-- CreateIndex
CREATE INDEX "EditorDocument_sessionId_idx" ON "EditorDocument"("sessionId");

-- CreateIndex
CREATE INDEX "EditorDocument_replayObjectId_idx" ON "EditorDocument"("replayObjectId");

-- CreateIndex
CREATE INDEX "EditorTelemetryAggregate_sessionId_windowStartedAt_idx" ON "EditorTelemetryAggregate"("sessionId", "windowStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorTelemetryAggregate_documentId_windowStartedAt_windowE_key" ON "EditorTelemetryAggregate"("documentId", "windowStartedAt", "windowEndedAt");

-- CreateIndex
CREATE INDEX "CodeSubmission_sessionId_createdAt_idx" ON "CodeSubmission"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CodeSubmission_participantId_idx" ON "CodeSubmission"("participantId");

-- CreateIndex
CREATE INDEX "CodeSubmission_documentId_idx" ON "CodeSubmission"("documentId");

-- CreateIndex
CREATE INDEX "CodeSubmission_outputEvidenceObjectId_idx" ON "CodeSubmission"("outputEvidenceObjectId");

-- CreateIndex
CREATE INDEX "RiskSummary_sessionId_windowStartedAt_idx" ON "RiskSummary"("sessionId", "windowStartedAt");

-- CreateIndex
CREATE INDEX "RiskSummary_reviewStatus_idx" ON "RiskSummary"("reviewStatus");

-- CreateIndex
CREATE INDEX "RiskSummary_evidenceObjectId_idx" ON "RiskSummary"("evidenceObjectId");

-- CreateIndex
CREATE INDEX "RiskSummary_reviewerId_idx" ON "RiskSummary"("reviewerId");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorDocument" ADD CONSTRAINT "EditorDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorDocument" ADD CONSTRAINT "EditorDocument_replayObjectId_fkey" FOREIGN KEY ("replayObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorTelemetryAggregate" ADD CONSTRAINT "EditorTelemetryAggregate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorTelemetryAggregate" ADD CONSTRAINT "EditorTelemetryAggregate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EditorDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EditorDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_outputEvidenceObjectId_fkey" FOREIGN KEY ("outputEvidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSummary" ADD CONSTRAINT "RiskSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSummary" ADD CONSTRAINT "RiskSummary_evidenceObjectId_fkey" FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSummary" ADD CONSTRAINT "RiskSummary_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
