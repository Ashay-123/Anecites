from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import secrets
from typing import AsyncIterator

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .analyzer import InferenceError, MediaAnalyzer
from .contract import ContractError, parse_analyze_request, parse_recording_verification_request
from .settings import Settings, load_settings


def create_app(settings: Settings | None = None, analyzer: MediaAnalyzer | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.analyzer = analyzer or await asyncio.to_thread(MediaAnalyzer, resolved_settings)
        try:
            yield
        finally:
            await asyncio.to_thread(application.state.analyzer.close)

    application = FastAPI(
        title="Anecites Media Inference",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @application.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "capabilities": {
                "voiceActivity": True,
                "facePresence": True,
                "faceLandmarks": True,
                "speakerDiarization": resolved_settings.speaker_diarization_enabled,
                "gazeOffscreen": False,
            },
        }

    @application.post("/v1/analyze")
    async def analyze(payload: dict[str, object], authorization: str | None = Header(default=None)) -> object:
        expected = f"Bearer {resolved_settings.auth_token}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            request = parse_analyze_request(payload)
            return await asyncio.wait_for(
                asyncio.to_thread(application.state.analyzer.analyze, request),
                timeout=resolved_settings.processing_timeout_seconds,
            )
        except ContractError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except asyncio.TimeoutError as error:
            raise HTTPException(status_code=504, detail="Media analysis timed out") from error
        except InferenceError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @application.post("/v1/recording-verification")
    async def verify_recording(payload: dict[str, object], authorization: str | None = Header(default=None)) -> object:
        expected = f"Bearer {resolved_settings.auth_token}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            request = parse_recording_verification_request(payload)
            return await asyncio.wait_for(
                asyncio.to_thread(application.state.analyzer.verify_recording, request),
                timeout=resolved_settings.processing_timeout_seconds,
            )
        except ContractError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except asyncio.TimeoutError as error:
            raise HTTPException(status_code=504, detail="Recording verification timed out") from error
        except InferenceError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @application.exception_handler(Exception)
    async def unexpected_error(_request: object, _error: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Media analysis failed"})

    return application


app = create_app()
