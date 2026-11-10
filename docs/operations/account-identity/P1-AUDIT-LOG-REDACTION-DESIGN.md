# P1 audit_log username redaction - design and local proof

**Purpose.** Specify how the historical application usernames stored in `public.audit_log.metadata` are removed without breaking the append-only protection of the audit trail. **Current decision.** The owner approved the **design** (option 2 of master plan 3.7) on 2026-11-10. **Hosted execution is NOT approved** and nothing here has been run against Acceptance or Production. **Rationale.** `profile.username_set` rows carry `{"username": ...}` (860 rows in Production, 20 in Acceptance, counts from the 2026-11-10 read-only audit); D-18 and D-22 require historical usernames to go, while D-22 also requires audit integrity to survive. **Scope.** The one key `username`, only on rows whose `action` is `profile.username_set`. **Deferred.** Choosing the timestamp and PR for the real migration (it ships inside M2 or as its own migration after the app release), the restore-verified backup, and the owner's go for each hosted environment. **Consequences.** Historical usernames become unrecoverable except from backups; the audit trail keeps every row, every column and every other key. **Related files.** [Master plan 3.7](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md), [draft migration](drafts/DRAFT_audit_log_username_redaction.sql), [pgTAP-style proof](drafts/DRAFT_audit_log_username_redaction_test.sql), [held-guard proof](drafts/DRAFT_audit_log_username_redaction_held_test.sql), [harness](drafts/run-audit-redaction-proof.sh), [evidence](P1-EVIDENCE.md).

## 1. What protects `audit_log` today (read from the migrations and the local database)

| Control | Where | Behaviour |
|---|---|---|
| Trigger `audit_log_no_delete` (BEFORE DELETE, row) | `20260802090003` | `app.forbid_mutation()` raises `public.audit_log is append-only (DELETE forbidden)` |
| Trigger `audit_log_no_update` (BEFORE UPDATE, row) | `20261014085731` replaced the function | `app.guard_audit_actor_deletion()` (SECURITY DEFINER, `search_path = ''`, owner `postgres`, execute only `postgres`) allows exactly one thing: the foreign key's nested `ON DELETE SET NULL` of `actor_user_id` for a user that no longer exists (`pg_trigger_depth() > 1`, all other columns identical). Everything else raises `audit_log is append-only (UPDATE forbidden)` |
| Privileges | `20260802090003` and later | `authenticated` and `service_role` hold SELECT only; `anon` nothing; only the owner `postgres` holds UPDATE/DELETE/TRUNCATE; RLS limits SELECT to platform administrators |
| Check constraints | `20260802090003` | `ck_audit_action_known` (the allowlist contains `profile.username_set`), `ck_audit_metadata_object`, `ck_audit_metadata_size` |

There is no bypass flag, GUC or redaction helper today. Triggers do not fire for TRUNCATE; that is handled by privileges, not by this design.

## 2. Design

**Principle.** The protection is never switched off. A reviewed migration replaces the update guard for the length of one transaction with a copy that additionally permits exactly one transformation, performs that transformation, restores the original guard byte for byte, and verifies itself. If anything is unexpected the whole transaction rolls back.

**Why not the alternatives.** `ALTER TABLE ... DISABLE TRIGGER` and `session_replication_role = replica` disable the protection for every update on the table (and need broader privileges); dropping and re-creating the trigger widens the exposure window and risks forgetting to re-create it. A permanent flag-checking guard would leave a reachable bypass in the live schema; this design leaves no bypass code behind.

**The transaction (see the [draft](drafts/DRAFT_audit_log_username_redaction.sql)):**

