"""Health/readiness endpoints. See docs/operations/monitoring-and-observability.md."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health(response: Response) -> dict[str, Any]:
    settings = get_settings()
    missing = settings.missing_configuration
    if missing:
        # Names only, never values. The process stays up so the rest of the site is
        # unaffected; every authenticated endpoint refuses until this is fixed.
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "misconfigured",
            "service": "backend",
            "env": settings.environment,
            "missing": missing,
        }
    return {"status": "ok", "service": "backend", "env": settings.environment}
