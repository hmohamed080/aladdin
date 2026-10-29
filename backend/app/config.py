"""The single environment/settings source for the backend (Pydantic Settings).

Application modules import `get_settings()` — they never call `os.getenv` or
`load_dotenv`. See root AGENTS.md and docs/security/secrets-and-environments.md.
"""

from __future__ import annotations

import re
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The environments this service knows. Anything else is a configuration error.
ENVIRONMENTS = ("local", "staging", "production")
# Same rule as the web app's REDIS_KEY_ENV (frontend/src/lib/env/cache.ts).
_REDIS_KEY_ENV = re.compile(r"[a-z0-9-]{1,24}")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # APP_ENV: local | staging | production. Read through `environment`, which also
    # consults CLOUDFLARE_APPLICATION_ID so a deployment can never run as `local`.
    app_env: str = ""
    # Set by the Cloudflare Containers runtime in every container (ADR-0022); never
    # set by hand. Its presence alone means "deployed on Cloudflare".
    cloudflare_application_id: str = ""

    # --- Supabase ---
    supabase_url: str = ""
    # Public anon key — used for USER-scoped clients that preserve the caller JWT
    # (RLS applies). Public by exposure level, but read here like any other config.
    supabase_anon_key: str = ""
    # Service-role key — BYPASSES RLS. Trusted server/worker paths only.
    supabase_service_role_key: str = ""
    # Legacy HS256 secret; only needed while a project still signs with it.
    supabase_jwt_secret: str = ""
    database_url: str = ""

    # --- OpenAI ---
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"

    # --- Redis (optional; job locks and queue wake-ups, never authorization) ---
    # The same switch as the web app's (ADR-0019). Off by default, so Redis stays
    # unused in every environment until the owner accepts it there.
    redis_cache_enabled: bool = False
    # rediss:// (TLS) outside local; holds the password, so a secret. Unset or the
    # switch off: jobs run without a cross-process lock and the video worker polls.
    redis_url: str = ""
    # Key namespace (`aladdin:{env}:v1:...`). Required outside local while Redis is
    # on, so two deployments sharing one database never share keys.
    redis_key_env: str = ""

    @property
    def redis_active_url(self) -> str:
        """REDIS_URL while Redis is switched on, else empty (callers then skip Redis)."""
        return self.redis_url.strip() if self.redis_cache_enabled else ""

    @property
    def redis_namespace(self) -> str:
        return self.redis_key_env or self.environment

    # --- R2 (video worker only; the private bucket holding originals and HLS) ---
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_private_bucket: str = ""
    # S3-compatible stand-in for isolated local tests. Refused outside a local environment.
    r2_local_s3_endpoint: str = ""

    @property
    def r2_endpoint(self) -> str:
        if self.r2_local_s3_endpoint:
            return self.r2_local_s3_endpoint
        return (
            f"https://{self.r2_account_id}.r2.cloudflarestorage.com" if self.r2_account_id else ""
        )

    # --- Server ---
    # Comma-separated browser origins allowed to call the API (CORS).
    allowed_origins: str = "http://localhost:3000"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def environment(self) -> str:
        """The effective environment.

        A deployed service must never skip the secret check below. A Cloudflare
        container says nothing about its environment, so one without an explicit
        staging/production APP_ENV is production (fail closed; the backend Worker
        also refuses to start a container without APP_ENV, so this is the second lock).
        """
        explicit = self.app_env.strip().lower()
        if self.cloudflare_application_id.strip() and explicit in {"", "local"}:
            return "production"
        return explicit or "local"

    @property
    def is_production_like(self) -> bool:
        # Anything but an explicit, undeployed `local` is held to deployed rules.
        return self.environment != "local"

    @property
    def missing_configuration(self) -> list[str]:
        """Names (never values) of the variables this deployment still needs.

        Deployed (staging/production), the request path needs the project URL (JWT
        issuer and JWKS) and the anon key (the caller-scoped account and session
        check). The service-role key, DATABASE_URL and the legacy JWT secret are not
        on any deployed request path: the media jobs run from an operator machine
        or a worker host, and refuse on their own without the service-role key.

        A non-empty list does not stop the process. `/api/backend/health` reports
        it as `misconfigured` (503) and every authenticated endpoint refuses
        (`app.auth.require_configured`), so a bad deployment is visible and closed
        without taking the rest of the site with it.
        """
        missing: list[str] = []
        if self.environment not in ENVIRONMENTS:
            missing.append("APP_ENV")
        if self.is_production_like:
            required = {
                "SUPABASE_URL": self.supabase_url,
                "SUPABASE_ANON_KEY": self.supabase_anon_key,
            }
            missing += [name for name, value in required.items() if not value.strip()]
        return missing

    @model_validator(mode="after")
    def _local_storage_only_locally(self) -> Settings:
        # A deployed worker must never write video bytes to a test stand-in.
        if self.r2_local_s3_endpoint and self.environment != "local":
            raise ValueError("R2_LOCAL_S3_ENDPOINT is only allowed in local isolated tests")
        return self

    @model_validator(mode="after")
    def _redis_tls_and_namespace(self) -> Settings:
        if not self.redis_cache_enabled:
            return self
        if self.redis_key_env and not _REDIS_KEY_ENV.fullmatch(self.redis_key_env):
            raise ValueError("REDIS_KEY_ENV must match [a-z0-9-]{1,24}")
        if self.environment != "local" and not self.redis_key_env:
            raise ValueError("REDIS_KEY_ENV is required outside local when Redis is enabled")
        if not self.redis_url.strip():
            return self
        url = urlsplit(self.redis_url.strip())
        if url.scheme not in {"redis", "rediss"}:
            raise ValueError("REDIS_URL must be a redis:// or rediss:// URL")
        loopback = url.hostname in {"127.0.0.1", "localhost", "::1"}
        if self.environment != "local" and url.scheme != "rediss" and not loopback:
            # The URL carries the password: never send it in clear text.
            raise ValueError("Hosted Redis must use TLS (rediss://)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
