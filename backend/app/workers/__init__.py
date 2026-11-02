"""Background/queue job handlers (Supabase Queues + Python workers).

See backend/AGENTS.md. Foundation scaffold: interfaces/boundaries only.

No worker is implemented, and the worker HOST is deliberately undecided: a
persistent queue consumer is a different deployment shape from the
request-driven FastAPI service, so the choice is deferred to a new ADR gated
on the first real worker (the video transcode worker has its own container).
"""
