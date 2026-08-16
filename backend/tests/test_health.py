"""Health, public-route-mounting, and configuration tests for the backend.

The routing tests pin the PUBLIC contract (`/api/backend/...`) that the Vercel
Services rewrite forwards unchanged — see ADR-0009 and `app.main.API_PREFIX`.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import API_PREFIX, app

client = TestClient(app)


def test_health_ok_on_public_prefixed_route() -> None:
    response = client.get(f"{API_PREFIX}/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "backend"


def test_public_prefix_is_the_expected_contract() -> None:
    # The deployed contract is /api/backend/<route>; the rewrite in vercel.json
    # forwards the original path, so this literal must not drift.
    assert API_PREFIX == "/api/backend"


def test_bare_route_is_not_served() -> None:
    # Proves ONE prefix mechanism, not two. If this ever returns 200 the app is
    # serving both /health and /api/backend/health, which means a route was
    # mounted outside the central include in app.api.v1.
    assert client.get("/health").status_code == 404


def test_prefix_is_not_doubled() -> None:
    # Guards the other failure mode: a router or endpoint that hardcodes the
    # prefix on top of the central include.
    assert client.get(f"{API_PREFIX}{API_PREFIX}/health").status_code == 404


def test_every_openapi_path_is_under_the_public_prefix() -> None:
    # Catches a future router included without the prefix, which would be
    # unreachable in deployment (the catch-all rewrite sends it to Next.js).
    paths = app.openapi()["paths"]
    assert paths, "expected at least one documented route"
    unprefixed = [p for p in paths if not p.startswith(f"{API_PREFIX}/")]
    assert unprefixed == [], f"routes mounted outside {API_PREFIX}: {unprefixed}"


def test_no_app_route_sits_outside_the_public_prefix() -> None:
    # Broader than the OpenAPI check: also covers the docs/redoc/oauth2-redirect
    # routes FastAPI adds itself, which are not part of the OpenAPI paths.
    outside = [
        path
        for route in app.routes
        if (path := getattr(route, "path", "")) and not path.startswith(API_PREFIX)
    ]
    assert outside == [], f"routes outside {API_PREFIX}: {outside}"


def test_schema_and_docs_are_behind_the_public_prefix() -> None:
    # Defaults (/openapi.json, /docs) would fall outside /api/backend and be
    # routed to Next.js instead of reaching this service.
    assert app.openapi_url == f"{API_PREFIX}/openapi.json"
    assert app.docs_url == f"{API_PREFIX}/docs"
    assert client.get(app.openapi_url).status_code == 200


def test_settings_default_env_is_local() -> None:
    settings = Settings(_env_file=None)
    assert settings.app_env == "local"
    assert settings.allowed_origins_list == ["http://localhost:3000"]


def test_settings_fail_fast_in_production_without_secrets() -> None:
    import pytest

    with pytest.raises(ValueError, match="Missing required configuration"):
        Settings(_env_file=None, app_env="production")
