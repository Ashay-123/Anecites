from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bootstrap_diarization_model import ModelBootstrapError, parse_model_bootstrap_config


class ModelBootstrapTests(unittest.TestCase):
    def test_requires_an_explicit_token_and_pinned_revision(self) -> None:
        with self.assertRaisesRegex(ModelBootstrapError, "HF_TOKEN is required"):
            parse_model_bootstrap_config({})

        with self.assertRaisesRegex(ModelBootstrapError, "pinned commit SHA"):
            parse_model_bootstrap_config({
                "HF_TOKEN": "hf_test_token",
                "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION": "main",
            })

    def test_builds_a_fixed_offline_model_target(self) -> None:
        config = parse_model_bootstrap_config({
            "HF_TOKEN": "hf_test_token",
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION": "a" * 40,
        })

        self.assertEqual(config.repository_id, "pyannote/speaker-diarization-community-1")
        self.assertEqual(config.target_directory, Path("/models/pyannote/speaker-diarization-community-1"))
        self.assertEqual(config.revision, "a" * 40)


if __name__ == "__main__":
    unittest.main()