1. `lock_timeout 5s`, `statement_timeout 60s` (transaction-local).
2. Refuse unless `session_user` is `postgres` or `supabase_admin` (the migration login), and unless `md5(prosrc)` of `app.guard_audit_actor_deletion()` equals the known fingerprint of the `20261014085731` definition (`74f342a5...`). An unexpected guard aborts instead of being overwritten.
3. Record the pre-run aggregate: row count, number of target rows, and `md5` of every column of every row with `metadata - 'username'` applied only to `profile.username_set` rows.
4. `CREATE OR REPLACE FUNCTION app.guard_audit_actor_deletion()` with the narrow exception first, then the unchanged original logic. Owner, ACL, SECURITY DEFINER and `search_path` are kept by `CREATE OR REPLACE`.
5. `set_config('app.audit_redaction', 'profile.username_set:remove-username:v1', true)` (third argument `true`: transaction-local).
6. `UPDATE public.audit_log SET metadata = metadata - 'username' WHERE action = 'profile.username_set' AND metadata ? 'username'`.
7. Clear the token and `CREATE OR REPLACE` the original guard body immediately.
8. Self-check, abort on any failure: restored fingerprint equals the original; ACL, owner, SECURITY DEFINER and config unchanged; both immutability triggers still exist and are enabled; row count unchanged; zero target rows still carry the key and the number updated equals the number found; the post-run aggregate equals the pre-run aggregate.
9. `RAISE NOTICE` with counts only (rows, redacted, remaining, checksum match).

**The narrow exception** is the conjunction of: the token equals the exact string; `session_user in ('postgres','supabase_admin')`; `pg_trigger_depth() = 1` (not nested inside another trigger); `old.action = 'profile.username_set'`; `old.metadata ? 'username'`; `new.metadata = old.metadata - 'username'`; and `to_jsonb(old) - 'metadata' = to_jsonb(new) - 'metadata'` (every other column identical). It cannot add a key, remove another key, change another column, touch another action, or delete.

**Why the token is safe.** It is a transaction-local setting, so it is empty again at COMMIT and ROLLBACK (proven below). It is only meaningful while the narrow guard exists, and the narrow guard exists only inside the migration transaction: after the migration the original guard is back, so setting the token has no effect (proven below). `anon`, `authenticated` and `service_role` hold no UPDATE or DELETE privilege on the table, so they cannot reach the trigger at all (proven below); PostgREST connects as the `authenticator` login, so even an accidental future grant would not satisfy the `session_user` condition.

**Not done, by decision.** No new audit action such as `audit.username_redacted`: it would need a second change to `ck_audit_action_known`. The count-only evidence (the `NOTICE` text, the pre-run and post-run counts and checksum) is recorded in the P1 acceptance and production reports instead. If the owner wants an in-database event, it is a separate small migration after this one.

**Concurrency.** The UPDATE touches 860 rows in Production; row locks only, inserts continue. The function replacement does not lock the table. Run off-peak anyway; a lock timeout aborts cleanly and the migration can be retried (re-runs update zero rows).

**Placement.** Run it after the new app is live and `profile_set_username` stops writing audit rows (M2 drops the function), as its own migration file between the Auth scrub and M2, or as step 4 of M2 (design open: separate file is easier to review and to roll forward independently). The file name and timestamp are assigned when it is promoted from `drafts/`; the current numbering plan is M1 `20261110090001`, M2/M3 `20261111...`, so a separate file takes `20261111090003` or later, and it needs its own permission snapshot only if it changes an ACL (it does not).

## 3. Local proof (not a hosted run)

Environment: local Supabase CLI stack (CLI 3.0.0, Postgres image 17.11.0.011, GoTrue v2.197.0), migrations of `main` `1b00ff4` applied, 18 audit rows from the seed, synthetic fixtures only. Harness: `drafts/run-audit-redaction-proof.sh` (refuses any container that is not `supabase_db_*`). The raw output is summarised in [P1-EVIDENCE.md](P1-EVIDENCE.md). Result: **39 of 39 assertions pass, 0 fail.**

