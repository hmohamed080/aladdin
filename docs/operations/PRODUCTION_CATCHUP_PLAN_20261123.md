# Production catch-up plan (Production 210 to main 237) - 2026-11-23

Status: PREPARED, NOT APPLIED. One gated, recoverable plan (`prod-catchup`). Nothing here was applied to Production; it needs a restore-verified Production backup and the owner's explicit GO at each step.

## Purpose
Production (`kkpkgjrweysgvhvkhzun`) is behind main and Acceptance (`nxossqhdfltcqdwvbewi`). `supabase db push` pushes EVERY unapplied local migration and main contains all 27, so the earlier six batches cannot be pushed one by one from main. This single plan replaces batches 1-6 (and the former `prod-batch1`).

## Current decision
- Acceptance first, Production only after: no workflow applies a hosted migration or deploys Production on a push to `main`.
- Production LIVE state (read-only, 2026-11-23): 210 migrations, latest `20261112090001`. Pending = 27 from main of 2026-11-23, plus the 7 later Marketplace migrations `20261123090001` (PR 5 seller approval v2), `20261123100001` (PR 6 product review), `20261123120001` (PR 8 delivery and payment settings), `20261123130001` (PR 7 publication gate v2), `20261123150001` (PR 9 public catalog v2), `20261123160001` (video scope value), `20261123160002` (product video): 34 in all, Production 210 -> 244: `20261114090001`, `20261115090001..006`, `20261116090001`, `20261116100001..014` (Marketplace, 30 tables), `20261121090001..003` (media policy, admin limits, notification templates), `20261122090001..002` (registration gate). Acceptance: 237, latest `20261122090002`.
- Production has 1,093 users; 54 have `users.status = 'active'` and 1,039 do not. Registration state classified read-only on 2026-11-23 with the branch order of `app.admin_user_registration_state` (aggregate counts only):

| Derived state | Users | Signed in within 30 days | Never signed in |
|---|---|---|---|
| access_ready | 941 | 408 | 0 |
| active_personal | 83 | 22 | 10 |
| unverified | 60 | 0 | 60 |
| account_type_pending | 5 | 2 | 0 |
| consent_pending | 4 | 1 | 3 |

  The registration gate would refuse writes for `unverified`, `consent_pending` and `account_type_pending`: 69 accounts, of which 60 never signed in and only 3 signed in during the last 30 days. The other 1,024 are unaffected. Repeat the count right before the apply.
- Permission contract: Production's live function ACL inventory equals `supabase/permissions/20261112090001.json` exactly (755 functions, no mismatch; checked 2026-11-23, read-only).
- Real-data risk check of all 27 migrations: [`PRODUCTION_CATCHUP_RISK_CHECK_20261123.md`](PRODUCTION_CATCHUP_RISK_CHECK_20261123.md). No statement can fail against Production's rows.

## The plan `prod-catchup` (`scripts/hosted-db/acceptance-gate.mjs`)
- target `production`, applied 210, latest `20261112090001`, pre contract `20261112090001`, pending = the 27 versions in order, post contract = the last pending version (`20261122090002` today), one PLAIN push, never `--include-all`.
- `changed` (expected catalog diff) was measured, not written: scratch replay with `catalog-fingerprint.sql` before/after and `catalog-diff.mjs`: 1,868 objects for the 34 migrations (the 27 first: 1,583; function names, replaced constraints, dropped trigger, new-table prefixes, the later 7 add 51 function names, the media_videos changes and the video scope enum). `production-apply.sh` repeats the diff on Production itself after the push.
- Guards kept: hidden password prompt, typed confirmation `APPLY prod-catchup TO PRODUCTION`, links to Production only (refuses Acceptance), `GATE_TARGET=production`, Acceptance scripts refuse the plan, no repair/reset. NEW: `drift` check in preflight and apply refuses when main has a migration the plan does not list.
- Fail-closed backup rule: `freshBackup`, needs `--backup-label aladdin-production-YYYYMMDDTHHMMSSZ` that is pinned in `PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS`. That registry is EMPTY, so the apply script stops before the password prompt today. An Acceptance snapshot never counts.

## Recovery
Four pinned forward-fixes (sha256 in `FORWARD_FIX`), run in undo order as NEW migrations (0. covers the 7 later migrations):
0. `forward-fix/mkt-later-remove.sql` (undoes all 7 later migrations: guard first (RAISE) while any user-written row exists in the new tables, a seller rejection, an edited preset or template, a Marketplace video or a marketplace notification; it deletes only seeded rows; drops the 6 new tables, 3 triggers, 52 new function signatures, the 8 review columns and 3 constraints of `public.media_videos`; restores with the exact Production definitions the 5 video functions and `ck_media_videos_scope`, read live on Production 2026-11-24 (md5 pinned in the tests). NOT undoable: the enum value `marketplace` of `public.media_video_scope`; an unused value is harmless, only the backup removes it)
1. `forward-fix/media-notify-remove.sql` (4 tables of 20261121090002/3, column `notifications.content`, notifications constraint, video cap trigger, 3 bucket limits back to 5 MiB, 4 permissions)
2. `forward-fix/marketplace-remove.sql` (39 relations, 126 functions, 3 permissions, central media functions and constraint)
3. `forward-fix/prod-catchup-restore-previous.sql` (NEW, the non-table part): 14 functions restored to the exact Production definitions (md5 of `pg_get_functiondef` and of the comment read live; pinned in the tests), showroom review trigger and guard with the owner-only ACL, `ck_verifications_reason_required`, the audit vocabulary, and drops the 5 functions the catch-up adds.

