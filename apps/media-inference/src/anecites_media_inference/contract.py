from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Any

MAX_DURATION_MS = 4 * 60 * 60 * 1000
MAX_SAMPLE_WINDOW_MS = 60_000
MAX_SAMPLES_PER_RECORDING = 100
MAX_STORAGE_KEY_LENGTH = 1_024


class ContractError(ValueError):
    pass


@dataclass(frozen=True)
class RecordingReference:
    storage_bucket: str
    storage_key: str
    content_type: str
    duration_ms: int | None


@dataclass(frozen=True)
class SamplingOptions:
    window_ms: int
    max_windows: int


@dataclass(frozen=True)
class RequestedAnalyses:
    voice_activity: bool
    face_presence: bool
    speaker_diarization: bool


@dataclass(frozen=True)
class AnalyzeRequest:
    recording: RecordingReference
    sampling: SamplingOptions
    analyses: RequestedAnalyses


@dataclass(frozen=True)
class RecordingVerificationRequest:
    recording: RecordingReference


def parse_analyze_request(value: Any) -> AnalyzeRequest:
    root = _require_object("request", value, {"version", "recording", "sampling", "analyses"})
    if root.get("version") != 1:
        raise ContractError("version must be 1")

    recording = _parse_recording_reference(root.get("recording"))
    sampling_value = _require_object(
        "sampling",
        root.get("sampling"),
        {"windowMs", "maxWindows"},
    )
    analyses_value = _require_object(
        "analyses",
        root.get("analyses"),
        {"voiceActivity", "facePresence", "speakerDiarization"},
    )

    analyses = RequestedAnalyses(
        voice_activity=_boolean("analyses.voiceActivity", analyses_value.get("voiceActivity")),
        face_presence=_boolean("analyses.facePresence", analyses_value.get("facePresence")),
        speaker_diarization=_boolean(
            "analyses.speakerDiarization",
            analyses_value.get("speakerDiarization"),
        ),
    )
    if not analyses.voice_activity and not analyses.face_presence and not analyses.speaker_diarization:
        raise ContractError("at least one analysis must be requested")

    return AnalyzeRequest(
        recording=recording,
        sampling=SamplingOptions(
            window_ms=_bounded_integer(
                "sampling.windowMs",
                sampling_value.get("windowMs"),
                1,
                MAX_SAMPLE_WINDOW_MS,
            ),
            max_windows=_bounded_integer(
                "sampling.maxWindows",
                sampling_value.get("maxWindows"),
                1,
                MAX_SAMPLES_PER_RECORDING,
            ),
        ),
        analyses=analyses,
    )


def parse_recording_verification_request(value: Any) -> RecordingVerificationRequest:
    root = _require_object("request", value, {"version", "recording"})
    if root.get("version") != 1:
        raise ContractError("version must be 1")
    return RecordingVerificationRequest(recording=_parse_recording_reference(root.get("recording")))


def _parse_recording_reference(value: Any) -> RecordingReference:
    recording_value = _require_object(
        "recording",
        value,
        {"storageBucket", "storageKey", "contentType", "durationMs"},
    )
    duration_value = recording_value.get("durationMs")
    duration_ms = None if duration_value is None else _bounded_integer(
        "recording.durationMs", duration_value, 1, MAX_DURATION_MS
    )
    return RecordingReference(
        storage_bucket=_non_empty_string("recording.storageBucket", recording_value.get("storageBucket"), 255),
        storage_key=_non_empty_string("recording.storageKey", recording_value.get("storageKey"), MAX_STORAGE_KEY_LENGTH),
        content_type=_non_empty_string("recording.contentType", recording_value.get("contentType"), 255),
        duration_ms=duration_ms,
    )


def select_sample_windows(duration_ms: int, window_ms: int, max_windows: int) -> list[tuple[int, int]]:
    duration_ms = _bounded_integer("durationMs", duration_ms, 1, MAX_DURATION_MS)
    window_ms = _bounded_integer("windowMs", window_ms, 1, MAX_SAMPLE_WINDOW_MS)
    max_windows = _bounded_integer("maxWindows", max_windows, 1, MAX_SAMPLES_PER_RECORDING)
    total_windows = ceil(duration_ms / window_ms)

    if total_windows <= max_windows:
        indexes = list(range(total_windows))
    elif max_windows == 1:
        indexes = [0]
    else:
        indexes = [round(index * (total_windows - 1) / (max_windows - 1)) for index in range(max_windows)]

    return [
        (index * window_ms, min((index + 1) * window_ms, duration_ms))
        for index in indexes
    ]


def _require_object(name: str, value: Any, allowed_keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{name} must be an object")
    unexpected = set(value) - allowed_keys
    if unexpected:
        raise ContractError(f"{name} contains unsupported fields")
    return value


def _non_empty_string(name: str, value: Any, maximum_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    parsed = value.strip()
    if len(parsed) > maximum_length or "\x00" in parsed:
        raise ContractError(f"{name} is invalid")
    return parsed


def _bounded_integer(name: str, value: Any, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ContractError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


def _boolean(name: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{name} must be a boolean")
    return value
