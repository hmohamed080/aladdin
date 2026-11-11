# P1 Auth metadata birth_date scrub - local findings and procedure design

**Purpose.** Establish, by experiment on a local Supabase stack, whether and how `birth_date` can be removed from `auth.users.raw_user_meta_data` and `auth.identities.identity_data` through a supported interface, and design the scrub procedure. **Current decision.** `raw_user_meta_data` is cleanable through the Auth Admin API (verified). `auth.identities.identity_data` is **not** cleanable through any supported interface found; this needs an owner decision (section 4). **Rationale.** The owner requires DOB erasure including Auth metadata (D-19, D-22) and forbids casual direct writes to Supabase-owned Auth tables. **Scope.** Experiments ran against a local stack only, with throwaway synthetic users that were deleted afterwards; Production (2 users) and Acceptance (11 users) counts come from the 2026-11-10 read-only audit. **Deferred.** Running any scrub on a hosted project, the script implementation, the owner decision on `identity_data`. **Consequences.** Until the owner decides, the identity copy is a reported residual in the P1 evidence. **Related files.** [P1-MIGRATION-DESIGN.md section 5](P1-MIGRATION-DESIGN.md), [master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-EVIDENCE.md](P1-EVIDENCE.md).

## 1. Experiments (local stack, GoTrue v2.197.0, 2026-11-10; synthetic values only)

| # | Action | Result in `raw_user_meta_data` | Result in `auth.identities.identity_data` (provider `email`) |
|---|---|---|---|
| E1 | Admin `POST /auth/v1/admin/users` (`createUser`) with `user_metadata` holding `birth_date` and two other keys | all keys stored | **no copy**: only `sub`, `email`, `email_verified`, `phone_verified` |
| E2 | Admin `PUT /admin/users/{id}` (`updateUserById`) with `user_metadata: {birth_date: null}` | `birth_date` **removed**; the other keys and `app_metadata` untouched (GoTrue merges `user_metadata`; a `null` value deletes the key) | unchanged (nothing to clean in E1) |
| E3 | Public `POST /auth/v1/signup` (what `supabase.auth.signUp({ options: { data } })` sends) with `birth_date` plus two other keys | all keys stored | **copied in full**: every `options.data` key, including `birth_date`, is written into `identity_data` at creation |
| E4 | Session user `PUT /auth/v1/user` with `data: {birth_date: <new value>}` | updated | **not updated** (the E3 copy keeps the old value) |
| E5 | Session user `PUT /user` with `data: {birth_date: null}` | removed | **unchanged: the copy stays** |
| E6 | Admin `updateUserById` with `user_metadata: {birth_date: null, x: 1}` on the E3 user | removed | **unchanged: the copy stays** |
| E7 | Admin `updateUserById` changing `email` (with `email_confirm`) on the E3 user | n/a | GoTrue rewrites `email` and `email_verified` inside `identity_data` and keeps every other key, so `birth_date` **stays** |
| E8 | Self-service unlink `DELETE /auth/v1/user/identities/{id}` | n/a | refused: `manual_linking_disabled` (404). GoTrue's documented rule that a user must keep at least one identity was not reached locally |
| E9 | Admin `DELETE /auth/v1/admin/users/{id}/identities/{identity_id}` | n/a | endpoint does not exist (404) in this GoTrue version |
| E10 | Admin `DELETE /admin/users/{id}` (cleanup) | user and identity removed | removed |

All throwaway users were deleted at the end (0 users, 0 identities left with the probe addresses). No SQL `UPDATE` was run against `auth.*`; reads were `SELECT` only.

## 2. Conclusions

1. **`raw_user_meta_data`:** supported and safe. `auth.admin.updateUserById(id, { user_metadata: { birth_date: null } })` deletes only that key and preserves unrelated metadata and app claims. Idempotent: repeating it on a user without the key changes nothing.
2. **`identity_data`:** the copy is created only by the public email `signUp` path with `options.data` (E3). The Admin `createUser` path (used for phone-alias accounts) does not copy (E1), and OAuth identities carry the provider's claims, not `options.data`. This explains why the audit found the same count in both places (2 / 11): they are email sign-ups made through `signUp` with the birthday in `options.data` (`auth-password-preview.ts`). The hosted GoTrue version is not known to match v2.197.0; the origin explanation is inferred from the local behaviour and the matching counts, and the hosted counts were not re-queried for this document.
3. **No supported interface removes a key from an existing `identity_data`.** Update calls never touch it except for `email` fields (E7), the unlink endpoint is disabled locally and a user's last identity cannot be unlinked by documented design (E8), and there is no admin identity-delete endpoint (E9). Unlink-and-relink is not a path either: manual linking is an OAuth feature and the only identity of an email account cannot be unlinked.
4. **Prevention matters more than cleanup:** the new app must stop passing `birth_date` (or anything else personal and unnecessary) in `signUp` `options.data` before the scrub, otherwise new copies appear (E3). The scrub script re-counts after a smoke sign-up to prove it.

