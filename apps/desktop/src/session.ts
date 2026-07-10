export interface JoinSessionInput {
  apiBaseUrl: string;
  collabBaseUrl: string;
  sessionId: string;
  documentId: string;
  participantId: string;
  authToken: string;
  languageId?: number;
}

export interface NormalizedJoinSessionInput extends Required<JoinSessionInput> {}

export type JoinSessionField = Exclude<keyof JoinSessionInput, "languageId"> | "languageId";

export type JoinSessionErrors = Partial<Record<JoinSessionField, string>>;

export type JoinSessionValidationResult =
  | {
      valid: true;
      value: NormalizedJoinSessionInput;
      errors: {};
    }
  | {
      valid: false;
      errors: JoinSessionErrors;
    };

const defaultLanguageId = 63;

export function validateJoinSessionInput(
  input: JoinSessionInput,
): JoinSessionValidationResult {
  const errors: JoinSessionErrors = {};

  const apiBaseUrl = normalizeRequiredString(input.apiBaseUrl);
  const collabBaseUrl = normalizeRequiredString(input.collabBaseUrl);
  const sessionId = normalizeRequiredString(input.sessionId);
  const documentId = normalizeRequiredString(input.documentId);
  const participantId = normalizeRequiredString(input.participantId);
  const authToken = normalizeRequiredString(input.authToken);

  if (!apiBaseUrl) {
    errors.apiBaseUrl = "API URL is required";
  }

  if (!collabBaseUrl) {
    errors.collabBaseUrl = "Collaboration URL is required";
  }

  if (!sessionId) {
    errors.sessionId = "Session ID is required";
  }

  if (!documentId) {
    errors.documentId = "Document ID is required";
  }

  if (!participantId) {
    errors.participantId = "Participant ID is required";
  }

  if (!authToken) {
    errors.authToken = "Auth token is required";
  }

  const languageId = input.languageId ?? defaultLanguageId;

  if (!Number.isSafeInteger(languageId) || languageId < 1) {
    errors.languageId = "Language ID must be a positive integer";
  }

  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    value: {
      apiBaseUrl: trimTrailingSlash(apiBaseUrl),
      collabBaseUrl: trimTrailingSlash(collabBaseUrl),
      sessionId,
      documentId,
      participantId,
      authToken,
      languageId,
    },
    errors: {},
  };
}

export function normalizeJoinSessionInput(
  input: JoinSessionInput,
): NormalizedJoinSessionInput {
  const result = validateJoinSessionInput(input);

  if (!result.valid) {
    throw new Error("Join session input is invalid");
  }

  return result.value;
}

function normalizeRequiredString(value: string): string {
  return value.trim();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
