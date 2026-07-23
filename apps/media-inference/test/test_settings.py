from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from anecites_media_inference.settings import load_settings


def valid_env() -> dict[str, str]:
    return {
        "MEDIA_INFERENCE_AUTH_TOKEN": "test_media_inference_token_32_chars",
        "S3_ENDPOINT": "http://minio:9000",
        "S3_ACCESS_KEY_ID": "anecites",
        "S3_SECRET_ACCESS_KEY": "test_storage_secret_at_least_32_chars",
        "MEDIA_INFERENCE_ALLOWED_BUCKETS": "anecites-dev",
    }


class SettingsTests(unittest.TestCase):
    def test_loads_defaults_without_exposing_credentials(self) -> None:
        settings = load_settings(valid_env())
        self.assertEqual(settings.allowed_buckets, frozenset({"anecites-dev"}))
        self.assertEqual(settings.video_frames_per_window, 5)
        self.assertEqual(settings.vad_threshold, 0.5)
        self.assertEqual(settings.face_landmarker_model_path, "/models/face_landmarker.task")
        self.assertFalse(settings.speaker_diarization_enabled)
        self.assertIsNone(settings.speaker_diarization_model_revision)

    def test_loads_an_explicit_offline_speaker_diarization_runtime(self) -> None:
        env = valid_env()
        env.update({
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED": "true",
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_PATH": "/models/pyannote/community-1",
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION": "a" * 40,
        })

        settings = load_settings(env)

        self.assertTrue(settings.speaker_diarization_enabled)
        self.assertEqual(settings.speaker_diarization_model_path, "/models/pyannote/community-1")
        self.assertEqual(settings.speaker_diarization_model_revision, "a" * 40)

    def test_requires_a_pinned_revision_when_speaker_diarization_is_enabled(self) -> None:
        env = valid_env()
        env["MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED"] = "true"
        with self.assertRaisesRegex(ValueError, "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION is required"):
            load_settings(env)

        env["MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION"] = "main"
        with self.assertRaisesRegex(ValueError, "must be a pinned commit SHA"):
            load_settings(env)

    def test_rejects_short_secrets_and_invalid_bounds(self) -> None:
        env = valid_env()
        env["MEDIA_INFERENCE_AUTH_TOKEN"] = "short"
        with self.assertRaisesRegex(ValueError, "at least 32"):
            load_settings(env)

        env = valid_env()
        env["MEDIA_INFERENCE_VIDEO_FRAMES_PER_WINDOW"] = "21"
        with self.assertRaisesRegex(ValueError, "between 1 and 20"):
            load_settings(env)

        env = valid_env()
        env["MEDIA_INFERENCE_SPEAKER_DIARIZATION_ENABLED"] = "yes"
        with self.assertRaisesRegex(ValueError, "must be true or false"):
            load_settings(env)


if __name__ == "__main__":
    unittest.main()
