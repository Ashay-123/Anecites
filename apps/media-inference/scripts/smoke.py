from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

import boto3
from botocore.config import Config


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    bucket = os.environ["MEDIA_INFERENCE_ALLOWED_BUCKETS"].split(",", 1)[0].strip()
    key = os.environ.get("MEDIA_INFERENCE_SMOKE_STORAGE_KEY", "smoke/media-inference-silence.mp4")
    endpoint = os.environ["S3_ENDPOINT"]
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        config=Config(s3={"addressing_style": "path"}),
    )
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)

    if args.cleanup:
        client.delete_object(Bucket=bucket, Key=key)
        print(json.dumps({"bucket": bucket, "key": key}))
        return

    descriptor, raw_path = tempfile.mkstemp(suffix=".mp4")
    os.close(descriptor)
    path = Path(raw_path)
    try:
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=4",
                "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-shortest", "-t", "4",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(path),
            ],
            check=True,
            timeout=30,
        )
        client.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": "video/mp4"})
        if args.prepare:
            print(json.dumps({"bucket": bucket, "key": key, "durationMs": 4_000}))
            return
        body = json.dumps({
            "version": 1,
            "recording": {
                "storageBucket": bucket,
                "storageKey": key,
                "contentType": "video/mp4",
                "durationMs": 4_000,
            },
            "sampling": {"windowMs": 4_000, "maxWindows": 1},
            "analyses": {
                "voiceActivity": True,
                "facePresence": True,
                "speakerDiarization": False,
            },
        }).encode("utf-8")
        request = urllib.request.Request(
            "http://127.0.0.1:8080/v1/analyze",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {os.environ['MEDIA_INFERENCE_AUTH_TOKEN']}",
                "Content-Type": "application/json",
            },
        )
        for _ in range(2):
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.load(response)
            assert result["voiceActivityWindows"] == [], result
            assert len(result["faceWindows"]) == 1, result
            assert result["faceWindows"][0]["faceCount"] == 0, result
            assert result["faceWindows"][0]["conditionSupport"] == 1, result
        print("Media inference smoke passed twice with real Silero VAD and MediaPipe Face Landmarker.")
    finally:
        path.unlink(missing_ok=True)
        if not args.prepare:
            try:
                client.delete_object(Bucket=bucket, Key=key)
            except Exception:
                pass


if __name__ == "__main__":
    main()
