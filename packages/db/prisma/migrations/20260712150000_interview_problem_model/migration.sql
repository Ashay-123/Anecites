-- Extend code submission statuses for judged interview submissions.
ALTER TYPE "CodeSubmissionStatus" ADD VALUE 'WRONG_ANSWER';

-- Persist reusable interview problems and testcase definitions.
CREATE TABLE "InterviewProblem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "starterCode" TEXT NOT NULL,
    "languageId" INTEGER NOT NULL,
    "examples" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewProblem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewProblemTestcase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewProblemTestcase_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Session" ADD COLUMN "problemId" TEXT;
ALTER TABLE "CodeSubmission" ADD COLUMN "problemId" TEXT;

CREATE UNIQUE INDEX "InterviewProblem_slug_key" ON "InterviewProblem"("slug");
CREATE INDEX "InterviewProblem_languageId_idx" ON "InterviewProblem"("languageId");
CREATE UNIQUE INDEX "InterviewProblemTestcase_problemId_ordinal_key" ON "InterviewProblemTestcase"("problemId", "ordinal");
CREATE INDEX "InterviewProblemTestcase_problemId_idx" ON "InterviewProblemTestcase"("problemId");
CREATE INDEX "Session_problemId_idx" ON "Session"("problemId");
CREATE INDEX "CodeSubmission_problemId_idx" ON "CodeSubmission"("problemId");

ALTER TABLE "InterviewProblemTestcase" ADD CONSTRAINT "InterviewProblemTestcase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "InterviewProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "InterviewProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CodeSubmission" ADD CONSTRAINT "CodeSubmission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "InterviewProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
