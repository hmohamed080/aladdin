# Migration dry-run, preflight and rollback runbook (2026-11-08)

Preparation only. Nothing here was run against a hosted database except read-only history listings. Every hosted step below needs its own owner approval. Rule: migrations only through `supabase db push`; no SQL Editor, no history repair.

Live history, read 2026-11-08 07:50Z (Supabase tool, read-only):

| Project | Ref | Applied | Latest | Pending (repo main 78d1b5c, 207 files) | Push mode |
|---|---|---|---|---|---|
| Acceptance | nxossqhdfltcqdwvbewi | 203 | 20261107090002 | 090003, 090004, 090005, 090006 | plain `db push` |
| Production | kkpkgjrweysgvhvkhzun | 203 | 20261107090003 | 20261105090001, 090004, 090005, 090006 | `--include-all` (20261105090001 is older than the latest) |

No remote-only versions on either. Expected end state on both: 207 applied, none pending.

## Fix made in this change
`scripts/hosted-db/p2-gate.mjs`, its test, `production-p2-push.sh` and `production-recovery-snapshot.sh` still encoded the old plan (195 applied, 8 pending). They would have refused the real Production state. They now expect 203 / `20261107090003`, exactly the 4 pending above, and finish at 207. Tests: 17/17 plus the history guard and policy suites (47/47). `WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md` still shows the old 195/8 numbers; treat this file as current.

## A. Acceptance (project nxossqhdfltcqdwvbewi)
Preflight (read-only, owner machine):
1. Checkout clean and equal to origin/main: `git status --porcelain` empty, `git rev-parse HEAD` = `git rev-parse origin/main`.
2. `pnpm exec supabase link --project-ref nxossqhdfltcqdwvbewi`; then `cat supabase/.temp/project-ref` must print that ref.
3. `supabase migration list --linked --output-format json > list.json`, then `node scripts/migration-history-guard.mjs list.json --expect plan`. Must show 203 remote, latest 090002, exactly 4 local-only, no remote-only, none out of order.
4. `supabase db push --linked --dry-run --output-format json > dry.json`, then `node scripts/migration-history-guard.mjs list.json --dry-run dry.json`. Must list exactly 090003, 090004, 090005, 090006 in that order. Any other row, any include-all hint: STOP.
5. Permission contract: `scripts/migration-permission-gate.mjs` only runs against a local RC2 test container (`node scripts/migration-permission-gate.mjs supabase_db_aladdin_r2_rc2_upgrade postgres upgrade`, needs the local Docker stack built by `supabase-rls.yml`). It cannot read a hosted database. Gate on a green `supabase-rls` run on the exact main SHA instead. Baseline `select count(*) from storage.objects` = 1 and `media_storage_locations` = 11, recorded.

Backup gate (before the push, separately approved): snapshot `aladdin-acceptance-20261108T060819Z` exists. Its restore test must report RESULT: PASS with schema, row counts and media inventory exact (track 1 owns this). The push waits for that PASS. If the snapshot is older than the push by more than a few hours or any migration or user-visible write happened since, take a new one.

Push (approval): `supabase db push --linked`. Then:
- `migration list --linked` shows 207 applied, none pending; guard `--expect up-to-date` passes.
- Permission gate against the live DB must match the 20261107090006 contract (753 functions); run security and performance advisors; `storage.objects` still 1.
- `select` checks: column `storage_key` exists (090004), backup control tables exist (090006), WhatsApp switch rows remain `false|false|off`.

## B. Production (project kkpkgjrweysgvhvkhzun), only after Acceptance is verified and Production has a separate GO
Preflight: same steps 1 to 4 but with ref kkpkgjrweysgvhvkhzun and `--include-all` on the dry run. Expected: 203 applied, latest 090003, pending exactly `20261105090001, 20261107090004, 20261107090005, 20261107090006` in that order. Run it through the scripted path, which enforces all of this:
1. `bash scripts/hosted-db/production-recovery-snapshot.sh` (read-only dump, refuses unless 203 / 090003).
2. `bash scripts/hosted-db/encrypt-backup.sh <snapshot folder>` (decrypt-and-compare recovery check must pass; keep the passphrase).
3. `bash scripts/hosted-db/production-p2-push.sh <snapshot folder> --check-only`: every gate, no push.
4. Real push (approval): same script without `--check-only`. Requires the snapshot to be at most 60 minutes old, typed phrase `PUSH 4 MIGRATIONS TO PRODUCTION`, then it confirms 207 applied, none pending.
Production backup gate: the encrypted copy plus its `.verified` file belong to this snapshot, and the older 2026-11-07 backup on Scorpion (`aladdin-production-backup-20261107-...tar.gpg`) does NOT count, because Production has changed since.
Known reviewed risk: 20261105090001 applies out of order. The 2026-11-07 review replayed Production order locally and found it identical to canonical except array element order of `ck_audit_action_known` (same set). Re-run that replay if main moved.

