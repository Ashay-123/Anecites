from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import tempfile

from anecites_media_inference.diarization import (
    SPEAKER_DIARIZATION_MODEL_REPOSITORY_ID,
    create_speaker_diarization_model_manifest,
)


MODEL_TARGET_DIRECTORY = Path("/models/pyannote/speaker-diarization-community-1")


class ModelBootstrapError(ValueError):
    pass


@dataclass(frozen=True)
class ModelBootstrapConfig:
    token: str
    revision: str
    repository_id: str
    target_directory: Path


def parse_model_bootstrap_config(env: dict[str, str] | None = None) -> ModelBootstrapConfig:
    values = os.environ if env is None else env
    token = values.get("HF_TOKEN", "").strip()
    if not token:
        raise ModelBootstrapError("HF_TOKEN is required to download the speaker diarization model")

    revision = values.get("MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION", "").strip().lower()
    if not re_fullmatch_pinned_revision(revision):
        raise ModelBootstrapError(
            "MEDIA_INFERENCE_SPEAKER_DIARIZATION_MODEL_REVISION must be a pinned commit SHA",
        )

    return ModelBootstrapConfig(
        token=token,
        revision=revision,
        repository_id=SPEAKER_DIARIZATION_MODEL_REPOSITORY_ID,
        target_directory=MODEL_TARGET_DIRECTORY,
    )


def bootstrap_model(config: ModelBootstrapConfig) -> None:
    target = config.target_directory
    if target.exists() and any(target.iterdir()):
        raise ModelBootstrapError("speaker diarization model target already contains files")

    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".speaker-diarization-", dir=target.parent))
    try:
        _download_model(config, staging)
        _verify_model_loads(staging)
        manifest = create_speaker_diarization_model_manifest(config.revision)
        (staging / ".anecites-model-manifest.json").write_text(
            json.dumps(manifest, separators=(",", ":")),
            encoding="utf-8",
        )
        staging.replace(target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _download_model(config: ModelBootstrapConfig, target: Path) -> None:
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=config.repository_id,
            revision=config.revision,
            local_dir=str(target),
            token=config.token,
        )
    except Exception as error:
        raise ModelBootstrapError("speaker diarization model download failed") from error


def _verify_model_loads(target: Path) -> None:
    try:
        from pyannote.audio import Pipeline

        Pipeline.from_pretrained(str(target))
    except Exception as error:
        raise ModelBootstrapError("speaker diarization model verification failed") from error


def re_fullmatch_pinned_revision(revision: str) -> bool:
    return len(revision) == 40 and all(character in "0123456789abcdef" for character in revision)


def main() -> None:
    config = parse_model_bootstrap_config()
    bootstrap_model(config)
    print(json.dumps({"repositoryId": config.repository_id, "revision": config.revision}))


if __name__ == "__main__":
    main()
