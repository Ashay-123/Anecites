export const DEFAULT_ROLLING_TELEMETRY_WINDOW_MS = 2_000;

export type IsoDateTimeString = string;

export function assertNonEmptyString(fieldName: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

export function assertNonNegativeInteger(fieldName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

export function assertPositiveInteger(fieldName: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be positive`);
  }
}
