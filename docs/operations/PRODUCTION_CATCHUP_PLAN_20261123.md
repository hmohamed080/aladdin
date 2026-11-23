# Production catch-up plan (Production 210 to Acceptance 237) - 2026-11-23

Status: PLAN ONLY. Nothing here has been applied to Production. Every batch needs its own gate plan, preflight and the owner's explicit GO.

## Purpose
Production (`kkpkgjrweysgvhvkhzun`) is behind Acceptance (`nxossqhdfltcqdwvbewi`). This document lists the 30 migrations that separate them, groups them into batches by risk, and states what must exist before each batch may touch Production.

## Current decision
- Acceptance first, Production only after: no workflow applies a hosted migration or deploys Production on a push to `main`.
- Production LIVE state (read-only, 2026-11-23): 210 migrations, latest `20261112090001`, no gaps after 207. The three beyond the 2026-11-11 record (`20261110090001`, `20261110090002`, `20261112090001`) are already applied, so the remaining gap is 27 migrations, not 30, and batch 1 is down to its last two migrations. `RUNTIME_STATE.md` still shows the older "last recorded 207".
- Production has 1,093 users; 54 have `users.status = 'active'` and 1,039 do not. Their registration state has not been classified yet (see the gate batch).
- Acceptance state: 237 migrations, latest `20261122090002` (2026-11-23).
- The classification below is an estimate from file names and the notes in `scripts/hosted-db/acceptance-gate.mjs`; each batch is re-checked against its SQL when its gate plan is written.

## The 27 remaining migrations (237 - 210); 3 more of the original 30 are already on Production

| Batch | Migrations | What they do | Risk / recovery |
|---|---|---|---|
| 1. Account identity and registration | `20261114090001`, `20261115090001` (`20261110090001`, `20261110090002`, `20261112090001` are ALREADY on Production) | reviewer gate on verification apply; craftsman profile verification submit | Function-only per the Acceptance gate notes. Recovery: pinned forward-fix. No backup required by the rule, but the rule must be re-read for Production. |
| 2. Admin verification | `20261115090002` .. `20261115090006` | admin-initiated verification (new constraints on verification tables), lazy users directory, status tab and Verified tab fixes, approval notification | Touches constraints and audit vocabulary: review against live Production data before judging. |
| 3. Organization approval state | `20261116090001` | approval state in the Admin organizations view | Low. |
| 4. Marketplace | `20261116100001` .. `20261116100014` | 30 tables and 9 sequences | Highest. Fresh restore-tested backup AND a pinned forward-fix. Needs the owner's product decision that Marketplace is ready. |
| 5. Media policy and notifications | `20261121090001` .. `20261121090003` | media caps and rejected-image purge, admin media limits, notification templates | Creates tables: fresh restore-tested backup and a pinned forward-fix. |
| 6. Registration gate | `20261122090001`, `20261122090002` | Admin registration-state column and the central registration gate in `app.api_pre_request` | Function-only. Proven on Acceptance (smoke test passed 2026-11-23). Pinned forward-fix `registration-gate-restore-previous.sql`. |

## Proposed order
1 then 3, then 2, then 6, then 4 and 5 last.

Why the gate (6) is not first: Production has 1,039 users whose `users.status` is not `active`. Their derived registration state must be classified first (read-only), because the gate refuses state-changing requests of every account in `unverified`, `consent_pending` or `account_type_pending`. It refuses state-changing requests of accounts whose registration is unfinished. Before applying it to Production, count Production accounts in those states (the helper `app.admin_user_registration_state` is created by batch 6 itself, so compute the same branch order from consents, onboarding progress and email confirmation), and decide what happens to them (the gate would stop their writes until they finish registering). On Acceptance the five `consent_pending` accounts are test accounts.

## Prerequisites before ANY Production apply
1. Live read-only history of Production (done 2026-11-23: 210, latest `20261112090001`; repeat immediately before each batch) and a catalog fingerprint against the expected pre-state.
2. A Production gate per batch. `acceptance-gate.mjs` is Acceptance-only; `p2-gate.mjs` and `production-p2-push.sh` exist for Production but are pinned to the old 203 / 4 pending state and must be re-pinned to the live state for each batch (plan name, applied count, pending list, pre and post permission contract, forward-fix sha256).
3. A forward-fix file per batch, proven on a scratch database against the live Production function hashes (the same method used for `registration-gate`).
4. For batches 4 and 5 (and any batch that creates tables): a fresh Production backup and its restore test. Production backups wait for their own owner GO.
5. The matching frontend is deployed AFTER its migrations, never before.
6. Per action: a gate plan shown to the owner and an explicit GO. No batch is applied by this document.

## What is deferred
- Marketplace launch decision (batch 4).
- Whether Production backups run on a schedule (`ACCEPTANCE_BACKUP_SCHEDULE` decision is for Acceptance and still open).
- Re-pinning the Production gate scripts (first execution task).

## Consequences
- Until batch 6 reaches Production, Production has no database-level registration protection; the UI redirects remain the only guard there.
- Production keeps working unchanged while batches wait.

## Related files
- [`RUNTIME_STATE.md`](RUNTIME_STATE.md), [`AGENT_WORK_LOG.md`](AGENT_WORK_LOG.md)
- `scripts/hosted-db/acceptance-gate.mjs` (plans, forward-fix pins), `scripts/hosted-db/forward-fix/`
- [`../decisions/ADR-0031-account-registration-verification-statuses.md`](../decisions/ADR-0031-account-registration-verification-statuses.md)
