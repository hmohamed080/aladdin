# Supabase Edge Functions

Deno-based Edge Functions live here, one directory per function (`functions/<name>/index.ts`).

## When to use an Edge Function vs. alternatives

- Prefer a **Next.js Route Handler / Server Action** for app logic and BFF endpoints.
- Prefer the **FastAPI service** for AI, OCR, RAG, documents, and heavy/background work.
- Use an **Edge Function** for lightweight, low-latency webhooks or DB-adjacent hooks that genuinely belong at the data edge.

## Rules

- Secrets come from Supabase function secrets, never hardcoded.
- Verify the Supabase JWT and enforce authorization; never trust client-supplied identity.

## Foundation status

No Edge Functions are shipped yet. Add them here with a clear responsibility (avoid duplicating Route Handlers or the FastAPI service).
