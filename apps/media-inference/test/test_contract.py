from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from anecites_media_inference.contract import (
    ContractError,
    parse_analyze_request,
    parse_recording_verification_request,
    select_sample_windows,
)


def valid_request() -> dict[str, object]:
    return {
        "version": 1,
        "recording": {
            "storageBucket": "anecites-dev",
            "storageKey": "recordings/session-1.mp4",
            "contentType": "video/mp4",
            "durationMs": 60_000,
        },
        "sampling": {"windowMs": 10_000, "maxWindows": 4},
        "analyses": {
            "voiceActivity": True,
            "facePresence": True,
            "speakerDiarization": False,
        },
    }


class ContractTests(unittest.TestCase):
    def test_parses_bounded_object_reference_request(self) -> None:
        request = parse_analyze_request(valid_request())
        self.assertEqual(request.recording.storage_key, "recordings/session-1.mp4")
        self.assertEqual(request.sampling.max_windows, 4)
        self.assertTrue(request.analyses.voice_activity)

    def test_rejects_raw_media_credentials_and_unbounded_values(self) -> None:
        for field in ("rawMedia", "accessKey", "secretAccessKey"):
            payload = valid_request()
            payload[field] = "must-not-be-accepted"
            with self.assertRaisesRegex(ContractError, "unsupported fields"):
                parse_analyze_request(payload)

        payload = valid_request()
        payload["sampling"] = {"windowMs": 60_001, "maxWindows": 4}
        with self.assertRaisesRegex(ContractError, "sampling.windowMs"):
            parse_analyze_request(payload)

    def test_requires_at_least_one_analysis(self) -> None:
        payload = valid_request()
        payload["analyses"] = {
            "voiceActivity": False,
            "facePresence": False,
            "speakerDiarization": False,
        }
        with self.assertRaisesRegex(ContractError, "at least one analysis"):
            parse_analyze_request(payload)

    def test_accepts_explicit_speaker_diarization_without_raw_audio(self) -> None:
        payload = valid_request()
        payload["analyses"] = {
            "voiceActivity": False,
            "facePresence": False,
            "speakerDiarization": True,
        }

        request = parse_analyze_request(payload)

        self.assertTrue(request.analyses.speaker_diarization)

    def test_selects_evenly_distributed_bounded_windows(self) -> None:
        self.assertEqual(
            select_sample_windows(100_000, 10_000, 4),
            [(0, 10_000), (30_000, 40_000), (60_000, 70_000), (90_000, 100_000)],
        )
        self.assertEqual(select_sample_windows(4_000, 10_000, 4), [(0, 4_000)])

    def test_parses_recording_verification_without_media_analysis_options(self) -> None:
        payload = valid_request()
        request = parse_recording_verification_request({
            "version": 1,
            "recording": payload["recording"],
        })
        self.assertEqual(request.recording.storage_bucket, "anecites-dev")

    def test_rejects_unexpected_recording_verification_fields(self) -> None:
        payload = valid_request()
        with self.assertRaisesRegex(ContractError, "unsupported fields"):
            parse_recording_verification_request({
                "version": 1,
                "recording": payload["recording"],
                "rawMedia": "must-not-be-accepted",
            })


if __name__ == "__main__":
    unittest.main()
