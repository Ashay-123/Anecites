import {
  applyRemoteYjsUpdate,
  createEditorYjsDocument,
  type EditorYjsDocument,
} from "./yjs-binding.js";

export interface EditorReplayEvidenceRecord {
  type: "editor.yjs_update";
  sessionId: string;
  documentId: string;
  participantId: string;
  occurredAt: string;
  updateBase64: string;
}

export interface EditorReplayOptions {
  documentId?: string;
  textName?: string;
}

export interface EditorReplayTimelineStep {
  record: EditorReplayEvidenceRecord;
  delayMs: number;
  elapsedMs: number;
}

export interface EditorReplayResult {
  document: EditorYjsDocument;
  finalText: string;
  timeline: EditorReplayTimelineStep[];
}

export function parseEditorReplayEvidenceNdjson(
  ndjson: string,
): EditorReplayEvidenceRecord[] {
  return ndjson
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseReplayEvidenceLine(line));
}

export function replayEditorEvidence(
  records: EditorReplayEvidenceRecord[],
  options: EditorReplayOptions = {},
): EditorReplayResult {
  const orderedRecords = orderReplayRecords(records);
  const documentId = options.documentId ?? orderedRecords[0]?.documentId;

  if (!documentId) {
    throw new Error("Replay requires at least one evidence record or an explicit documentId");
  }

  const document = createEditorYjsDocument({
    documentId,
    ...(options.textName !== undefined ? { textName: options.textName } : {}),
  });
  const timeline = createReplayTimeline(orderedRecords);

  for (const record of orderedRecords) {
    if (record.documentId !== documentId) {
      document.destroy();
      throw new Error("Replay evidence contains multiple document IDs");
    }

    applyRemoteYjsUpdate(document, base64ToBytes(record.updateBase64));
  }

  return {
    document,
    finalText: document.text.toString(),
    timeline,
  };
}

function parseReplayEvidenceLine(line: string): EditorReplayEvidenceRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error("Invalid replay evidence record", {
      cause: error,
    });
  }

  if (!isReplayEvidenceRecord(parsed)) {
    throw new Error("Invalid replay evidence record");
  }

  return parsed;
}

function isReplayEvidenceRecord(value: unknown): value is EditorReplayEvidenceRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === "editor.yjs_update" &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.documentId === "string" &&
    value.documentId.length > 0 &&
    typeof value.participantId === "string" &&
    value.participantId.length > 0 &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    typeof value.updateBase64 === "string" &&
    value.updateBase64.length > 0
  );
}

function orderReplayRecords(records: EditorReplayEvidenceRecord[]): EditorReplayEvidenceRecord[] {
  return records
    .map((record, index) => ({
      record,
      index,
      occurredAtMs: Date.parse(record.occurredAt),
    }))
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.index - right.index)
    .map((entry) => entry.record);
}

function createReplayTimeline(
  records: EditorReplayEvidenceRecord[],
): EditorReplayTimelineStep[] {
  const firstOccurredAtMs = Date.parse(records[0]?.occurredAt ?? "");

  if (!Number.isFinite(firstOccurredAtMs)) {
    return [];
  }

  return records.map((record, index) => {
    const occurredAtMs = Date.parse(record.occurredAt);
    const previousOccurredAtMs =
      index === 0 ? occurredAtMs : Date.parse(records[index - 1]?.occurredAt ?? record.occurredAt);

    return {
      record,
      delayMs: Math.max(0, occurredAtMs - previousOccurredAtMs),
      elapsedMs: Math.max(0, occurredAtMs - firstOccurredAtMs),
    };
  });
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
