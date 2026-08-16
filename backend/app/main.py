"""FastAPI application entrypoint for the Aladdin AI/document service.

Scope reminder (see backend/AGENTS.md): this service handles AI, OCR, RAG,
documents, embeddings, and workers — NOT the product's CRUD backend.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as api_v1_router
from app.config import get_settings

# Public path prefix this service is addressed by.
#
# The service is deployed as the `backend` Vercel Service (root vercel.json,
# ADR-0009), where `/api/backend(/.*)?` is rewritten to it. Vercel Services
# forwards the ORIGINAL request path — it does not strip the matched prefix —
# so the app genuinely receives `/api/backend/health` and its routes must be
# declared that way. (`root_path` is deliberately NOT used: that is for proxies
# that strip the prefix, which would leave these routes unreachable here.)
#
# Applied exactly once, at the single include below. Route modules keep their
# bare paths (`/health`); nothing else in the codebase repeats this string.
API_PREFIX = "/api/backend"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Aladdin AI/Document Service",
        version="0.1.0",
        description="Specialized AI, OCR, RAG, and document/worker service.",
        # Schema/docs live behind the same public prefix as the routes; left at
        # their defaults they would sit outside `/api/backend` and be swallowed
        # by the catch-all rewrite to Next.js.
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=f"{API_PREFIX}/redoc",
        # Not derived from docs_url by FastAPI — left at its default it would be
        # the one route sitting outside the prefix.
        swagger_ui_oauth2_redirect_url=f"{API_PREFIX}/docs/oauth2-redirect",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_v1_router, prefix=API_PREFIX)
    return app


app = create_app()
