from __future__ import annotations

from collections.abc import Iterable
import json
from math import isfinite
from pathlib import Path
import re


MAX_SPEAKER_SEGMENTS = 100
MAX_SPEAKER_ID_LENGTH = 128
SPEAKER_DIARIZATION_MODEL_REPOSITORY_ID = "pyannote/speaker-diarization-community-1"
SPEAKER_DIARIZATION_MODEL_MANIFEST_NAME = ".anecites-model-manifest.json"
_MODEL_REVISION_PATTERN = re.compile(r"^[a-f0-9]{40}$")


class DiarizationError(ValueError):
    pass


def create_speaker_diarization_model_manifest(revision: str) -> dict[str, str]:
    return {
        "repositoryId": SPEAKER_DIARIZATION_MODEL_REPOSITORY_ID,
        "revision": _require_pinned_model_revision(revision),
    }


def verify_speaker_diarization_model_manifest(model_directory: Path, expected_revision: str) -> None:
    manifest_path = model_directory / SPEAKER_DIARIZATION_MODEL_MANIFEST_NAME
    try:
        manifest_content = manifest_path.read_text(encoding="utf-8")
    except OSError as error:
        raise DiarizationError("speaker diarization model manifest is invalid") from error

    parse_speaker_diarization_model_manifest(manifest_content, expected_revision)


def parse_speaker_diarization_model_manifest(manifest_content: str, expected_revision: str) -> None:
    expected = create_speaker_diarization_model_manifest(expected_revision)
    try:
        manifest = json.loads(manifest_content)
    except (TypeError, json.JSONDecodeError) as error:
        raise DiarizationError("speaker diarization model manifest is invalid") from error

    if not isinstance(manifest, dict) or set(manifest) != {"repositoryId", "revision"}:
        raise DiarizationError("speaker diarization model manifest is invalid")
    if manifest != expected:
        raise DiarizationError("speaker diarization model manifest does not match the configured revision")


def serialize_speaker_diarization_segments(
    turns: Iterable[tuple[float, float, object]],
) -> list[dict[str, object]]:
    segments: list[dict[str, object]] = []
    for started_at_seconds, ended_at_seconds, speaker_id in turns:
        if len(segments) >= MAX_SPEAKER_SEGMENTS:
            raise DiarizationError(f"speaker diarization segments cannot exceed {MAX_SPEAKER_SEGMENTS}")
        if (
            not isinstance(started_at_seconds, (int, float))
            or not isinstance(ended_at_seconds, (int, float))
            or not isfinite(started_at_seconds)
            or not isfinite(ended_at_seconds)
        ):
            raise DiarizationError("speaker diarization timestamps must be finite numbers")
        if ended_at_seconds <= started_at_seconds:
            raise DiarizationError("speaker diarization segment must end after it starts")
        if not isinstance(speaker_id, str) or not speaker_id.strip() or len(speaker_id.strip()) > MAX_SPEAKER_ID_LENGTH:
            raise DiarizationError("speaker diarization speaker id is invalid")

        segments.append(
            {
                "speakerId": speaker_id.strip(),
                "startedAtMs": round(started_at_seconds * 1_000),
                "endedAtMs": round(ended_at_seconds * 1_000),
            },
        )

    return segments


def _require_pinned_model_revision(value: str) -> str:
    if not isinstance(value, str) or not _MODEL_REVISION_PATTERN.fullmatch(value.strip().lower()):
        raise DiarizationError("speaker diarization model revision must be a pinned commit SHA")
    return value.strip().lower()
