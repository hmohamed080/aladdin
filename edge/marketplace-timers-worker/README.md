# Aladdin Marketplace timers Worker — NOT DEPLOYED

A Cloudflare Worker whose only job is its cron trigger (every 5 minutes). It calls two bounded, idempotent, **service-role-only** Postgres functions through PostgREST and logs counts:

| Call | Does |
|---|---|
| `marketplace_timers_run(p_limit)` | Seller reminder every 6 h and automatic cancellation at 72 h (stock released); buyer receipt-resubmit reminder at 24 h and cancellation at 48 h. All logic, locks and idempotency are in the database (`supabase/migrations/20261124140002_marketplace_timers_runner.sql`). |
| `marketplace_checkout_sessions_purge(p_limit)` | Expires old checkout sessions (PR 12). |

There is no `pg_cron` in this repo; the existing pattern (media cleanup, the transcode Worker) is "logic in Postgres, a scheduler outside only calls it". A double fire is safe (`SKIP LOCKED`, the order machine re-checks the order).

## Owner approval needed (nothing here is set or deployed)

Building and deploying this Worker, first on Acceptance, is an **open owner question** (contract section 11, question 11). Until it is approved, `node scripts/marketplace-timers.mjs run --project <ref|local> --execute` does the same job by hand.

When approved, the owner (or an approved session) must:

1. `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` for the target environment (Acceptance first). Never commit them; never put them in `vars`.
2. Deploy with `wrangler deploy` from this directory. The config is private (no route, no workers.dev, no preview URL) and carries no secret.
3. Confirm in Workers observability that the log lines `marketplace-timers ok processed=… reminders=… cancelled=… errors=0` appear every 5 minutes (numbers only: no id, no name, no response body is ever logged).
4. Create a production Worker/config separately after Acceptance is verified (`name` is the Acceptance one).

## Local checks

```bash
node --experimental-strip-types --test test/*.test.ts   # unit tests (fake fetch)
node_modules/.bin/tsc --noEmit -p .                      # typecheck
```

## Failure behaviour

A failed timers call is logged (`status=<http>`) and the tick throws so Workers observability shows it; the next tick is the retry. A failed purge never blocks the timers call and vice versa. Nothing is retried inside a tick.
