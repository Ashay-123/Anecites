from __future__ import annotations


def summarize_face_landmarker_window(
    started_at_ms: int,
    ended_at_ms: int,
    face_counts: list[int],
) -> dict[str, object]:
    if isinstance(started_at_ms, bool) or not isinstance(started_at_ms, int) or started_at_ms < 0:
        raise ValueError("started_at_ms must be a non-negative integer")
    if isinstance(ended_at_ms, bool) or not isinstance(ended_at_ms, int) or ended_at_ms <= started_at_ms:
        raise ValueError("ended_at_ms must be greater than started_at_ms")
    if not face_counts:
        raise ValueError("face_counts must contain at least one frame")
    if any(isinstance(count, bool) or not isinstance(count, int) or count < 0 for count in face_counts):
        raise ValueError("face_counts must contain non-negative integers")

    total = len(face_counts)
    missing = sum(1 for count in face_counts if count == 0)
    multiple = sum(1 for count in face_counts if count >= 2)
    single = total - missing - multiple

    if missing >= multiple and missing >= single:
        face_count = 0
        condition_support = missing / total
    elif multiple >= single:
        face_count = max(face_counts)
        condition_support = multiple / total
    else:
        face_count = 1
        condition_support = single / total

    return {
        "faceCount": face_count,
        "conditionSupport": round(condition_support, 4),
        # Face Landmarker provides landmarks rather than a detector score. Landmarks are never retained.
        "detectorConfidence": None,
        "startedAtMs": started_at_ms,
        "endedAtMs": ended_at_ms,
    }
