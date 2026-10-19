"""The single environment/settings source for the backend (Pydantic Settings).

Application modules import `get_settings()` — they never call `os.getenv` or
`load_dotenv`. See root AGENTS.md and docs/security/secrets-and-environments.md.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# The environments this service knows. Anything else is a configuration error.
ENVIRONMENTS = ("local", "staging", "production")
# Vercel sets VERCEL_ENV on every deployment. A Preview deployment is staging.
_FROM_VERCEL = {"production": "production", "preview": "staging", "development": "local"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # APP_ENV: local | staging | production. Read through `environment`, which also
    # consults VERCEL_ENV so a deployment can never run as `local`.
    app_env: str = ""
    # Set by Vercel itself (production | preview | development); never set by hand.
    vercel_env: str = ""

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

    # --- Server ---
    # Comma-separated browser origins allowed to call the API (CORS).
    allowed_origins: str = "http://localhost:3000"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def environment(self) -> str:
        """The effective environment.

        On a Vercel deployment VERCEL_ENV decides whenever APP_ENV is unset or says
        `local`: a deployed service must never skip the secret check below. An
        unknown VERCEL_ENV counts as production (fail closed).
        """
        explicit = self.app_env.strip().lower()
        vercel = self.vercel_env.strip().lower()
        deployed = _FROM_VERCEL.get(vercel, "production") if vercel else None
        if deployed in {"staging", "production"} and explicit in {"", "local"}:
            return deployed
        return explicit or deployed or "local"

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
