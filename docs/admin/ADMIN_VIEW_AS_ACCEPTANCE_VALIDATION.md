# Admin View-As (#193): Acceptance validation runbook

**Status:** PREP ONLY (2026-11-14). Nothing here has been applied. No hosted migration, deploy or write was made. Applying any migration to
Acceptance or Production, merging, or enabling the flag on a hosted Worker each needs a separate, explicit owner approval.
**Scope:** PR #193 (`feat/admin-view-as-rebased-20261114`), stacked on #192 (`feat/admin-real-verify-rebased-20261114`).
**Not blocking #192:** #192 stands alone and merges first. #193 only adds files and migrations *after* #192's `20261114090001`; nothing in #192
depends on them. If #193 is delayed, #192 ships unchanged. Acceptance apply order below is the only coupling.

## 1. Migrations, in apply order

| Order | Version | Belongs to | Content | md5 (CR stripped) |
|---|---|---|---|---|
| 1 | `20261114090001` | **#192** | verification apply reviewer gate | `9a6e939f6dfd340344f6e61ae41fbba6` |
| 2 | `20261114090002` | #193 | view-as foundation: permission, `admin_view_sessions`, `app.require_view_as`, begin/current/end/end_all | `7f54a270b3d3efe2f440d9a748daac38` |
| 3 | `20261114090003` | #193 | craftsman section readers (`admin_view_craftsman_*`) | `392bfca9c9874655d17836ca7b129164` |
| 4 | `20261114090004` | #193 | `admin_view_as_media_open` + audit action `admin.view_as.media_read` | `9bd6fdcd8b0a8e13cd4b7d15fe5f9906` |

`090001` is #192's; if #192 is already applied on Acceptance, #193 needs only 2 to 4 (`EXPECTED_FROM=090002`). The three #193 migrations are
additive and dormant unless `ADMIN_VIEW_AS_ENABLED=true`. Exact function-permission contracts: `supabase/permissions/20261114090002..4.json`.
Rollback is forward-only: unset the flag; then a forward migration deleting the `users.view_as` rows of `admin_role_permissions` (every
`app.require_view_as` then fails closed) and, if wanted, dropping the `admin_view_*` functions.

### Preflight (read-only; owner approval NOT needed to run, needed before any apply)
`scripts/view-as-acceptance-preflight.sh` (updated to the 2026-11-14 numbering and hashes) from a checkout of the #193 branch, CLI logged in and
linked to Acceptance (`nxossqhdfltcqdwvbewi`). It refuses any other project, checks the hashes, runs `scripts/migration-history-guard.mjs --expect plan`,
checks the pending set is exactly the expected one and prints `db push --dry-run`. It never applies.
The apply itself is `supabase db push --linked`, run by the owner **only after the owner approves the apply**.

## 2. Check matrix

**L** = runs locally / in CI with no hosted resources. **A** = needs Acceptance: real migrations (owner approval to apply), a real Auth session and
real R2 bytes.

| # | Check | Where | Evidence |
|---|---|---|---|
| 1 | Allowed viewer gets exact bytes of an image and of a certificate through the same-origin route | **L** (route + fake store) / **A** (real R2) | `authorization-matrix.test.ts` "allowed viewer"; A: section 3 step 4 |
| 2 | Unauthorized caller (no `users.view_as`, non-staff) gets the generic refusal | **L** / **A** | matrix test; pgTAP 131 A; A: step 5a |
| 3 | Expired view session, same refusal | **L** (model) + **L** pgTAP 129 (real DB) / **A** (real clock) | matrix test; pgTAP 129; A: step 5b |
| 4 | Expired / signed-out **Auth** session, same refusal | **L** (`getUser` null) / **A** (real GoTrue revoke) | matrix test; A: step 5c |
| 5 | Exit View-As **mid-fetch** cuts the file | **L** (re-authorization after fetch) / **A** (large object, Exit during download) | matrix test; route.test.ts; A: step 5d |
| 6 | Wrong-owner media id, wrong namespace, pending, non-R2, non-existent id: identical refusal | **L** (pgTAP 131 D + matrix) / **A** (real ids) | pgTAP 131; matrix test byte-identical fingerprint |
| 7 | Refusals are byte-identical (status, headers, empty body) incl. upstream 404/5xx/3xx/oversize/type | **L** | matrix test "byte-identical" |
| 8 | No service-role client, no shared resolver, exactly one RPC | **L** | `view-as-read-only.test.ts` import guard + matrix runtime Proxy trap |
| 9 | Redirects never followed (`redirect: "manual"`, one storage request) | **L** / **A** (cannot be forced on real R2; code-path proof only) | matrix test |
| 10 | Strictly read-only: no mutating RPC/route reachable from view-as; live session confers no write on the subject | **L** | `view-as-read-only.test.ts` (import graph, RPC allow-list), pgTAP 134 (exact gate-caller list; RLS refuses all writes during a live view; subject data unchanged) |
| 11 | Shared resolvers (`media_storage_resolve`, `/api/media`, edge ticket) still refuse an admin inside a view | **L** pgTAP 131 E, 134 C / **A** (spot check) | pgTAP |
| 12 | One audit row per session+media, never the key | **L** pgTAP 131 C / **A** (query `audit_log`) | pgTAP |
| 13 | Migrations apply cleanly in order on Acceptance's real history, permission contracts match | **A** (owner approval) | preflight + `migration-permission-gate.mjs` |
| 14 | Real signed R2 URL serves the object; `Sec-Fetch-Site` same-origin from a real browser `<img>`/`<a>` | **A** | step 4 |

