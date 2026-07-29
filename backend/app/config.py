"""The single environment/settings source for the backend (Pydantic Settings).

Application modules import `get_settings()` — they never call `os.getenv` or
`load_dotenv`. See root AGENTS.md and docs/security/secrets-and-environments.md.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # local | staging | production
    app_env: str = "local"

    # --- Supabase ---
    supabase_url: str = ""
    supabase_service_role_key: str = ""
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
    def is_production_like(self) -> bool:
        return self.app_env in {"staging", "production"}

    @model_validator(mode="after")
    def _require_secrets_outside_local(self) -> Settings:
        """Fail fast in staging/production if security-sensitive config is missing.

        No silent defaults for secrets in deployed environments; local/dev may
        run without them (e.g. for the health check and unit tests).
        """
        if self.is_production_like:
            missing = [
                name
                for name, value in {
                    "SUPABASE_URL": self.supabase_url,
                    "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
                    "SUPABASE_JWT_SECRET": self.supabase_jwt_secret,
                    "DATABASE_URL": self.database_url,
                }.items()
                if not value
            ]
            if missing:
                raise ValueError(
                    f"Missing required configuration for {self.app_env}: {', '.join(missing)}"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
