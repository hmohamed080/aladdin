# Marketplace orders: gated PRODUCTION plan (246 -> 266) - 2026-11-28

Status: **PLAN, prepared and NOT applied.** Nothing was applied, deployed, enabled or written on Production (`kkpkgjrweysgvhvkhzun`) or Acceptance by the work that produced this document. The only hosted access was read-only (`SELECT`, the migration list and the security advisors) on Production. The owner runs the scripts, each step on an explicit GO.

## Purpose

One runbook for taking Production from the Marketplace catalogue (246 migrations) to the Marketplace order flow (266), and for everything else Production needs before buyers can order: backup, frontend, flags, timers, phone verification, security, admin permissions, video, rollback and the tests still open.

## Current decision

- Plan name **`prod-marketplace-orders`** in `scripts/hosted-db/acceptance-gate.mjs` (target `production`): **246 (`20261124120001`) -> 266 (`20261128120001`)**, 20 migrations, one plain push, never `--include-all`. It is the Acceptance plans `marketplace-orders` (246 -> 264) and `marketplace-clarity` (264 -> 266) combined: the pending list, the expected catalog changes (727 objects) and the forward-fixes come from those two plans in code, not from a second typed list.
- Permission contracts: before `20261124120001`, after `20261128090001` (the last migration changes no grant).
- Recovery: a restore-verified Production snapshot taken at **246 or later** (mandatory), plus the forward-fixes `marketplace-clarity-restore-previous.sql` **then** `marketplace-orders-remove.sql`.
- **The plan cannot run today.** No Production snapshot of 246 or later is pinned, so the recovery gate refuses before the password prompt. That is intended.
- No launch decision is made here. Every product choice is listed in "What is deferred" as open.
- Recorded owner decision (Acceptance test log): findings **F01-F27 are fixed before Production**; the remaining tests wait until the owner asks for them.

## Rationale

- One plan instead of two: a plain push always sends every unapplied local migration, so a `246 -> 264` push from current `main` is impossible; and Production has no order, payment proof or Marketplace product for an intermediate step to protect, so splitting buys nothing.
- Data is the cheapest it will ever be: 0 orders, 0 products. The forward-fixes work only until the new application writes data.
- Database first, frontend second: the current Production frontend keeps every function it calls (no public function is removed or changes signature between 246 and 266); the new frontend needs the new functions.

## Scope

### 1. Production state, read live on 2026-11-28 (about 14:40-16:00Z)

| Item | Value |
|---|---|
| Migrations | **246**, latest `20261124120001`; the version list is identical to the first 246 files on `main` (`e1692e4f`) |
| Pending on `main` | exactly **20** |
| Marketplace orders / payment proofs | **0 / 0** (nothing of the old order model is open, so the migration cannot refuse for that) |
| Marketplace products, images, videos, notifications, platform events | 0 |
| Sellers | 1 approved (has a slug; payment settings and delivery settings not ready; no branch address) |
| Marketplace switch | **open** (set 2026-11-25T09:20Z); `media_verification_ready` true |
| Notification templates / owner-message presets | 8 (none edited) / 15 |
| Users | 1108 profiles; **31 with a verified mobile** |
| Admin roles (active) | Super Admin 1, Administrator 1, Moderator 1, Support 0 |
| Catalog compared with a local 246 database | Same, except: the hosted-only table `app.storage_write_closure_saved`; **9 functions stored with CRLF line endings** (identical after normalising; the plan touches none of them); the same 221 values of `ck_audit_action_known` in a different order (the plan does not change it) |
| Public site | `/api/health` 200; `/market` shows "coming soon" |

Open work that changes this plan if it lands on `main` before the apply (checked 2026-11-28):

| PR | Adds | Effect |
|---|---|---|
| #296 (Engineer account) | `20261128130001`-`20261128130007` | newer than the plan: the `drift` check refuses until the plan (or a new one) lists them, with their contract, changed objects and forward-fix |
| #298 (retest notes F07, F09, F27-F29; open, not merged, head `f7b7eeac`) | `20261128150001` and its permission contract; 6 functions replaced, 1 internal helper added, no table, row or client grant | newer than the plan: if merged first, the plan must become **246 -> 267** (pending list, post contract, catalog changes, forward-fix `marketplace-retest` first in the undo order, smoke counts, proof re-run). The PR carries the Acceptance plan `marketplace-retest` (266 -> 267, not applied), which must pass before Production |
| #284 (backup console) | `20261126130001` | falls inside the range: drift refuses; on Acceptance (already 266) it would be out of order |
| #244 (draft, conflicting) | `20261123090001` | older than Production's latest: a plain push is not enough |

