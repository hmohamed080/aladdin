# Aladdin AI/document service — portable container.
#
# Two hosts build this image:
#   - Cloudflare Containers (ADR-0022): `edge/backend-worker` builds and deploys
#     it behind the `aladdin-backend` Worker. This is the migration target.
#   - Any other container host (the managed-container fallback in ADR-0022).
# Vercel still runs the same app as the `backend` Vercel Service (root
# vercel.json, ADR-0009) until the cutover; it does not use this file.
#
# Multi-stage: build deps with uv, run as a non-root user.

FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# uv for fast, locked dependency installs. Pinned (never `latest`) so an image
# rebuild cannot pick up a different installer; installed from PyPI so the build
# needs no second registry.
ARG UV_VERSION=0.11.32
RUN pip install --no-cache-dir "uv==${UV_VERSION}"

# --- dependencies layer (cached on lockfile) ---
FROM base AS deps
COPY pyproject.toml uv.lock ./
# Compile bytecode at build time. Without it every cold start compiles FastAPI,
# pydantic and friends from source: measured 41 s to ready on a 1/16-vCPU
# Cloudflare `lite` instance (ADR-0022), and wasted CPU on any host.
ENV UV_COMPILE_BYTECODE=1
RUN uv sync --frozen --no-dev

# --- runtime ---
FROM base AS runtime
RUN useradd --create-home --uid 10001 appuser
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY app ./app
# The app's own modules too; PYTHONDONTWRITEBYTECODE stops runtime writes only.
RUN python -m compileall -q app
USER appuser
EXPOSE 8000
# Routes live under /api/backend (app/main.py API_PREFIX); a bare /health is a 404.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/backend/health').status==200 else 1)"
# Cloudflare sends SIGTERM before replacing an instance on deploy; finish in-flight
# requests for up to 30 s, then exit.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "30"]
