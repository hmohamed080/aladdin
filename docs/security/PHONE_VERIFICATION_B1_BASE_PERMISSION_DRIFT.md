# Pre-existing function-permission discrepancies (found during Phase B1)

**Status:** open · **Not caused by B1, not fixed by B1, not approved by B1.** Recorded here so it cannot be lost inside a feature PR, and so nobody reads a green B1 run as a review of these permissions.

## What was found

The repository's reviewed contract `supabase/permissions/20261026090001.json` lists, per function, who may `EXECUTE` it. On a **clean local replay of `main` + #119 + A2 with the B1 migration absent**, 13 existing functions do not match that contract in the same way: the database lets **`service_role`** execute them, the reviewed contract says it must not.

Reproduction (no B1 files needed): reset an isolated stack to `main` + #119 + #120 and compare the live inventory (`scripts/function-permissions.sql`) to `20261026090001.json`. B1's own tooling reproduces it with the B1 migration present because B1 adds only its 7 functions: `node supabase/tests/b1/permission_contract.mjs <container> check` (strict by default; it fails and prints every difference).

| Function | Differs from contract | `SECURITY DEFINER` | Reads caller from `auth.uid()` | `authenticated` | `anon` | `service_role` (live) | `service_role` (contract) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `public.account_entry_allowed(text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.account_password_confirm(text,text,text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.admin_phone_cooldown_override(text,text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.admin_phone_cooldown_status(text)` | grants, effective | yes | no (permission helper) | yes | no | **yes** | no |
| `public.admin_users_directory(text,text,text,text,text,text,integer,integer)` | grants, effective | yes | no (permission helper) | yes | no | **yes** | no |
| `public.branch_location_set(uuid,text,text,text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.my_secondary_phone()` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.organization_legal_name_set(uuid,text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.secondary_phone_cancel()` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.secondary_phone_change(text,uuid)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.secondary_phone_make_primary(uuid,text,text)` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.secondary_phone_renew()` | grants, effective | yes | yes | yes | no | **yes** | no |
| `public.secondary_phone_reserve(text,uuid)` | grants, effective | yes | yes | yes | no | **yes** | no |

Everything else about these 13 entries (kind, owner, definer, `search_path`, `authenticated`/`anon`/other roles) matches the contract. The other 678 reviewed entries match exactly.

## What is and is not known

* **Known (measured):** the 13 differences above, on a clean local replay; a freshly created function in `public` gets **no explicit `service_role` grant** here (its ACL is empty, i.e. default `PUBLIC`), so the explicit grants on these 13 were made at or after their creation, not by a current default; a search of the migrations for these function names found no `GRANT … TO service_role` for them.
* **Not known:** which stack the contract was captured on and why it differs (candidates: creation-time default privileges for `postgres` in `public` before `20261021090007_restrict_rc2_function_creator_defaults.sql`; the renumbering of the `…0906`/`…0907` migrations; a different Supabase CLI default). **This is an unverified hypothesis, not a conclusion.** It is also unknown whether Acceptance or Production show the same grants — that needs a read-only inspection and is out of scope for B1.
* **Not known:** whether CI's `Verify fresh effective function permissions` step is currently green on `main`; it compares against the same file.

## Why it matters (assessment, not a verdict)

`service_role` bypasses RLS and already has far broader powers through direct SQL, so an extra `EXECUTE` does not by itself open a data path. But these are `SECURITY DEFINER` functions the reviewed contract says are client-only; 11 of 13 derive the caller from `auth.uid()` (a service-role call has none, so they should refuse), while the two admin helpers rely on a permission helper. The concern is least-privilege and the integrity of the permission gate: a gate that is silently red or silently ignored stops protecting the next change.

## What B1 does about it

* It does **not** add these entries to any allow-list, and does **not** rewrite the reviewed entries with the local values: the generator keeps all 691 reviewed entries byte-identical and appends only B1's 7 functions.
* `permission_contract.mjs check` is **strict by default**: it prints every difference and exits non-zero. `run_b1.sh` passes `--accept-known-base-drift` explicitly, prints the 13 differences in its log, and records `ACCEPTED-FOR-B1-ONLY` in its summary so the exception is visible every run. `B1_STRICT_CONTRACT=1` removes it. The flag is only valid for exactly these 13 signatures; any other difference fails.
* Nothing was revoked, granted or changed in any environment.

## Options for the owner (not decided here)

1. **Revoke** `service_role` EXECUTE on the 13 in a new migration (additive, reversible), then the contract is right as written. Needs a check that no server code calls them as `service_role`.
2. **Accept** `service_role` EXECUTE and regenerate the contract entries after review.
3. **First inspect Acceptance/Production** (read-only) to see which reality exists there, then choose 1 or 2.

Until one is chosen the permission gate cannot be clean on a fresh replay, regardless of B1.
