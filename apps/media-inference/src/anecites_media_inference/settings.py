from __future__ import annotations

from dataclasses import dataclass
import os
import re


@dataclass(frozen=True)
class Settings:
    auth_token: str
    s3_endpoint: str
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_region: str
    s3_force_path_style: bool
    allowed_buckets: frozenset[str]
    max_media_bytes: int
    processing_timeout_seconds: int
    face_landmarker_model_path: str
    face_min_detection_confidence: float
    video_frames_per_window: int
    vad_threshold: float
    vad_min_speech_ms: int
    speaker_diarization_enabled: bool
    speaker_diarization_model_path: str
    speaker_diarization_model_revision: str | None


def load_settings(env: dict[str, str] | None = None) -> Settings:
    values = os.environ if env is None else env
    speaker_diarization_enabled = _boolean(values, "MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED", False)
    speaker_diarization_model_revision = _optional_pinned_model_revision(
        values,
        "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION",
    )
    if speaker_diarization_enabled and speaker_diarization_model_revision is None:
        raise ValueError("MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION is required when speaker diarization is enabled")

    return Settings(
        auth_token=_required_secret(values, "MEDIA_INFERENCE_AUTH_TOKEN"),
        s3_endpoint=_required(values, "S3_ENDPOINT"),
        s3_access_key_id=_required(values, "S3_ACCESS_KEY_ID"),
        s3_secret_access_key=_required(values, "S3_SECRET_ACCESS_KEY"),
        s3_region=values.get("S3_REGION", "us-east-1").strip() or "us-east-1",
        s3_force_path_style=_boolean(values, "S3_FORCE_PATH_STYLE", True),
        allowed_buckets=_allowed_buckets(values),
        max_media_bytes=_integer(values, "MEDIA_INFERENCE_MAX_MEDIA_BYTES", 536_870_912, 1, 2_147_483_648),
        processing_timeout_seconds=_integer(values, "MEDIA_INFERENCE_PROCESSING_TIMEOUT_SECONDS", 240, 1, 600),
        face_landmarker_model_path=_required_path(
            values,
            "MEDIA_INFERENCE_FACE_LANDMARKER_MODEL_PATH",
            "/models/face_landmarker.task",
        ),
        face_min_detection_confidence=_float(values, "MEDIA_INFERENCE_FACE_MIN_DETECTION_CONFIDENCE", 0.5),
        video_frames_per_window=_integer(values, "MEDIA_INFERENCE_VIDEO_FRAMES_PER_WINDOW", 5, 1, 20),
        vad_threshold=_float(values, "MEDIA_INFERENCE_VAD_THRESHOLD", 0.5),
        vad_min_speech_ms=_integer(values, "MEDIA_INFERENCE_VAD_MIN_SPEECH_MS", 250, 50, 10_000),
        speaker_diarization_enabled=speaker_diarization_enabled,
        speaker_diarization_model_path=_required_path(
            values,
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_PATH",
            "/models/pyannote/speaker-diarization-community-1",
        ),
        speaker_diarization_model_revision=speaker_diarization_model_revision,
    )


def _required(values: dict[str, str] | os._Environ[str], name: str) -> str:
    value = values.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _required_secret(values: dict[str, str] | os._Environ[str], name: str) -> str:
    value = _required(values, name)
    if len(value) < 32:
        raise ValueError(f"{name} must contain at least 32 characters")
    return value


def _required_path(
    values: dict[str, str] | os._Environ[str],
    name: str,
    default: str,
) -> str:
    value = values.get(name, default).strip()
    if not value:
        raise ValueError(f"{name} must be a non-empty path")
    return value


def _allowed_buckets(values: dict[str, str] | os._Environ[str]) -> frozenset[str]:
    buckets = frozenset(
        bucket.strip()
        for bucket in _required(values, "MEDIA_INFERENCE_ALLOWED_BUCKETS").split(",")
        if bucket.strip()
    )
    if not buckets:
        raise ValueError("MEDIA_INFERENCE_ALLOWED_BUCKETS must contain at least one bucket")
    return buckets


def _boolean(values: dict[str, str] | os._Environ[str], name: str, default: bool) -> bool:
    value = values.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false")
    return normalized == "true"


def _integer(
    values: dict[str, str] | os._Environ[str],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = values.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _float(values: dict[str, str] | os._Environ[str], name: str, default: float) -> float:
    raw = values.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
    if value < 0 or value > 1:
        raise ValueError(f"{name} must be between 0 and 1")
    return value


def _optional_pinned_model_revision(
    values: dict[str, str] | os._Environ[str],
    name: str,
) -> str | None:
    raw = values.get(name)
    if raw is None or not raw.strip():
        return None
    revision = raw.strip().lower()
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError(f"{name} must be a pinned commit SHA")
    return revision