## C. Rollback
- No automatic down migrations; all four are additive. Prefer a forward-fix migration, applied the same way.
- If a file fails: each file is its own transaction, so history stops at the first failure; fix forward and re-run the same push.
- Data loss or bad state, Acceptance: `scripts/hosted-db/restore-acceptance.sh` restores ONLY `nxossqhdfltcqdwvbewi`, resets that database, and needs a `rebuild-acceptance.sh`-style backup folder (fingerprint-before.txt etc.). Use it only with owner approval and a backup in that layout, or the backup-kit restore path in the backup runbook (track 1).
- Data loss or bad state, Production: there is NO scripted restore into a new project. `production-recovery-snapshot.sh` plus `encrypt-backup.sh` produce a verified, recoverable dump, and `production-rehearsal.sh` proved a local restore on 2026-10-25. Restoring into a new hosted project would be a new procedure needing its own design and approval; do not improvise it. `db reset --linked` is not a rollback.
- Frontend: keep the previous Worker version; frontend rollback target for Production is 39bdf3a2. The old frontend works with the new schema because the migrations are additive.
- Never run repair, SQL Editor DDL or `migration repair` without separate approval.

## D. Read-only tooling added 2026-11-08 (all tested offline; none has been run against a hosted project)
| Script | What it does | Tests |
|---|---|---|
| `scripts/hosted-db/acceptance-preflight.sh` | Real CLI `migration list` + `db push --dry-run` (no `--include-all`) on Acceptance, then `acceptance-gate.mjs` and the history guard. Refuses unless checkout = origin/main, linked ref is Acceptance, 203 applied / latest 090002, exactly 090003-090006 pending, no drift, no out-of-order. Never pushes. | `acceptance-gate.test.mjs` 6/6 |
| `scripts/hosted-db/verify-permissions-readonly.sh acceptance\|production [version]` | Runs only the SELECT-only `scripts/function-permissions.sql` through `supabase db query --linked`, compares with `supabase/permissions/<version>.json` using the CI gate's own `compare()`. Run it as a baseline BEFORE the push (expect the previous contract, e.g. `20261107090002`) and after (expect `20261107090006`, 753 functions). | `verify-permissions-readonly.test.mjs` 6/6 (exact contract passes in all output shapes; widened grant, unreviewed, missing, changed owner/search_path and unusable output all fail) |

Limits, stated plainly: the comparison logic is tested against the committed contract files, but the `supabase db query` output shape was only modelled on what the existing scripts parse (array or `{rows}`, jsonb column as value or string); the first real run is the first end-to-end test, so run it read-only on Acceptance as a baseline before the push.

## E. Production recovery rehearsal requirement (must be satisfied BEFORE Production migration approval is requested)
Owner decision basis: Production holds real accounts, so "a backup exists" is not enough; recovery must be shown to work for the exact change.
1. Fresh Production snapshot taken within 60 minutes of the push (`production-recovery-snapshot.sh`), encrypted and recovered once (`encrypt-backup.sh`: decrypt-and-compare passes).
2. A restore rehearsal of THAT snapshot into a throwaway local Supabase stack on the owner machine: schema fingerprint and per-table row counts match the snapshot exactly.
3. On that restored copy, apply the 4 pending migrations in Production order (`20261105090001` out of order, then 090004-090006) with `db push --include-all`; then run `verify-permissions-readonly.mjs` logic against it (expect contract 20261107090006) and the schema fingerprint against the canonical replay. The 2026-11-07 review already showed the out-of-order replay differs only in element order of `ck_audit_action_known`.
4. Report counts and hashes only (no row data); owner reviews before the Production GO.
Gap found: `scripts/hosted-db/production-rehearsal.sh` is pinned to branch `claude/project-thread-724t0d`, an old commit SHA and manifest, and applies the old 26-migration baseline, so it cannot do step 3 as is. It must be re-pinned/adapted (new tested change, local Docker only) before the Production rehearsal. The 2026-10-25 rehearsal proved the method, not this change. Rollback for Production remains forward-fix or restore of the rehearsed snapshot; a restore into a new hosted project has no script and needs its own approved design.
