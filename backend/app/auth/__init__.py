"""Supabase JWT verification and request identity.

Every backend request that acts for a person carries that person's Supabase
access token. `TokenVerifier` checks it locally against the project's signing
keys (JWKS for the asymmetric ES256/RS256 keys, the legacy shared secret only
for HS256), so no Supabase Auth round trip is spent per request. FastAPI
dependencies:

- `require_configured`: refuses with 503 while the deployment is missing
  configuration (`Settings.missing_configuration`); every endpoint that acts for
  a person or runs a job depends on it, directly or through the two below;
- `require_principal`: a valid, unexpired `authenticated` token;
- `require_active_principal`: additionally asks the database, as the caller,
  whether the account is still active and the session still live
  (`my_account_status`). Suspension, sign-out, bans and deletion are database
  facts, so they apply on the next request even while the JWT lives.

Identity is only ever taken from the verified token, never from a request body.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings
from app.database import create_user_client

_ASYMMETRIC = ("ES256", "RS256")


class InvalidToken(Exception):
    """The token is missing, malformed, expired, forged or not a user session."""


@dataclass(frozen=True)
class Principal:
    user_id: str
    session_id: str | None
    expires_at: int
    access_token: str = field(repr=False)


class TokenVerifier:
    def __init__(self, settings: Settings, jwks_client: jwt.PyJWKClient | None = None) -> None:
        if not settings.supabase_url:
            raise RuntimeError("SUPABASE_URL is not configured; cannot verify access tokens.")
        base = settings.supabase_url.rstrip("/")
        self._issuer = f"{base}/auth/v1"
        self._secret = settings.supabase_jwt_secret
        # PyJWKClient caches the key set and refetches it for an unknown `kid`,
        # which is how Supabase key rotation reaches this service.
        self._jwks = jwks_client or jwt.PyJWKClient(
            f"{self._issuer}/.well-known/jwks.json", cache_keys=True, lifespan=600, timeout=5
        )

    def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            key: Any
            if algorithm in _ASYMMETRIC:
                key = self._jwks.get_signing_key_from_jwt(token).key
            elif algorithm == "HS256" and self._secret:
                key = self._secret
            else:
                raise InvalidToken("unsupported signing algorithm")
            claims = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience="authenticated",
                issuer=self._issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
                leeway=5,
            )
        except InvalidToken:
            raise
        except (jwt.PyJWTError, ValueError, KeyError) as exc:
            raise InvalidToken(type(exc).__name__) from exc
        if claims.get("role") != "authenticated":
            raise InvalidToken("not a user session")
        session = claims.get("session_id")
        return Principal(
            user_id=str(claims["sub"]),
            session_id=str(session) if session else None,
            expires_at=int(claims["exp"]),
            access_token=token,
        )


@lru_cache
def get_token_verifier() -> TokenVerifier:
    return TokenVerifier(get_settings())


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_configured(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    if settings.missing_configuration:
        # The variable names are on /api/backend/health; nothing more is said here.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="service misconfigured"
        )


def require_principal(
    # Declared first: FastAPI resolves dependencies in order, so a misconfigured
    # deployment answers 503 before a token verifier is ever built.
    _configured: Annotated[None, Depends(require_configured)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    try:
        return verifier.verify(token.strip())
    except InvalidToken:
        raise _unauthorized() from None


def account_is_active(principal: Principal) -> bool:
    """The database decides, as the caller (RLS and auth.uid() apply)."""
    result = create_user_client(principal.access_token).rpc("my_account_status").execute()
    data = result.data
    # Mirrors app.account_is_active (every status except suspended/deactivated) and
    # app.jwt_session_is_live (the session was not signed out, banned or deleted).
    return (
        isinstance(data, dict)
        and data.get("suspended") is False
        and data.get("session_active") is not False
    )


def require_active_principal(
    principal: Annotated[Principal, Depends(require_principal)],
) -> Principal:
    if not account_is_active(principal):
        # Same answer as a bad token: a suspended account learns nothing more.
        raise _unauthorized()
    return principal
