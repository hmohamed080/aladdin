"""Supabase (supabase-py) data access; read/write of migration-owned tables.

Python data access uses `supabase-py` (ADR-0005): user-facing operations
preserve the caller's JWT so RLS applies; service-role access is limited to
trusted workers and explicitly authorized operations. The schema is owned by
`supabase/migrations` — this layer never creates or alters it (ADR-0002).
Complex operations use PostgreSQL functions/RPC. SQLAlchemy is deferred.

See backend/AGENTS.md. Foundation scaffold: interfaces/boundaries only.
"""
