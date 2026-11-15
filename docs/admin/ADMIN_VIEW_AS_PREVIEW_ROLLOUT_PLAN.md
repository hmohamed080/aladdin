# Admin View-As — Acceptance migration preflight and isolated Preview plan

**Status:** PLAN ONLY (2026-11-01). Nothing here has been applied. No hosted migration, Worker deploy, branch-policy change, secret or
flag change was made. Production is untouched, and `ADMIN_VIEW_AS_ENABLED` stays unset (off) everywhere except the one isolated Preview Worker once approved.

## 1. Acceptance migration state (read-only, 2026-11-01)

Read with the official CLI (`supabase migration list --linked`, temporary login role, SELECT-only). Acceptance = `nxossqhdfltcqdwvbewi`.

| Set | Count | Notes |
|---|---|---|
| Repository `main` | 193 | latest `20261027090001` |
| Acceptance | 197 | = all of `main` + 4 Registration migrations |
| Registration-only versions already on Acceptance | 4 | `20261028090001`, `20261028090003`, `20261029090001`, `20261029090002` (in `claude/registration-resume`, not in `main`) |
| View-As stack, not on Acceptance | 3 | `20261114090001`, `…090002`, `…090003` |
| On `main`, missing on Acceptance | 0 | |

**Correction to the earlier report:** `20261026090001` and `20261027090001` are NOT pending. They are on `main`, on Acceptance, and (per the work log) already pushed to Production. Nothing from `main` is missing anywhere.

### Consequence for ordering
All three View-As versions sort AFTER the newest remote version (`20261029090002`), so they are a normal forward apply, not out-of-order.
But the View-As branch does not contain the four Registration migrations, so `supabase db push` / the history guard run from it would report
"remote-only" history drift. They must therefore be applied from a branch that contains both stacks (section 3). Migration history is never edited by hand.

### Dependency order and compatibility
1. `20261114090001_verification_apply_reviewer_gate` — replaces the verification apply RPCs, adds the internal `app.assert_assigned_reviewer`, default listing opt-in to false. Independent of View-As.
2. `20261114090002_admin_view_as_foundation` — permission `users.view_as`, audit actions, `admin_view_sessions`, gate functions, begin/current/end/end_all. Needs the admin RBAC tables (present).
3. `20261114090003_admin_view_craftsman_sections` — six readers. Needs 2.

