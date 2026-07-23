import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from anecites_media_inference.diarization import (
    DiarizationError,
    create_speaker_diarization_model_manifest,
    parse_speaker_diarization_model_manifest,
    serialize_speaker_diarization_segments,
)


class DiarizationTests(unittest.TestCase):
    def test_serializes_bounded_segments_without_model_specific_objects(self) -> None:
        result = serialize_speaker_diarization_segments(
            [
                (0.125, 2.875, "SPEAKER_00"),
                (3.25, 6.0, "SPEAKER_01"),
            ],
        )

        self.assertEqual(
            result,
            [
                {"speakerId": "SPEAKER_00", "startedAtMs": 125, "endedAtMs": 2875},
                {"speakerId": "SPEAKER_01", "startedAtMs": 3250, "endedAtMs": 6000},
            ],
        )

    def test_rejects_invalid_or_unbounded_segments(self) -> None:
        with self.assertRaisesRegex(DiarizationError, "must end after"):
            serialize_speaker_diarization_segments([(1.0, 1.0, "speaker")])

        with self.assertRaisesRegex(DiarizationError, "cannot exceed 100"):
            serialize_speaker_diarization_segments(
                [(float(index), float(index + 1), "speaker") for index in range(101)],
            )

    def test_verifies_the_pinned_bootstrap_manifest_before_model_load(self) -> None:
        revision = "a" * 40
        manifest = json.dumps(create_speaker_diarization_model_manifest(revision))

        parse_speaker_diarization_model_manifest(manifest, revision)

        with self.assertRaisesRegex(DiarizationError, "does not match"):
            parse_speaker_diarization_model_manifest(manifest, "b" * 40)

        with self.assertRaisesRegex(DiarizationError, "is invalid"):
            parse_speaker_diarization_model_manifest("{}", revision)


if __name__ == "__main__":
    unittest.main()
