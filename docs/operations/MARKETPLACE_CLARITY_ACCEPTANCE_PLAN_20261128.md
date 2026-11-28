# Marketplace clarity fixes: gated Acceptance apply plan - 2026-11-28

Status: **APPLIED to Acceptance (`nxossqhdfltcqdwvbewi`) by the owner on 2026-11-28** from `main` `98f60d52`: post smoke OK, `PASS`. Frontend `c905580f` deployed afterwards. Production (`kkpkgjrweysgvhvkhzun`) was not touched.

Plan name: **`marketplace-clarity`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance **264 -> 266** migrations, plain push, no `--include-all`.

## Purpose

Bring Acceptance up to the database behaviour the 2026-11-28 test-round fixes need ([test log](MARKETPLACE_ACCEPTANCE_TEST_LOG.md), F01-F26).

## Current decision

One plan for both pending migrations, applied before the retest and before any timers Worker deploy.

## Rationale

Return reminders would repeat on every run without `20261128090001` (F24), and most remaining retests need it.

## Scope

| Migration | What changes |
|---|---|
| `20261128090001` | return notifications to the other side; refund-confirmation reminder (3 days) and admin queue (7 days); return timers advance and close; rejection reason presets; units, labelled address lines and readable dates; invoice buyer area, address parts and variant; cart free-delivery facts; admin phones on returns |
| `20261128120001` | waybill: nothing to collect once a refund is owed or done; labelled address parts |

Measured on a scratch replay: **22 catalog objects** - 17 functions replaced, 2 internal helpers added (no API role), 3 CHECK constraints re-created with more allowed values. **3 notification templates** inserted. No table or column; no existing row is rewritten.

## Recovery

No fresh backup is required: nothing existing is rewritten or dropped. The recovery is `scripts/hosted-db/forward-fix/marketplace-clarity-restore-previous.sql` (sha256 pinned in the gate). It restores the previous definitions and constraints and removes the two helpers and three templates. It **refuses, changing nothing**, once a refund-confirmation timer, an escalation or a notification of the new kinds exists, or a new template was edited; after that the recovery is a new forward-fix. Address lines and invoices written in the new format stay.

## Before the apply

- The PR carrying this plan is merged; no newer migration is on `main` (otherwise the preflight refuses).
- Roll nothing back in the frontend: the deployed build already works with 264, and the new fields are optional.

## Ordered checklist (executed 2026-11-28, except the retest in step 6)

PowerShell, from a **real clone** (not a git worktree), on `main` equal to `origin/main` with a clean tree. Run the scripts with Git Bash by its full path: plain `bash` opened WSL, which has no `node` (first preflight attempt, nothing changed).

1. Update the clone:

   ```powershell
   cd D:\projects\aladdin-acc-apply; git switch main; git pull --ff-only; pnpm install --frozen-lockfile
   ```

2. Preflight, read-only (owner GO):

   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/acceptance-preflight.sh marketplace-clarity
   ```

   Expected: 264 applied, exactly the two pending, history guard passes.

3. Apply (owner GO, hidden password prompt, typed confirmation `APPLY marketplace-clarity TO ACCEPTANCE`):

   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/acceptance-apply.sh --plan marketplace-clarity --sha (git rev-parse origin/main)
   ```

   Before the push: sha, clean tree, forward-fix sha256, link (Production refused), history, dry run, permissions against contract `20261126120002`, counts, structure, catalog fingerprint, `pre` smoke. After it: history 266 / `20261128120001`, permissions against contract `20261128090001`, catalog diff exactly the plan's list, `post` smoke.

4. Confirm `MARKETPLACE CLARITY SMOKE (post): OK` and `PASS`.
5. Deploy the frontend (owner GO): workflow `Cloudflare frontend preview`, `workflow_dispatch` on `main` at the applied commit; record the version id; `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` answer 200.
6. Retest the 🛠️ items of the test log and record the result in `RUNTIME_STATE.md` and `AGENT_WORK_LOG.md`.

## What is deferred

The timers Worker (its two secrets and deploy come **after** this apply), WhatsApp on Acceptance, the remaining tests in the log, and Production.

## Consequences

- New orders, invoices and notifications use the new text. Issued invoices (such as `INV-000001`) and stored address lines never change.
- Until the timers Worker runs, no reminder, escalation or automatic cancellation happens.

## Evidence and what is NOT verified

- `node scripts/hosted-db/marketplace-clarity-scratch-proof.mjs` (throwaway databases in a local container at 264), 2026-11-28: OK - the catalog diff is exactly the plan's list; both smokes pass; the forward-fix returns the catalog, every row and every function grant to the pre-state from the full plan and from the half-applied state; it refuses after new data.
- Read-only on Acceptance, 2026-11-28: all application function definitions and the three constraints are identical to the replayed pre-state; the `pre` smoke facts hold (264 / `20261126120002`, 36 templates, no new template or helper, no refund-confirmation timer).
- `node --test scripts/hosted-db/*.test.mjs scripts/*.test.mjs` passes.

Verified after the apply (read-only, 2026-11-28): 266 / `20261128120001`, 39 templates, the new waybill read is in place.

## Related files

- `scripts/hosted-db/acceptance-gate.mjs`, `acceptance-apply.sh`, `marketplace-clarity-smoke.{sql,mjs,test.mjs}`
- [Marketplace orders plan](MARKETPLACE_ORDERS_ACCEPTANCE_PLAN_20261126.md) · [Runtime state](RUNTIME_STATE.md)