Compatibility with the four Registration migrations: none of my migrations reference their objects (no `account_basics`, `user_specialties`, `pending_registrations`, username-lease), and they redefine none of my functions. Registration alters `public.users`/`public.profiles`; the View-As readers use explicit column allow-lists, so added columns are not exposed.
Trial merge of `claude/registration-resume` into the View-As stack: 3 mechanical conflicts only — `server/actions/auth.ts` (keep Registration's body plus the `admin_view_as_end_all` call), its test `auth-sign-out.test.ts`, and the pgTAP `41_trade_taxonomy_test.sql` allow-list (union of both lists). The throwaway worktree was deleted.

### Preflight checks (`scripts/view-as-acceptance-preflight.sh`, read-only)
- Linked project is exactly Acceptance and not Production.
- Each migration file matches its reviewed md5 (CR stripped): `…090001` 9a6e939f6dfd340344f6e61ae41fbba6 · `…090002` 7f54a270b3d3efe2f440d9a748daac38 · `…090003` 01efab95f07e8fea96226300ea866854.
- `scripts/migration-history-guard.mjs --expect plan` passes (no drift, no out-of-order).
- Pending set is exactly the three versions (anything else means another workstream moved Acceptance — stop and re-plan).
- `supabase db push --linked --dry-run` lists the same three.
- Then, separately: local fresh-replay and upgrade-replay on the combined branch, full pgTAP, and the permission-contract gate (`supabase-rls` job).

### Apply (owner-run, only after a separate approval)
`supabase db push --linked` from the combined branch, as for `20261027090001`. Afterwards re-run the preflight in `--expect up-to-date` mode and `supabase test db`-equivalent hosted checks (admin sees `users.view_as`, anon/authenticated cannot read `admin_view_sessions`).

### Rollback
Forward-only. The new objects are additive, and the whole surface is dormant unless `ADMIN_VIEW_AS_ENABLED=true`, so the first rollback step is the flag.
Database kill switch: a forward migration that deletes the `users.view_as` rows from `admin_role_permissions` (every `app.require_view_as` then fails closed) and, if needed, drops the `admin_view_*` functions. `…090001` is reversible by a forward migration that restores the previous function bodies and listing default.

## 2. Isolated Preview (proposal — not created)

The existing Worker `aladdin-frontend-preview` is untouched and stays on the Registration branch.

| Item | Proposal |
|---|---|
| Worker | new wrangler env `viewas-preview` → Worker `aladdin-frontend-viewas-preview` (workers.dev) |
| URL | `https://aladdin-frontend-viewas-preview.bstalent9.workers.dev` |
| Database | the same Acceptance project `nxossqhdfltcqdwvbewi` (workflow guard refuses `kkpkgjrweysgvhvkhzun`) |
| Code branch | new integration branch `integration/view-as-registration-<date>` = `claude/registration-resume` + View-As stack (+ conflict resolution above). Never `main`. |
| Vars | `NEXT_PUBLIC_APP_ENV=staging`, `ADMIN_VIEW_AS_ENABLED=true`, `APP_PUBLIC_ORIGIN` and `TURNSTILE_ALLOWED_HOSTNAMES` = the new hostname, `REDIS_KEY_ENV=cf-viewas` (separate cache keys), `R2_STORAGE_ENABLED=false` (no hosted media delivery until Stage 4 is approved) |
| Services | `WORKER_SELF_REFERENCE` → itself; `BACKEND` → existing `aladdin-backend-preview` (shared, unchanged) |
| Cost | No new fixed cost: Workers Paid is a flat account subscription already needed by the existing Preview; usage billing starts only above 10 M requests/month (review traffic is far below). Estimate, from `cloudflare-cost-scalability-2026-10-22.md`; billing was not inspected. |
| Impact on others | None to the shared Preview Worker, its secrets, or Registration testing. It shares the Acceptance database and the backend preview service. |

Authorization/configuration needed before anything is created (report-first, none requested yet):
1. **Cloudflare Access** must cover the new hostname (the existing protection is per application/hostname); a new `workers.dev` Worker is otherwise public.
2. **Worker secrets** (Supabase keys the app already uses, Turnstile secret, etc.) must be set on the new Worker by the owner; values cannot be copied between Workers and must not be pasted in chat.
3. **Acceptance Auth redirect/site allow-list** must include the new origin for sign-in; Turnstile hostname list likewise.
4. **GitHub**: a deploy workflow for the new env, and the `cloudflare-preview` environment's branch policy (currently `main`, `claude/project-thread-1bi6x0`, `claude/registration-resume`) must allow the integration branch — or a separate environment `cloudflare-viewas-preview` with its own secrets is created. Proposed (not applied): add the integration branch to the policy, or the separate environment (preferred, so Registration's environment is never loosened).
5. Wrangler env block (proposed text, not committed): copy of `env.preview` with the name, vars and `REDIS_KEY_ENV` above.

## 3. Test accounts (read-only inspection of Acceptance)

- Users: 13 (1 active, 12 `pending_verification`), none with a craftsman persona and none with the pilot seed ids. 0 job assignments, 0 points rows, 2 portfolio projects.
- Admin: exactly one `super_admin` assignment. The existing GitHub environment secrets `ACCEPTANCE_ADMIN_*` are the approved mechanism; the owner signs in with their own credentials. `users.view_as` becomes available to it only after the migrations.
- **No existing account is suitable and none should be modified.** Recommendation: create a dedicated synthetic fixture on Acceptance — one craftsman and one poster/organization with `@example.test` addresses and **no usable credential** (the craftsman never signs in; only the admin views). The sample-data script `supabase/seed-view-as-preview.sql` currently assumes the pilot seed accounts, so it needs a small self-contained variant for this fixture. This creates Acceptance data and needs separate approval.

## 4. Stage 4 (private media) design, local only
The `media-edge` Worker verifies a short-lived HMAC ticket, then calls `public.media_edge_authorize` per request (database is the authority). Proposed addition, reviewable separately:
- A distinct ticket audience (`aladdin.media-edge.view-as.v1.`) and Worker route; ticket claims admin id, admin auth-session id, subject id, namespace, key, variant, ≤120 s.
- A new definer function `media_edge_view_as_authorize` that re-checks `users.view_as`, the live view session bound to that auth session, subject eligibility, and that the object row belongs to the subject (via `media_storage_locations`). It returns the existing grant shape; deny by default.
- Responses `private, no-store`; no Supabase Storage fallback; no public URL; object keys never reach the browser. Existing user tickets are unchanged.
- Hosted media delivery stays off until separately approved.
