"""Minimal health + configuration tests for the backend service."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app

client = TestClient(app)


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "backend"


def test_settings_default_env_is_local() -> None:
    settings = Settings(_env_file=None)
    assert settings.app_env == "local"
    assert settings.allowed_origins_list == ["http://localhost:3000"]


def test_settings_fail_fast_in_production_without_secrets() -> None:
    import pytest

    with pytest.raises(ValueError, match="Missing required configuration"):
        Settings(_env_file=None, app_env="production")
