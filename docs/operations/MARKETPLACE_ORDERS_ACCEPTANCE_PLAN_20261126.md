# Marketplace orders: gated Acceptance apply plan - 2026-11-26

Status: **PLAN, prepared and NOT applied.** Nothing in this document or in the PR that carries it wrote to Acceptance (`nxossqhdfltcqdwvbewi`) or Production (`kkpkgjrweysgvhvkhzun`). The owner runs `acceptance-apply.sh` themself, each step on an explicit GO. Same pattern as [MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md](MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md).

Plan name: **`marketplace-orders`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance **246 -> 264** migrations, plain push, no `--include-all`.

## 1. What is pending

Acceptance is at 246, latest `20261124120001` (read 2026-11-26). Exactly these eighteen are newer:

| Migrations | What they add |
|---|---|
| `20261125090001`, `090002` | buyer addresses, account cart |
| `20261125100001` | checkout and the new order model; **migrates the existing orders** to the new payment values and marks them `legacy` |
| `20261125110001` - `110003` | order invoices and order reads |
| `20261125120001` - `120003` | payment complaints and the timers runner |
| `20261125130001` - `130003` | returns |
| `20261125140001` | refund of a cancelled order |
| `20261126090001`, `100001` | independent publishers can publish; "not returnable" reads and return photo removal |
| `20261126110001` | upload limits: failed uploads released, Admin-controlled limits and exemptions (ADR-0032) |
| `20261126120001` | backup ledger: stale and hand-started runs |
| `20261126120002` | `search_path` pinned on the last nine functions |

Measured on a scratch replay (section 6): **21 new tables, 27 new columns on existing tables, 8 re-created constraints, 33 functions replaced, 136 added, 28 notification templates, 20 owner-message presets, 2 admin permissions** (granted to the Super Admin), 724 catalog objects changed.

## 2. Recovery

A **fresh restore-verified snapshot is mandatory** (`freshBackup: true`) and is pinned: **`aladdin-acceptance-20261126T140613Z`** (backup run 45835425956, restore run 45847352834 `RESULT: PASS`, 213 tables / 3999 rows exact, 246 migrations). It recovers only data written before it was taken.

`scripts/hosted-db/forward-fix/marketplace-orders-remove.sql` (sha256 pinned in the gate) removes everything the eighteen add, restores the previous definitions and maps the existing orders back to the old payment values. It **refuses, changing nothing**, as soon as the new application wrote any row (an address, a cart item, a checkout, a return, a complaint, a timer, an upload-limit change) or a seeded row was edited. It never deletes user data. Not undone: `updated_at` of the migrated orders, and run-time side effects of replaced functions.

In practice the forward-fix is usable only **before testing starts**. After that, recovery is: frontend rollback first, then the snapshot.

## 3. Before the apply

- Every existing order must be finished (`delivered`, `cancelled`, `returned`): the new application cannot act on an old order (owner decision: legacy orders by data check). Read 2026-11-26: 11 orders, none open. The `pre` smoke refuses otherwise.
- No frontend deploy from `main` until the apply has passed.
- If a newer migration merges into `main` first, the preflight refuses; the plan must be updated and re-proved.

## 4. Ordered checklist (nothing below has been executed)

PowerShell, from a **real clone** (not a git worktree: `acceptance-apply.sh` tests `[ -d .git ]`) fast-forwarded to `origin/main` with a clean tree.

1. Record the frontend rollback target: `pnpm --filter frontend exec wrangler deployments list --name aladdin-frontend-preview`.
2. Preflight, read-only (owner GO):

   ```powershell
   bash scripts/hosted-db/acceptance-preflight.sh marketplace-orders
   ```

   Expected: 246 applied, exactly the eighteen pending, plain push, history guard passes.
3. Apply (owner GO, hidden password prompt, typed confirmation):

   ```powershell
   bash scripts/hosted-db/acceptance-apply.sh --plan marketplace-orders --sha <40-char origin/main sha> --backup-label aladdin-acceptance-20261126T140613Z
   ```

   Before the push: sha, clean tree, forward-fix sha256, snapshot pin, link (Production refused), history, dry run, permissions against contract `20261124120001`, counts, structure, catalog fingerprint, `pre` smoke. After it: history 264 / `20261126120002`, permissions against contract `20261126120002`, catalog diff exactly the plan's list, `post` smoke.
4. Confirm `MARKETPLACE ORDERS SMOKE (post): OK` and `PASS`.
5. Deploy the frontend (owner GO): workflow `Cloudflare frontend preview`, `workflow_dispatch` on `main` at the same commit as `--sha`; record the new version id; `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` answer 200.
6. Record the result in `RUNTIME_STATE.md` and `AGENT_WORK_LOG.md`.

## 5. What changes, and what stays off

Live with the migrations: the new order model for the database; the upload limits (50 successful or running uploads and 150 attempts per hour, 1024 MB, changeable in Admin); independent publishers can publish.

Still off until separately approved: ordering in the frontend (`NEXT_PUBLIC_MARKETPLACE_ORDERING`), the timers Worker (reminders and automatic cancellation do not run), WhatsApp sending on Acceptance, video. Granting the two new admin permissions to roles other than the Super Admin is an owner step.

## 6. Evidence and what is NOT verified

- `node scripts/hosted-db/marketplace-orders-scratch-proof.mjs` (throwaway databases in a local container at 246): the catalog diff is exactly the plan's list; the migrated legacy orders; the forward-fix returns the catalog, every row and every function grant to the pre-state from the full plan **and from each of the 17 partly applied states**; it refuses after new data. Result 2026-11-26: OK.
- Read-only on Acceptance, 2026-11-26: all 954 application function definitions are identical to the replayed pre-state; constraints and columns are identical except `app.storage_write_closure_saved`, an operational table that exists only on the hosted project and that no pending migration touches.
- `node --test scripts/hosted-db/*.test.mjs` passes.

Not verified:

- The preflight and the apply script have not been run for this plan; the first real run is the owner's.
- The `post` smoke passed on a scratch database for every fact except the migration history, which a scratch replay does not record.
- The currently deployed Acceptance frontend was not tried against the new database; deploy the matching frontend straight after the apply.
- Browser flows, the Worker settings and the timers Worker are separate steps.
