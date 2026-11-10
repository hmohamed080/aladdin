# P1 PR Conflict Matrix

**Purpose.** Show how open pull requests interact with Phase 1 (username and DOB removal) so migrations, tests and files do not collide. **Current decision.** None of these PRs is closed, modified or merged by Phase 1 work; the owner decides their fate. **Rationale.** PR state alone proves nothing, so every row was verified with `git cherry`, `merge-base` and `merge-tree` against `main` `1b00ff4` (2026-11-10, read-only, subagent-reported, awaiting reviewer verification). **Scope.** Open PRs listed below. **Deferred.** Any action on these PRs. **Consequences.** Ordering and relabel decisions in section 3 need owner approval. **Related files.** [Master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md).

## 1. Matrix

| PR | State vs `main` | Migrations not on main | Username/DOB touch | Phase 1 risk | Recommended handling |
|---|---|---|---|---|---|
| #116 | Head is an ancestor of `main` (0 ahead): open but already in main (stale). Tip tree holds an unmerged file | `20261102090001_phone_code_budget_and_verified_proof.sql` (superseded) | indirect | Low | Do not base on it; owner may close as stale |
| #120 #121 #122 #124 #125 #126 #127 #136 | Heads are ancestors of `main` (0 commits ahead). Content reached `main` via merge `d3b8737` and R2 merge `4ef1452` | none | none | Low | Stale; do not base on them |
| #117 | Docs only, clean | none | none | None | Independent |
| #128 | Base `main`; clean to `main` for files audited | `20261101090001_verification_apply_reviewer_gate.sql` | none | Medium: out-of-order timestamp and pgTAP number clash | Decide fate before M1 |
| #129 | Stacked on #128 | `20261101090001`, `20261101090002`, `20261101090003` | `admin_view_craftsman_profile` returns `p.username` and calls `app.profile_completion` | **High**: merge-tree conflicts with `main` in `auth.ts`, `auth-sign-out.test.ts`, pgTAP 41 and 85, and `AGENT_WORK_LOG` | Rebase or rework before or after Phase 1; must not depend on username before M3 |
| #130 | CI validation only, conflicts | n/a | n/a | Low | Never merge |
| #131 | Validation only | n/a | n/a | Low | Do not merge |
| #134 | Validation only; stale registration copies | `20261102090001_phone_authority_send_budget`, `20261103090002_request_and_verification_media` (unique, not on main) | stale registration copy | Low | Do not merge |
| #146 | Conflicts with `main` | none read | hosted-acceptance spec may sign in by username (check) | Medium | Review spec after app release |
| #149, #168 | Low risk | none read | none known | Low | Independent |
| #159 | Docs only; touches the same workflow as #146 | none | none | Low | Update runbooks after M3 |

## 2. Collisions

- **Migration names:** no open head carries a migration `>= 20261108`, so `20261110090001`, `20261111090001`, `20261111090002` do not collide by name.
- **Timestamp ordering:** #128/#129 migrations (`20261101...`) sort **before** M1-M3. Applying them after M1-M3 on a database that already holds later versions is an out-of-order apply. Options: relabel them to `>= 20261112`, or land them before M1. Needs owner approval; not done.
- **pgTAP numbers:** `116`, `117`, `118` are each already used twice on `main` (`116_showroom_social_links` and `116_sign_up_birthday_phone_codes`, `117_account_basics` and `117_showroom_social_links_settings`, `118_registration_username_lease` and `118_showroom_social_links_atomicity`); `main` runs to `124`. #128/#129 test files clash by prefix; Phase 1 tests use numbers above the highest on `main` at the time of writing.
- **Files:** #129 conflicts in `auth.ts`, `auth-sign-out.test.ts` (also on the Phase 1 test list), pgTAP 41/85 (85 is on the Phase 1 list) and the work log.

## 3. Recommended order (needs owner approval where marked)

1. Decide the fate of #128/#129 and whether they relabel or land first (owner).
2. M1 compatibility migration (PR-1).
3. App release (PR-2/PR-3).
4. Auth-metadata scrub.
5. M2 cleanup (needs restore-verified backup).
6. M3 drop.
7. Update #159, #146 and runbooks.

Owner constraints: do not close, modify or merge unrelated PRs without approval; PR-2..PR-5 do not start until PR-1 compatibility and the blockers are reviewed.
