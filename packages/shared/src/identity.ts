import { assertNonEmptyString } from "./constants.js";

export const USER_ROLES = [
  "candidate",
  "interviewer",
  "reviewer",
  "admin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PARTICIPANT_ROLES = [
  "candidate",
  "interviewer",
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const ROOM_TYPES = [
  "editor",
  "video",
  "review",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export function buildSessionRoomName(sessionId: string, roomType: RoomType): string {
  assertNonEmptyString("sessionId", sessionId);
  return `session:${sessionId}:${roomType}`;
}

export function isPrivilegedUserRole(role: UserRole): boolean {
  return role === "interviewer" || role === "reviewer" || role === "admin";
}
