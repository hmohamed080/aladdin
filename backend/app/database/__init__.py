"""Supabase (supabase-py) data access; read/write of migration-owned tables.

Python data access uses `supabase-py` (ADR-0005): user-facing operations
preserve the caller's JWT so RLS applies; service-role access is limited to
trusted workers and explicitly authorized operations. The schema is owned by
`supabase/migrations` — this layer never creates or alters it (ADR-0002).
Complex operations use PostgreSQL functions/RPC. SQLAlchemy is deferred.

See backend/AGENTS.md. This module provides the two sanctioned client
boundaries; capability modules build on them and never call `create_client`
directly.
"""

from __future__ import annotations

from supabase import Client, ClientOptions, create_client

from app.config import Settings, get_settings


def create_user_client(access_token: str, settings: Settings | None = None) -> Client:
    """A Supabase client scoped to the CALLER, preserving their JWT so RLS applies.

    This is the default for any user-facing request. The client authenticates with
    the public anon key and forwards the verified caller token as the Authorization
    header, so every query runs under the caller's `authenticated` identity and
    Postgres RLS enforces tenant isolation — the service never gains cross-tenant
    reach. Never pass the service role here.
    """
    s = settings or get_settings()
    if not s.supabase_url or not s.supabase_anon_key:
        raise RuntimeError(
            "Supabase URL/anon key are not configured; cannot build a user-scoped client."
        )
    if not access_token:
        raise ValueError("A caller access token is required for a user-scoped client.")
    return create_client(
        s.supabase_url,
        s.supabase_anon_key,
        options=ClientOptions(headers={"Authorization": f"Bearer {access_token}"}),
    )


def create_service_client(settings: Settings | None = None) -> Client:
    """A Supabase client using the service-role key, which BYPASSES RLS.

    Trusted server/worker paths ONLY — e.g. append-only `audit_log` inserts and
    worker outputs — and always with explicit intent. Never use it to satisfy an
    ordinary user request (that would defeat tenant isolation), and never expose
    the service-role key to client code (root AGENTS.md security baseline).
    """
    s = settings or get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError(
            "Supabase URL/service-role key are not configured; cannot build a service client."
        )
    return create_client(s.supabase_url, s.supabase_service_role_key)
