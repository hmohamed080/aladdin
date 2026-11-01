# Admin View-As — Stage 4: private media delivery (design, security, status)

**Status:** implemented and tested LOCALLY on branch `feat/admin-view-as-private-media-20261101` (separately reviewable; based on the integration branch). **Nothing is activated or deployed.**
Both delivery switches are OFF by default, no migration has been applied to any hosted database, and the Worker route is not enabled anywhere.
Refines [ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md); Stage 3 context in [`ADMIN_VIEW_AS_ARCHITECTURE.md`](ADMIN_VIEW_AS_ARCHITECTURE.md).

## What it does
Inside a live View-As session an Admin sees the viewed craftsman's **portfolio images** and **certificate files** (image or PDF) instead of placeholders, through the **existing**
Cloudflare R2 + `media-edge` Worker architecture. Videos stay details-only (they use the separate HLS system). Avatars are supported by the database function but not rendered
yet (see Outstanding).

## Architecture (one authorization system, extended — not duplicated)
```
Admin page (server)                 Browser                       media-edge Worker                 Postgres (authority)
 readers return record ids   →   <img src=/a/<kind>/<variant>?t=T>  →  verify T (HMAC, prefix v1)  →  media_edge_view_as_authorize(...)
 mint T (≤120 s) from the                                              no authorization logic          re-checks EVERYTHING per request
 Admin's own session client                                            reads R2 only on a grant        → grant {object, type, size, sha256} | null
```
- **Reused unchanged:** R2 private bucket, the Worker, `TICKET_KEYS`, `media_edge` role + Hyperdrive, `app.media_edge_grant`, the byte/serve code path, the 404-for-everything denial.
  The **owner** delivery path (`/m`, `media_edge_authorize`) is untouched and has its own regression assertions.
- **Added:** database function `public.media_edge_view_as_authorize` (migration `20261101090004`, granted to `media_edge` only), Worker route `/a/<kind>/<variant>` behind `VIEW_AS_ROUTES=on`
  (default off), and a **separate ticket type** with its own HMAC domain-separation prefix `aladdin.media-view-as.v1.` (an owner or video ticket cannot be replayed here, nor the reverse).

## Security properties (each is test-enforced)
| Requirement | How |
|---|---|
| No raw R2 key or path ever reaches the browser | The ticket names a **database record id** (`rid`: portfolio item / certificate / avatar upload) and the viewed account, never an object key. The key is resolved inside the database. Tests decode a minted ticket and assert no key, path, extension or file name is present; the page HTML is asserted free of keys. |
| Every object belongs to the viewed account via authoritative metadata | The record must be the subject's own and `ready`; the verified, not-cleaned **R2 location** (`media_storage_locations`) must have `owner_user_id` = the subject. Another account's record, a wrong kind, a pending/deleted record, a missing location, or a location owned by someone else → `null` (pgTAP 119). |
| Admin permission, Auth session and View-As session revalidated **on every media request** | The function runs the same gate as the readers (`app.view_as_active`: `users.view_as`, rank rules, subject eligibility, a live audited view session **bound to the Admin's current Auth session**), plus the Auth session row itself. Nothing about authorization is cached in the Worker or the ticket. Exit, sign-out, permission revocation, admin suspension, record deletion and R2 clean-up each deny the **next** request (pgTAP: 54 assertions incl. positive controls). |
| No public access, no Supabase Storage fallback | R2 provider rows only; legacy `supabase`-provider rows return `null`. The app minter returns `null` (placeholder) when anything is off — it never falls back to the application proxy URL the owner path uses. Responses carry `private, no-store`, `nosniff`, a sandbox CSP and no object key. |
| Owner-media delivery preserved | `media_edge_authorize` and `/m` are unmodified; pgTAP 119 §F and the Worker's existing 18 handler tests still pass; test 99's exact `media_edge` grant list now also names the new function (a deliberate, reviewable change). |
| No orphan files / no duplicate authorization system | View-As is **read-only**: it creates no objects, uploads or rows. There is one authority (Postgres) and one Worker. |
| Read-only guard stays strict | The minter reads only the four `MEDIA_EDGE_*` variables through a minimal reader (it may not import the storage env module, which names the service-role key, nor `server/storage/media.ts`). The transitive import-graph test passes unmodified. |

## Switches (all OFF by default)
`ADMIN_VIEW_AS_ENABLED` (Stage 3) + `ADMIN_VIEW_AS_MEDIA_ENABLED` + `MEDIA_EDGE_DELIVERY_ENABLED` (+ origin/kid/secret) in the app; `VIEW_AS_ROUTES=on` on the media-edge Worker (unset = off).
Hosted media delivery needs **all** of them plus the migration, and needs the owner's explicit approval.

## Tests
pgTAP `119_admin_view_as_media_test.sql` (54 assertions); Worker `view-as.test.ts` (route, ticket, domain separation, strict schema, no existence oracle, every lifecycle flip) and shared
cross-language vectors generated independently with Python HMAC; app `media-ticket.test.ts` (parity with the Worker's verifier, env parity with the owner schema, expiry parity, no key in the ticket,
off-by-default, no fallback); section tests (links vs placeholders). Permission contract `20261101090004.json` (714 functions match the live schema).

## Coordination with the existing R2 workstreams (no duplicate authorization system)
- `feat/r2-media-backup-20261031` / `claude/project-thread-yjnwej` (migration `20261029120001_media_id_storage_keys`, edits to `edge/media-worker/src/handler.ts` and `server/storage/media.ts`) is **unmerged**. It touches the same `handler.ts`; expect a small, mechanical merge conflict at the route table. If that work changes how keys are derived from record ids, `media_edge_view_as_authorize`'s record→key lookups (3 `select`s) are the only code to adapt.
- `integration/unified-registration-r2-20261031` (PR #126) and `integration/whatsapp-otp-worker-r2-20261031` (PR #127) change Worker/media-worker deployment files and carry migrations `20261030090001/02`. Order of migrations matters (see the rollout plan): do not apply `20261101…` to a shared database before deciding the order.

## Outstanding risks / not done
1. **Not activated or deployed anywhere.** Needs the migration, the Worker route and all switches; hosted media delivery requires a separate approval.
2. **No synthetic media objects exist on Acceptance.** The fixture's file rows are metadata only (keys point at nothing), so the first hosted review would show broken/blocked images until real test objects are uploaded under the fixture account — a separate approval (it writes to the private R2 bucket).
3. **Avatar** is supported by the database function but not rendered: the Stage 3 profile reader exposes only `has_avatar`, not the upload id. Rendering it needs a reader change (a small migration).
4. **Videos** are not covered (HLS tickets are a different system).
5. **Per-file audit:** one audit row exists per view **session** (Stage 2); individual media reads are not logged (volume). A count/last-access summary could be added if the owner wants it.
6. **Certificates are sensitive documents:** an Admin with `users.view_as` can open them (decided: same population that already reviews verification documents). Tickets are ≤120 s, the link opens in a new tab with `noopener`/`no-referrer`.
7. **Variants:** images are served as `original` (no thumbnail pipeline reuse yet), which is heavier for large photos.
8. **Residual window:** a ticket already minted stays usable for at most its remaining life (≤120 s) *only if every database condition still holds*; any change in those conditions denies it immediately.
