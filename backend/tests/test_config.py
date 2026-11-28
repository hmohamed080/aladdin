"""Deployed configuration: a Cloudflare container never runs as `local`, and a
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
    "CLOUDFLARE_APPLICATION_ID",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "DATABASE_URL",
)


@pytest.mark.parametrize(
    ("app_env", "expected"),
    [
        ("", "local"),
        ("local", "local"),
        ("LOCAL", "local"),
        ("staging", "staging"),
        ("production", "production"),
    ],
)
def test_environment_outside_a_container_is_app_env_or_local(app_env: str, expected: str) -> None:
    assert Settings(_env_file=None, app_env=app_env).environment == expected


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
    assert bare.is_production_like
    assert bare.missing_configuration == ["SUPABASE_URL", "SUPABASE_ANON_KEY"]

    ready = Settings(
        _env_file=None,
        cloudflare_application_id="a1b2c3",
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
    assert Settings(_env_file=None).missing_configuration == []


@pytest.fixture
def deployed_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """A Cloudflare container with no APP_ENV and no secrets."""
    for name in CONFIG_VARS:
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("CLOUDFLARE_APPLICATION_ID", "a1b2c3")
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
