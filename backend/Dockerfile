# Aladdin AI/document service — portable container.
#
# NOT the deployment path: the service ships as the `backend` Vercel Service
# (root vercel.json, Python runtime, entrypoint app/main.py) per ADR-0009.
# This Dockerfile is retained DELIBERATELY as the portability exit path — it
# keeps a move to any container host a config change rather than a rewrite,
# and CI still builds it. Do not delete it as "unused".
#
# Multi-stage: build deps with uv, run as a non-root user.

FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# uv for fast, locked dependency installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# --- dependencies layer (cached on lockfile) ---
FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# --- runtime ---
FROM base AS runtime
RUN useradd --create-home --uid 10001 appuser
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY app ./app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
