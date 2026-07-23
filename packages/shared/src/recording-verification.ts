export interface RecordingVerificationJob {
  version: 1;
  jobId: string;
  sessionId: string;
  recordingEvidenceObjectId: string;
}

export function createRecordingVerificationJob(value: RecordingVerificationJob): RecordingVerificationJob {
  if (value.version !== 1) {
    throw new Error("Recording verification job version must be 1");
  }
  const sessionId = requireIdentifier("sessionId", value.sessionId);
  const recordingEvidenceObjectId = requireIdentifier(
    "recordingEvidenceObjectId",
    value.recordingEvidenceObjectId,
  );
  const jobId = requireIdentifier("jobId", value.jobId);
  if (jobId !== `recording-verification:${recordingEvidenceObjectId}`) {
    throw new Error("Recording verification job id is invalid");
  }
  return { version: 1, jobId, sessionId, recordingEvidenceObjectId };
}

function requireIdentifier(fieldName: string, value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,256}$/.test(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value;
}
