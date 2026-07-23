export type MediaWorkerErrorCode =
  | "MEDIA_JOB_BUSY"
  | "MEDIA_JOB_CONFLICT"
  | "MEDIA_JOB_LEASE_LOST"
  | "MEDIA_EVIDENCE_NOT_FOUND"
  | "MEDIA_EVIDENCE_INVALID"
  | "MEDIA_PARTICIPANT_INVALID"
  | "MEDIA_ADAPTER_UNAVAILABLE"
  | "MEDIA_ADAPTER_TIMEOUT"
  | "MEDIA_ADAPTER_FAILED"
  | "MEDIA_ADAPTER_INVALID_RESPONSE";

export class MediaWorkerError extends Error {
  readonly code: MediaWorkerErrorCode;

  constructor(code: MediaWorkerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaWorkerError";
    this.code = code;
  }
}
