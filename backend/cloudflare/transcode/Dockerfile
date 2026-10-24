# Aladdin video transcode worker: Cloudflare Containers image (NOT deployed).
#
# A separate image from the FastAPI API container (backend/Dockerfile): no
# uvicorn, no port, ffmpeg installed, and the `video-worker` dependency group.
# It runs one drain (every claimable video, then the purge) and exits, so the
# container stops billing. See
# docs/architecture/video-transcode-cloudflare-containers.md.
#
# Build context: backend/ (wrangler.jsonc sets image_build_context "../..";
# backend/.dockerignore keeps .env files and tests out of the context).
# Secrets are never baked in: the Durable Object passes them as environment
# variables when it starts the container.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

FROM base AS deps
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --group video-worker

FROM base AS runtime
# Debian's ffmpeg carries libx264 and the native AAC encoder the worker uses.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 worker
COPY --from=deps /app/.venv /app/.venv
COPY app ./app
ENV PATH="/app/.venv/bin:$PATH" \
    TMPDIR=/tmp
USER worker
# Python is PID 1: video_transcode installs its own SIGTERM handler in --drain,
# which stops ffmpeg, releases the job and removes the temp files.
CMD ["python", "-m", "app.workers.video_transcode", "--drain"]
