# P1 PR Conflict Matrix

**Purpose.** Show how open pull requests interact with Phase 1 (username and DOB removal) so migrations, tests and files do not collide. **Current decision.** None of these PRs is closed, modified or merged by Phase 1 work. **#128 and #129 are recorded as HOLD** (not merged, not modified, not closed): after Phase 1 they are rebased or reworked without username dependencies and relabelled with migration timestamps newer than the deployed history (section 3). The owner still decides the fate of every other PR. **Rationale.** PR state alone proves nothing, so every row was verified with `git cherry`, `merge-base` and `merge-tree` against `main` `1b00ff4` (2026-11-10, read-only, subagent-reported, awaiting reviewer verification). **Scope.** Open PRs listed below. **Deferred.** Any action on these PRs. **Consequences.** Ordering and relabel decisions in section 3 need owner approval. **Related files.** [Master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md).

## 1. Matrix

| PR | State vs `main` | Migrations not on main | Username/DOB touch | Phase 1 risk | Recommended handling |
|---|---|---|---|---|---|
| #116 | Head is an ancestor of `main` (0 ahead): open but already in main (stale). Tip tree holds an unmerged file | `20261102090001_phone_code_budget_and_verified_proof.sql` (superseded) | indirect | Low | Do not base on it; owner may close as stale |
| #120 #121 #122 #124 #125 #126 #127 #136 | Heads are ancestors of `main` (0 commits ahead). Content reached `main` via merge `d3b8737` and R2 merge `4ef1452` | none | none | Low | Stale; do not base on them |
| #117 | Docs only, clean | none | none | None | Independent |
| #171 / #172 / #173 | Phase 1 implementation stack, all based on `main`. **#173 contains every commit of #171 and #172** (0 missing, `git rev-list`, 2026-11-11), so it is the combined Auth + Frontend/Admin application PR; `git merge-tree` of #173 against `main` `66a0f0ab` is conflict-free | M1 `20261110090002` only (in #171 and #173) | this is the Phase 1 change | **#172 is superseded by #173 and must NOT be merged on its own** (its `auth-captcha-e2e` fails: old sign-up specs/UI are incompatible with server-side `ageConfirmed`; the fix is in #173) | Merge #171 first (DB only), then merge `main` into #173 and merge #173, then close #172 with a comment pointing to #173 (owner actions, not executed). See master plan 3.10 |
| #128 | **HOLD.** Base `main`; clean to `main` for files audited | `20261101090001_verification_apply_reviewer_gate.sql` | none | Medium: out-of-order timestamp (deployed history ends `20261107090006`, so `20261101...` would be an out-of-order apply) and pgTAP number clash | HOLD. After Phase 1: rebase, relabel to `>= 20261112...`, renumber pgTAP above the highest on `main` |
| #129 | **HOLD.** Stacked on #128 | `20261101090001`, `20261101090002`, `20261101090003` | `admin_view_craftsman_profile` returns `p.username` and calls `app.profile_completion` | **High**: merge-tree conflicts with `main` in `auth.ts`, `auth-sign-out.test.ts`, pgTAP 41 and 85, and `AGENT_WORK_LOG`; `p.username` breaks at run time once M3 drops the column (PL/pgSQL bodies do not block the drop) | HOLD. After Phase 1: rework `admin_view_craftsman_profile` to drop the username key and column read, keep its use of `app.profile_completion` (its `missing`/`percent` contract changed in M1), rebase over the Phase 1 app changes, relabel to `>= 20261112...` |
| #130 | CI validation only, conflicts | n/a | n/a | Low | Never merge |
| #131 | Validation only | n/a | n/a | Low | Do not merge |
| #134 | Validation only; stale registration copies | `20261102090001_phone_authority_send_budget`, `20261103090002_request_and_verification_media` (unique, not on main) | stale registration copy | Low | Do not merge |
| #146 | Conflicts with `main` | none read | hosted-acceptance spec may sign in by username (check) | Medium | Review spec after app release |
| #149, #168 | Low risk | none read | none known | Low | Independent |
| #159 | Docs only; touches the same workflow as #146 | none | none | Low | Update runbooks after M3 |

## 2. Collisions

- **Migration names:** no open head carries a migration `>= 20261108`, so `20261110090002`, `20261111090001`, `20261111090002` do not collide by name.
- **Timestamp ordering:** #128/#129 migrations (`20261101...`) sort **before** the deployed history (ends `20261107090006`), M1 (`20261110090002`) and M2/M3 (`20261111...`). Applying them afterwards is an out-of-order apply. **Plan (HOLD):** keep them on hold through Phase 1, then relabel their migrations to timestamps `>= 20261112...` (newer than everything deployed or planned for Phase 1) so they apply in order; landing them before M1 is no longer an option because M1 is already in review. The relabel is a rename of unmerged files, done in their own rework, never as an edit of an applied migration. Needs the owner's go when the hold is lifted; nothing is done to those PRs now.
- **Reworked #129 content:** besides the username key, re-check every function it adds against the M3 catalog test (no function body may reference `username`, `username_normalized`, `username_reserved_at` or `birth_date`), and re-run its permission snapshot on top of `20261110090002.json`.
- **pgTAP numbers:** `116`, `117`, `118` are each already used twice on `main` (`116_showroom_social_links` and `116_sign_up_birthday_phone_codes`, `117_account_basics` and `117_showroom_social_links_settings`, `118_registration_username_lease` and `118_showroom_social_links_atomicity`); `main` runs to `124`. #128/#129 test files clash by prefix; Phase 1 tests use numbers above the highest on `main` at the time of writing.
- **Files:** #129 conflicts in `auth.ts`, `auth-sign-out.test.ts` (also on the Phase 1 test list), pgTAP 41/85 (85 is on the Phase 1 list) and the work log.

## 3. Recommended order (needs owner approval where marked)

1. #128/#129 stay on HOLD (recorded; owner confirms the hold and later the relabel).
2. M1 compatibility migration (PR-1, #171; CI per exact SHA in [P1-EVIDENCE.md section 7](P1-EVIDENCE.md)). Apply M1 to the environment before its app release.
3. App release: #173 (combined PR-2 + PR-3); #172 is closed as superseded, never merged alone.
4. Auth-metadata scrub.
5. M2 cleanup (needs restore-verified backup).
6. M3 drop.
7. Update #159, #146 and runbooks.

Owner constraints: do not close, modify or merge unrelated PRs without approval; PR-2..PR-5 do not start until PR-1 compatibility and the blockers are reviewed.
