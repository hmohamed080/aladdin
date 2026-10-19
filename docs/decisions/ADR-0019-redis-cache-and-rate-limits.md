# ADR-0019 — Redis as an optional accelerator: reference cache, rate limits, job locks

**Status:** Proposed · 2026-10-19 · **Needs owner approval** before any hosted Redis is created. The code ships switched off (`REDIS_CACHE_ENABLED=false`). With it off, reads go to Postgres as before, and the rate limits below count per instance in memory (Revision 2).

**Revision 2 (2026-10-19, same day):** the owner has an Upstash account and asked for it to be used. Changes: rate limits fail safe instead of open; the client is tuned for Upstash's per-command billing; usage monitoring and warnings; an owner setup guide, [upstash-setup.md](../guides/upstash-setup.md).

**Refines:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md) Revision 2, section "Redis: not now". The owner's 2026-10-19 brief asked for Redis to be implemented now. This ADR records what Redis may and may not hold.

## Decision

Redis is an **accelerator and counter store**, never an authority.

| Use | Where | Key | TTL | When Redis is down |
|---|---|---|---|---|
| Reference vocabularies (trades, trade specialties, product categories) | `frontend/src/server/cache/reference.ts` | `aladdin:{env}:v1:ref:global:{hash}` | 600 s (an empty list 300 s), plus `invalidateReference()` | Read Postgres |
| Per-user rate limits: signed upload URLs, private media proxy reads, video part URLs | `frontend/src/server/cache/rate-limit.ts` | `aladdin:{env}:v1:rl:u-{userId}:{hash}` | one window | Same window counted in this instance's memory; database limits still apply |
| Background job locks (historical purge, video transcode) | `backend/app/coordination` | `aladdin:{env}:v1:lock:global:{name}` | 10 min, extended per batch | Job runs unlocked; every job is idempotent |

### What Redis must never hold

- **Authorization.** No permission, membership, capability, visibility, audience, suspension or session decision is read from Redis. Media access is decided by Postgres on every request (ADR-0018), so revocation stays immediate.
- **Bytes.** No image, video, segment or document content. Bytes live in R2 and the Worker's edge cache.
- **Per-tenant business data.** Nothing tenant-owned is cached today. If a future entry is, it must use the `t-{tenantId}` scope, and `cacheKey()` refuses a malformed scope.
- **Raw identifiers.** Key parameters are SHA-256 hashed; phone numbers and emails never appear in a key.

### Why only reference vocabularies are cached

The audit (2026-10-19) found no other cross-user hot reads. Every other page reads data that RLS filters per caller, and caching it would mean caching a permission decision. The measured staging bottleneck (a 260 ms per-row role check) was fixed in SQL instead (`20261019130000_rls_platform_check_initplan.sql`).

Each cached loader filters explicitly (`is_active = true`), so a support user, whose policy also returns retired rows, can never fill an entry other callers are served. A caller without a verified session never touches the cache. An empty result is kept for 300 s only.

**Revision 2 re-measurement.** `pg_stat_statements` deltas over 252 signed-in page loads on a production build (13 B2B routes as a showroom owner, 8 `/home` routes as a consumer) found:
- about 18 PostgREST requests per page;
- the costliest per-page statements are all per-user entitlement or authorization reads: `my_organization_application_slot()` (13 ms per B2B page, computes `app.application_slot` twice), branch address and list, `my_organization_applications`, `my_workspaces`, `admin_my_access`, `my_account_status`, and the `pre_request` hook;
- the only cross-user reads on these paths are the vocabularies already cached.

None of the others may be cached under this ADR. The slot function is a SQL fix (evaluate the slot once), recorded as follow-up work, not a Redis one.

### Client and failure behaviour

