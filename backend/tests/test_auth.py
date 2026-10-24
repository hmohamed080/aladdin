"""Authorization tests for the backend's Supabase token verification.

Tokens are signed here with throwaway keys; no network call is made. They prove
that only a valid, unexpired `authenticated` session from this project passes,
and that identity comes from the verified token alone.
"""

from __future__ import annotations

import time
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app import auth
from app.auth import InvalidToken, Principal, TokenVerifier, require_principal
from app.config import Settings, get_settings

URL = "http://127.0.0.1:54321"
ISSUER = f"{URL}/auth/v1"
SETTINGS = Settings(
    _env_file=None, supabase_url=URL, supabase_jwt_secret="legacy-shared-secret-of-32-bytes!"
)
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


class _Jwks:
    """Stands in for PyJWKClient: knows exactly one key id."""

    def get_signing_key_from_jwt(self, token: str) -> Any:
        if jwt.get_unverified_header(token).get("kid") != "k1":
            raise jwt.PyJWKClientError("unknown kid")
        return type("K", (), {"key": KEY.public_key()})()


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims = {
        "sub": "70000009-0000-4000-8000-000000000009",
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "session_id": "e9000000-0000-4000-8000-000000000001",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _es256(claims: dict[str, Any], key: Any = KEY, kid: str = "k1") -> str:
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": kid})


VERIFIER = TokenVerifier(SETTINGS, jwks_client=_Jwks())  # type: ignore[arg-type]


def test_valid_es256_session_yields_the_token_identity() -> None:
    p = VERIFIER.verify(_es256(_claims()))
    assert p.user_id == "70000009-0000-4000-8000-000000000009"
    assert p.session_id == "e9000000-0000-4000-8000-000000000001"


def test_token_is_never_printed_with_the_principal() -> None:
    token = _es256(_claims())
    assert token not in repr(VERIFIER.verify(token))


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(_es256(_claims(exp=int(time.time()) - 60)), id="expired"),
        pytest.param(_es256(_claims(aud="other")), id="wrong-audience"),
        pytest.param(_es256(_claims(iss="https://evil.example/auth/v1")), id="other-project"),
        pytest.param(_es256(_claims(role="anon")), id="anon-key"),
        pytest.param(_es256(_claims(role="service_role")), id="service-role"),
        pytest.param(_es256(_claims(sub=None)), id="no-subject"),
        pytest.param(_es256(_claims(), key=OTHER_KEY), id="forged-signature"),
        pytest.param(_es256(_claims(), kid="unknown"), id="unknown-kid"),
        pytest.param(
            jwt.encode(_claims(), "not-the-secret-but-long-enough-32b", algorithm="HS256"),
            id="hs256-wrong",
        ),
        pytest.param("not.a.jwt", id="malformed"),
    ],
)
def test_invalid_tokens_are_refused(token: str) -> None:
    with pytest.raises(InvalidToken):
        VERIFIER.verify(token)


def test_none_algorithm_is_refused() -> None:
    token = jwt.encode(_claims(), key=None, algorithm="none")
    with pytest.raises(InvalidToken):
        VERIFIER.verify(token)


def test_legacy_hs256_secret_still_verifies() -> None:
    token = jwt.encode(_claims(), SETTINGS.supabase_jwt_secret, algorithm="HS256")
    assert VERIFIER.verify(token).user_id.startswith("70000009")


def test_hs256_is_refused_without_a_configured_secret() -> None:
    verifier = TokenVerifier(Settings(_env_file=None, supabase_url=URL), jwks_client=_Jwks())  # type: ignore[arg-type]
    token = jwt.encode(_claims(), "legacy-shared-secret-of-32-bytes!", algorithm="HS256")
    with pytest.raises(InvalidToken):
        verifier.verify(token)


def _app() -> TestClient:
    app = FastAPI()

    @app.get("/who")
    def who(p: Annotated[Principal, Depends(require_principal)]) -> dict[str, str]:
        return {"user": p.user_id}

    @app.get("/active")
    def active(p: Annotated[Principal, Depends(auth.require_active_principal)]) -> dict[str, str]:
        return {"user": p.user_id}

    app.dependency_overrides[auth.get_token_verifier] = lambda: VERIFIER
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    return TestClient(app)


def test_dependency_requires_a_bearer_token() -> None:
    client = _app()
    assert client.get("/who").status_code == 401
    assert client.get("/who", headers={"Authorization": "Basic abc"}).status_code == 401
    r = client.get("/who", headers={"Authorization": f"Bearer {_es256(_claims())}"})
    assert r.status_code == 200 and r.json() == {"user": "70000009-0000-4000-8000-000000000009"}
    assert (
        client.get("/who", headers={"Authorization": "Bearer junk"}).headers["www-authenticate"]
        == "Bearer"
    )


def test_suspended_account_is_refused_on_the_next_request(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _app()
    headers = {"Authorization": f"Bearer {_es256(_claims())}"}
    monkeypatch.setattr(auth, "account_is_active", lambda p: True)
    assert client.get("/active", headers=headers).status_code == 200
    monkeypatch.setattr(auth, "account_is_active", lambda p: False)
    assert client.get("/active", headers=headers).status_code == 401


@pytest.mark.parametrize(
    ("status", "active"),
    [
        ({"status": "active", "suspended": False, "session_active": True}, True),
        ({"status": "active", "suspended": False}, True),
        ({"status": "active", "suspended": False, "session_active": False}, False),
        ({"status": "suspended", "suspended": True, "session_active": True}, False),
        (None, False),
    ],
)
def test_account_is_active_reads_suspension_and_session(
    monkeypatch: pytest.MonkeyPatch, status: dict[str, Any] | None, active: bool
) -> None:
    class _Rpc:
        def execute(self) -> Any:
            return type("R", (), {"data": status})()

    class _Client:
        def rpc(self, name: str) -> _Rpc:
            assert name == "my_account_status"
            return _Rpc()

    monkeypatch.setattr(auth, "create_user_client", lambda token: _Client())
    principal = VERIFIER.verify(_es256(_claims()))
    assert auth.account_is_active(principal) is active
