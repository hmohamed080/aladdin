"""Deployed configuration: a Vercel deployment never runs as `local`, and a
misconfigured one stays up but closed (health 503, authenticated endpoints 503).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app import auth
from app.auth import Principal, require_active_principal
from app.config import Settings, get_settings
from app.main import API_PREFIX, create_app

CONFIG_VARS = (
    "APP_ENV",
    "VERCEL_ENV",
    "CLOUDFLARE_APPLICATION_ID",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "DATABASE_URL",
)


@pytest.mark.parametrize(
    ("app_env", "vercel_env", "expected"),
    [
        ("", "", "local"),
        ("local", "", "local"),
        ("staging", "", "staging"),
        ("", "production", "production"),
        ("", "preview", "staging"),
        ("", "development", "local"),
        # A deployment can never be talked down to `local`.
        ("local", "production", "production"),
        ("LOCAL", "preview", "staging"),
        # An explicit deployed value wins (e.g. a staging project on a Production deployment).
        ("staging", "production", "staging"),
        ("production", "preview", "production"),
        # Unknown VERCEL_ENV: fail closed.
        ("", "something-new", "production"),
    ],
)
def test_environment_is_derived_from_vercel_when_app_env_is_missing(
    app_env: str, vercel_env: str, expected: str
) -> None:
    settings = Settings(_env_file=None, app_env=app_env, vercel_env=vercel_env)
    assert settings.environment == expected


@pytest.mark.parametrize(
    ("app_env", "expected"),
    [
        # A Cloudflare container can never run as `local` either.
        ("", "production"),
        ("local", "production"),
        ("staging", "staging"),
        ("production", "production"),
    ],
)
def test_cloudflare_container_never_runs_as_local(app_env: str, expected: str) -> None:
    settings = Settings(_env_file=None, app_env=app_env, cloudflare_application_id="a1b2c3")
    assert settings.environment == expected
    assert settings.is_production_like


def test_cloudflare_container_without_app_env_still_checks_secrets() -> None:
    bare = Settings(_env_file=None, cloudflare_application_id="a1b2c3")
    assert bare.missing_configuration == ["SUPABASE_URL", "SUPABASE_ANON_KEY"]


@pytest.mark.parametrize("vercel_env", ["production", "preview"])
def test_deployed_without_app_env_still_checks_secrets(vercel_env: str) -> None:
    bare = Settings(_env_file=None, vercel_env=vercel_env)
    assert bare.is_production_like
    assert bare.missing_configuration == ["SUPABASE_URL", "SUPABASE_ANON_KEY"]

    ready = Settings(
        _env_file=None,
        vercel_env=vercel_env,
        supabase_url="https://ref.supabase.co",
        supabase_anon_key="anon",
    )
    assert ready.missing_configuration == []


def test_blank_values_count_as_missing() -> None:
    settings = Settings(
        _env_file=None, app_env="production", supabase_url="  ", supabase_anon_key="anon"
    )
    assert settings.missing_configuration == ["SUPABASE_URL"]


def test_unknown_app_env_is_a_configuration_error_held_to_deployed_rules() -> None:
    settings = Settings(_env_file=None, app_env="prod")
    assert settings.is_production_like
    assert settings.missing_configuration == ["APP_ENV", "SUPABASE_URL", "SUPABASE_ANON_KEY"]


def test_local_development_needs_nothing() -> None:
    assert Settings(_env_file=None, vercel_env="development").missing_configuration == []


@pytest.fixture
def deployed_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """A Production deployment with no APP_ENV and no secrets, as Vercel runs it today."""
    for name in CONFIG_VARS:
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("VERCEL_ENV", "production")
    get_settings.cache_clear()
    auth.get_token_verifier.cache_clear()
    yield monkeypatch
    get_settings.cache_clear()
    auth.get_token_verifier.cache_clear()


def _client() -> TestClient:
    app = create_app()  # must not raise: the rest of the site keeps working

    @app.get(f"{API_PREFIX}/probe")
    def probe(p: Annotated[Principal, Depends(require_active_principal)]) -> dict[str, str]:
        return {"user": p.user_id}

    return TestClient(app, raise_server_exceptions=True)


def test_misconfigured_deployment_starts_and_health_says_so(
    deployed_env: pytest.MonkeyPatch,
) -> None:
    deployed_env.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-value-must-not-leak")
    response = _client().get(f"{API_PREFIX}/health")
    assert response.status_code == 503
    assert response.json() == {
        "status": "misconfigured",
        "service": "backend",
        "env": "production",
        "missing": ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    }
    assert "service-role-value-must-not-leak" not in response.text


def test_misconfigured_deployment_refuses_authenticated_endpoints(
    deployed_env: pytest.MonkeyPatch,
) -> None:
    # 503 before any token verifier is built (SUPABASE_URL is missing, so building
    # one would raise): the check is ordered first, not merely present.
    response = _client().get(f"{API_PREFIX}/probe", headers={"Authorization": "Bearer x.y.z"})
    assert response.status_code == 503
    assert response.json() == {"detail": "service misconfigured"}


def test_configured_deployment_is_healthy(deployed_env: pytest.MonkeyPatch) -> None:
    deployed_env.setenv("SUPABASE_URL", "https://ref.supabase.co")
    deployed_env.setenv("SUPABASE_ANON_KEY", "anon")
    client = _client()
    health = client.get(f"{API_PREFIX}/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "backend", "env": "production"}
    # Configured, so the request reaches token verification and is refused there.
    assert client.get(f"{API_PREFIX}/probe").status_code == 401