## 3. Procedure design (script, not yet written)

Location (proposal): `scripts/hosted-db/scrub-auth-birth-date.mjs` with an offline test, following the existing hosted-db scripts (dry run by default, typed confirmation phrase naming the target, refuses unless the target is the intended project).

- **Inputs.** Target (Acceptance or Production), the Auth Admin credential from the operator environment (never printed), batch size (default 20), delay between calls (default 250 ms, about 4 requests per second), `--apply` plus the typed phrase.
- **Dry run (default).** Read-only. Enumerate users carrying the key through the Admin API (`listUsers` pages), count `raw_user_meta_data.birth_date` and report counts only. A separate read-only SQL count (`select count(*) from auth.users where raw_user_meta_data ? 'birth_date'` and the same on `auth.identities.identity_data`) is the cross-check. User ids stay in memory and on the operator machine; they are never logged, never written to evidence.
- **Apply.** For each user in the in-memory list: `updateUserById(id, { user_metadata: { birth_date: null } })`. Never send other keys, never send `app_metadata`, never send the whole metadata object (so a concurrent change to another key cannot be overwritten). Batches with the fixed delay; HTTP 429 or 5xx backs off exponentially with a cap and a per-user retry limit; a user that still fails is counted, not logged by id, and the run exits non-zero.
- **Idempotent and resumable.** The work list is recomputed from the live state at start (users that still carry the key), so a re-run after an interruption simply continues; a run on a clean target reports zero and changes nothing. No checkpoint file is needed; a completed update is invisible to the next enumeration.
- **No personal values in output.** Only counters: seen, with key, updated, failed, remaining, elapsed. Errors print the HTTP status and a short code, never the response body.
- **Verify.** After the run, re-count both locations. Expected: `raw_user_meta_data` 0; `identity_data` as per the owner decision (section 4). Then a smoke sign-up with the new app and a re-count to prove nothing re-creates the key.
- **Evidence.** Counts before and after, script commit hash, timestamp, operator, reviewer. No raw values.
- **Ordering.** After the new app is live and sessions are drained, after a restore-verified backup, before M2 (master plan P1.5). Acceptance first under its own approval.

Rollback: not reversible (the value is erased); recovery is from the backup, and a restored backup must be re-scrubbed before it is used.

## 4. Owner decision needed: the `identity_data` copy (2 Production, 11 Acceptance)

| Option | What it is | Assessment |
|---|---|---|
| A. Accept and report as a residual | Leave `identity_data.birth_date` in place; the table is not exposed through PostgREST or the app, readable only with the service credential or the dashboard | Honest and zero-risk, but D-19 ("fully removed") is not met for these 13 rows; needs written acceptance by the owner and legal |
| B. One-off surgical SQL on `auth.identities` (`identity_data = identity_data - 'birth_date'`, email-provider rows only) | A direct write to a Supabase-owned table, run by the migration/operator login after backup, counts-only evidence | Not a supported interface and **not tested here** (the experiment rules forbid SQL writes to `auth.*`). The hosted `postgres` role's ability to write that table, side effects on `updated_at` or the generated `email` column, and Supabase's position on it are unverified. Needs explicit owner approval and a Acceptance rehearsal on a restored snapshot first |
| C. Delete and recreate affected users | New user ids | Rejected: breaks every foreign key, business history and the one-identity-per-person rule |
| D. Ask Supabase support for a supported scrub | Vendor-assisted | Possible but slow and uncertain; can run in parallel with A |

**Recommendation:** run the Admin API scrub for `raw_user_meta_data` (supported), record the `identity_data` copy as an explicit residual under option A until the owner decides, and in parallel rehearse option B on a restored snapshot so the owner can choose it with evidence. Do not mark P1 COMPLETE with a silent residual.
