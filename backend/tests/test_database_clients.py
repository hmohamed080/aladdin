"""Tests for the two sanctioned Supabase client boundaries (data access).

These prove the tenant-safety guardrails without any network call:
- a user-scoped client requires a caller token and forwards it (RLS preserved);
- the service-role client is a distinct, explicit path;
- both fail fast when their required configuration is missing.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.database import create_service_client, create_user_client

_CONFIGURED = Settings(
    _env_file=None,
    supabase_url="http://127.0.0.1:54321",
    supabase_anon_key="anon-key",
    supabase_service_role_key="service-role-key",
)


def test_user_client_requires_access_token() -> None:
    with pytest.raises(ValueError, match="caller access token"):
        create_user_client("", settings=_CONFIGURED)


def test_user_client_forwards_caller_jwt() -> None:
    client = create_user_client("caller-jwt-token", settings=_CONFIGURED)
    # The caller token is forwarded as the Authorization header so RLS runs under
    # the caller's identity (not the anon/service role).
    headers = client.options.headers
    assert headers.get("Authorization") == "Bearer caller-jwt-token"


def test_user_client_uses_anon_key_not_service_role() -> None:
    # A user-scoped client must authenticate with the PUBLIC anon key and never
    # silently fall back to the service role (which would bypass RLS).
    client = create_user_client("caller-jwt-token", settings=_CONFIGURED)
    assert client.supabase_key == "anon-key"
    assert client.supabase_key != _CONFIGURED.supabase_service_role_key


def test_service_client_uses_service_role_key() -> None:
    # The service client is the only place the service-role key is used, and only
    # via explicit create_service_client() invocation (trusted server path).
    client = create_service_client(settings=_CONFIGURED)
    assert client.supabase_key == "service-role-key"


def test_user_client_fails_fast_without_config() -> None:
    unconfigured = Settings(_env_file=None)
    with pytest.raises(RuntimeError, match="anon key"):
        create_user_client("some-token", settings=unconfigured)


def test_service_client_builds_with_service_role() -> None:
    client = create_service_client(settings=_CONFIGURED)
    assert client is not None


def test_service_client_fails_fast_without_service_role() -> None:
    unconfigured = Settings(_env_file=None, supabase_url="http://127.0.0.1:54321")
    with pytest.raises(RuntimeError, match="service-role key"):
        create_service_client(settings=unconfigured)