| Requirement | Proof |
|---|---|
| (a) username key gone | tests 4-5: no `profile.username_set` row carries the key; the five fixture rows are redacted |
| (b) every other column and key byte-identical | tests 6-11: all non-metadata columns identical on every row; metadata differs only by the removed key; sibling keys and values survive (including a null-valued username key and an array sibling); a row of another action keeps its `username` key; aggregate checksum of the non-username content is unchanged |
| (c) row count unchanged | test 12 |
| (d) other UPDATE and DELETE stay blocked | tests 17-22: adding a key, changing another column, removing another key, DELETE, and the token plus a redaction-shaped UPDATE all raise after the migration; before the migration the token alone does nothing (tests 2-3) |
| narrow guard is narrow while installed | held test (14 assertions): other-key removal, removal of more than the username key, removal plus an added key, removal plus another column change, another action, DELETE are all blocked; `service_role`, `authenticated` and `anon` with the token stop on privileges (42501); no role other than the owner holds UPDATE or DELETE; exactly the redaction is allowed |
| guard restored exactly | tests 13-16: `md5(prosrc)` equals the original; ACL, owner, SECURITY DEFINER and search_path unchanged; both triggers enabled; token empty inside the transaction |
| (e) token does not persist | harness stage 3: the token is set inside a committed transaction and is empty in the same session after COMMIT and `NULL` in a new session; a rolled-back run and a committed run both leave the original guard and a `NULL` token |
| (f) idempotent | tests 23-25 (re-run inside the proof) and harness stage 3c (the draft committed twice on the local database: second run `redacted=0`, same checksum) |

One real defect was found and fixed by this proof: the first draft computed the pre-run checksum with the key stripped from every row (including rows of other actions), so its own self-check aborted; the migration's self-verification caught it, which is the intended behaviour.

**Not proven locally:** behaviour on the hosted Postgres minor versions and on real data volume (the local `audit_log` holds no `profile.username_set` rows; the fixtures are inserted and rolled back, because audit rows cannot be removed once committed); that the hosted migration login reports `session_user = postgres` (it does for the Supabase CLI; the Production Phase D runbook uses the same login, to be confirmed in the dry run); `pg_dump` / WAL / PITR copies still hold old values (section 4).

## 4. Rollback and recovery plan

The migration is forward-only; the old values cannot be reconstructed after COMMIT except from backup. Therefore:

1. **Before the run (per environment, owner-approved):** take a fresh restore-verified backup from the aladdin-backups kit ([BACKUPS_ADMIN.md](../BACKUPS_ADMIN.md)): snapshot, then a restore test into a scratch database that returns the expected `audit_log` row count. Record the snapshot identifier and timestamp.
2. **Pre-run aggregate** (read-only, counts and a checksum, no values): run the pre-check below on the target and record the output. The migration recomputes the same figure inside the transaction and aborts on mismatch, so the pre-run figure is an independent second record.

   ```sql
   select count(*) as total,
          count(*) filter (where action = 'profile.username_set' and metadata ? 'username') as with_username,
          md5(coalesce(string_agg(concat_ws('|', id, actor_user_id, actor_role, action, subject_type, subject_id,
              organization_id, created_at,
              (case when action = 'profile.username_set' then metadata - 'username' else metadata end)::text),
              E'\n' order by id), '')) as non_username_checksum
   from public.audit_log;
   ```
   After the run the same query must return `with_username = 0`, an unchanged `total` and a `non_username_checksum` equal to the pre-run value (the expression yields the same text because the key is already gone).
3. **Failure inside the transaction:** nothing is committed; the guard and the data are exactly as before. Fix the cause and re-run.
4. **Failure after COMMIT (unexpected content change):** forward-fix only. Restore the affected non-username fields from the restore-verified backup into a scratch database and compare; any repair of audit rows needs a second reviewed narrow redaction-style migration and a fresh owner approval. Do not disable triggers.
5. **What can be restored:** the pre-run `audit_log` as a whole, from the backup. **What cannot:** the removed username values from the live database; and a deliberate restore of the old values would reintroduce erased personal data, so a restore of this table after the run must be re-scrubbed (master plan 5.8 and the retention register).
6. **What the run does not erase:** dead tuples until autovacuum (run `VACUUM public.audit_log`, not `FULL`, after the run), WAL and PITR windows, and immutable backups; their retention and expiry are documented in the backup retention contract and must be quoted truthfully, never as "all copies purged".

## 5. Open items

- Owner: approval to execute per environment (Acceptance first), timing, and whether the redaction is its own migration or step 4 of M2.
- Whether to add an in-database `audit.username_redacted` event (needs an allowlist migration) or keep evidence in the reports.
- Dry run on the Production snapshot restore (the rehearsal kit) to confirm `session_user`, the guard fingerprint and timing.
