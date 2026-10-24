# media-worker — private R2 media delivery at the edge

Cloudflare Worker that serves Aladdin's revocable media (avatar, portfolio,
certificate, product, organization) from a **private** R2 bucket. It replaces
the application proxy (`frontend/src/server/storage/delivery.ts`) for rows whose
`media_storage_locations.provider = 'r2'` once `MEDIA_EDGE_DELIVERY_ENABLED=true`.
Until then nothing here is used. Business-verification documents are out of
scope: they stay in their Supabase bucket (PR #88 contract).

Plan: `r2-delivery-architecture.md` WP3. Database side:
`supabase/migrations/20261021090009_media_edge_authorization.sql` (WP1).
App side: `frontend/src/server/storage/edge-ticket.ts` (WP4).

## Routes

| Route | Mode | Who | Per request |
|---|---|---|---|
| `GET /m/<ns>/<variant>?t=<ticket>` | P, private | the viewer the app minted the ticket for | HMAC ticket check, then `public.media_edge_authorize(...)` |
| `GET /c/<portfolio\|avatar>/<id>/<variant>` | C, conditional public | anyone while eligible | `public.media_edge_public(...)` |

`<variant>` is `original`, `thumb`, `card` or `full` (variants exist once WP2
records them). Everything else, including every denial, a missing object, a bad
ticket, a database error and any non-GET/HEAD method, is the same `404` with
`Cache-Control: private, no-store`, so there is no existence oracle.

## Security model

- **Postgres is the only authority.** The Worker copies no rules. Both functions
  evaluate the existing resolvers (`media_storage_resolve`,
  `organization_media_resolve`, `public_portfolio_media_key`,
  `is_published_portfolio_object`, `profile_public_directory`) on **every**
  request, including `304` revalidations. `media_edge_authorize` additionally
  requires `app.account_is_active(viewer)`, an existing unexpired
  `auth.sessions` row for that viewer (sign-out deletes it), no Auth ban, and an
  R2 receipt that is verified and not cleaned.
- **Revocation bound: the next request.** Delete, unpublish, delist, audience or
  workspace change, membership/organization suspension, account suspension, ban
  and sign-out all deny the next request (pgTAP `99_media_edge_authorization_test.sql`,
  `test/handler.test.ts`, `test/authority.live.test.ts`). Bytes already
  delivered, and a response already streaming, cannot be recalled.
- **Tickets bind, they do not authorize.** `kid.payload.mac`, HMAC-SHA256 over
  `aladdin.media-edge.v1.<kid>.<payload>`; claims: namespace, object key,
  variant, viewer, Auth session id, workspace (organization media only) and
  expiry (60–120 s, 5 s skew; the database re-checks the expiry). The path must
  match the ticket's namespace and variant. `test/ticket-vectors.json` pins the
  format for both implementations.
- **Mode P** responses: `private, no-store`. **Mode C**: `private, no-cache` plus
  a strong `ETag` (the receipt's sha256), so browsers revalidate each view and
  each revalidation is re-authorized. Both: `nosniff`, `CSP: default-src 'none';
  sandbox`, `Referrer-Policy: no-referrer`, content type from the database (an
  allow-list per namespace), no CORS headers, no upstream R2 headers. Objects
  whose size differs from the verified receipt are refused. Single byte ranges
  and HEAD are supported.
- **Database role.** `media_edge` is `NOLOGIN`, has `EXECUTE` on exactly the two
  functions and nothing else (no table grants, no `app`/`auth`/`storage` usage).
  The functions set the viewer's claims only for the nested resolvers and
  restore the caller's claims before returning, including the legacy
  `request.jwt.claim.sub` that `auth.uid()` reads first, so a connection cannot
  pre-set claims to impersonate someone.

## Dependency: `postgres` (porsager) 3.4.9

1. Problem: speak the Postgres wire protocol (SCRAM auth, TLS, extended query)
   from a Worker to Hyperdrive. That is not a 30-line task.
2. No platform API exists for Postgres; a PostgREST RPC with a service secret
   would add an `edge_logs` row per image (the cost this Worker removes) and
   need a broader credential.
3. Used on every media request.
4. Maintained (3.4.9, April 2026); listed by Cloudflare's Hyperdrive docs as a
   supported driver.
5. Zero transitive dependencies.
6. Appropriate: one function call per request, behind `MediaAuthority` so tests
   inject a fake.

Dev only: `vitest` and `typescript` at the frontend's versions. Runtime types
are declared in `src/types.ts` instead of adding `@cloudflare/workers-types`.
`wrangler` is not a repository dependency; the owner runs a pinned version at
deploy time.

## Tests (no Cloudflare account needed)

```bash
pnpm --filter @aladdin/media-worker test        # ticket vectors, routes, revocation, headers, ranges
pnpm --filter @aladdin/media-worker typecheck
# Optional, local stack only (refuses non-localhost URLs):
MEDIA_EDGE_LIVE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm --filter @aladdin/media-worker exec vitest run test/authority.live.test.ts
```

## Hosted steps (owner approval required; none have been done)

1. **Migration.** Apply `20261021090009_media_edge_authorization.sql` through the
   permission gate with the other pending migrations. It creates the NOLOGIN
   `media_edge` role.
2. **Worker login role** (SQL editor or `psql`, as `postgres`; type the password
   at the prompt so it never lands in history or logs):
   ```sql
   create role media_edge_worker login inherit connection limit 20;
   grant media_edge to media_edge_worker;
   alter role media_edge_worker set statement_timeout = '3s';
   alter role media_edge_worker set idle_in_transaction_session_timeout = '5s';
   \password media_edge_worker
   ```
   Verify: `set role media_edge_worker; select count(*) from public.users;` must
   fail with permission denied. **Pre-existing exposure to check first:** on the
   local stack `PUBLIC` has `USAGE` on schema `net` and `EXECUTE` on
   `net.http_delete(...)`, `net.worker_restart()` and a few pg_net helpers, so
   every role (including this one, and `anon`) can call them. Check the hosted
   project and revoke those from `PUBLIC` in a separate reviewed change.
3. **Hyperdrive** with caching **disabled** (cached results would delay revocation):
   `wrangler hyperdrive create aladdin-media-edge --caching-disabled --connection-string="postgres://media_edge_worker.<project-ref>:<password>@<supavisor-session-host>:5432/postgres?sslmode=require"`
   (Supavisor session mode, port 5432, or the direct connection). Put the id in
   `wrangler.toml`.
4. **R2.** A private bucket (no public access, no `r2.dev`), lifecycle rule
   expiring `pending/` after 2 days. Bind it as `MEDIA_BUCKET`.
5. **Hostname `media.aladdindecore.com`** (feasible; checked 2026-10-19). The
   `aladdindecore.com` zone is served by Vercel DNS (`ns1/ns2.vercel-dns.com`),
   and a Workers Custom Domain needs a Cloudflare zone (CNAME/partial setup is
   Business plan and up). Two free ways:
   - **B, recommended first:** a Cloudflare **Pages** project (`pages/`) running
     the same bundle. Add `media.aladdindecore.com` as its custom domain, then
     one DNS record in Vercel: `media CNAME aladdin-media.pages.dev`. Nothing
     else in the zone changes.
   - **A:** move the `aladdindecore.com` nameservers to a Cloudflare Free zone
     (recreate the Vercel A/CNAME records and every MX/TXT record first) and use
     `wrangler.toml`'s Custom Domain. Adds Cloudflare WAF and rate-limit rules,
     but touches the whole domain, including email.
   Workers Paid (D5, $5/month) is needed for production volume either way.
6. **Ticket key.** Generate 32 random bytes, base64url. `wrangler secret put
   TICKET_KEYS` with `{"k1":"<secret>"}`. In Vercel set
   `MEDIA_EDGE_TICKET_KID=k1` and `MEDIA_EDGE_TICKET_SECRET=<secret>` (secret),
   `MEDIA_EDGE_ORIGIN=https://<media-hostname>`.
7. **Deploy** `wrangler deploy` from this directory; then set
   `MEDIA_EDGE_DELIVERY_ENABLED=true` on staging only. `MEDIA_EDGE_PUBLIC_ENABLED=false`
   keeps public portfolio on `/p/media` if Mode C is not approved (D1).
8. **Canary:** publish → 200, unpublish → 404 on the next request; sign out → 404.

**Rotation:** add `k2` to `TICKET_KEYS`, switch the app to `k2`, wait 5 minutes,
remove `k1`. **Rollback:** `MEDIA_EDGE_DELIVERY_ENABLED=false` returns every URL
to the application proxy at the next render; no data changes. Setting
`PRIVATE_ROUTES`/`PUBLIC_ROUTES` to anything but `on` disables a route family at
the edge.

## Edge byte cache

With `EDGE_CACHE=on`, whole-object GETs up to 20 MB are kept in the local
Cloudflare cache (`caches.default`, available on Workers custom domains and on
Pages) under an internal key made of the R2 object and its verified sha256. The
order is fixed: **database authorization first, cache second**, so a cached copy
never outlives a revocation, and a replaced object (new sha256) never reuses an
old entry. Browsers still receive `private, no-store` (Mode P) or `private,
no-cache` + ETag (Mode C). Ranges, HEAD and cache failures fall back to R2.
Effect: repeat views in the same Cloudflare location cost no R2 Class B read.
The Cache API is per location and does not use tiered cache; Workers Caching
(authenticated-entrypoint pattern) is the upgrade path if hit rates matter.

## Local end-to-end run (2026-10-19, wrangler 4.151.1, real workerd)

Against the local Supabase stack (all migrations), a `media_edge_worker` login
role, local R2 and Hyperdrive `localConnectionString`:
- `/c` portfolio: 200 with identical bytes, `304` on revalidation; **404 on the
  very next request** after unpublish, delete and owner suspension (with the
  bytes in the edge cache); 200 again after restore.
- `/m` certificate with an app-format ticket: 200 identical bytes, `private,
  no-store`; tampered ticket 404; unknown session 404; **404 right after
  sign-out** (session row deleted).
- The worker role cannot read any table (`permission denied for table users`).
- Pages advanced mode (`_worker.js`, 99 KB bundle) loads and routes with the R2
  binding; `wrangler pages dev` has no local Hyperdrive flag, so the database
  half of Pages was not exercised locally.

## Residual risks and costs

- A copied Mode P URL can be replayed for at most 120 s, and only while its
  viewer is still authorized and signed in (same as the previous 30–300 s
  signed URLs).
- Each request costs one Hyperdrive round trip to the database region (a few ms
  in-region; more from distant edges). Free plan limits (100k Worker requests and
  100k Hyperdrive queries a day, 10 ms CPU) fail hard; production needs Workers
  Paid ($5/month). R2 Class B reads stay within the free tier at the plan's
  scale estimate; image bytes leave Vercel and Supabase entirely.
- Legacy `provider='supabase'` rows keep using the application proxy (Vercel
  bandwidth) until migrated.
