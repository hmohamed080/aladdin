"""FastAPI application entrypoint for the Aladdin AI/document service.

Scope reminder (see backend/AGENTS.md): this service handles AI, OCR, RAG,
documents, embeddings, and workers — NOT the product's CRUD backend.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.health import router as health_router
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Aladdin AI/Document Service",
        version="0.1.0",
        description="Specialized AI, OCR, RAG, and document/worker service.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    return app


app = create_app()
