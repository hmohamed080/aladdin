# Marketplace v2: gated PRODUCTION apply plan - 2026-11-24

Status: **PLAN, prepared and NOT applied.** Nothing in this document or in the PR that carries it connected to Production (`kkpkgjrweysgvhvkhzun`) or Acceptance (`nxossqhdfltcqdwvbewi`). The owner runs `production-apply.sh` themself, each step on an explicit GO. Production twin of [`MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md`](MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md); read that document first for what each migration does.

Plan name: **`prod-marketplace-v2`** (`scripts/hosted-db/acceptance-gate.mjs`, target `production`). Production **237 -> 245**, EIGHT migrations, one plain push, never `--include-all`.

> **Amended 2026-11-24 (owner decision, final): the COMBINED plan.** The plan was written for seven migrations (237 -> 244). PR #252 then merged migration `20261124090001_marketplace_seller_public_slug.sql` to `main`, so the drift guard refused the seven-migration plan (`not in the plan: 20261124090001`). Decision: Production gets all **eight** in ONE plan, **237 (`20261122090002`) -> 245 (`20261124090001`)**; permission contract after = `20261124090001`. Acceptance (already at 244) gets its own small plan `marketplace-slug` (244 -> 245) **first**: [`MARKETPLACE_SLUG_ACCEPTANCE_PLAN_20261124.md`](MARKETPLACE_SLUG_ACCEPTANCE_PLAN_20261124.md). Wherever the text below says seven / 244 / `20261123160002` for the Production end state, read **eight / 245 / `20261124090001`**; the sections that matter are rewritten here:
> - Pending, in order: the seven above, then `20261124090001` (2 functions `app.marketplace_assign_org_slug` / `app.marketplace_seller_slug_trigger`, trigger `marketplace_seller_slug_assign` on `marketplace_seller_accounts`, backfill of `organizations.slug` for approved sellers that have none, revokes). Drift command: `matches this checkout (8 pending, none unplanned)`.
> - Catalog diff = the marketplace-v2 list + 3 objects (2 functions, 1 trigger), measured by `marketplace-slug-scratch-proof.mjs` (base 237 -> 245: 318 expected-change entries, exactly matched).
> - **Data effect (new):** the backfill writes `organizations.slug` (only where it is NULL) for every approved seller. The "before" run of `marketplace-slug-smoke.mjs facts pre` prints how many approved sellers that is: **note the number**. Nothing else is written.
> - Recovery: TWO pinned forward-fixes, in THIS order: `forward-fix/marketplace-slug-remove.sql`, then `forward-fix/marketplace-v2-remove.sql` (both sha256-pinned, both checked by `recovery` before the password prompt). The slug forward-fix drops the trigger and the 2 functions and REFUSES (RAISE before any change) if another trigger, function body or object depends on them. **The backfilled slugs are data and are NOT reverted** (they are valid and are what shared storefront links use); only the backup restores the old NULLs.
> - Smoke: `production-apply.sh` runs `marketplace-v2-smoke.sql` AND `marketplace-slug-smoke.sql` before and after the push (post expects 245 / `20261124090001`; every approved seller has a slug).
> - Acceptance-success gate (section 5): Acceptance `marketplace-v2` (done, 244) **and** `marketplace-slug` (245) must both have passed.
> - Snapshot: unchanged requirement (restore-verified Production snapshot taken at >= 237; `aladdin-production-20261124T133628Z` is pinned in PR #263, merge `main` after it lands). The plan adds no table, so no larger backup is needed for the slug part.

## 0. Correction to the starting premise

The task brief said Production was "far behind (last recorded 207/210)" and that `prod-catchup` still had to run. `RUNTIME_STATE.md` (section "Production state after the catch-up - 2026-11-23, evening", on `main`) records that **`prod-catchup` was already applied by the owner from `main` `8302aee9`: Production is at 237 migrations, latest `20261122090002`**. This plan therefore starts at 237 and does not touch `prod-catchup`. That is a recorded value, **not re-read live by this session**: the Production preflight reads the real history and refuses anything but 237 / `20261122090002` with exactly the seven pending.

Consequence of the order: `prod-catchup` can no longer be run from current `main` (its drift check refuses the seven newer migrations, which a plain push would also send). It is finished, so that is expected; do not try to re-run it.

## 1. Pinned state and permission contract

| | Production before | Production after |
|---|---|---|
| Applied migrations | 237 | **245** |
| Latest version | `20261122090002` | **`20261124090001`** |
| Function ACL contract (`supabase/permissions/`) | `20261122090002.json` | **`20261124090001.json`** |

Pending, in order: `20261123090001`, `100001`, `120001`, `130001`, `150001`, `160001`, `160002`, **`20261124090001`** (verified against `supabase/migrations` on current main; the `drift` command prints `matches this checkout (8 pending, none unplanned)`). `production-apply.sh` compares Production's live function-ACL inventory with both contracts (pre and post) through `verify-permissions-readonly.mjs`; any mismatch stops the run.

## 2. Expected catalog diff (measured, shared with Acceptance)

`PLANS["prod-marketplace-v2"]` is derived from `PLANS["marketplace-v2"]` in code (same `changed` list, same forward-fix), so the two cannot drift apart; a test pins that. The list was **measured**, not typed, by `marketplace-v2-scratch-proof.mjs` (local scratch container): **315 catalog objects changed** - 6 new tables, 24 new columns on existing tables, 7 re-created constraints, 28 existing functions replaced, 52 added, 1 enum value, plus seeded rows (notification templates 6 -> 8, 15 owner-message presets, 1 permission and its Super Admin grant). After the push `catalog-diff.mjs --expect-changed` must find **exactly** that set on Production; anything else fails the run.

## 3. Snapshot requirement (mandatory, `freshBackup: true`)

- The pinned Production snapshot `aladdin-production-20261123T142725Z` (restore PASS, #243) was taken at **210** migrations on 2026-11-23 before the catch-up. It covers Production data and schema **as of 210 only**: none of the 27 catch-up migrations and no row written since. The gate **refuses it** for this plan (`has 210 migrations; plan needs one taken at 237 or later`, covered by a test).
- Needed: a **new Production backup taken at 237** (the schedule is daily 01:30 Cairo; take one on demand right before the apply), **restore-tested with `RESULT: PASS`**, then pinned in `PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS` in a one-line PR (`backupRun`, `restoreRun`, tables, rows, `migrations: 237`).
- `aladdin-production-20261123T162323Z` (237 migrations, backup succeeded, 206 tables per RUNTIME_STATE) is **not pinnable as it stands**: no restore test is recorded for it, and the gate refuses any label that is not pinned. It is also a day old by the time of the apply; rows written since are lost on a restore.
- The gate checks only that the snapshot has >= 237 migrations and is pinned. **Recency is the owner's discipline:** a restore returns Production to the snapshot's moment, so take it as close to the apply as practical.
- Why it is needed even though a forward-fix exists: the forward-fix restores **objects, not rows**, refuses (RAISE) as soon as Marketplace data written after the push exists, and cannot remove the enum value.

## 4. Recovery pieces

- Forward-fix (combined, order: `marketplace-slug-remove.sql` FIRST, then `marketplace-v2-remove.sql`, both sha256 pinned in `FORWARD_FIX`; proven in `marketplace-slug-scratch-proof.mjs`: base 237 -> 245 -> both fixes = the 237 catalog except the enum value). The marketplace-v2 part: **reuse** `forward-fix/marketplace-v2-remove.sql`. No Production-specific one is needed: Production after `prod-catchup` is the same 237 catalog the scratch proof starts from (the `prod-catchup` proof reproduced Production's catalog from its pre-state plus the 27 migrations; this plan's proof replays the same migrations on a clean base). **Unverified:** the previous function definitions inside the forward-fix come from the scratch replay, not md5 values read from live Production (see section 11).
- Restores objects and drops what was added; guards refuse when user-written rows exist; never deletes user data; not undone: enum value `marketplace`, `media_verification_ready = true` (previous value is in the "before" facts), run-time side effects.
- Run through the Supabase migration path as a NEW migration, never the SQL Editor, on the owner's GO.

## 5. Acceptance-success gate (evidence required before any Production step)

Production is applied only after Acceptance has succeeded. Concretely, all of the following must exist and be recorded (RUNTIME_STATE / work log) before the Production GO:

1. Acceptance `acceptance-apply.sh --plan marketplace-v2` finished with `PASS` (done 2026-11-24: 244 / `20261123160002`), **and** `acceptance-apply.sh --plan marketplace-slug` finished with `PASS`: history 245 / `20261124090001`, permissions match `20261124090001`, catalog diff exactly 3 objects, `MARKETPLACE SLUG SMOKE (post): OK`.
2. `node scripts/hosted-db/marketplace-v2-smoke.mjs http` on Acceptance: `MARKETPLACE V2 HTTP SMOKE: OK`.
3. The frontend of the **same commit** is deployed to the Acceptance preview Worker and `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` answer 200.
4. The by-hand browser pass on Acceptance (Acceptance plan section 4, step 8: seller transitions and presets, product review, delivery and payment settings, open/close card, public catalog) and the Worker video flags checked (`VIDEO_ENABLED` not `"true"`, `VIDEO_ROUTES` off). Neither is automated nor verifiable from this repo.
5. A **soak period** with no new defect found and the Acceptance Worker/Supabase logs clean. **Length is the owner's decision** (this PR does not enforce one; suggestion: at least one full day of use that includes a seller approval, a product review and a publish). Production has real users (1,093 at the last count); Acceptance does not.
6. Production commit rule: the Production `--sha` must equal current `origin/main`; if main gained any migration or code change since Acceptance, either repeat the Acceptance run on that commit or record why the delta is irrelevant. A new migration on main is refused by the `drift` check.

## 6. Owner decisions and GO list

1. **GO to merge this PR** (draft; owner merges). Merge `origin/main` into the branch first if main moved.
2. **Acceptance-success gate satisfied** (section 5), including the soak length you accept.
3. **GO to take the Production backup at 237**, then **GO to restore-test it**, then **GO to merge the pin PR** (`chore(gate): pin Production snapshot <label> for prod-marketplace-v2`).
4. **Launch decisions** (section 8): switch posture, first-seller plan, who may approve sellers.
5. **GO to run the preflight** (read-only).
6. **GO to apply** (typed `APPLY prod-marketplace-v2 TO PRODUCTION`).
7. **GO to upload the frontend, GO to take it to 10%, GO to promote to 100%.**
8. Who checks the Worker video flags and the browser pass on Production.

## 7. Ordered checklist (nothing below has been executed)

PowerShell, from a clone fast-forwarded to `origin/main` (the script needs `.git`; a git worktree also works), `HEAD == origin/main`, clean tree. Use the exact 40-char sha as `--sha`.

0. Prerequisites: this PR merged; section 5 evidence recorded; snapshot pinned (section 3); `git fetch origin main` and `git status` clean.
1. **Record the frontend rollback target** fresh: the version currently serving 100% on `aladdin-frontend-production` (Cloudflare dashboard Deployments, or `pnpm --filter frontend exec wrangler deployments list --env production`). RUNTIME_STATE last recorded `8ed864f0`; the live value is what matters.
2. Decide the launch posture first (section 8); you cannot change it between the apply and the post checks without consequences.
3. Preflight, read-only, no push:
   ```powershell
   bash scripts/hosted-db/production-preflight.sh prod-marketplace-v2
   ```
   Expected: HEAD = origin/main, `drift` ok, 237 applied, exactly the eight pending, plain push, history guard passes.
4. Apply (owner GO, hidden password prompt, typed confirmation):
   ```powershell
   bash scripts/hosted-db/production-apply.sh --plan prod-marketplace-v2 --sha <40-char origin/main sha> --backup-label <pinned aladdin-production-... label>
   ```
   The script checks: exact sha = origin/main, clean tree, `drift`, pinned forward-fix sha256, snapshot pin (>= 237, Production labels only), link to Production (Acceptance refused), history, `db push --dry-run`, permissions inventory vs `20261122090002`, table counts, structure, catalog fingerprint, the read-only `marketplace-v2-smoke.sql` ("before" facts); typed confirmation; `supabase db push --linked`; then history 245 / `20261124090001`, permissions vs `20261124090001`, counts, structure, catalog diff = exactly the plan's list, and the "after" facts. If the push fails midway nothing is retried; stop and read `supabase migration list --linked`.
5. Read the printed **"before" INFO lines**: `media_verification_ready` (write it down, the forward-fix cannot restore it) and the seller / product / published counts. Confirm `MARKETPLACE V2 SMOKE (post): OK`.
6. **Frontend, migrations first** (never before: on 2026-11-23 a Worker built ahead of the database called missing objects and had to be rolled back). Workflow `cloudflare-production.yml` (manual, from `main`, environment `cloudflare-production` with the owner as reviewer): `stage = frontend-upload` with `media_mode = match-live` at the same commit as `--sha`. It uploads a new version that serves **0%**. Record the version id.
   - Verify the uploaded version's bindings equal the live one's: `node frontend/scripts/check-cloudflare-production.mjs --verify-version <version id>` (needs the Cloudflare account id and token in the owner's shell).
   - Test on the live hostname with the header `Cloudflare-Workers-Version-Overrides: aladdin-frontend-production="<version id>"`.
   - **Promote by hand, own approval each time:** 10% (`wrangler versions deploy <version id>@10% <previous>@90% --env production` or the dashboard), watch error rate and logs, then 100% (`wrangler versions deploy <version id>@100% --env production`). Record the final version id.
7. Post-apply HTTP smoke (anonymous, read-only, no database password; the Production project is accepted **only** with the explicit switch):
   ```powershell
   $env:SMOKE_TARGET = "production"
   $env:SMOKE_URL = "https://kkpkgjrweysgvhvkhzun.supabase.co"
   $env:SMOKE_PUBLISHABLE_KEY = "<the Production publishable key>"
   node scripts/hosted-db/marketplace-v2-smoke.mjs http
   ```
   Expected `MARKETPLACE V2 HTTP SMOKE: OK` (open=true). If you closed the Marketplace on purpose (section 8), run it with `$env:SMOKE_EXPECT_OPEN = "false"` and expect open=false.
8. By hand: `/admin/marketplace`, `/admin/marketplace/media`, `/showroom/marketplace/delivery` and `/payments` with a Super Admin account and a test showroom; the public catalog. **Do not create test data in Production that you cannot explain**: any seller/preset edit or open/close event makes the forward-fix guard refuse.
9. By hand: `VIDEO_ENABLED` is not `"true"` on the Production frontend Worker and the media Worker has `VIDEO_ROUTES` off. **Unverified by this PR; the smoke cannot see Worker variables.**
10. Record the result in `RUNTIME_STATE.md` / `AGENT_WORK_LOG.md` (counts, Worker version, snapshot label).

### What the post-apply smoke checks (read-only)

Same as the Acceptance plan (`marketplace-v2-smoke.sql` + `marketplace-v2-smoke.mjs facts pre|post`): history 237 -> 245 (the slug part is judged by `marketplace-slug-smoke.sql` / `.mjs facts pre|post --applied N --latest V`: 2 functions + trigger exist and are enabled, not executable by API roles, every approved seller has a slug); the 6 new tables; 8 notification templates; 15 owner-message presets by action; `marketplace_open` column default `true` and value `true`; `media_verification_ready` true; enum has `marketplace`; permission `marketplace_platform.manage` locked to Super Admin only; no marketplace video rows; 17 key functions; the public reads answer; blockers answer for an unknown product. The SQL is SELECT only. The `facts` judge was written for Acceptance and has never been run on Production's data: if a count differs because of real Production content it fails closed and the owner reads the INFO lines (a failed "post" smoke after the push means: stop, do not continue to the frontend).

## 8. Marketplace launch decisions for the owner (flagged, none assumed)

The migrations ship the Marketplace **OPEN by default** (`marketplace_platform_settings.marketplace_open` default `true`; there is no setting before the migration, so it **cannot be closed before the first apply**). What goes public is limited by data, not by the switch: only approved sellers' published, listable products appear, and the sellers must complete payment and delivery settings first. The switch is Super Admin only, audited, via `admin_marketplace_set_open(false, reason)` or the admin card.

Options:
- **A. Leave it open.** Simplest. Nothing appears until a seller is approved and publishes; the "before" INFO line shows how many sellers / published products Production already has from the catch-up (read it: if published products exist they are subject to the new on-shelf rule the moment the migration lands, see the Acceptance plan section 5).
- **B. Apply, run all checks, close, open later.** Run the apply and the post checks with the switch open (the smoke expects it), then immediately close it with a reason, deploy the frontend, test, and open it when the owner decides. Window between the apply and the close: seconds to minutes, and public reads can already answer. **Cost:** the close writes `marketplace_platform_events`, after which the forward-fix guard refuses (it protects that audit trail), so the only way back is the restore from the snapshot. Decide knowingly.
- **C. Do not approve any seller until the checks pass.** Independent of A/B: no seller approval = nothing public even with the switch open. Cheapest protection and it keeps the forward-fix available.
- **D. A code change** that makes the default closed (a new migration or a changed seed) would remove the window altogether. Not done here; it would need a new migration, new proofs and a new contract.

Other launch decisions: who gets Super Admin (`marketplace_platform.manage` is locked to that role); whether existing Production sellers (if any) are told before their unpublished-on-save rule bites; the registration gate from `prod-catchup` is already live (69 accounts at the last count were affected then).

## 9. Behaviour that goes live with the migrations (before the frontend)

Same as the Acceptance plan section 5: public reads and checkout follow the open switch and the on-shelf rule; publish requires a payment method and delivery; image verification is always mandatory; stock-out withdraws a product and notifies the owner (2 new templates). The old frontend keeps working with the EXPAND signatures, but these rules apply from the moment the database is changed.

## 10. Rollback and recovery ladder

1. **Frontend first:** `wrangler rollback <R> --env production` (or dashboard) with `R` = the version recorded in step 1 of section 7; owner approval. The previous application never calls the new objects.
2. **Close the public Marketplace without SQL:** Super Admin switch (audited). One-way towards "restore from backup" (section 8, option B).
3. **Forward-fix** (owner GO, new migration, never the SQL Editor): `forward-fix/marketplace-v2-remove.sql`. Refuses when any user-written Marketplace row, preset edit, setting, replacement image, video, custom threshold, open/close event, stock notification or edited template exists. Safe from a partly applied plan.
4. **Restore from the pinned >= 237 Production snapshot:** the only recovery for data written after the push and for everything once a guard refuses. Rows written between the snapshot and the incident are lost; plan the restore with the owner before it is needed.

If the push fails midway, history stops at the first failing file (one transaction per file); the forward-fix is valid from any partly applied state.

## 11. What is verified and what is NOT

Verified here (no hosted connection, no secret):
- `node --test` in `scripts/hosted-db`: 300 pass, including new tests for this plan (pinned 237/`20261122090002` -> 244/`20261123160002`, production target refused by the Acceptance gate and vice versa, the 210 snapshot and every Acceptance label refused, a future 237+ Production pin accepted, drift, partial/extra push refused, smoke before and after the push in `production-apply.sh`, Production HTTP smoke only with `SMOKE_TARGET=production`). `bash -n` passes on `production-apply.sh` and `production-preflight.sh`. `node acceptance-gate.mjs drift prod-marketplace-v2` matches this checkout; `recovery` with the pinned 210 label is refused.
- The catalog diff and forward-fix are the ones measured for the Acceptance plan (scratch proof: exactly 315 objects, forward-fix leaves only the enum value). **That proof was not re-run for this PR.**

NOT verified, stated plainly:
- **Nothing was run against hosted Production or Acceptance.** Production's real state (237 / `20261122090002`, no drift, ACL inventory equals the contract), `db push --dry-run`, the history guard, structure/fingerprint queries and `production-apply.sh` end to end have never executed for this plan. They run first on the owner's machine (read-only preflight first).
- Production being at 237 is read from `RUNTIME_STATE.md` (written by the owner's session on 2026-11-23), not from the live database.
- Production's catalog after `prod-catchup` was not compared with the scratch pre-state by fingerprint, and the previous function definitions in the forward-fix were not md5-compared with live Production. If Production was hand-edited since, the post-apply catalog diff is the check.
- The smoke `facts` judge and the Production HTTP smoke have never run against Production (the HTTP smoke is unit-tested with fake `fetch`).
- No Production snapshot of >= 237 migrations is pinned; `aladdin-production-20261123T162323Z` has no recorded restore test.
- Worker variables, the Cloudflare rolling promotion and the browser flows are manual.
- `shellcheck` is not installed here; only `bash -n` was run.
- Other open Production work (legacy media plan, R2 closure on Acceptance) is not part of this plan.

## Related files
[`MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md`](MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md), [`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md), [`BACKUPS_ENABLEMENT_PLAN_20261123.md`](BACKUPS_ENABLEMENT_PLAN_20261123.md), [`RUNTIME_STATE.md`](RUNTIME_STATE.md), `scripts/hosted-db/acceptance-gate.mjs`, `production-apply.sh`, `production-preflight.sh`, `marketplace-v2-smoke.{sql,mjs}`, `forward-fix/marketplace-v2-remove.sql`.

## 12. Update 2026-11-24 (combined plan): what was verified and what was not
- Verified locally (never hosted): `node --test scripts/hosted-db/*.test.mjs` green (327 tests); `bash -n` on the four changed scripts; `node scripts/hosted-db/acceptance-gate.mjs drift prod-marketplace-v2 supabase/migrations` -> `matches this checkout (8 pending, none unplanned)`; scratch proof `node scripts/hosted-db/marketplace-slug-scratch-proof.mjs` (throwaway database in a local container): base 237 -> 245 diff equals the plan's list exactly (318 entries), the data effect on 4 seeded organizations, forward-fix refusal cases, forward-fix on the 244 state equals the 244 catalog, re-apply idempotent, combined undo order slug -> marketplace-v2 returns to 237 except the enum value.
- NOT verified: anything against hosted Production or Acceptance (real history, dry run, ACL inventory vs `20261124090001.json`, live fingerprint, `production-apply.sh` end to end); the forward-fix guards were proven against synthetic dependents only, not Production's real catalog; the number of Production approved sellers that the backfill will touch is unknown until the "before" smoke runs; the contract `20261124090001.json` was not re-read live.
