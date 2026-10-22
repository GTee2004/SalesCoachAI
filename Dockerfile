# ---- Stage 1: Build ----
FROM python:3.11-slim AS builder

WORKDIR /app

# A venv outside /root, so the non-root runtime user can read it
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Stage 2: Production ----
FROM python:3.11-slim

WORKDIR /app

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

# Security: run as non-root user
RUN useradd -m appuser

COPY --from=builder /opt/venv /opt/venv

# Application code only; .dockerignore keeps out tests, frontend and secrets
COPY --chown=appuser:appuser src ./src

USER appuser

# ai-coustics Voice Focus downloads its model here; compose mounts a volume
RUN mkdir -p /home/appuser/.cache/pipecat

EXPOSE 8000

# Ready turns false while shutting down, not just when the process is up
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('APP_PORT', '8000')}/health/ready\")" || exit 1

# One worker: the session registry and nonce store live in process memory.
# APP_HOST and APP_PORT let host networking bind loopback behind the reverse proxy.
CMD ["sh", "-c", "exec uvicorn src.main:app --host \"${APP_HOST:-0.0.0.0}\" --port \"${APP_PORT:-8000}\" --workers 1 --timeout-graceful-shutdown 45"]