### 2. What the 20 migrations do, and what is live the moment they run

Details: [`MARKETPLACE_ORDERS_ACCEPTANCE_PLAN_20261126.md`](MARKETPLACE_ORDERS_ACCEPTANCE_PLAN_20261126.md) and [`MARKETPLACE_CLARITY_ACCEPTANCE_PLAN_20261128.md`](MARKETPLACE_CLARITY_ACCEPTANCE_PLAN_20261128.md). 21 new tables, all with RLS and no anonymous privilege. Seeds: notification templates 8 -> 39, owner-message presets 15 -> 35, 6 return reason rules, 1 upload-limit settings row, 2 admin permissions. No existing row is rewritten on Production (the order backfill has 0 orders).

Live **before** any new frontend: the upload limits (today: fixed 50 per hour per user and per organization; after: 50 successful and 150 attempts per hour and 1024 MB, admin-settable, with exemptions), the independent-publisher publishing guard, the stale-backup expiry in the backup ledger, pinned `search_path` on every function, and the new order, payment and return rules in the database.

### 3. Conditions before the apply

| # | Condition | Who | State |
|---|---|---|---|
| C1 | This PR merged | owner | open |
| C2 | Acceptance retest of the fixed findings (section 8) and the tests the owner marks mandatory; F27 decided | owner / test session | open |
| C3 | Soak period on Acceptance, length chosen by the owner | owner | open |
| C4 | New Production backup taken at 246, restore test `RESULT: PASS`, then a pin PR (below) | owner | **open, blocks the apply** |
| C5 | `main` holds no migration outside the plan (#298, #296, #284, #244) | owner (merge order) | open |
| C6 | Rollback frontend version recorded from the live dashboard | owner | open |
| C7 | Launch posture decided (flags, open switch, approvals) | owner | open |

**C4, the snapshot.** Succeeded Production backups that exist at 246 but have **no recorded restore test** (so they cannot be pinned as they are): runs `46095978490` (2026-11-28 02:01Z), `45917803967` (2026-11-27), `45722999580` (2026-11-25 23:39Z). The last restore test on record (`45406400001`, PASS, 2026-11-24) covers a 237 snapshot. Take the backup as close to the apply as practical (a restore loses everything written after it), restore-test it, then add it to `PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS` with `backupRun`, `restoreRun`, `tables`, `rows`, `migrations: 246`. The same PR must update the exact snapshot list asserted by the `prod-catchup` test in `acceptance-gate.test.mjs`, or CI fails.

### 4. Apply checklist (nothing here has been executed)

PowerShell, from a checkout of `origin/main` with a clean tree. Use Git Bash by full path: plain `bash` is WSL and has no Node.

1. Record the frontend version serving 100% on `aladdin-frontend-production` (rollback target; last recorded `1babd2c0-ded2-4e44-a73e-982e62179485`, from `d33afa66`) and list its variables and secrets (needed in section 6.2).
2. Preflight, read-only:
   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/production-preflight.sh prod-marketplace-orders
   ```
   Expected: HEAD = origin/main, `drift` ok, 246 applied, exactly the 20 pending, plain push, history guard passes.
3. Apply, at a quiet hour (the post check fails if the number of storage objects or media location rows changes during the push), on an explicit GO:
   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/production-apply.sh --plan prod-marketplace-orders --sha (git rev-parse origin/main) --backup-label <pinned aladdin-production-... label>
   ```
   Hidden password prompt, read-only pre-checks (history, dry run, function permissions, counts, structure, catalog fingerprint, `marketplace-orders-smoke.sql` "pre"), typed `APPLY prod-marketplace-orders TO PRODUCTION`, push, then: history 266, permissions `20261128090001`, counts, structure, catalog diff = exactly the plan's list, orders smoke "post" and clarity smoke "post". Expected end: `PASS`.
   There is no clarity "pre" smoke: its query reads tables that the same push creates.
   If the push stops midway: do not retry. History stops at the failing file; read `supabase migration list --linked` and decide recovery (section 9).
4. Frontend, **after** the database: workflow `cloudflare-production.yml`, `stage = frontend-upload`, `media_mode = match-live`, same commit. The new version serves 0%. Then:
   ```powershell
   node frontend/scripts/check-cloudflare-production.mjs --verify-version <version id>
   ```
   This compares only the three media flags; compare every other variable and secret by hand against step 1. Promote 10%, watch errors, then 100%, each on its own approval.
5. Anonymous HTTP smoke:
   ```powershell
   $env:SMOKE_TARGET = "production"
   ```
   ```powershell
   $env:SMOKE_URL = "https://kkpkgjrweysgvhvkhzun.supabase.co"
   ```
   ```powershell
   $env:SMOKE_PUBLISHABLE_KEY = "<Production publishable key>"
   ```
   ```powershell
   node scripts/hosted-db/marketplace-v2-smoke.mjs http
   ```
   Add `$env:SMOKE_EXPECT_OPEN = "false"` if the Marketplace was closed on purpose.
6. Owner steps in the product: grant the two new permissions if wanted (6.6), complete the seller's payment methods, delivery settings and branch address, start the timers (6.3) **before** ordering is on.
7. Record versions, snapshot label and counts in `RUNTIME_STATE.md` and `AGENT_WORK_LOG.md`.

### 5. Recommended order

backup + restore test + pin -> preflight -> apply -> frontend upload with ordering **off** -> checks and seller setup -> timers running -> phone verification checked -> second frontend release with ordering **on** (only if the owner chooses that posture) -> admin grants -> watch.

### 6. Everything Production needs besides the database

#### 6.1 Frontend flags

Production sets **neither** flag. Both are read in browser code, so they must exist **at build time** (the `env` block of `.github/workflows/cloudflare-production.yml`) **and** in `env.production.vars` of `frontend/wrangler.jsonc` (the preview has both). That is a small frontend PR, not part of this one.

| Flag | Turns on |
|---|---|
| `NEXT_PUBLIC_MARKETPLACE_PREVIEW` | the public Marketplace (`/market`, product and seller pages), the showroom Marketplace area and its navigation, `/settings/addresses` |
| `NEXT_PUBLIC_MARKETPLACE_ORDERING` (needs PREVIEW) | cart, checkout, orders, returns, add to cart |

No map provider is configured (`NEXT_PUBLIC_MAPS_PROVIDER` unset).

#### 6.2 Phone verification and WhatsApp (**check before ordering**)

- Checkout refuses a buyer whose recipient mobile is not the account's verified mobile (`phone_unverified`). Only **31 of 1108** profiles are verified, so almost every buyer must verify inside checkout.
- The Production database records WhatsApp delivery switched **on by an administrator on 2026-11-10** (reason "starting the phone sign up", daily limit 1000, hard ceiling 2000) and 32 completed verifications from 2026-11-10 to 2026-11-24. Repository records still describe it as off. **The current state of the app switches (`PHONE_*`) and of the delivery Worker was not read.**
- Owner check: which `PHONE_*` values the live Worker version carries and whether each is a **secret** or a **plain variable**. `wrangler.jsonc` declares none; a plain variable added in the dashboard is replaced by the file's variables on the next deploy, a secret is kept. Then one real verification inside checkout (test T54).

#### 6.3 Timers Worker

- Without it nothing runs the 72-hour seller deadline, reminders, escalations, automatic cancellation or the checkout-session purge, while the pages promise them (finding F23).
- Only `aladdin-marketplace-timers-acceptance` is configured and it is approved **for Acceptance only**. Production needs its own configuration (name, `APP_ENV`), a reviewed PR, the owner's approval, and two secrets set with `wrangler secret put`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Cron every 5 minutes.
- Stop-gap: `scripts/marketplace-timers.mjs --execute`, which refuses Production unless `MARKETPLACE_TIMERS_APPROVED_PROJECT=kkpkgjrweysgvhvkhzun`.
- Start it only after migration `20261128090001` is applied (F24: before it, return reminders repeat on every run).

#### 6.4 Video (Production-plan item only; stays off)

No `VIDEO_ENABLED`, no `aladdin-media-edge` Worker on Production, no transcode host, and buyer playback is not built. The database part already exists since 246. It is **not** part of this release; follow [`MARKETPLACE_VIDEO_ENABLEMENT_PLAN_20261125.md`](MARKETPLACE_VIDEO_ENABLEMENT_PLAN_20261125.md) (Acceptance first).

#### 6.5 Security settings

- Hosted Turnstile CAPTCHA protection: recorded ON since 2026-10-28 (not re-read).
- Security advisors on Production (2026-11-28): no error level. Warnings: [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is **off** (owner decision); 9 functions without a pinned `search_path` (fixed by `20261126120002` in this plan); `SECURITY DEFINER` functions executable by anonymous (20) and signed-in (422) callers (the application's RPC design, held by the permission contracts); 66 tables with RLS and no policy (informational; reached only through functions).
- 0 public tables without RLS today; the post smoke requires the same for the new ones.
- The two new Worker secrets (6.3) hold the service-role key: set them with the hidden prompt, never in a file.

#### 6.6 Admin permissions

`marketplace_payment_complaints.review` and `marketplace_returns.review` are granted to **Super Admin only** (one active account). Without another grant, one person handles every complaint and return, and nobody else receives those admin notifications (test T43). Existing: `marketplace_sellers.manage` and `marketplace_media.moderate` (Administrator, Super Admin), `marketplace_platform.manage` (Super Admin).

#### 6.7 Seller and Marketplace data

The one approved seller cannot take an order yet: no payment method ready, no delivery settings, no branch address (the invoice's seller address comes from it, F07), and Production has no Marketplace product. The Marketplace switch is **already open**, so publishing becomes visible once the preview flag is on.

#### 6.8 Backups after the apply

The schedule keeps running; restore tests pin the Auth image (PR #288). Take one extra backup after the apply and restore-test it, so a pinned snapshot at 266 exists for the next plan.

### 7. Deploy order and compatibility

Database, then frontend. Between them the old frontend runs on the new database: every public function it can call still exists with the same arguments and result type (513 -> 580 public functions, none removed or overloaded, compared on a local database). Behaviour changes in section 2 apply at once. **The old frontend was not exercised against 266.**

### 8. Acceptance findings and tests that gate Production

Source: [`MARKETPLACE_ACCEPTANCE_TEST_LOG.md`](MARKETPLACE_ACCEPTANCE_TEST_LOG.md) as on `main` at `e1692e4f`; a parallel session is retesting, so read the newest version before the GO.

| State on `main` | Findings |
|---|---|
| Confirmed | F05, F06, F07 (check a new invoice), F08, F25, F26 |
| Fixed, **waiting for retest** (condition: F01-F27 before Production) | F01-F04, F09-F22, F24 |
| Waiting for the timers Worker | F23 |
| **Not fixed** | F27 (waybill of a refunded order says "Paid in full") |

Not tested at all: returns **T01-T15**, payment and cancellation **T20-T27**, shipping and receipt **T30-T37**, timers and notifications **T40-T43**, interface and permissions **T50-T58**. Which of these must pass before Production is an **owner decision**. Suggested minimum if ordering is turned on: T20, T22-T26 (money), T40 (timers), T50, T52, T53, T54 (mobile, Arabic, guest, phone step), T55 (staff permissions), plus T01/T12 once the Worker runs.

### 9. Rollback and recovery ladder

1. **Frontend first:** `wrangler rollback <recorded version> --env production` (or the dashboard). Ordering alone is rolled back by returning to the version built with the flag off. Do not roll back past the R2-only version (it reopens Supabase Storage writes).
2. **Close the Marketplace** (Super Admin switch, audited) and **stop the timers Worker**. The close writes a permanent platform event.
3. **Forward-fix** (owner GO, as a **new migration**, never the SQL Editor), in order: `forward-fix/marketplace-clarity-restore-previous.sql` (only if `20261128090001` is applied), then `forward-fix/marketplace-orders-remove.sql`. Each refuses, changing nothing, once data it would destroy or lose exists (for example a refund-confirmation timer, a changed upload limit or an edited new template; the full guard lists are in the two Acceptance runbooks). If the second refuses after the first ran, the database is "clarity undone, orders still applied". Proven from every partly applied state.
4. **Restore the pinned snapshot:** the only recovery after real use. Everything written after the snapshot is lost.

## What is deferred

Open owner decisions. Nothing below is assumed.

| # | Decision |
|---|---|
| D1 | Launch posture: flags off; browse only (PREVIEW); or ordering on. Same release or two steps |
| D2 | Keep the Marketplace switch open, or close it until the checks pass (it is open now) |
| D3 | Which tests (T01-T58) are mandatory, how long the Acceptance soak lasts, and whether F27 is fixed first |
| D4 | Timers Worker on Production (new approval), or ordering waits |
| D5 | Phone verification / WhatsApp for checkout: confirm the live switches and the daily limit |
| D6 | Who besides Super Admin gets complaints and returns review |
| D7 | Merge order of #298, #296 and #284 against this apply (apply first, or extend the plan) |
| D8 | Video: stays off, or start the separate enablement plan |
| D9 | Leaked password protection |

Also deferred: the frontend flag PR, the Production timers configuration, buyer video playback, a map provider.

## Consequences

- After the apply, the permission contract is `20261128090001`; `prod-marketplace-v2` and older plans can no longer run from `main`.
- The forward-fix window closes with the first real order, address or return; after that only the snapshot remains.
- Turning ordering on without the timers Worker or phone verification leaves orders that never expire, or buyers who cannot check out.

### Evidence: what is verified

- `node --test scripts/hosted-db/*.test.mjs scripts/*.test.mjs`: 513 tests, 511 pass, 0 fail (includes `marketplace-orders-prod-plan.test.mjs`).
- `marketplace-orders-prod-scratch-proof.mjs` on a throwaway local database at 246: pre and post smokes pass; catalog diff exactly the plan's 727 objects with all 20 files in one session; both forward-fixes give back the pre-state (catalog, rows, function grants) after the full plan and from each of the 19 partial states; three refusal cases change nothing.
- Local rehearsal of the apply steps with the real Supabase CLI (2.110.0): history list and dry run accepted by the gate and history guard; permissions 954 functions = `20261124120001` before and 1092 = `20261128090001` after; `db push`; post gate, structure and count checks, catalog diff, both post smokes.
- Production pre-state facts judged by the orders "pre" smoke: all pass.

### Evidence: what is NOT verified

- `production-preflight.sh` and `production-apply.sh` have never run against Production; `db push --dry-run` there has not been seen. The local rehearsal used `--local` and its own query helper, not the scripts themselves.
- No restore-tested Production snapshot at 246 exists.
- The old frontend on 266, the new frontend with either flag on Production, the HTTP smoke at 266, and the live `PHONE_*`, video and media variables of the Production Worker.
- Behaviour with real data volume; timers, WhatsApp delivery and returns on any hosted environment beyond the Acceptance log.

## Related files

[`MARKETPLACE_ORDERS_ACCEPTANCE_PLAN_20261126.md`](MARKETPLACE_ORDERS_ACCEPTANCE_PLAN_20261126.md) · [`MARKETPLACE_CLARITY_ACCEPTANCE_PLAN_20261128.md`](MARKETPLACE_CLARITY_ACCEPTANCE_PLAN_20261128.md) · [`MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md`](MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md) · [`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md) · [`MARKETPLACE_ACCEPTANCE_TEST_LOG.md`](MARKETPLACE_ACCEPTANCE_TEST_LOG.md) · [`MARKETPLACE_VIDEO_ENABLEMENT_PLAN_20261125.md`](MARKETPLACE_VIDEO_ENABLEMENT_PLAN_20261125.md) · [`RUNTIME_STATE.md`](RUNTIME_STATE.md) · [timers Worker](../../edge/marketplace-timers-worker/README.md) · [`acceptance-gate.mjs`](../../scripts/hosted-db/acceptance-gate.mjs) · [`production-apply.sh`](../../scripts/hosted-db/production-apply.sh) · [`production-preflight.sh`](../../scripts/hosted-db/production-preflight.sh) · [scratch proof](../../scripts/hosted-db/marketplace-orders-prod-scratch-proof.mjs)
