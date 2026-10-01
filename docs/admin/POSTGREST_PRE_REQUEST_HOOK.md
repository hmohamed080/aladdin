# PostgREST pre-request hook — architecture, Production incident, regression proof

Status (2026-10-01): the corrected design (migration `20260930100005`) is built and fully validated **locally**. **Production currently runs with the hook DISABLED** (emergency config reset) even though migration `20260930100002` is recorded as applied. `20260930100005` has **not** been applied anywhere hosted.

## 1. Why a hook exists

PD-010 (suspended accounts cannot use the product) is enforced centrally: PostgREST runs the function named by `pgrst.db_pre_request` before every Data API request, after switching to the request role. `app.api_pre_request()` reads the JWT claims and `request.path`, refuses a suspended/deactivated `authenticated` caller with `42501 account suspended` (hint `account_suspended`), and lets `my_account_status`, `anon` and `service_role` through. That function is the **only** place the rule lives.

## 2. Production incident (2026-10-01)

- Migration `20260930100002` set `alter role authenticator set pgrst.db_pre_request = 'app.api_pre_request'`.
- PostgREST resolves and prepares the hook **as the request role**, so that role needs `USAGE` on the hook's schema. `anon` and `authenticated` hold `USAGE` on `app`; **`service_role` deliberately does not**. Requests made with the service-role key (installer phone pre-check, `pending_registration_save`) failed **intermittently** with `permission denied for schema app` — only on cold/new pooled connections and around config/schema reloads, which is why warm checks, the pgTAP suite (which calls the function directly) and a first browser pass all looked healthy.
- **Emergency rollback (manual, in Production):** `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';` Service-role queries recovered; anon traffic, the Platform Admin session and the Admin pages are healthy; no 5xx. **No migration was rolled back** — `20260930100002` stays in migration history, so Production now has **no suspension enforcement through the hook** (the DB-side helpers `has_capability` / `is_org_member` / `require_verified_caller` and the middleware gate still apply). Do not re-enable the hook until `20260930100005` is applied as a controlled step.
- Stage C (`20260930100003`, `100004`) is unaffected and stays.

## 3. Why not `GRANT USAGE ON SCHEMA app TO service_role`

`service_role` already has `EXECUTE` on 37 of ~130 `app` functions (24 explicit, 13 via the default `PUBLIC` grant), including SECURITY DEFINER helpers such as `app.organization_create_owned`. They are unreachable today only because the schema is closed to it; a schema-wide `USAGE` grant would open all 37 for the sake of one function. **Not approved.**

## 4. The fix — migration `20260930100005_postgrest_hook_service_role_compatibility.sql`

```
PostgREST → pgrst_hooks.pre_request()  (SECURITY DEFINER, owner postgres, search_path = '')
              └─ perform app.api_pre_request()      -- unchanged; stays the canonical rule
```

- New schema `pgrst_hooks` (owner postgres, `PUBLIC` revoked) holding **exactly one function and nothing else**; `USAGE` only (no `CREATE`) for `anon`, `authenticated`, `service_role`.
- `pgrst_hooks.pre_request()` — `STABLE SECURITY DEFINER`, `search_path = ''`, `EXECUTE` revoked from `PUBLIC` and granted to the three request roles. Its body is one `perform app.api_pre_request()`: **no business rule is duplicated.** Because it runs as the owner it needs no access to `app` from the caller.
- Schema `app` is untouched: ACL still `{postgres=UC, anon=U, authenticated=U}`; `service_role` has **no** `USAGE`; its 37 executable `app` functions are unchanged; `app.api_pre_request()` keeps its existing grants.
- `alter role authenticator set pgrst.db_pre_request to 'pgrst_hooks.pre_request'; notify pgrst, 'reload config';` — **applying the migration activates the hook.**
- Not an API surface: PostgREST exposes only `public`/`graphql_public`; `POST /rest/v1/rpc/pre_request` → 404 and `Content-Profile: pgrst_hooks` → `406 PGRST106 Invalid schema` (verified). **Production check before applying:** confirm the project's exposed-schemas setting is still `public, graphql_public`.

## 5. Regression proof (local, Production-matched stack: PostgREST v14.5, Postgres 17.6.1.155)

| Check | Result |
|---|---|
| pgTAP `69_postgrest_hook_service_role_compatibility_test.sql` (structure, grants, role config, anon / active / admin / service_role / unknown + malformed subject / suspended / deactivated, delegation, no widening of `app`) | 34/34 |
| HTTP `supabase/tests/pgrst_pre_request_hook_api_test.mjs` against a real PostgREST — anon, authenticated active, **pending**, Administrator, service_role, installer phone pre-check, installer sign-up chain, `pending_registration_save`/`consume`, suspended account | 28/28 |
| **OLD-hook control** (`HOOK_MODE=old`, hook = `app.api_pre_request`; 3 cold-connection cycles with DDL + config-reload churn) | **43 of 3,330 requests failed (1.3 %)** — every one `service_role` `403 permission denied for schema app`; anon/authenticated unaffected → the test catches the bug |
| **FIXED hook** (same churn, `CYCLES=3`) | **0 of 3,300 failed** |
| Full clean-database suite (`supabase db reset` then `supabase test db`, 86 migrations) | 71 files / 2,858 tests PASS |

Run it: `supabase db reset`, then `node supabase/tests/pgrst_pre_request_hook_api_test.mjs` (fixed hook: must pass), `HOOK_MODE=old node …` (control: must reproduce the failure, exit 0), `CYCLES=3 node …` (stress). The old-hook failure rate is load/timing dependent (about 1–5 % of service-role requests); the control requires at least one reproduction.

## 6. Production rollout order (not executed)

1. Apply `20260930100005` as its own controlled step with real anon / authenticated / Administrator / service_role requests ready to verify (including a cold-connection burst and the installer pre-check) and the documented rollback at hand.
2. Only then `20260930100006` (platform-account preparation), cleanup + preparation, Super Admin bootstrap.
3. The business-account activation proposal (BL-033) stays out of the executable migration paths (`docs/admin/proposals/` only).

Related: [BL-035](ADMIN_IMPLEMENTATION_BACKLOG.md) (user deletion vs. append-only `audit_log`, found while building the HTTP test), [`ADMIN_USER_ORG_OPERATIONS.md`](ADMIN_USER_ORG_OPERATIONS.md) §12.
