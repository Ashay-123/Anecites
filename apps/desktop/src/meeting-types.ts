import { type CodeExecutionResult } from "@anecites/editor-core";
import { type LiveKitConnectionStatus } from "./livekit.js";

export type VideoStatus = "idle" | "connecting" | LiveKitConnectionStatus | "error";
export type ScreenShareStatus = "idle" | "checking" | "ready" | "sharing" | "error";
export type NativeMonitoringStatus = "idle" | "scanning" | "ready" | "error";
export type ReviewQueueStatus = "idle" | "loading" | "ready" | "updating" | "error";
export type ExecutionStatus = "idle" | "running" | "ready" | "error";
export type CollabStatus = "idle" | "connecting" | "connected" | "unavailable";
export type ExecutionMode = "run" | "submit";
export type LiveKitMediaTileKind = "audio" | "video";

export interface LiveKitMediaTile {
  id: string;
  kind: LiveKitMediaTileKind;
  participantName: string;
  source: string;
  local: boolean;
  element: HTMLMediaElement;
}

export interface LocalSubmissionRecord {
  id: string;
  mode: ExecutionMode;
  status: string;
  occurredAt: string;
}

export interface EditorCursorPosition {
  lineNumber: number;
  column: number;
}

export const emptyExecution: CodeExecutionResult = {
  token: null,
  status: {
    id: 0,
    description: "Not run",
  },
  stdout: null,
  stderr: null,
  compileOutput: null,
  message: null,
  timeSeconds: null,
  memoryKb: null,
};
