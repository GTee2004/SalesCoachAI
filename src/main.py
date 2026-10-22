from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import get_settings
from src.salescoach_voice.api import router as voice_router
from src.salescoach_voice.middleware import VoiceOriginMiddleware
from src.salescoach_voice.runtime import voice_lifespan


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    print(f"Starting {settings.app_name} in {settings.app_env} mode")
    try:
        async with voice_lifespan(app):
            yield
    finally:
        print("Shutting down...")


app = FastAPI(
    title="SalesCoach AI",
    description="Voice practice backend for SalesCoach AI",
    version="1.0.0",
    lifespan=lifespan,
    # FastAPI's native OpenTelemetry would export a span for every HTTP request
    # (health checks, /internal/* polling) through the Langfuse tracer provider, and
    # would parent the voice pipeline's conversation span under the /api/offer request.
    # Langfuse traces should come from the voice pipeline only.
    telemetry={"tracing": False},
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(VoiceOriginMiddleware)

app.include_router(voice_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
