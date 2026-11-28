# Marketplace retest fixes: gated Acceptance apply plan - 2026-11-28

Status: **PREPARED, NOT APPLIED.** Nothing hosted was changed. Production (`kkpkgjrweysgvhvkhzun`) is not part of this plan.

Plan name: **`marketplace-retest`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance (`nxossqhdfltcqdwvbewi`) **266 -> 267** migrations, plain push, no `--include-all`.

## Purpose

Bring Acceptance up to the database behaviour the 2026-11-28 retest fixes need ([test log](MARKETPLACE_ACCEPTANCE_TEST_LOG.md): F07, F09, F27).

## Current decision

One plan for the one pending migration, applied before the frontend of the same commit is deployed.

## Rationale

F07 (seller address on the invoice), F09 (money text in notifications) and the database half of F27 (payment status on the waybill) cannot be fixed in the frontend.

## Scope

| Migration | What changes |
|---|---|
| `20261128150001` | an invoice falls back to the showroom's oldest active branch with an address; notifications write money as the pages do (`EGP 150`); the waybill read returns the payment status |

Measured on a scratch replay: **7 functions** - 6 replaced, 1 internal helper added (`app.marketplace_money`, no API role). No table, column, constraint, template or row.

## Recovery

No fresh backup is required: the migration writes no row. The recovery is `scripts/hosted-db/forward-fix/marketplace-retest-restore-previous.sql` (sha256 pinned in the gate). It restores the 6 previous definitions and drops the helper. It **refuses, changing nothing**, if a later migration is applied or another function started using the helper. Invoices and notifications written in the meantime keep their text.

## Before the apply

- The PR carrying this plan is merged; no newer migration is on `main` (otherwise the preflight refuses).
- No frontend rollback is needed: the deployed build works with 266 and with 267.
- A new invoice gets an address only if the showroom has a branch with an address. On 2026-11-28 one of the two selling showrooms on Acceptance (`TEST-E2E Showroom`) had none; the showroom of `MP-000014` has one.

## Ordered checklist

PowerShell, from the real clone `D:\projects\aladdin-acc-apply` (not a git worktree), on `main` equal to `origin/main` with a clean tree. Run the scripts with Git Bash by its full path: plain `bash` opens WSL, which has no `node`.

1. Update the clone:

   ```powershell
   cd D:\projects\aladdin-acc-apply; git switch main; git pull --ff-only; pnpm install --frozen-lockfile
   ```

2. Preflight, read-only (owner GO):

   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/acceptance-preflight.sh marketplace-retest
   ```

   Expected: 266 applied, exactly `20261128150001` pending, history guard passes.

3. Apply (owner GO, hidden password prompt, typed confirmation `APPLY marketplace-retest TO ACCEPTANCE`):

   ```powershell
   & "C:\Program Files\Git\bin\bash.exe" scripts/hosted-db/acceptance-apply.sh --plan marketplace-retest --sha (git rev-parse origin/main)
   ```

   Before the push: sha, clean tree, forward-fix sha256, link (Production refused), history, dry run, permissions against contract `20261128090001`, counts, structure, catalog fingerprint, `pre` smoke. After it: history 267 / `20261128150001`, permissions against contract `20261128150001`, catalog diff exactly the plan's list, `post` smoke.

4. Confirm `MARKETPLACE RETEST SMOKE (post): OK` and `PASS`.
5. Deploy the frontend (owner GO): workflow `Cloudflare frontend preview`, `workflow_dispatch` on `main` at the applied commit; record the version id; `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` answer 200.
6. Retest F07, F09, F27, F28 and F29 (F07 and F09 need a new order) and record the result in `RUNTIME_STATE.md` and `AGENT_WORK_LOG.md`.

## What is deferred

F30 (owner decision), the timers Worker, WhatsApp on Acceptance, the remaining tests in the log, and Production.

## Consequences

- Invoices and notifications created after the apply use the new address fallback and money text. Issued invoices (`INV-000001`, `INV-000002`) and sent notifications never change.
- A Production plan prepared before this migration must list it once it is on `main`.

## Evidence and what is NOT verified

- `node scripts/hosted-db/marketplace-retest-scratch-proof.mjs` (throwaway databases in a local container at 266), 2026-11-28: OK - the catalog diff is exactly the plan's list; both smokes pass; the forward-fix returns the catalog, every row and every function grant to the pre-state, also on a second run; it refuses once another function uses the helper. Its "later migration" refusal is **not** exercised by the proof.
- Read-only on Acceptance, 2026-11-28: the 6 functions to be replaced have the same body, security setting, search path and grants as the replayed pre-state; the `pre` smoke facts hold (266 / `20261128120001`, no helper, 4 writers on the old format, 39 templates).
- `node --test scripts/*.test.mjs scripts/hosted-db/*.test.mjs`: 511 pass, 2 skipped, 0 fail.
- **Not verified:** the apply and preflight scripts were syntax-checked and unit-tested, not run against a hosted database.

## Related files

- `scripts/hosted-db/acceptance-gate.mjs`, `acceptance-apply.sh`, `marketplace-retest-smoke.{sql,mjs,test.mjs}`, `marketplace-retest-scratch-proof.mjs`
- [Marketplace clarity plan](MARKETPLACE_CLARITY_ACCEPTANCE_PLAN_20261128.md) · [Runtime state](RUNTIME_STATE.md)
