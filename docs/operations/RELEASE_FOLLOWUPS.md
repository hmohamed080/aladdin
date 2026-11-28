# Release follow-ups (mandatory, tracked, machine-checked)

**Purpose.** Some release work cannot happen in the same window as the release it belongs to (an expand/contract "contract" step, for example), and "later" is where it gets forgotten. Every such step is recorded here, linked to a GitHub issue, and **checked by CI**: `scripts/release-followups-guard.mjs` runs in the `migration-policy` job and fails the build when a step is untracked, premature or overdue.

**How to read it.** The fenced JSON block between the markers is the source of truth for the guard. Edit it, not the prose. Statuses are `OPEN` and `DONE`.

<!-- followups:begin -->
```json
[
  {
    "id": "RF-001",
    "title": "Drop the unused legacy table public.phone_verification_challenges",
    "status": "OPEN",
    "mandatory": true,
    "proposal": "supabase/proposals/contract_20261031090001_retire_registration_phone_challenges.sql",
    "readiness_check": "supabase/proposals/readiness_check_legacy_phone_challenges.sql",
    "issue": 135,
    "production_activated_on": null,
    "due_days_after_activation": 14,
    "hard_due_on": "2026-12-31",
    "closed_by": null
  }
]
```
<!-- followups:end -->

## Rules the guard enforces
1. Every `supabase/proposals/contract_*.sql` must be referenced by an entry here. A contract step cannot exist untracked.
2. A `mandatory` entry must link a GitHub issue.
3. A `mandatory` entry must also carry `hard_due_on`, an **absolute backstop deadline**: CI fails after it even if nobody ever records the activation date, so the step cannot be forgotten. An `OPEN` entry fails CI once **today > `production_activated_on` + `due_days_after_activation`**. Record `production_activated_on` (ISO date) in the same PR that activates Production; to move the date, change it here with the owner's reason in the PR.
4. While an entry is `OPEN`, its proposal file must **not** exist in `supabase/migrations` (a premature DROP); while it is `DONE`, `closed_by` must name an existing migration and the proposal file must be gone.
5. Dates must be ISO `YYYY-MM-DD` or `null`.

## RF-001: drop `public.phone_verification_challenges`

**What and why.** Created by `20261028090001` (PR #113) for the pre-R2 sign-up. The R2 authority (`app.phone_verification_challenges`, `20261030090001/2`) replaced it and nothing reads or writes the old table (no application code, function, view or foreign key). It is harmless (RLS on, service role only) but is a second, weaker authority and must not stay indefinitely.

**Why not now.** Everything in `supabase/migrations` is applied by the next `supabase db push` to whichever project is pushed, in order, with no knowledge of the deployed build. Migration history is never edited, renamed or deleted; the forward-only DROP stays in `supabase/proposals/` until it is safe.

**When it becomes safe, per environment (ALL must hold):**
| # | Condition | How it is established |
|---|---|---|
| 1 | The R2 build is the live build there and demonstrably serving sign-ups | readiness SQL: authority installed, switches on, at least one grant in 7 days |
| 2 | No deployment that references the table is still a rollback target | owner attestation in the PR. **Production:** none ever did: the table does not exist there until `20261028090001` is applied and the live rollback build `39bdf3a2` (2026-10-28) predates PR #113. **Acceptance:** the pre-R2 preview versions (before the R2 deploy of 2026-11-01) are retired |
| 3 | The table is idle and has no dependents | readiness SQL: no code in 24 h, no foreign key, view or function body mentioning it |
| 4 | Owner approval for that environment and a fresh read-only migration-history inspection | `scripts/hosted-db/inspect-auth-security.mjs --env <env> --only migrations` |
| 5 | Promoted with a **new** timestamp later than every migration then in the repo | the promotion PR |

**Hosted baseline (read-only, 2026-11-02).** Production: the table does not exist, so the DROP would be a no-op. Acceptance: the table exists with 0 rows, no dependents, R2 installed, switches currently OFF, so `safe_to_promote=false` until R2 is switched on there.

**Simplification assessed.** No safe shortcut exists without touching history. One option is available **only with the owner's explicit approval**: promote the DROP as the seventh migration in Production's first `db push`, so the table is created by `20261028090001` and dropped in the same push and never exists in Production. It is safe in substance (no Production build ever used the table) but it executes the DROP before R2 is live there, which the owner's rule forbids; the default plan therefore keeps the table until after cutover.

**Acceptance criteria (DONE only when all hold).**
- [ ] Table absent on Acceptance and Production (readiness SQL: `legacy_table_exists=false`).
- [ ] The DROP is a numbered migration, applied Acceptance first and then Production, each after owner approval.
- [ ] `git grep public.phone_verification_challenges` finds only the historical creating migration; generated types and permission contracts regenerated; `supabase-rls` green.
- [ ] This entry is `DONE` with `closed_by` set, the proposal file is gone from `supabase/proposals`, and issue #135 is closed.

**Due.** Production activation date + 14 days (enforced once the date is recorded), and in any case by the hard backstop `2026-12-31`, after which CI fails. Move the backstop only with the owner's reason in the PR.

## Related
[Contract proposal](../../supabase/proposals/contract_20261031090001_retire_registration_phone_challenges.sql) · [Readiness check](../../supabase/proposals/readiness_check_legacy_phone_challenges.sql) · [R2 release plan, Phase 4](../security/PHONE_SIGNUP_R2_RELEASE_PLAN.md) · [Production release plan](../security/WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md) · issue #135
