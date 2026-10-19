# Upstash Redis setup (owner guide)

**Purpose:** connect the existing Upstash account to Aladdin's optional Redis accelerator ([ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md)) safely, starting on the Free plan.
**Current decision:** one Free database, used by Preview first and Production second. The owner's database `alert-bedbug-148148.upstash.io` already exists, so use it rather than creating another. The code ships with `REDIS_CACHE_ENABLED=false`.

**Transport:** the app on Vercel (web app and backend) connects over TCP with TLS, using `REDIS_URL` (`rediss://…:6379`). Vercel can reach port 6379. The REST endpoint (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) is not used by the app; see [REST transport](#rest-transport-not-used-by-the-app).
**Scope:** the web app (`frontend/`) and, optionally, the backend job lock. It does not cover Upstash QStash, Vector or the REST SDK, none of which the app uses.

## What Redis does here, and what it never does

| Holds | Never holds |
|---|---|
| Reference vocabularies (trades, trade specialties, product categories), 10 min TTL | Permission, membership, visibility or session decisions |
| Per-user rate-limit counters for uploads, video parts and private media reads | Image, video or document bytes |
| Background job locks (backend) | Tenant business data, phone numbers, emails (keys are hashed) |

If Redis is down, slow, out of quota or switched off:
- pages read Postgres as before;
- rate limits keep working, counted per server instance in memory;
- access is unchanged, because no access decision ever reads Redis.

## 1. Check the database (in the existing account)

Use the account and the database you already have (`alert-bedbug-148148`). Do not create a second account. Create a database only if that one is ever deleted.

1. Sign in at [console.upstash.com](https://console.upstash.com) and open **Redis → alert-bedbug-148148**.
2. Check the settings below. If one differs, fix it there, or tell the coding agent.
   - Plan: **Free**.
   - Region: the one closest to Paris, where the Vercel functions (`cdg1`) and Supabase (`eu-west-3`) run. Pick **Paris (eu-west-3)** if offered, otherwise **Frankfurt (eu-central-1)**, London or Ireland. Upstash cannot move a database between regions. If this one is far from Paris (for example in the US), create a new Free one in the right region and delete the old one.
   - No read replicas: each replica multiplies write commands.
   - **TLS on** and **Eviction off**. The app sets a TTL on every key, so nothing piles up.

The Free plan was, when checked on 2026-10-19: 500,000 commands a month, 256 MB, 10 GB bandwidth a month, 10,000 commands a second. Upstash changes plans; read the current numbers on the pricing page before relying on them.

## 2. Copy the right URL

On the database page, open the **TCP** (or "Connect" → "node-redis" / "redis-cli") tab and copy the URL that starts with **`rediss://`**:

```
rediss://default:<password>@alert-bedbug-148148.upstash.io:6379
```

- Use `rediss://` (two s, TLS). The app refuses a plain `redis://` URL outside local development.
- Do **not** append a database number (`/1`): Upstash only has database 0.
- Do **not** use `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. The app talks Redis protocol over TCP with `@redis/client`, not the REST API.
- The URL contains the password. Treat it as a secret: never paste it in chat, an issue, a PR, or a `NEXT_PUBLIC_` variable.

## 3. Add the secrets, Preview first

### Vercel (web app and backend; one project)

Vercel → Project → Settings → Environment Variables. Add, for **Preview** only at first:

| Name | Value | Sensitive |
|---|---|---|
| `REDIS_URL` | the `rediss://…` URL | Yes |
| `REDIS_KEY_ENV` | `preview` | No |
| `REDIS_CACHE_ENABLED` | `true` | No |
| `REDIS_MONTHLY_COMMAND_BUDGET` | `500000` (optional; this is the default) | No |

Redeploy a Preview deployment so it picks up the variables.

After Preview has run cleanly for a few days (step 5), add the same names for **Production**, with `REDIS_KEY_ENV=production`. Preview and Production then share the one Free database, kept apart by the key prefix (`aladdin:preview:…` and `aladdin:production:…`), and share its 500,000 commands.

The backend reads the same `REDIS_URL` and `REDIS_KEY_ENV` for job locks. With `REDIS_URL` unset, background jobs simply run without a cross-process lock.

### This cloud coding environment

Here the database is reachable only over the **HTTPS REST** endpoint: the network proxy adds the REST token, and TCP port 6379 is blocked. So:
- no `REDIS_URL` is set here, and the app's TCP client cannot reach Upstash from this environment;
- a later session can still do a **read-only** live check through REST (step 4.4), with no secret in the session.

Never put the URL or token in `.env.local` files that could be committed, and never in CI. CI tests against a throwaway Redis service container.

## 4. Verify

1. Open `https://<preview-deployment>/api/health`. Expect:
   ```json
   { "status": "ok", "cache": "ok", "cacheMetrics": { "usage": { "connects": 1, ... }, ... } }
   ```
   - `"cache": "disabled"`: `REDIS_CACHE_ENABLED` is not `true` in that environment, or the deployment predates the variable.
   - `"cache": "unavailable"`: the URL, password, TLS or network is wrong. Check the Vercel runtime logs for `cache.redis_unavailable`; its `error` field names the failure (for example `connect:ECONNREFUSED`). The site keeps working meanwhile.
2. Sign in as a business user and open **Jobs → New job** twice (it shows the trade vocabularies). The second open is served from Redis: `cacheMetrics.namespaces.ref.hits` goes up on that instance. Health counters are per server instance, so a request may land on a different one.
3. Upstash console → the database → **Data Browser**: keys look like `aladdin:preview:v1:ref:global:<hash>` and `aladdin:preview:v1:rl:u-<user uuid>:<hash>`. Values are JSON lists of vocabulary rows or small counters, never bytes.
4. Read-only live check from the cloud coding environment (REST; the proxy adds the token):
   ```bash
   curl -s https://alert-bedbug-148148.upstash.io/ping                    # {"result":"PONG"}
   curl -s https://alert-bedbug-148148.upstash.io/dbsize                  # number of keys
   curl -s "https://alert-bedbug-148148.upstash.io/scan/0/match/aladdin:preview:*/count/100"
   ```
   Each call is one billed command. The full test suite (`REDIS_TEST_URL=… pnpm exec vitest run src/server/cache`) needs TCP. It runs only from a machine that can reach port 6379, never from this environment. It only touches keys under `aladdin:test-<pid>:` and deletes them; it never flushes the database.

## 5. Watch usage

Two sources, and the Upstash one is authoritative:

- **Upstash console → database → Usage / Metrics.** Shows monthly commands against the plan limit, daily commands, storage, bandwidth and connections. Under **Account → Billing** (paid plans) set a **budget**; at the cap Upstash rate-limits the database instead of billing more.
- **App logs (Vercel → Logs), per server instance:**
  - `cache.redis_budget` with `thresholdPercent` 50 or 80: this one instance, extrapolated from at least 15 minutes of traffic, would use that share of `REDIS_MONTHLY_COMMAND_BUDGET` on its own. Several instances run at once, so the real total is higher: open the Upstash dashboard when you see it.
  - `cache.redis_unavailable`: Redis failed twice in a row, or a connection could not be opened. The app falls back for 5 seconds and tries again. One line per outage, not per request.
  - `/api/health` → `cacheMetrics`: per-instance `commands`, `connects`, `projectedMonthly`, hits/misses/errors and `rl.fallback` (requests limited in memory because Redis was unavailable).

### Command estimate

What one event costs:

| Event | Redis commands |
|---|---|
| Private image shown through the app's media proxy (edge delivery off) | 1 |
| Signed upload URL; each signed video part URL | 1 |
| Page that renders a vocabulary (profile edit: 2, job form: 1) | 1 per vocabulary |
| Refilling a vocabulary after its TTL | 2, at most every 10 minutes per vocabulary (≤ 26,000 a month) |
| New connection (cold server instance) | 1 (AUTH) |
| `/api/health` | 0 if Redis was used in the last minute on that instance, else 1 (PING) |
| Repeated requests from a user already refused | 0 (refused in memory until the window ends) |

Monthly estimates (30 days). Assumptions: 10 private images per page view through the proxy; 10% of page views show a vocabulary (1.5 on average) and most of those refill it; uploads 20 / 50 / 250 a day; 3,000 / 4,000 / 6,000 cold starts. Not included: an uptime monitor on `/api/health` (up to ~43,000 more, see risk 3).

| Traffic | Edge delivery off | Edge delivery on (images bypass the app) |
|---|---|---|
| 300 page views/day | ~100,000 (20% of Free) | ~8,000 (2%) |
| 1,000 page views/day | ~320,000 (64%) | ~19,000 (4%) |
| 5,000 page views/day | ~1,560,000 (3× Free; about $3/month pay-as-you-go) | ~62,000 (12%) |

### Free-tier exhaustion risks

1. **Proxied image reads dominate.** At around 1,500 page views a day with edge delivery off, Free runs out. Either turn on edge delivery (ADR-0018), or move to pay-as-you-go ($0.20 per 100,000 commands) with a budget. Moving needs your approval.
2. **One signed-in client hammering images.** The read limit allows 1,200 a minute per user. Sustained abuse could use the month's commands in hours. Once refused, a user costs nothing more until the window ends, on that instance. If the quota does run out, Upstash refuses commands and the app falls back exactly as in an outage: limits stay on in memory and pages read Postgres.
3. **A frequent uptime monitor on `/api/health`.** At most one PING per instance per minute, about 43,000 a month for a monitor polling every minute. Poll every 5 minutes, or point the monitor at a page instead.
4. **Preview and Production share one database.** Heavy preview testing spends Production's allowance. Use a second Free database for Preview if that happens; the plan page lists how many free databases an account may have.

## REST transport (not used by the app)

Upstash also serves every command over HTTPS (`POST` a JSON array with `Authorization: Bearer <token>`). Should the app support it as a second transport? **Not now.**

- **No gain on Vercel.**
  - TCP works there and needs no dependency beyond `@redis/client`.
  - TCP keeps one multiplexed connection per warm instance: about one network round trip per command, and one `AUTH` per connection.
  - REST is one HTTPS request per command, with the same command count and billing, and a TLS handshake whenever the HTTP keep-alive connection lapses.
- **Atomic limiter.** The limiter runs as one `EVAL`; REST runs `EVAL` too, so both transports would have to stay correct.
- **Only the cloud coding environment needs REST,** and only for read-only checks. The `curl` commands in step 4 cover that.
- **No dependency if ever needed.** `@upstash/redis` is not justified: a REST transport is about 30 lines of `fetch` behind the existing `withRedis` seam. Reasons to write it would be an Edge-runtime caller, or a host that blocks 6379. Neither applies today.

## 6. Roll back

Any one of these, in order of preference:

1. Set `REDIS_CACHE_ENABLED=false` in that Vercel environment and redeploy. Pages read Postgres; rate limits continue in memory. No data migration; nothing is lost.
2. Remove `REDIS_URL` as well if the password may have leaked, then in Upstash **Reset Password** (rotates the credential; old URLs stop working).
3. Deleting the Upstash database is safe at any time: it holds only caches, counters and locks.

To drop cached vocabularies immediately (for example right after a migration changed one), delete the keys matching `aladdin:<env>:v1:ref:*` in the Data Browser. They refill on the next page view.

## Related files

- [ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md): what Redis may and may not hold, and measurements.
- `frontend/src/server/cache/redis.ts`: connection, budget counter, breaker, key scheme.
- `frontend/src/server/cache/rate-limit.ts`: limits and the memory fallback.
- `frontend/src/server/cache/reference.ts`: vocabulary cache.
- `frontend/src/lib/env/cache.ts`: settings; `frontend/.env.example`.
- `backend/app/coordination/__init__.py`: job locks.