Proof: Production's pre-state + the 27 + 7 migrations + the four files gives a catalog fingerprint identical to the pre-state (`node scripts/hosted-db/prod-catchup-scratch-proof.mjs`, scratch container only, always ROLLBACK, 2.9 s). The two table files refuse (RAISE) as soon as seller, product, order, import, stock or template rows exist. **Rows written after the push are recoverable ONLY from the restore-tested backup**; the forward-fixes restore objects, not data.

## Versions in the plan and still pending
- In the plan (`PC_LATER`, 7 versions): `20261123090001`, `20261123100001`, `20261123120001`, `20261123130001`, `20261123150001`, `20261123160001`, `20261123160002`. Scratch proof (throwaway database, committed after the enum migration): 1,868 changed objects pre to post, all in `changed`; after all four forward-fixes `no catalog differences` except `changed types: public.media_video_scope` (enum value); post permission contract = `supabase/permissions/20261123160002.json`, PASS against a clean replay.
- Still pending, NOT in the plan: none. Final count: 34 pending, Production 210 -> 244. Anything newer than `20261123160002` is refused by the `drift` check until added.

## Updating the plan at execution time (anything newer than 20261123160002)
Any migration merged to main after `20261123160002` is NOT in the plan; preflight and apply refuse with the version list. To add them:
1. In `acceptance-gate.mjs` append the versions to `PC_LATER` (ascending, all newer than `20261123160002`); the post contract becomes the last version, so that migration's `supabase/permissions/<version>.json` must exist.
2. Append the functions/constraints/prefixes they add or change to `PC_LATER_CHANGED` (measure: `node scripts/hosted-db/prod-catchup-scratch-proof.mjs` fails with the unexpected keys).
3. Extend recovery: new tables or rows need an entry in the matching forward-fix (a new file pinned in `FORWARD_FIX` and added to the plan's `fixes`, undo order newest first); re-run the scratch proof until `pre -> after` reports `no catalog differences`.
4. `cd scripts/hosted-db && node --test`, then re-read Production (`list_migrations`: still 210) and re-run the risk check queries for the new statements.

## Owner steps still required (in order, each its own GO)
1. Merge #232/#233 then this PR (retarget to `main`); `main` must contain the plan (branch up to date with latest `origin/main`).
2. Production backup with a passed restore test ([`BACKUPS_ENABLEMENT_PLAN_20261123.md`](BACKUPS_ENABLEMENT_PLAN_20261123.md)); pin its label with counts in `PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS` in a PR (the backup needs its own GO).
3. Owner-run `bash scripts/hosted-db/production-preflight.sh prod-catchup` (read-only; password at a hidden prompt).
4. Re-count the 69 registration-gate accounts and decide (the gate stops their writes until they finish registering); decide the Marketplace launch (the migrations only create tables, nothing is public until sellers are approved).
5. Apply GO, then `bash scripts/hosted-db/production-apply.sh --plan prod-catchup --sha <origin/main sha> --backup-label <label>`.
6. Deploy the matching frontend AFTER the migrations, never before.

## What is deferred
- Whether Production backups run on a schedule.

## Consequences
- Until the apply, Production has no database-level registration protection and no Marketplace; it keeps working unchanged while the plan waits.
- After the apply the three storage bucket limits go from 5 to 10 MiB and 69 unfinished accounts are refused writes.

## Related files
- [`PRODUCTION_CATCHUP_RISK_CHECK_20261123.md`](PRODUCTION_CATCHUP_RISK_CHECK_20261123.md), [`BACKUPS_ENABLEMENT_PLAN_20261123.md`](BACKUPS_ENABLEMENT_PLAN_20261123.md), [`RUNTIME_STATE.md`](RUNTIME_STATE.md), [`AGENT_WORK_LOG.md`](AGENT_WORK_LOG.md)
- `scripts/hosted-db/acceptance-gate.mjs`, `production-preflight.sh`, `production-apply.sh`, `prod-catchup-scratch-proof.mjs`, `scripts/hosted-db/forward-fix/`
- [`../decisions/ADR-0031-account-registration-verification-statuses.md`](../decisions/ADR-0031-account-registration-verification-statuses.md)
