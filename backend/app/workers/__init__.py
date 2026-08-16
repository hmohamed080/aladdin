"""Background/queue job handlers (Supabase Queues + Python workers).

See backend/AGENTS.md. Foundation scaffold: interfaces/boundaries only.

No worker is implemented, and the worker HOST is deliberately undecided: a
persistent queue consumer is a different deployment shape from the
request-driven FastAPI service, so ADR-0009 defers the choice (Vercel
Cron/Queues vs. a container host) to a new ADR gated on the first real worker.
"""