- `@redis/client` (the official client's core, without the module packages) runs in Node server code only.
- Each serverless instance holds one multiplexed connection. A client pool helps only blocking commands, which nothing here uses.
- Commands time out after 150 ms, and the first connect after 1 s.
- A failed connect, or two failed commands in a row, opens a 5-second breaker, so a dead Redis costs one timeout, not one per request. A single failure on a connection idle for 30 s or more is retried once on a fresh connection (a frozen serverless instance's socket may have been closed).
- The offline queue is disabled, so commands fail fast instead of waiting on a reconnect.
- **Upstash command budget:** RESP2, no `CLIENT SETINFO` or maintenance handshake, so a connection costs one `AUTH`, not `HELLO` plus three `CLIENT` commands (measured with `MONITOR`). No PING interval and no automatic reconnect: a closed connection is reopened only when a request needs Redis, so an idle instance spends nothing. TCP keep-alive stays on (not a Redis command). The backend job lock uses the same settings in redis-py.
- **Rate limits fail safe.** When Redis is off, unreachable or out of quota, the same fixed window is counted in the instance's memory (bounded to 20,000 users). Memory, not Postgres, because the fallback must not add a write per image read to the database it protects. Weakness: N warm instances allow up to N times the limit. Once Redis refuses a user, the instance refuses them locally until the window ends, spending no more commands.
- Hosted Redis must use TLS (`rediss://`); the env schema refuses anything else outside local.
- Monitoring:
  - `/api/health` reports `cache: disabled | ok | unavailable` and `cacheMetrics`: per-instance commands, connects, monthly projection, hits, misses, sets, errors, invalidations, limited and memory-fallback counts, average latency. It PINGs only if Redis has not answered in the last minute on that instance.
  - `cache.redis_unavailable` is logged once per outage (with an error code, never the URL).
  - `cache.redis_budget` is logged when one instance's projection (after 15 min) crosses 50% and 80% of `REDIS_MONTHLY_COMMAND_BUDGET` (default 500,000). The Upstash dashboard remains the billing source of truth.

## Measurements (local, 2026-10-19)

300 iterations each. PostgREST and Redis both ran on loopback, so the hosted gap is mostly network.

| Read | PostgREST p50 / p95 | Redis p50 / p95 |
|---|---|---|
| Trades (14 rows, 1 kB) | 4.48 / 6.29 ms | 0.47 / 0.70 ms |
| Product categories (15 rows, 1 kB) | 3.53 / 4.46 ms | 0.39 / 0.54 ms |
| Rate-limit window script | — | 0.13 / 0.26 ms |

**Honest reading:**
- The page-latency gain is a few milliseconds on the pages that render these selectors.
- The real value is fewer Data API requests against Supabase Free, plus rate limits on expensive media paths.
- Redis is not a fix for Core Web Vitals.

### Revision 2 benchmarks (local, 2026-10-19, 300 iterations after 20 warm-up)

| Path | p50 | p95 |
|---|---|---|
| Trades via PostgREST (authenticated) | 3.44 ms | 6.82 ms |
| Trades via `cachedReference`, Redis hit | 0.29 ms | 0.60 ms |
| Product categories via PostgREST | 3.20 ms | 6.64 ms |
| Product categories via `cachedReference`, Redis hit | 0.26 ms | 1.27 ms |
| Rate limit, Redis `EVAL` | 0.23 ms | 1.61 ms |
| Rate limit, memory (Redis off, or breaker open) | 0.02 ms | 0.06–0.09 ms |
| Trades with Redis down (breaker open, PostgREST) | 3.90 ms | 10.72 ms |
| First call with Redis refused / blackholed | 92 ms / 1,030 ms once, then breaker | — |

Whole page on a production build, `/b2b/jobs/new` (it reads two vocabularies; 60 requests per run, the machine shared with other jobs). p50 / p95 per run:
- Redis off: 205 / 362 ms and 183 / 455 ms.
- Redis on: 219 / 559, 173 / 318 and 143 / 243 ms.

The difference is within run-to-run noise. Redis saves Data API requests, not visible page time.

End to end on that build:
- 1,600 private-media requests cost one `EVAL` each (1,537 commands plus 64 memory-limited during a cold-start stall), on one connection.
- With Redis on a dead port, every request was still served, `/api/health` reported `unavailable`, and all 320 limiter checks used the memory window.

## Managed options (researched 2026-10-19; no account created)

| Option | Free tier | First paid step | Fit |
|---|---|---|---|
| **Upstash Redis** (Vercel Marketplace) | 250 MB, 500K commands/month | Pay as you go, $0.20 per 100K commands; or $10/month fixed | **Recommended.** TLS, EU regions, billed per command, works from serverless. |
| Redis Cloud Essentials | 30 MB, 30 connections, 100 ops/s, 5 GB/month bandwidth | From about $5/month | Too few connections for serverless bursts. |
| Aiven for Valkey | 1 GB single node | Hobbyist, $19/month | Fine, but a fixed node and higher first paid step. |

**Command budget.** Each private image read through the application proxy costs one command for the limiter; each reference miss costs two. The full per-event table, estimates at 300 / 1,000 / 5,000 page views a day (about 100K / 320K / 1.56M commands a month with images through the proxy; 8K / 19K / 62K with edge delivery on) and the Free-tier exhaustion risks are in [upstash-setup.md](../guides/upstash-setup.md#command-estimate).

- Free covers the pilot. At around 1,500 page views a day with images still proxied it does not.
- Once edge delivery is on, images bypass the proxy and that cost disappears.
- Running out of quota is a cost and speed event, not a security one: Upstash refuses commands, and the app falls back as in an outage. Moving to pay-as-you-go **needs owner approval.**

## Activation (owner approval required)

Step by step in [upstash-setup.md](../guides/upstash-setup.md). In short:

1. In the existing Upstash account, use the existing database (`alert-bedbug-148148`): Free, in the EU region closest to Paris.
2. Set `REDIS_URL` (`rediss://…`, a secret), `REDIS_KEY_ENV` and `REDIS_CACHE_ENABLED=true` in Vercel Preview first, then Production.
3. Check `/api/health` reports `cache: "ok"`, and watch the Upstash usage page.
4. Rollback: set `REDIS_CACHE_ENABLED=false`. No data migration is involved, and nothing is lost.

**Transport.** On Vercel the app and the backend use TCP + TLS (`REDIS_URL=rediss://…:6379`). The cloud coding environment reaches the database only over Upstash's HTTPS REST endpoint (proxy-injected token; 6379 blocked), so it can run read-only `curl` checks but not the TCP test suite. A REST transport in the app is not worth it today. It would add one HTTPS request per command for no gain where TCP works. If ever needed (Edge runtime, or a host that blocks 6379), it is about 30 lines of `fetch` behind `withRedis`, with no new dependency.

Not verified from the build sandbox: a live connection to Upstash (unreachable from it). TLS (`rediss://`) was tested against a local TLS proxy, including refusal of an untrusted certificate.
