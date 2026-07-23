from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from anecites_media_inference.face_windows import summarize_face_landmarker_window


class FaceWindowSummaryTests(unittest.TestCase):
    def test_summarizes_face_landmarker_counts_without_retaining_landmarks(self) -> None:
        result = summarize_face_landmarker_window(
            10_000,
            20_000,
            [1, 2, 2, 0, 2],
        )

        self.assertEqual(
            result,
            {
                "faceCount": 2,
                "conditionSupport": 0.6,
                "detectorConfidence": None,
                "startedAtMs": 10_000,
                "endedAtMs": 20_000,
            },
        )


if __name__ == "__main__":
    unittest.main()