## 3. Acceptance procedure (after the owner approves the apply)

Prerequisites: #192 migration applied (or applied together), the three #193 migrations applied by the owner, a Preview Worker with
`ADMIN_VIEW_AS_ENABLED=true` and R2 enabled for that Worker only (rollout plan section 4), the owner's own Super Admin/Administrator login (the
existing `ACCEPTANCE_ADMIN_*` mechanism; never pasted into chat), one craftsman with a ready avatar, one portfolio image and one certificate that
exist on R2, and a second craftsman with a certificate. Record only opaque ids, status codes and byte hashes, never keys, URLs or tokens.

1. Preflight output attached to the approval request. After apply: re-run preflight in up-to-date mode; `select version from supabase_migrations.schema_migrations where version >= '20261114090001'` shows four rows (read-only).
2. Read-only SELECT: `has_function_privilege('authenticated','public.admin_view_as_media_open(uuid,text,uuid)','execute')` is true, and `anon`/`service_role` false.
3. Sign in as the admin, Start View-As on craftsman A (audit row `admin.view_as.begin`).
4. In the view: image and certificate load; `sha256sum` of the downloaded bytes equals the object's recorded `sha256` in `media_storage_locations` (SELECT). Network log shows only same-origin requests, `cache-control: no-store`, no `X-Amz` in any response header.
5. Refusals, each expecting an empty 404 with identical headers (compare with `curl -i`, same cookie jar where needed):
   a. a Support/Moderator account (no `users.view_as`) hitting the same URL;
   b. the same URL after the 30-minute view TTL elapsed (or after the owner shortens it on Acceptance only);
   c. the same URL after sign-out / session revocation of the admin's Auth session;
   d. Exit View-As while a large certificate download is in flight: the stream errors or truncates, nothing further is served, a new request is 404;
   e. craftsman B's media id under craftsman A's view, a random UUID, and a valid id under the wrong namespace.
6. SELECT `audit_log` where `action='admin.view_as.media_read'`: one row per distinct media id for the session, none containing an object key.
7. Exit; confirm media URLs are 404 again.

## 4. Local results (2026-11-14)

Run against a scratch database `c2_viewas` created by restoring the local stack's `postgres` database (migrated through `20261112090001`), then applying
`20261114090001..090004`; the scratch database is the only thing written (no hosted project touched).

| Suite | Result |
|---|---|
| vitest: `app/admin/users`, `features/admin-view-as`, `server/view-as`, `lib/admin/view-as` | 13 files / 119 tests passed before this change; the new `authorization-matrix.test.ts` adds 27 (media dir: 39 passed) |
| pgTAP 129 foundation | 64 ok, 0 not ok |
| pgTAP 130 craftsman sections | 32 ok, 0 not ok |
| pgTAP 131 private media | 23 ok, 0 not ok |
| pgTAP 134 strictly read-only (new) | 10 ok, 0 not ok |

CI: `supabase-rls` already runs every file under `supabase/tests` (`supabase test db`), so 134 is wired automatically; the frontend job runs the
vitest suite. `supabase-rls` triggers on PRs to `main`; for the stacked #193 use `workflow_dispatch`.
