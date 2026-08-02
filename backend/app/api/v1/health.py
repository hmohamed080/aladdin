"""Health/readiness endpoints. See docs/operations/monitoring-and-observability.md."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {"status": "ok", "service": "backend", "env": settings.app_env}
