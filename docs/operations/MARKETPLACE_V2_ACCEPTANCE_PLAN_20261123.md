# Marketplace v2: gated Acceptance apply plan - 2026-11-23

Status: **PLAN, prepared and NOT applied.** Nothing in this document or in the PR that carries it touched Acceptance (`nxossqhdfltcqdwvbewi`) or Production (`kkpkgjrweysgvhvkhzun`). The owner runs `acceptance-apply.sh` themself, each step on an explicit GO. Same pattern as the plans `media-notify` (PR #220) and `registration-gate` (PR #229).

Plan name: **`marketplace-v2`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance **237 -> 244** migrations, plain push, no `--include-all`.

## 1. What is pending (verified against `supabase/migrations` on `origin/main` `7faec643`, 244 files)

Acceptance is at 237, latest `20261122090002` (RUNTIME_STATE, registration gate applied 2026-11-23). Exactly these seven are newer, in this order:

| # | Migration | PR | What it does (EXPAND only: changed signatures are added next to the old ones) |
|---|---|---|---|
| 1 | `20261123090001_marketplace_seller_approval_v2` | #239 | status `rejected`, owner messages, tables `marketplace_seller_message_presets` (15 seeded) + `marketplace_seller_preset_events`, new overloads of `app.notify_from_template` / `marketplace_seller_transition` / admin approve, suspend, revoke, reinstate, reject, `*_v2` overview + history |
| 2 | `20261123100001_marketplace_product_review` | #238 | image verification always mandatory (**sets `media_verification_ready = true`**), product-level review RPCs, replacement images (`replaces_image_id`), preset action `image_reject` (+5 presets), new moderation action |
| 3 | `20261123120001_marketplace_seller_delivery_payment_settings` | #240 | tables `marketplace_seller_delivery_settings`, `marketplace_free_shipping_products`, `marketplace_seller_settings_events`; delivery-rate columns (duration, next-day, free-shipping minimum); InstaPay full payment; readiness contract |
| 4 | `20261123130001_marketplace_publication_gate_v2` | #241 | open/close switch (`marketplace_platform_settings.marketplace_open` **default true**, permission `marketplace_platform.manage`, Super Admin only, audited), low-stock threshold + notifications (2 seeded templates), payment and delivery as publish conditions, auto-unpublish on seller suspension, `app.marketplace_publication_blockers` redefined |
| 5 | `20261123150001_marketplace_public_catalog_v2` | #246 | public reads: `marketplace_public_status/browse/catalog_page/facets/product/delivery/seller`, cart and checkout follow the open switch |
| 6 | `20261123160001_marketplace_video_scope_value` | #249 | `alter type media_video_scope add value 'marketplace'` (own file because an enum value must be committed before use) |
| 7 | `20261123160002_marketplace_product_video` | #249 | `media_videos` gains the marketplace scope + review columns, append-only `marketplace_video_events`, seller list RPC, 3 admin review RPCs, cap trigger follows the `product` limit |

Totals measured on a scratch replay (section 7): **6 new tables, 24 new columns on existing tables, 7 re-created constraints, 28 existing functions replaced, 52 added, 1 enum value, 2 notification templates (6 -> 8), 15 owner-message presets, 1 permission + its Super Admin grant**, 315 catalog objects changed. The only existing-table row counts that change are `notification_templates` 6 -> 8, `admin_permissions` +1, `admin_role_permissions` +1.

Video delivery stays OFF: these migrations create the video tables and RPCs, but `VIDEO_ENABLED=false` and Worker `VIDEO_ROUTES=off` keep it inert. **The smoke cannot see Worker variables: check them by hand (step 9).**

## 2. Recovery decision per migration

The plan is **not function-only**, so unlike `registration-gate` a backup is required. Reasoning per migration:

| Migration | Can it be undone by the forward-fix? | Notes |
|---|---|---|
| 1 seller approval v2 | Yes, while no seller was rejected / holds an owner message / no preset edited | drops 2 tables and 7 columns, restores 3 constraints; old signatures were never touched |
| 2 product review | Yes, while no replacement image, no new moderation action | **`media_verification_ready = true` is NOT undone** (previous value unknown to the script; smoke "before" run prints it, owner sets it back if needed) |
| 3 delivery/payment settings | Yes, while the three tables are empty and no delivery rate / payment row uses a new column | drops 3 tables and 6 columns (plus their constraints) |
| 4 publication gate v2 | Yes, while the Marketplace was never closed/opened (platform events), no custom threshold, no stock notification or edited template | deletes only the 2 seeded templates, the permission and its grant |
| 5 public catalog v2 | Yes: functions only (restored / dropped) | |
| 6 enum value | **No.** PostgreSQL cannot drop an enum value | inert once the columns/constraint are gone; the scratch proof allows exactly this one residual difference |
| 7 product video | Yes, while no marketplace video row exists | drops `marketplace_video_events` and 8 columns, restores `ck_media_videos_scope` |

`scripts/hosted-db/forward-fix/marketplace-v2-remove.sql` (sha256 pinned in the gate) restores the exact previous definition of 28 functions and 7 constraints (read from the pre-state, not written by hand), drops what was added, and **RAISEs before any change as soon as one user-written row exists**. It never deletes user data. It restores objects, **not rows**: data written after the push is recoverable only from the backup.

### A fresh restore-verified snapshot is MANDATORY (`freshBackup: true`)

Why: (a) six tables, new NOT NULL columns with defaults, seven re-created constraints and seeded rows cannot be reversed once users write data (the guard refuses exactly then, which is the point of a backup); (b) the enum value can never be removed; (c) migration 2 and 4 change runtime behaviour on existing rows' visibility (see section 5); (d) the newest pinned snapshot, `aladdin-acceptance-20261122T100424Z`, has **232** migrations and predates three media-notify migrations, the registration gate and all Marketplace test activity since; the gate refuses it (`needs one taken at 237 or later`). **No snapshot of >= 237 is pinned in this PR**: `acceptance-apply.sh` refuses to run until one is.

Snapshot pin approach (same as PR #222 for media-notify): take a backup of Acceptance **after it is at 237** (aladdin-backups `Backup` workflow, Admin backup console or manual dispatch; check the stale `running` ledger row described in `BACKUPS_ENABLEMENT_PLAN_20261123.md` gap 3 first), restore-test it, and only when the restore run reports `RESULT: PASS` merge a one-line PR adding the label to `RESTORE_VERIFIED_SNAPSHOTS` (`backupRun`, `restoreRun`, tables, rows, `migrations: 237`). That snapshot is a recovery point only for data written before it.

## 3. Owner decisions and GO steps

1. **GO to merge this PR** (owner merges; draft until then). Merge `origin/main` into the branch first if main moved.
2. **GO to take the Acceptance snapshot** and restore-test it; then **GO to merge the pin PR** (`chore(gate): pin Acceptance snapshot <label> for marketplace-v2`).
3. **GO to run the preflight** (read-only) from a clean checkout equal to `origin/main`.
4. **GO to apply** (typed confirmation `APPLY marketplace-v2 TO ACCEPTANCE`).
5. **GO to deploy the frontend** matching `main` to the Acceptance preview Worker.
6. Decide, before the apply, whether Acceptance sellers/products exist whose storefront visibility may change (section 5).
7. Decide who checks the Worker video flags and the real-browser pass (not verifiable from this repo).

## 4. Ordered checklist (nothing below has been executed)

PowerShell; run from a real clone (not a git worktree: `acceptance-apply.sh` tests `[ -d .git ]`, see the 2026-11-23 work-log entry) fast-forwarded to `origin/main`. Use the exact 40-char sha as `--sha`.

0. Prerequisites: this PR merged; the snapshot label pinned (section 2); `git fetch origin main; git status` clean and `HEAD == origin/main`.
1. **Record the frontend rollback target** (the version the deploy will replace): `pnpm --filter frontend exec wrangler deployments list --name aladdin-frontend-preview`. RUNTIME_STATE last recorded `41b77bf4-53b4-408d-9891-b527c540b0c6` (main `b7de7c6b`); read it fresh, it is the value that matters.
2. Preflight (read-only, no push):
   ```powershell
   bash scripts/hosted-db/acceptance-preflight.sh marketplace-v2
   ```
   Expected: 237 applied, exactly the seven pending, plain push, no drift; history guard passes.
3. Apply (owner GO, hidden password prompt, typed confirmation):
   ```powershell
   bash scripts/hosted-db/acceptance-apply.sh --plan marketplace-v2 --sha <40-char origin/main sha> --backup-label <pinned label>
   ```
   The script checks: exact sha = origin/main, clean tree, pinned forward-fix sha256, snapshot pin (>= 237), link to Acceptance (Production refused), history, `db push --dry-run`, permissions inventory against contract `20261122090002`, table counts, structure, catalog fingerprint, the read-only `marketplace-v2-smoke.sql` ("before" facts); then `supabase db push --linked`; then post: history 244 / `20261123160002`, permissions against contract `20261123160002`, counts, catalog diff **exactly the plan's list** (315 objects), and the "after" facts.
4. Read the printed **"before" INFO lines** and write down `media_verification_ready` (before) and the existing seller/product counts.
5. Confirm `MARKETPLACE V2 SMOKE (post): OK` in the script output.
6. **Deploy the frontend matching main** (migrations first, then the frontend; the old frontend keeps working with the EXPAND signatures, but see section 5): GitHub Actions workflow `Cloudflare frontend preview` (`.github/workflows/cloudflare-frontend-preview.yml`), `workflow_dispatch` on `main` at the **same commit as `--sha`**. Record the new Worker version id; confirm `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` answer 200 (as the workflow smoke does).
7. Post-apply HTTP smoke (anonymous, read-only, no database password):
   ```powershell
   $env:SMOKE_URL = "https://nxossqhdfltcqdwvbewi.supabase.co"
   $env:SMOKE_PUBLISHABLE_KEY = "<the Acceptance publishable key>"
   node scripts/hosted-db/marketplace-v2-smoke.mjs http
   ```
   Expected `MARKETPLACE V2 HTTP SMOKE: OK`.
8. By hand in the browser (not automated): `/admin/marketplace` (seller transitions + preset editor), `/admin/marketplace/media` (product review), `/showroom/marketplace/delivery` and `/payments`, the open/close card (only toggle it if you accept that this blocks the forward-fix, section 6), the public catalog.
9. By hand: confirm `VIDEO_ENABLED` is not `"true"` on the Acceptance frontend Worker and the media Worker has `VIDEO_ROUTES` off. **Unverified by this PR.**
10. Record the result in `RUNTIME_STATE.md` / `AGENT_WORK_LOG.md` (counts, versions, snapshot label).

### What the post-apply smoke checks (read-only)

`scripts/hosted-db/marketplace-v2-smoke.sql` (SELECT only) + `marketplace-v2-smoke.mjs facts pre|post`: history 237 -> 244 and latest; the 6 new tables exist; **8 notification templates** (6 + 2 stock); **15 owner-message presets** (`approve:1,image_reject:5,reinstate:1,reject:4,revoke:2,suspend:2`); `marketplace_open` column default `true` **and** value `true` (the Marketplace is open by default); `media_verification_ready` true; enum has `marketplace`; permission `marketplace_platform.manage` locked to Super Admin only; no marketplace video rows; 17 key functions exist; the public reads answer (`marketplace_public_status` = `{"open": true}`, `marketplace_public_catalog_page`, `marketplace_public_facets`); `app.marketplace_publication_blockers` answers for an unknown product. The `http` mode repeats the three public reads through the Data API as an anonymous client.

## 5. Behaviour changes that go live with the migrations (before the frontend)

- Public reads and checkout follow the open switch and `marketplace_product_is_listed`: a published product with nothing to sell is withdrawn from the storefront; sellers must be approved and the Marketplace open.
- Publish now requires a payment method and delivery; per RUNTIME_STATE, existing published products of a seller without them are unpublished on their next save.
- Image verification is now always mandatory.
- Stock-out withdraws a product and notifies the owner (the two new templates).
Acceptance holds test data only (no Production effect), but check the seller/product counts from the "before" INFO line.

## 6. Rollback and recovery, in order of preference

1. **Frontend first:** `pnpm --filter frontend exec wrangler rollback <R> --name aladdin-frontend-preview` with `R` = the version recorded in step 1 (needs the owner's approval). The previous application never calls the new objects.
2. **Switch the public Marketplace off without SQL:** the Super Admin close switch (`admin_marketplace_set_open(false, reason)`, audited). **Caveat:** it writes `marketplace_platform_events`, after which the forward-fix guard refuses (it protects that audit trail). Closing is therefore a one-way step towards "restore from backup", not towards the forward-fix. Decide knowingly.
3. **Forward-fix (owner GO, as a NEW migration through the Supabase path, never the SQL Editor):** `scripts/hosted-db/forward-fix/marketplace-v2-remove.sql`. It refuses (RAISE, nothing changed) when any seller rejection or owner message, preset edit, delivery/payment/free-shipping setting, replacement image, product video, custom low-stock threshold, close/open event, stock notification, edited stock template or extra holder of `marketplace_platform.manage` exists. Safe from a partly applied plan (guards inspect only what exists; every drop is IF EXISTS). Not undone: the enum value, `media_verification_ready`, run-time side effects (e.g. products set to `unpublished`).
4. **Restore from the pinned snapshot:** the only recovery for data written after the push (and for everything once a guard refuses). Rows written between the snapshot and the incident are lost.

If the push itself fails midway, nothing is retried: each migration file is its own transaction, so history stops at the first failing file; the script prints what it can read. The forward-fix is valid from any partly applied state.

## 7. Evidence and what is NOT verified

Measured locally (no hosted connection, no secret): `node scripts/hosted-db/marketplace-v2-scratch-proof.mjs` creates a throwaway database from a `pg_dump` of the local scratch container `supabase_db_aladdin_r2_rc2_fresh` (the container's own database is never written), replays the missing migrations up to `20261122090002` (30 files from `20261110090001`), fingerprints the catalog, applies the seven (one transaction per file, like `db push`), fingerprints again, runs the forward-fix, fingerprints a third time, and drops the database. Result: `pre -> post: catalog diff ok (exactly 315 objects changed)` = the plan's `changed` list; `pre -> after the forward-fix` differs **only** by `public.media_video_scope` (the enum value); about 2.6 s. The forward-fix guard was also exercised: closing the Marketplace makes it refuse with a clear message. `node --test scripts/hosted-db/*.test.mjs`: 286 pass. `bash -n` on both scripts passes.

Not verified, stated plainly:
- Nothing was run against hosted Acceptance or Production: the real `supabase migration list`, `db push --dry-run`, the history guard, the permissions inventory against contracts `20261122090002` / `20261123160002`, the structure and fingerprint queries on the live database, and `acceptance-apply.sh` end to end were **not executed**. They run for the first time on the owner's machine (read-only preflight first).
- The scratch pre-state is a clean replay on a local Postgres 17 container (replayed from `20261110090001` on a 207-migration base), not a copy of Acceptance. Earlier plans proved the same equivalence by fingerprint on the live database; for this plan that comparison happens at preflight time only through the pre checks (history + permissions + structure), not by fingerprint equality.
- The previous definitions in the forward-fix come from that replay, not from md5 values read live on Acceptance (as the registration-gate fix did). If Acceptance was hand-edited, they could differ; the post-apply catalog diff on Acceptance is the check.
- `shellcheck` is not installed on this machine (CI runs it only for `ops/backups/*.sh`); only `bash -n` was run.
- The HTTP smoke is unit-tested with fake `fetch`; it was never run against the live Data API. The Worker flags and the browser flows (section 4, steps 8-9) are manual.
- No snapshot of >= 237 migrations exists or is pinned yet.
