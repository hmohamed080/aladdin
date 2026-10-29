# The 13 function-permission discrepancies — reconciliation with GitHub CI

**Status: root cause of the local/CI disagreement established; the discrepancy itself stays OPEN.** Nothing was revoked, regenerated or allow-listed. `supabase/permissions/*.json` is untouched. Hosted state was **not** read.

## 1. Result in one paragraph

The 13 functions differ from the reviewed contract **only on a newer local Supabase toolchain**. The same 194 migrations replayed under the toolchain CI uses pass the strict contract check (698 exact matches, no drift). The difference is created *before any repository migration runs*: the two toolchains start the database with different default `EXECUTE` privileges for role `postgres` on new `public` functions. All 13 functions were created before migration `20261021090007` (which removes those defaults), and each of them revokes only `PUBLIC` and `anon`, never `service_role`. Whether any **hosted** database carries the extra `service_role` EXECUTE depends on the defaults that database had when those functions were created, and that has to be read from the hosted database (read-only) — it cannot be derived from CI.

## 2. Evidence (all local; every step reproducible)

| Step | Toolchain | Result |
|---|---|---|
| A. CI environment (from the #113 `supabase-rls` run log) | CLI **2.110.0**, Postgres image **17.6.1.143**, GoTrue v2.193.0 | step *Verify fresh effective function permissions* = success, against `supabase/permissions/20261029090001.json` |
| B. Local, B1/this branch | CLI **2.122.0**, image **17.11.0.006**, GoTrue v2.197.0 | `permission_contract.mjs check` → the 13 differ (`service_role` EXECUTE = true; contract = false) |
| C. **Replay of all 194 migrations under the CI toolchain** (`npx supabase@2.110.0 start`, isolated project) | CLI 2.110.0, image 17.6.1.143, GoTrue v2.193.0 | `node supabase/tests/b1/permission_contract.mjs <container> check` → **`PASS 698 exact function permission contracts`**, strict, no accepted drift |
| D. Boot only, **no migrations**, each CLI in its own empty project | CLI 2.110.0 / 17.6.1.143 | default ACL for `postgres` on `public` functions = `{postgres=X/postgres}` |
| | CLI 2.122.0 / 17.11.0.006 | `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` |
| E. Rolled-back experiment on the local DB | 2.122.0 | with those defaults in place, `create function …; revoke all … from public, anon; grant execute … to authenticated;` leaves `service_role` EXECUTE = **true** (ACL `{postgres=X, authenticated=X, service_role=X}`) |
| F. Committed fingerprint `scripts/hosted-db/local-noseed-detail.txt` (2026-10-25) | recorded for the production post-migration check | all 13 have `acl=authenticated=X/postgres,postgres=X/postgres` — no `service_role` |

Notes on what was ruled out: a bare `docker run` of the two images shows *identical* default privileges (both include `service_role`), so the Postgres image alone is not the cause; the difference appears once the Supabase CLI has bootstrapped the project (step D), so it is a CLI/bootstrap difference between 2.110.0 and 2.122.0 (which of the two components is responsible was not isolated further). The ordering is confirmed by the migration history: `20261021090007_restrict_rc2_function_creator_defaults.sql` is the first migration that revokes the function defaults; the 13 functions are defined in `20261017134139` … `20261021090004`, all earlier.

### Migration replay order
| Function | Defined in | Grants it makes |
|---|---|---|
| `account_entry_allowed(text)` | 20261017134139 | revoke all from public, anon / grant authenticated |
| `branch_location_set`, `organization_legal_name_set` | 20261020090001 | revoke execute from public (and anon) / grant authenticated |
| `admin_users_directory` | 20261021090003 | revoke execute from … / grant authenticated |
| `account_password_confirm`, `admin_phone_cooldown_override`, `admin_phone_cooldown_status`, `my_secondary_phone`, `secondary_phone_{cancel,change,make_primary,renew,reserve}` | 20261021090004 (`account_password_confirm` is redefined in 20261024090002; `create or replace` keeps the ACL) | revoke all from public, anon / grant authenticated |

None of them revokes `service_role`. Every other reviewed function does (or was created after `…090007`), which is why exactly these 13 are affected.

## 3. Intended grants and legitimate callers

* **Intended:** the reviewed contract (every version since the first `20261021090004.json`) says `authenticated` only; the production fingerprint above agrees.
* **Callers:** every call site in `main`, #113, #116 and #114 (`frontend/src/**`) invokes these through the **signed-in user's** client, never the admin/service client (zero admin-client references in each calling file). No `backend/`, `edge/` or script calls them. The functions that read `auth.uid()` (11 of 13) refuse when called with a service-role key, because there is no caller identity; the two admin helpers (`admin_phone_cooldown_status`, `admin_users_directory`) resolve the caller through the same helper and are `authenticated`-only in intent.
* **Consequence if the grant exists:** low direct exposure (service role already has far broader access and these refuse without `auth.uid()`), but it is a deviation from the reviewed least-privilege contract and it makes the CI gate unable to see it.

## 4. Why CI cannot see it, and what to do

CI passes because its toolchain never creates the extra grant. The gate therefore validates the *toolchain*, not hosted reality. Two consequences:
1. A hosted database built when function defaults included `service_role` (as the acceptance rebuild's table defaults did — see the comment in `20261024090001_revoke_platform_default_privileges.sql`) may carry the grant while CI stays green.
2. Developers on a newer CLI see failures that CI does not. Pin the CLI version in the dev docs, or run the existing `local-default-privileges-reset.sql` step first.

### Recommended actions (separate PR; none taken here)
1. **Owner, read-only on each hosted database** (Acceptance, Production), a single query decides everything:
   ```sql
   select p.oid::regprocedure as fn, has_function_privilege('service_role', p.oid, 'execute') as service_role_exec, p.proacl::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('account_entry_allowed','account_password_confirm','admin_phone_cooldown_override',
     'admin_phone_cooldown_status','admin_users_directory','branch_location_set','my_secondary_phone','organization_legal_name_set',
     'secondary_phone_cancel','secondary_phone_change','secondary_phone_make_primary','secondary_phone_renew','secondary_phone_reserve');
   ```
   (The existing read-only `scripts/hosted-db/production-post-migration-check.sh` already diffs ACLs against the committed fingerprint and answers the same question for Production.)
2. **If any is `true`, or to make every environment converge regardless of toolchain:** one additive, idempotent migration `revoke execute on function <the 13 signatures> from service_role;` (a no-op where the grant is absent, so CI is unaffected and the contract stays as reviewed), plus a pgTAP file asserting `has_function_privilege('service_role', …, 'execute')` is false for the 13. Historical migrations cannot be edited (the baseline hash check forbids it), so an additive migration is the only route.
3. **Do not** regenerate the contract to include `service_role`, and do not extend `KNOWN_BASE_DRIFT`. When the revoke migration lands, delete `KNOWN_BASE_DRIFT` and the `--accept-known-base-drift` flag from `supabase/tests/b1/`.
4. Add a CI note that the permission gate and the dev toolchain must use the same CLI/bootstrap defaults.

## 5. Reproduce

```
# C: CI-toolchain replay (isolated project dir containing this repo's supabase/ migrations + config, project_id/ports changed)
npx -y supabase@2.110.0 start -x studio,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor
node supabase/tests/b1/permission_contract.mjs supabase_db_<project> check      # strict: PASS 698
# D: bootstrap defaults, empty migrations dir, each CLI
select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
 where n.nspname='public' and defaclobjtype='f';
```
