FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    MPLCONFIGDIR=/tmp/matplotlib \
    XDG_CACHE_HOME=/tmp/cache \
    HF_HOME=/tmp/huggingface \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYANNOTE_METRICS_ENABLED=0

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libegl1 libglib2.0-0 libgl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.9.1 \
      torchaudio==2.9.1

WORKDIR /app
COPY apps/media-inference/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

ARG FACE_LANDMARKER_MODEL_URL=https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
ARG FACE_LANDMARKER_MODEL_SHA256=64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
RUN mkdir -p /models \
    && python -c "import hashlib, urllib.request; url='${FACE_LANDMARKER_MODEL_URL}'; expected='${FACE_LANDMARKER_MODEL_SHA256}'; path='/models/face_landmarker.task'; urllib.request.urlretrieve(url, path); actual=hashlib.sha256(open(path, 'rb').read()).hexdigest(); assert actual == expected, f'model checksum mismatch: {actual}'"

COPY apps/media-inference/src ./src
COPY apps/media-inference/scripts ./scripts

RUN useradd --create-home --uid 10001 inference \
    && chown -R inference:inference /app /models
USER inference

EXPOSE 8080
CMD ["python", "-m", "uvicorn", "anecites_media_inference.app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
