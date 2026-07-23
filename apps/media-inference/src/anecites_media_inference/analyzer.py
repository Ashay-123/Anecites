from __future__ import annotations

from array import array
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import wave
from typing import Iterator

import boto3
from botocore.config import Config
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

from .contract import AnalyzeRequest, RecordingReference, RecordingVerificationRequest, MAX_DURATION_MS, select_sample_windows
from .diarization import (
    DiarizationError,
    serialize_speaker_diarization_segments,
    verify_speaker_diarization_model_manifest,
)
from .face_windows import summarize_face_landmarker_window
from .settings import Settings


class InferenceError(RuntimeError):
    pass


class MediaAnalyzer:
    adapter_version = "mediapipe-face-landmarker-0.10.35_silero-vad-6.2.1_pyannote-audio-4.0.7"

    def __init__(self, settings: Settings):
        self._settings = settings
        self._s3 = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region,
            config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "virtual"}),
        )
        face_landmarker_options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=settings.face_landmarker_model_path),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=2,
            min_face_detection_confidence=settings.face_min_detection_confidence,
            min_face_presence_confidence=settings.face_min_detection_confidence,
            min_tracking_confidence=settings.face_min_detection_confidence,
        )
        self._face_landmarker = vision.FaceLandmarker.create_from_options(face_landmarker_options)
        self._vad_model = load_silero_vad()
        self._speaker_diarization_pipeline = self._load_speaker_diarization_pipeline(settings)
        self._analysis_lock = threading.Lock()

    def close(self) -> None:
        self._face_landmarker.close()

    def analyze(self, request: AnalyzeRequest) -> dict[str, object]:
        with self._analysis_lock:
            return self._analyze_locked(request)

    def verify_recording(self, request: RecordingVerificationRequest) -> dict[str, object]:
        with self._analysis_lock:
            with self._download_recording(request.recording) as media_path:
                return {
                    "version": 1,
                    "adapterVersion": self.adapter_version,
                    "durationMs": self._probe_duration_ms(media_path),
                    "byteSize": media_path.stat().st_size,
                }

    def _analyze_locked(self, request: AnalyzeRequest) -> dict[str, object]:
        with self._download_recording(request.recording) as media_path:
            actual_duration_ms = self._probe_duration_ms(media_path)

            response: dict[str, object] = {
                "version": 1,
                "adapterVersion": self.adapter_version,
                "voiceActivityWindows": [],
                "faceWindows": [],
                "speakerSegments": [],
            }
            if request.analyses.voice_activity:
                response["voiceActivityWindows"] = self._analyze_voice_activity(media_path)
            if request.analyses.face_presence:
                response["faceWindows"] = self._analyze_faces(media_path, actual_duration_ms, request)
            if request.analyses.speaker_diarization:
                response["speakerSegments"] = self._analyze_speaker_diarization(media_path)
            return response

    @contextmanager
    def _download_recording(self, recording: RecordingReference) -> Iterator[Path]:
        bucket = recording.storage_bucket
        if bucket not in self._settings.allowed_buckets:
            raise InferenceError("recording bucket is not allowed")

        metadata = self._s3.head_object(Bucket=bucket, Key=recording.storage_key)
        content_length = metadata.get("ContentLength")
        if not isinstance(content_length, int) or content_length < 1:
            raise InferenceError("recording object is empty")
        if content_length > self._settings.max_media_bytes:
            raise InferenceError("recording object exceeds the configured size limit")

        suffix = _safe_media_suffix(recording.content_type)
        descriptor, raw_path = tempfile.mkstemp(prefix="anecites-media-", suffix=suffix)
        os.close(descriptor)
        path = Path(raw_path)
        try:
            with path.open("wb") as output:
                self._s3.download_fileobj(bucket, recording.storage_key, output)
            if path.stat().st_size > self._settings.max_media_bytes:
                raise InferenceError("downloaded recording exceeds the configured size limit")
            yield path
        finally:
            path.unlink(missing_ok=True)

    def _probe_duration_ms(self, media_path: Path) -> int:
        result = _run_bounded(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(media_path),
            ],
            self._settings.processing_timeout_seconds,
        )
        try:
            duration_seconds = float(json.loads(result.stdout)["format"]["duration"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise InferenceError("recording duration could not be determined") from error
        duration_ms = round(duration_seconds * 1_000)
        if duration_ms < 1 or duration_ms > MAX_DURATION_MS:
            raise InferenceError("recording duration is outside the configured bounds")
        return duration_ms

    def _analyze_faces(
        self,
        media_path: Path,
        duration_ms: int,
        request: AnalyzeRequest,
    ) -> list[dict[str, object]]:
        capture = cv2.VideoCapture(str(media_path))
        if not capture.isOpened():
            raise InferenceError("recording video stream could not be opened")

        windows: list[dict[str, object]] = []
        try:
            for started_at_ms, ended_at_ms in select_sample_windows(
                duration_ms,
                request.sampling.window_ms,
                request.sampling.max_windows,
            ):
                frame_times = _frame_times(started_at_ms, ended_at_ms, self._settings.video_frames_per_window)
                face_counts: list[int] = []
                for frame_time_ms in frame_times:
                    capture.set(cv2.CAP_PROP_POS_MSEC, frame_time_ms)
                    read, frame = capture.read()
                    if not read:
                        continue
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    media_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                    detection = self._face_landmarker.detect(media_image)
                    face_counts.append(len(detection.face_landmarks))

                if not face_counts:
                    raise InferenceError("recording frames could not be decoded")
                windows.append(summarize_face_landmarker_window(started_at_ms, ended_at_ms, face_counts))
        finally:
            capture.release()
        return windows

    def _analyze_voice_activity(self, media_path: Path) -> list[dict[str, int]]:
        descriptor, raw_wav_path = tempfile.mkstemp(prefix="anecites-audio-", suffix=".wav")
        os.close(descriptor)
        wav_path = Path(raw_wav_path)
        try:
            _run_bounded(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(media_path),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    "-y",
                    str(wav_path),
                ],
                self._settings.processing_timeout_seconds,
            )
            audio = _read_pcm16_mono(wav_path)
            timestamps = get_speech_timestamps(
                audio,
                self._vad_model,
                threshold=self._settings.vad_threshold,
                sampling_rate=16_000,
                min_speech_duration_ms=self._settings.vad_min_speech_ms,
                return_seconds=False,
            )
            return [
                {
                    "startedAtMs": round(int(segment["start"]) * 1_000 / 16_000),
                    "endedAtMs": round(int(segment["end"]) * 1_000 / 16_000),
                }
                for segment in timestamps[:100]
            ]
        finally:
            wav_path.unlink(missing_ok=True)

    def _load_speaker_diarization_pipeline(self, settings: Settings) -> object | None:
        if not settings.speaker_diarization_enabled:
            return None

        model_path = Path(settings.speaker_diarization_model_path)
        if not model_path.is_dir():
            raise InferenceError("speaker diarization model is unavailable")

        try:
            if settings.speaker_diarization_model_revision is None:
                raise InferenceError("speaker diarization model revision is unavailable")
            verify_speaker_diarization_model_manifest(
                model_path,
                settings.speaker_diarization_model_revision,
            )
            from pyannote.audio import Pipeline

            return Pipeline.from_pretrained(str(model_path))
        except DiarizationError as error:
            raise InferenceError("speaker diarization model manifest is invalid") from error
        except Exception as error:
            raise InferenceError("speaker diarization model could not be loaded") from error

    def _analyze_speaker_diarization(self, media_path: Path) -> list[dict[str, object]]:
        if self._speaker_diarization_pipeline is None:
            raise InferenceError("speaker diarization is disabled")

        try:
            output = self._speaker_diarization_pipeline(str(media_path))
            return serialize_speaker_diarization_segments(
                (turn.start, turn.end, speaker)
                for turn, speaker in output.speaker_diarization
            )
        except DiarizationError as error:
            raise InferenceError("speaker diarization output is invalid") from error
        except Exception as error:
            raise InferenceError("speaker diarization failed") from error


def _safe_media_suffix(content_type: str) -> str:
    return {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/x-matroska": ".mkv",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }.get(content_type.lower(), ".media")


def _run_bounded(command: list[str], timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except (subprocess.SubprocessError, OSError) as error:
        raise InferenceError("bounded media extraction failed") from error


def _read_pcm16_mono(path: Path) -> torch.Tensor:
    with wave.open(str(path), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2 or wav_file.getframerate() != 16_000:
            raise InferenceError("extracted audio format is invalid")
        samples = array("h")
        samples.frombytes(wav_file.readframes(wav_file.getnframes()))
    if not samples:
        return torch.zeros(1, dtype=torch.float32)
    return torch.tensor(samples, dtype=torch.float32) / 32_768.0


def _frame_times(started_at_ms: int, ended_at_ms: int, count: int) -> list[int]:
    if count == 1:
        return [started_at_ms + max(0, ended_at_ms - started_at_ms - 1) // 2]
    span = max(0, ended_at_ms - started_at_ms - 1)
    return sorted({started_at_ms + round(index * span / (count - 1)) for index in range(count)})
