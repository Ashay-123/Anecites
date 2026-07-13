CREATE TYPE "CodeExecutionMode" AS ENUM ('RUN', 'SUBMIT');

ALTER TABLE "CodeSubmission" ADD COLUMN "executionMode" "CodeExecutionMode" NOT NULL DEFAULT 'RUN';
