export const SESSION_STATES = [
  "created",
  "scheduled",
  "lobby",
  "active",
  "ended",
  "cancelled",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const TERMINAL_SESSION_STATES = [
  "ended",
  "cancelled",
] as const satisfies readonly SessionState[];

export const ALLOWED_SESSION_TRANSITIONS = {
  created: ["scheduled", "cancelled"],
  scheduled: ["lobby", "cancelled"],
  lobby: ["active", "cancelled"],
  active: ["ended", "cancelled"],
  ended: [],
  cancelled: [],
} as const satisfies Record<SessionState, readonly SessionState[]>;

export function isSessionState(value: string): value is SessionState {
  return (SESSION_STATES as readonly string[]).includes(value);
}

export function isTerminalSessionState(state: SessionState): boolean {
  return (TERMINAL_SESSION_STATES as readonly string[]).includes(state);
}

export function isValidSessionTransition(from: SessionState, to: SessionState): boolean {
  return (ALLOWED_SESSION_TRANSITIONS[from] as readonly string[]).includes(to);
}
