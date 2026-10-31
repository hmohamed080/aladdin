# Admin "View as account" — read-only account view (architecture & permission model)

**Status:** DESIGN — for review before any code or migration. Nothing here is implemented.
**Branch / PR:** `feat/admin-view-as-design-20261031` (stacked on PR #128, which touches the same Users pages).
**First account kind:** Craftsman (`installer_technician`). **Designed to be reused** for Showroom and every other account kind without changing the framework.

## 1. What the owner asked for

> When I press the eye on an account in Admin, I can see it as if I had opened it with that person's username and password.

Decided with the owner (2026-10-31):

| Decision | Choice |
|---|---|
| Mode | **Read-only view-as**, inside the Admin's own session. Full impersonation is **out of scope** (possible later, separately reviewed). |
| Data access | **Subject-scoped reads** and carefully secured admin-gated database functions. **No service-role client** in the app. |
| Rollout | Test / Acceptance only. No Production change, deployment or merge without explicit approval. |

**Relationship to the "no Use As / Profile Switcher" rule.** The product rule (CLAUDE.md, `PRODUCT_DIRECTION_GUIDE.md`) forbids *persona switching for users*: one person = one primary account type, with no mode that lets a user act as another persona. This feature is a different thing: an **Admin-surface, read-only inspection tool** for platform staff. It never changes who the Admin is, never gives the Admin the target's capabilities, never appears in any public account's navigation, and cannot write. It must stay that way — if full impersonation is ever wanted it needs its own decision and ADR.

## 2. Non-negotiable principles

1. The Admin is **always** the authenticated principal. We never obtain, mint or swap the target's Supabase Auth session; `auth.uid()` never changes; no impersonation JWT exists.
2. **Default deny.** Every layer (route, server loader, database function, media resolver) refuses unless a *new, explicit* permission is held **and** a logged view session is active.
3. **Read-only is a backend property**, not a disabled-button property (§7).
4. **One reusable seam, not a copy of the product.** Real components are reused; the data source and the link scope are the only things that change (§6).
5. Normal sessions behave **exactly** as before: every existing loader, `my_*` function and component keeps its current behavior and defaults.
6. Private data is never placed in a shared cache, and raw storage keys never reach the client (§9, §10).

## 3. Threat model (what we are defending against)

| Threat | Control |
|---|---|
| A staff member without the need reads private account data | New permission `users.view_as`, held by few roles; checked in the route **and** inside every database function. |
| A lower-ranked admin inspects a more senior admin | Rank rule mirrored from `admin_user_suspend` (§4.3). |
| Silent browsing with no trace | A view **session** row + audit event on every new session; reads require a live session in the database (§5). |
| Admin edits *their own* data believing it is the target's | View-as routes cannot reach mutating code: import-graph test + no server actions in the tree (§7). |
| Direct RPC / URL guessing by an unprivileged user | Functions are `revoke … from public, anon`; internal authorization; `invalid id` and `not permitted` are indistinguishable to the caller (§4.4). |
| Private response cached by a CDN / browser | `dynamic`, `Cache-Control: private, no-store`, no shared cache tags (§9). |
| Private media leaked via a public URL or raw key | Existing private-media ticket architecture, extended with a view-as branch; nothing becomes public (§10). |
| Secrets exposure | Credentials, OTPs, tokens and auth metadata are not in any section's projection; enforced by an explicit column allow-list per reader + a test (§6.3). |

## 4. Permission model

### 4.1 New permission

Add to the existing RBAC catalog (`admin_permissions`, mirrored in `ADMIN_PERMISSIONS` in `lib/permissions/admin.ts`):

| key | module | action | meaning |
|---|---|---|---|
| `users.view_as` | `users` | `view_as` | Open a read-only view of another user's account area (dashboard, profile, portfolio, work, points, reviews), logged. |

**Why a dedicated permission and not `users.read`.** `users.read` lets Support see a directory row (name, email, status). `view_as` exposes the *private* account surface (private portfolio items, certificates, work history, points, reviews, availability). It must be grantable independently of `users.read` and revocable without removing directory access.

### 4.2 Default grants (proposal — owner to confirm, §14)

| System role | `users.view_as` |
|---|---|
| Super Admin | yes (all permissions, locked) |
| Administrator | **yes** (they already verify accounts and see the full user record) |
| Moderator | no |
| Support | **no** (read-only help-desk role; PD-004) |
| Custom roles | no, unless an admin with `roles.manage` adds it |

A role may only be given a permission the grantor holds (`canWieldRole` already enforces this), so the permission cannot spread by accident.

### 4.3 Subject eligibility (who may be viewed)

Mirrors `admin_user_suspend` so the console never offers what the server would refuse:

* Never one's **own** account (use the normal `/home`).
* Never **Admin Staff at or above the actor's rank** unless the actor is a Super Admin.
* The subject must exist and be a real user (not deleted). **Suspended / deactivated / unverified accounts are viewable** — support and moderation need exactly those.
* `staffRankOf(...) === null` (actor cannot read ranks) → UI draws the control, the database stays the only judge (same convention as Suspend).

### 4.4 Enforcement at both boundaries

| Layer | Check |
|---|---|
| Route / server (`requireAdminRoute("/admin/users")` + new `requireViewAs(subjectId)`) | `can(access, "users.view_as")`, eligibility (§4.3), feature switch (§11). Failure → `notFound()` (same response as an unknown id; no existence oracle). |
| Database (`app.require_view_as(p_subject)`, called first by every `admin_view_*` function) | `app.has_admin_permission('users.view_as')` (platform scope), subject eligibility, **and** a live session (§5). Raises one generic `42501` for every failure. |
| Media resolver (§10) | Same predicate; revalidated per request. |

## 5. View sessions and auditing

**Requirement:** log Admin ID, target account ID, action and timestamp for every *new view session*.

New table `public.admin_view_sessions`:

| column | notes |
|---|---|
| `id uuid` | PK |
| `admin_user_id uuid` | `auth.uid()` at creation; never client-supplied |
| `subject_user_id uuid` | the viewed user |
| `account_kind text` | `craftsman` now; `showroom`, … later (registry key, §8) |
| `subject_organization_id uuid null` | for org-scoped kinds (showroom) — unused for craftsman |
| `started_at`, `expires_at` | default TTL **30 min** (owner to confirm); no sliding extension |
| `ended_at null` | set by an explicit "Exit" |

* RLS enabled; **no** table grants to `authenticated` / `anon` / `service_role`. Only the functions below touch it.
* `admin_view_as_begin(p_subject uuid, p_kind text) → uuid` (VOLATILE, `SECURITY DEFINER`): runs `app.require_view_as`, **reuses** an unexpired session for the same admin+subject+kind (a page refresh must not spam the log), otherwise inserts a row and writes audit action **`admin.view_as.started`** (`actor_user_id` = admin, `subject_type` = `user`, `subject_id` = subject, `metadata` = `{kind, session_id, expires_at}`) via the existing `app.record_audit_event`. New audit actions are appended with the existing `app.audit_actions_add` helper (never re-creating `ck_audit_action_known` from a literal list).
* `admin_view_as_end(p_session uuid)` → sets `ended_at`, audit `admin.view_as.ended`.
* **Every read function requires a live session** (`exists(... admin_user_id = auth.uid() and subject_user_id = p_subject and ended_at is null and expires_at > now())`). Consequence: the database itself refuses reads that were not preceded by a logged session — a forged direct RPC call cannot skip the audit.
* The audit entries appear in the existing audit feed (`/admin/audit`) and on the subject's own Audit tab; no new UI is needed.

## 6. Subject-scoped data architecture

### 6.1 Where the data comes from today (surveyed)

The craftsman screens read the **current user** four different ways:

1. Direct tables under owner RLS (`profiles`, `portfolio_projects`, `portfolio_items`, `professional_certificates`, `user_trades`, `user_service_areas`, `points_ledger`, …).
2. `my_*` **views** that filter on `auth.uid()` (`my_job_assignments`, `my_job_reviews`, `my_network_organizations`, …).
3. `my_*` **RPCs** (`my_work_page`, `my_work_counts`, `my_points_overview`, `my_review_monthly`, `my_profile_completion`, …).
4. The media resolver (`media_storage_resolve`, `media_edge_authorize`) keyed on `auth.uid()`.

No pattern accepts a subject id, which is why Admin cannot simply open `/home` for someone else.

### 6.2 The seam: a `SubjectReader` per account kind

Presentational components and view-model builders (`InstallerProfilePage`, `installer-work-data.ts`, `installer-dashboard-data.ts`, …) already take plain data. We add **one interface** and two implementations; production loaders are **not rewritten**:

```
AccountReader<K>                         // K = account kind (craftsman | showroom | …)
  ├─ selfReader(supabase)                // thin adapter over the EXISTING loaders (unchanged behavior)
  └─ viewAsReader(supabase, subject, sessionCtx)   // calls admin_view_* functions for the subject
```

Section pages are written once against `AccountReader` and rendered by either shell:

* `/home/...` → `selfReader` (as today).
* `/admin/users/[id]/view/...` → `viewAsReader`.

Result: no duplicated dashboards or business logic; the only new code per section is the admin adapter and its database function.

### 6.3 Database pattern per read (decision rule)

| Pattern | Use when | Security |
|---|---|---|
| **A. Admin SELECT policy** on the table: `using (app.has_admin_permission('users.view_as') and app.view_as_active(user_id))` | The section is a plain table read | `SECURITY INVOKER`, RLS-enforced, no new function. Preferred. |
| **B. Internal `app.<section>_for(p_user)`** + `my_*` rewritten as a one-line wrapper of `auth.uid()` | The `my_*` body is non-trivial and duplicating it would drift | Changes an existing function's body ⇒ **only with the existing pgTAP for that function green and an owner OK**. |
| **C. `public.admin_view_<section>(p_subject, …)`** `SECURITY DEFINER` returning the **same row shape** as the `my_*` function | A, B not workable (views filtered by `auth.uid()`) | `set search_path = ''`, schema-qualified, `STABLE`, `revoke … from public, anon`, `grant execute to authenticated` only, first statement `app.require_view_as(p_subject)`, explicit column list (no `select *`). |

Default order of preference: **A → C → B**. B is listed so the trade-off is explicit, not because we expect to use it first. Every function exposes an explicit allow-list of columns: no credential, OTP, token, session, or auth metadata column exists in any projection; a pgTAP test asserts the function result keys against a fixed list.

### 6.4 Section map (first account kind: Craftsman) — pattern to confirm while building

| Section (existing page) | Current source | Proposed pattern |
|---|---|---|
| Dashboard (`/home`) | `loadPersonalHome` (profiles, onboarding, verifications) + open-job board | A/C; the public job board is already visible to anyone and is reused as is |
| Profile (`/home/profile`, edit excluded) | `profiles`, `user_trades`, `user_service_areas`, `my_profile_completion`, `my_secondary_phone` | A for tables, C for completion; secondary phone: **masked** unless owner confirms |
| Portfolio (`/home/profile/portfolio`, certificates) | `portfolio_projects`, `portfolio_items`, `professional_certificates` | A; media via §10 |
| Work (`/home/work`) | `my_work_page`, `my_work_counts`, `my_work_companies`, `my_job_assignments` | C (views filter on `auth.uid()`) |
| Points (`/home/points`, history) | `points_balance`, `my_points_overview`, `points_ledger` | A/C — note `/admin/users/[id]?tab=points` already shows an admin ledger |
| Reviews (`/home/reviews`, history) | `my_job_reviews`, `my_review_monthly` | C |

Out of scope for this slice: Network, Settings, Offers, anything that edits.

## 7. Truly read-only

1. **No mutating code is reachable from the view-as route tree.** The view-as shell composes *read-only* section components. Components that currently embed editors or forms (`professional-profile-editor`, `availability-*`, `service-areas-editor`, `trade-selector`, `activity-selector`, …) are not rendered; the read-only variants render the same values as text. A test (precedent: `installer-jobs-work-import-graph.test.ts`) asserts that nothing under `app/admin/users/[id]/view/**` or the shared read-only sections imports `@/server/actions/**` or an editor component.
2. **Even a stray action cannot touch the target.** Server actions run as the *Admin's* session, so they can only ever change the Admin's own rows — which is why the route tree must not render them (a misleading edit of the Admin's own data is the real risk, and the import-graph test removes it).
3. **Database:** every `admin_view_*` function is `STABLE` (cannot write); the only writes are `admin_view_as_begin` / `_end` (session + audit). No `INSERT/UPDATE/DELETE` policy references `view_as`.
4. **Link scope:** 56 files hard-code `/home/...` links. A small `LinkScope` context maps a product path to the active shell (`/home/work` → `/admin/users/<id>/view/work`); the default scope is the identity function, so normal sessions are unchanged. Navigation therefore can never land on the Admin's *own* craftsman data. A test fails if a view-as page renders an `href` that begins with `/home`.
5. **Banner:** a persistent "Admin View — Read Only" bar with the subject's name, account kind, session expiry and **Return to admin** (calls `admin_view_as_end`).

## 8. Reusability: account-kind registry

The framework knows nothing about craftsmen. Each kind registers one object:

```
AccountViewDefinition {
  kind: "craftsman" | "showroom" | …
  subjectType: "user" | "organization"      // showroom = organization + member context
  sections: { key, titleKey, path, readOnlyComponent, readerMethod }[]
  nav: section keys in order
  linkScope: product-path → view-as-path mapping
}
```

* **Craftsman (this PR):** `subjectType = user`; the six sections of §6.4.
* **Showroom (future, not implemented):** `subjectType = organization` (workspace = organization + active membership); register its sections (catalog, requests, team…) and its `admin_view_showroom_*` functions. `admin_view_sessions.account_kind` and `subject_organization_id` already exist for it. **No framework change** is needed; only a new definition, readers, and database functions behind the same `require_view_as` gate. The permission can be split later (`organizations.view_as`) without touching the session model.

## 9. Privacy, caching, headers

* View-as routes: `export const dynamic = "force-dynamic"`, `revalidate = 0`, `Cache-Control: private, no-store` (and `Pragma: no-cache`), no `unstable_cache` / tag caching of any admin-view loader, no analytics events carrying the subject.
* Responses carry `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`; the route is not in any sitemap.
* No subject data is written to logs; errors map to generic keys (the existing convention).

## 10. Private media

The existing architecture stays the only delivery path (Postgres is the single authority; Worker calls `media_edge_authorize`; HMAC tickets; R2 private bucket; `Cache-Control: private, no-store`).

Extension (**a separate, later slice, §13 step 4 — needs its own security review**):

* `media_edge_authorize` / `media_storage_resolve` gain one branch: viewer is an Admin with `users.view_as` **and** a live view session for the object's *owner*, **and** the namespace is in an allow-list (`portfolio`, `certificate`, `avatar`). The ticket carries the session id (`vas`) so the check is re-evaluated on **every** request; ending the session or revoking the permission cuts access immediately (same 0 s revocation bound as the owner path).
* No raw object key reaches the browser (the ticket URL is opaque, as today); no object becomes public; nothing is copied.
* Until that slice ships, the view shows public media normally and a neutral "private file" placeholder for the rest — **the view is still useful and nothing leaks**.

## 11. Migration impact

| Item | Change | Risk |
|---|---|---|
| `admin_permissions` | 1 row `users.view_as` + `admin_role_permissions` rows for Super Admin (locked) and Administrator | Low; pgTAP 81 catalog counts updated (Super Admin "holds every permission" is count-based and stays true). |
| `admin_view_sessions` | new table, RLS on, no client grants | Low |
| Audit | 2 new actions via `app.audit_actions_add` | Low |
| Functions | `app.require_view_as`, `app.view_as_active`, `admin_view_as_begin/_end`, `admin_view_<section>` (≈6–10, pattern C) | Medium (privileged surface) — minimized by A-first, uniform gate, allow-listed columns, fixed `search_path`, tight grants |
| Existing `my_*` / RLS | **None under A/C.** Only pattern B alters them (not planned) | — |
| RLS policies (pattern A) | additive SELECT policies, each `and app.view_as_active(user_id)` | Low–Medium; each covered by an isolation test |
| Frontend | new route tree, readers, `LinkScope`; no change to existing pages' behavior | Low |

**Kill switch:** server env `ADMIN_VIEW_AS_ENABLED` (default `false`) hides the eye and 404s the routes; removing `users.view_as` from roles denies in the database. Migrations are forward-only (ADR-0002); rollback = switch off + revoke permission; objects stay inert.

**Environments:** applied only to explicitly authorized Test/Acceptance; Production only after separate explicit approval (matches the standing rule).

## 12. Test plan

* **pgTAP**: permission matrix (Super Admin, Administrator, Moderator, Support, anon, plain user, scoped-only admin → only the first two allowed); rank rule and self-view refusal; unknown id and forbidden id return the **same** error; reads without a live session fail; expired / ended session fails; session reuse (no log spam) and one audit row per new session; column allow-list per function; `STABLE`/no-write; `revoke` surface (`anon`/`public` cannot execute); isolation: viewing A never returns B's rows; existing `my_*` suites unchanged and green.
* **Vitest**: `requireViewAs` guard, reader adapters, `LinkScope` (identity default; mapping), registry shape, import-graph (no actions/editors), no `/home` hrefs, no cache directives missing, section components render with fixture data.
* **Browser** (local isolated stack, then Test/Acceptance with explicit authorization): authorized Admin sees each section; unauthorized/support gets 404; unlisted/unpublished account works; banner + Return; every link stays under the view-as base; no write requests fired (network log assertion); audit row appears.
* **Regression**: full vitest, tsc, eslint, existing pgTAP suites (identity, RBAC 81, audit 13, media, portfolio, work, points, reviews), CI jobs.

## 13. Delivery slices (stacked, each reviewable)

1. **Design (this document)** — review/approve permission model and defaults.
2. **Foundation:** permission, session table, audit actions, `require_view_as`, begin/end, `ADMIN_VIEW_AS_ENABLED`, guard + banner shell with an empty section list + tests.
3. **Craftsman sections** (§6.4) with readers, read-only components, `LinkScope`, import-graph test; wire the **eye** (craftsman rows → view-as; other kinds keep `/p/<id>`).
4. **Private media branch** (§10) — separate security review.

Each slice documents its migration impact and regression results here before it is marked ready.

## 14. Decisions needed from the owner

1. **Default grants:** Administrator + Super Admin only (proposed). Should Moderator or Support ever have it?
2. **Session TTL:** 30 minutes, non-sliding (proposed).
3. **Suspended / deactivated subjects:** viewable (proposed).
4. **Private media:** keep as the later slice (proposed) or require it before the first release?
5. **Secondary phone / contact details inside the view:** show as the owner sees them, or mask (proposed: mask the secondary phone, show the primary as the directory already does).
6. **Pattern B** (refactoring existing `my_*` bodies): not planned; confirm we stay on A/C.

## 15. Related

* [`ADMIN_RBAC_ARCHITECTURE.md`](ADMIN_RBAC_ARCHITECTURE.md) — permission catalog, roles, ranks.
* [`ADMIN_USER_ORG_OPERATIONS.md`](ADMIN_USER_ORG_OPERATIONS.md) — the suspension rank rule mirrored in §4.3.
* [`ADMIN_USERS_ORGS_READ_AUDIT.md`](ADMIN_USERS_ORGS_READ_AUDIT.md) — what the directory already exposes.
* [`../operations/showroom-admin-handoff/r2-delivery-architecture.md`](../operations/showroom-admin-handoff/r2-delivery-architecture.md) — private-media tickets and resolvers (§10).
* [`../decisions/ADR-0007-identity-and-tenancy-model.md`](../decisions/ADR-0007-identity-and-tenancy-model.md) — identity, public listing (D11/D14).
