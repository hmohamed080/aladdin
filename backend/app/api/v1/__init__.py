"""v1 API surface — the single aggregation point for every v1 router.

Route modules (`app.api.v1.*`) declare their own bare paths (`/health`), and
this module is the ONLY place they are collected. `app.main` then mounts this
one router under the public service prefix, so the `/api/backend` prefix is
applied exactly once, in exactly one place.

Add new routers here — never with a hardcoded `/api/backend` on the router or
on an individual endpoint. See `app.main.API_PREFIX`.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.health import router as health_router

router = APIRouter()
router.include_router(health_router)
