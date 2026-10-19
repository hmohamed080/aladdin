# ADR-0018 — Media delivery: R2 primary store, ticketed edge Worker for private and conditional-public media

**Status:** Proposed · 2026-10-18 · **Needs owner approval.** Nothing in this ADR has been deployed, and no hosted resource exists for it. The code is on the unmerged draft PR #89 with edge delivery switched off (`MEDIA_EDGE_DELIVERY_ENABLED=false`).

**Refines:** [ADR-0017](ADR-0017-rc2-private-media-integration.md) (RC2 private-media provider integration). ADR-0017 stays in force. This ADR adds a second delivery path for R2-provider rows and records which media may be served without a session.
**Consistent with:** [ADR-0009](ADR-0009-vercel-services-deployment.md) (Vercel Services). See [Relationship to ADR-0009](#relationship-to-adr-0009).

## Purpose

Decide where media bytes are stored and how browsers receive them. Today every image either comes from a Supabase signed URL (on `main`) or is streamed through the Next.js app (the ADR-0017 proxy on PR #89). The first spends the Supabase Free egress quota. The second moves the same bytes onto Vercel bandwidth and adds an Auth `getUser` call per image. Neither one meets the cost target while keeping the rule that deleted or revoked media is denied on the next request.

Evidence: `/mnt/project-files/showroom-admin/supabase-usage-audit.md` and `/mnt/project-files/showroom-admin/r2-delivery-architecture.md` (the plan, WP0–WP10). Both are outside the repository.

## Context

- The aladdin-staging Free cycle had used **4.71 of 5 GB** of egress by 2026-10-18, leaving **about 0.29 GB**. Storage accounted for about 94% of measured edge egress since 2026-10-01, mostly portfolio originals, and 4.50 GB of it came from one burst on 2026-10-01. Going over the quota returns HTTP 402 on every API call, which is a full outage.
- No media namespace is unconditionally public under current product rules. Published portfolio photos and listed avatars are **conditional**: unpublishing, delisting, suspending or deleting must withdraw them, and the tests `48_*`, `88_*` and `public_media_exposure_test.mjs` §D say that happens **immediately**. Certificates, product images (audience-gated) and organization logos (members only) are **private**.
- Postgres already holds the authority (`media_storage_locations`, `media_storage_resolve`, `organization_media_resolve`, `public_portfolio_media_key`, `is_published_portfolio_object`, `profile_public_directory`) through migrations `20261018100000`–`20261018100003`.

## Current decision (proposed)

### 1. Storage

- **Cloudflare R2 is the primary store** for the five revocable namespaces: `avatar`, `portfolio`, `certificate`, `product`, `organization`. The bucket is **private**: no public access and no `r2.dev`. A lifecycle rule expires `pending/` uploads after 2 days.
- Supabase remains the authority for identity, tenancy, lifecycle and media metadata (ADR-0017, unchanged). `media_storage_locations.provider` records `supabase` or `r2` per object. Legacy `supabase` rows keep working through the application proxy until they are migrated by `scripts/media-storage.mjs` (see [media-monitoring.md](../operations/media-monitoring.md)).
- **Business-verification documents stay in Supabase Storage, unchanged.** This is the PR #88 contract: the private `business-verification-documents` bucket, the `bv_documents_*` policies, the caller-signed 30 s URL and the `/business-verification/file/<org>/<file>` route. They are not in `media_storage_locations`, the migration tooling or the edge Worker. `purchase-request-images` also stays on Supabase, as ADR-0017 already decided.
- **No media is unconditionally public.** There is no public bucket, no public CDN URL and no long-lived browser cache for any namespace. Each byte served is authorized by Postgres at the time of the request.

### 2. Delivery: the `media-edge` Cloudflare Worker (`edge/media-worker/`)

The Worker runs on a media hostname on a Cloudflare zone. It reads bytes from the private R2 bucket through a binding. It never copies authorization logic: each request calls one SECURITY DEFINER function in Postgres through **Hyperdrive with query caching disabled**, so a cached result can never delay a revocation.

| Route | Mode | Who | Checked on every request |
|---|---|---|---|
| `GET /m/<ns>/<variant>?t=<ticket>` | P, private | the viewer the app minted the ticket for | HMAC ticket, then `public.media_edge_authorize(...)` |
| `GET /c/<portfolio\|avatar>/<id>/<variant>` | C, conditional public | anyone while the item is eligible | `public.media_edge_public(...)` |

- **Ticket (Mode P).** The app authorizes the read exactly as the proxy does, then mints `kid.payload.mac`: HMAC-SHA256 over the namespace, object key, variant, viewer, Auth session id, workspace (organization media only) and expiry. The lifetime is **at most 120 s** (5 s clock skew), and the expiry is rounded to a 60 s bucket so a re-render inside a minute produces the same URL. The ticket only **binds** a URL to a viewer and object; it does not authorize.
- **Per-request authorization.** `media_edge_authorize` re-runs `media_storage_resolve` / `organization_media_resolve` as the viewer. It also requires `app.account_is_active(viewer)`, a live, unexpired `auth.sessions` row for the ticket's session (sign-out deletes it), no Auth ban, and a verified, not-cleaned R2 receipt. `media_edge_public` re-runs the publication and listing rules (`is_published_portfolio_object`, `profile_public_directory`, the current-avatar rule). Both functions restore the caller's claims before returning.
- **Revocation takes effect on the next request.** Delete, unpublish, delisting, an audience or workspace change, membership or organization suspension, account suspension, an Auth ban and sign-out each deny the next request (pgTAP `99_media_edge_authorization_test.sql`, the Worker tests).
- **Database role.** `media_edge` is `NOLOGIN` with `EXECUTE` on exactly the two functions and no table or schema grants beyond `public` usage (migration `20261019100000_media_edge_authorization.sql`). A separate login role for Hyperdrive, `media_edge_worker`, is created as a hosted step; its password lives only in Hyperdrive.
- **Responses.** Mode P sends `Cache-Control: private, no-store`. Mode C sends `private, no-cache` with a strong `ETag`, so the browser revalidates on every view and each revalidation is authorized again. Both send `nosniff`, `CSP: default-src 'none'; sandbox`, `Referrer-Policy: no-referrer`, and a content type from the database. They send no CORS headers and no upstream R2 headers. Every denial, missing object, bad ticket or database error is the same `404` with `no-store`, so the Worker cannot be used to test whether an object exists.
- **Fallback.** While `MEDIA_EDGE_DELIVERY_ENABLED=false` (the default), every URL is an application URL: `/api/media/<ns>` (private) and `/p/media/<itemId>` (published portfolio), served by `frontend/src/server/storage/delivery.ts` with `no-store`. When the flag is on, only `provider='r2'` rows get Worker URLs. Supabase-provider rows stay on the proxy. `MEDIA_EDGE_PUBLIC_ENABLED=false` keeps public portfolio and avatars on `/p/media` if Mode C is not approved. Rolling back is a flag flip and changes no data.

### 3. Variants

After the trusted verifier accepts an R2 original, it writes three WebP renditions beside it at `v/<ns>/<key>/<variant>.webp`, with metadata stripped:

| Variant | Long edge | Used for |
|---|---|---|
| `thumb` | 320 px | grids |
| `card` | 768 px | cards |
| `full` | 1600 px | detail and lightbox views |

The manifest (`width`, `height`, `size`, `sha256` per variant) is recorded in `media_storage_locations.variants`. The Worker serves only variants that are recorded. The original is served only where it is explicitly needed. Before upload, the browser also caps the long edge (2560 px for photos, 3200 px for certificates). Server verification stays authoritative. Variants are best-effort: an upload never fails because a variant could not be written.

### Relationship to ADR-0009

ADR-0009 stays as written. The Next.js app and FastAPI still deploy as one Vercel Services deployment from the root `vercel.json`. Supabase is still the data platform.

This ADR adds **Cloudflare (R2, a Worker and Hyperdrive) as a media-storage and media-delivery edge**, next to Supabase Storage. It is not a third application service:

- The Worker is **not** declared in `vercel.json` and is **not** deployed by Vercel. The owner deploys it separately with a pinned `wrangler` version.
- It is **not** the background-worker host that ADR-0009 leaves undecided. It serves media reads only and runs no jobs.
- It holds no business logic. Postgres stays the only authority, and the Next.js app still decides which URL to render.

## Rationale

Each option was judged on one requirement: deleted or revoked media must be denied on the next request, with no image bytes or per-image Auth calls going through Supabase or Vercel.

### Alternatives considered

| Option | Revocation | Cost | Verdict |
|---|---|---|---|
| **Public CDN bucket** (Mode B: public R2 bucket on a custom domain, edge-cached derived variants, withdraw by delete and purge from a database outbox) | Bounded, not immediate: about 1–2 s on the fast path, up to 60 s from the cron backstop, plus purge propagation, plus a browser TTL of up to 300 s | Lowest per request | **Rejected.** The owner chose immediate revocation on 2026-10-19 (plan decision D1, closed). It would change the product contract and the tests that say "immediately". It is kept as optional work package WP10. |
| **Signed R2 URLs** (presigned GETs handed to the browser) | A presigned URL stays valid until it expires, whatever happens to the media in the meantime. Suspension and sign-out are not seen. | Low | **Rejected.** It is the same bearer-URL problem as today's Supabase signed URLs. Re-minting per render also defeats browser caching. |
| **Keep the application proxy** (`/api/media`, `/p/media` through `delivery.ts`) | Next request | Every image byte through Vercel, one function invocation, `getUser` and 2–3 RPCs per image | **Kept as the fallback**, and for Supabase-provider rows. It is not the target, because at the plan's scale case (about 300 GB/month) it is Vercel-bound. |
| Short-TTL HMAC ticket only | Valid until expiry; suspension not seen | Lowest | Rejected alone. Used here only to bind the URL. |
| Ticket plus Workers KV deny-list | KV writes take up to 60 s to reach other locations, plus a push pipeline that can miss events | Medium | Rejected |
| Ticket plus Durable Object deny-list | Depends on an outbox push that is not atomic with the Postgres commit; duplicates the authority | High | Rejected |
| Ticket plus PostgREST RPC with a service secret | Next request | One Supabase `edge_logs` row per image, and a broader credential | Fallback only if Hyperdrive or the new role is refused |
| **Ticket plus per-request Postgres authorization through Hyperdrive** | **Next request** | One indexed function call per image | **Chosen** |

## Scope

In scope: the five revocable namespaces, the R2 bucket, the `media-edge` Worker, the two edge functions and the `media_edge` role, the WebP variants, edge ticket issuance in the app (`frontend/src/server/storage/edge-ticket.ts`), and the flags `MEDIA_EDGE_DELIVERY_ENABLED` and `MEDIA_EDGE_PUBLIC_ENABLED`.

Out of scope: business-verification documents (PR #88), purchase-request and chat media, and the Mode B public publisher (WP10, dropped: D1 closed on 2026-10-19 in favour of immediate revocation).

## What is deferred

- **Every hosted step**, each needing owner approval: applying the migrations, the `media_edge_worker` login role, Hyperdrive with caching disabled, the private bucket and its lifecycle rule, the media zone and hostname (D4), Workers Paid (D5), the `TICKET_KEYS` Worker secret, and the Vercel variables `MEDIA_EDGE_*` and `R2_*`. The exact steps are in [`edge/media-worker/README.md`](../../edge/media-worker/README.md).
- The variant backfill for media migrated from Supabase (`scripts/media-variants.mjs`, not written yet). It must read the R2 copies, so it spends no Supabase egress.
- The scheduled revocation canary (planned in [media-monitoring.md](../operations/media-monitoring.md)).
- Deleting Supabase source objects. This needs at least 30 days, a clean `rehash` pass and separate approval.
- Owner decision D1 is closed: public media keeps immediate revocation (Mode C), chosen 2026-10-19. Still open: D2 (whether product images and logos become public; recommendation: no), D3 (egress timing for the bulk copy), D4 (media domain) and D5 (Workers Paid).

## Consequences

- **Cost:** about **$5/month** for Workers Paid in production. On the Free plan, Workers (100k requests/day), Hyperdrive (100k queries/day) and the 10 ms CPU limit fail hard once exceeded. R2 storage and operations stay inside the free tier at current volume and at the plan's scale estimate. A new domain, if one is chosen, costs about $10–15 a year (to verify).
- **Latency and load:** **one database round trip per image** through Hyperdrive. That is a few milliseconds in-region and more from distant edges, plus a few hundred bytes of pooler traffic per call.
- **Supabase egress:** from a measured baseline of **about 1.4 GB/month** (plus bursts) to **about 0.05–0.15 GB/month**, which is Auth and REST traffic plus the Hyperdrive authorization bytes. The one-off migration costs about 0.273 GB. Image bytes leave both Supabase and Vercel.
- **Auth logs:** the per-image `getUser` call on `/api/media` ends for R2 rows once edge delivery is on. Until then the proxy keeps calling Auth on each private read, so sign-out is seen at once (commit `26edd40`).
- **Operations:** a second platform account (Cloudflare) holds a production secret (`TICKET_KEYS`). Key rotation: add `k2`, switch the app to `k2`, wait 5 minutes, remove `k1`.
- **New runtime dependency:** `postgres` (porsager) 3.4.9 in the Worker only, justified in the Worker README.

### Limits that remain

- **Bytes already delivered cannot be recalled.** That includes a response already streaming and any copy a browser has cached or a user has saved. Revocation only stops later requests.
- **A copied private URL can be replayed for at most 120 s, and only while its viewer is still authorized and signed in.** The ticket binds the viewer's session, and the database checks that session on every request. This is no wider than the 30–300 s signed URLs it replaces.
- Mode C revalidation still means one Worker request and one database call per view, including `304` responses.
- Legacy `provider='supabase'` rows use the proxy and Vercel bandwidth until they are migrated.

## Related files

- Plan and evidence (outside the repository): `/mnt/project-files/showroom-admin/r2-delivery-architecture.md`, `/mnt/project-files/showroom-admin/supabase-usage-audit.md`
- Worker: [`edge/media-worker/README.md`](../../edge/media-worker/README.md), `edge/media-worker/src/`, `edge/media-worker/wrangler.toml` (template)
- Database: `supabase/migrations/20261018100000_rc2_verified_media_storage.sql` through `20261018100003_rc2_private_media_application_delivery.sql`, `supabase/migrations/20261019100000_media_edge_authorization.sql`, `supabase/tests/99_media_edge_authorization_test.sql`
- App: `frontend/src/server/storage/edge-ticket.ts`, `frontend/src/server/storage/delivery.ts`, `frontend/src/lib/env/storage.ts`
- Operations: [media monitoring and migration runbook](../operations/media-monitoring.md), [auth session reads](../frontend/auth-session-reads.md)
- Earlier decisions: [ADR-0017](ADR-0017-rc2-private-media-integration.md), [ADR-0009](ADR-0009-vercel-services-deployment.md), [professional asset storage](../database/professional-asset-storage.md)
