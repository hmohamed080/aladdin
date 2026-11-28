# B1 reconciliation: PR #116's newer commits against the R2 integration (#127)

**Status:** review draft on an isolated, unpushed branch (`recon/b1-116-into-r2-20261102`, worktree `D:/projects/aladdin-b1-recon`). Nothing is merged, pushed, deployed or applied. No hosted database, Cloudflare, Meta or Production change was made to produce it.

## Purpose
Release blocker **B1** from the Production readiness audit: `origin/claude/registration-resume` (#116) gained four commits after the integration branch was cut, so #127's head did not contain them and a merge conflicted in ten files. This report decides, file by file, what to keep, what R2 already supersedes, and which protection had no R2 equivalent, without discarding any security improvement silently.

## Current decision
1. **Merge #116's four commits into the integration, keeping the R2 side of every conflict.** They harden the *pre-R2* sign-up path, which R2 replaced. The merge (`4ef14522`) makes those commits ancestors, so #116 is fully contained when #127 later retargets to `main`. Its tree differs from the #127 head only by #116's two append-only work-log entries.
2. **Do not ship migration `20261102090001`.** It was never applied anywhere. Its three functions act on the legacy `public.phone_verification_challenges` table, which the R2 build no longer reads.
3. **Port the one protection R2 lacks, the global rolling-24h send budget, to the delivery Worker** (`c83cd597`), because that is where the Meta cost is incurred. No SQL, no change to the authority.

## What each #116 change was, and where it lives now
| #116 change | R2 equivalent | Verdict |
|---|---|---|
| App-side Graph sender (`whatsapp-otp.ts`) with allowlist, `aladdin_otp` template, language | Deleted in R2. The Worker is delivery-only and holds the allowlist (`OTP_ALLOWED_RECIPIENTS`, allowlist is the default mode, `open` only when `OTP_ENVIRONMENT=production`), the template and languages | **Superseded** (proven by the Acceptance pilot) |
| Server-only proof that sets `profiles.phone_verified_at` (`phone_sign_up_mark_verified`) | The authority's single-use grant plus `phone_signup_attach` sets it for exactly the proven number. Acceptance pilot: `phone_verified_at` set after the code | **Superseded** |
| Atomic per-number hourly cap under a lock (`phone_challenge_issue`) | `phone_signup_start`: per-registration lock, per-phone lock, `signup_phone_hourly`, per-registration `user_hourly_starts`, 60 s cooldown, per-IP bucket | **Superseded** |
| Resend keeps the old row so caps cannot be dodged | Resend sets `invalidated_why='superseded'` and keeps the row; cleanup refuses a retention under one day, so the 24 h windows stay intact | **Superseded** |
| Code lifetime 5 minutes | `challenge_ttl` default 5 min, Worker `ttlSeconds` 300, template TTL 300 s | **Superseded** |
| `provider_accepted_at` (accepted is billable, reserved is not) | The Worker journal records `reserved / accepted / failed`; a failed Meta call invalidates the challenge as `delivery_failed` | **Superseded** (see decision D1 on counting) |
| Fail-closed defaults (allowlist and budget required) | Delivery defaults OFF, the token is read only after every gate, allowlist mandatory; the budget was missing | **Superseded, except the budget** |
| **Global rolling-24h send budget** (`WHATSAPP_DAILY_SEND_LIMIT`, `p_daily_limit`) | **None.** R2 limits per registration, phone and IP but has no cap across all numbers | **Must be ported: done in the Worker** |
| Legacy-table pgTAP, concurrency script, workflow step, generated types, permission contract | Only meaningful for the dropped migration | **Removed with it** |

**Production relevance:** the live Production build (2026-10-28) has no WhatsApp sign-up and no legacy challenge table (`phone_verification_challenges` does not exist there). None of the dropped hardening protected any live Production path.

## File-by-file
| File | Conflict | Resolution and rationale |
|---|---|---|
| `docs/operations/AGENT_WORK_LOG.md` | content | **Kept both** entries; the log is append-only history. #116's entry describes a path R2 supersedes (see this report) |
| `frontend/.env.example` | content | **R2.** The frontend no longer holds any `WHATSAPP_*`; the Worker owns template, language, allowlist and (now) the budget |
| `frontend/src/lib/env/index.ts` | content | **R2.** Same reason; the budget moved to the Worker as `OTP_DAILY_SEND_LIMIT` |
| `frontend/src/lib/supabase/admin-server.ts` | content | **R2.** `issuePhoneChallenge` / `markPhoneChallengeSent` / `markPhoneVerified` call the legacy functions; R2 uses the authority |
| `frontend/src/server/auth/phone-sign-up.ts` and `.test.ts` | content | **R2.** The sign-up flow runs on the authority and the grant |
| `frontend/src/server/auth/whatsapp-otp.ts` and `.test.ts` | modify/delete | **Deletion confirmed.** The legacy app-side sender is replaced by the Worker transport |
| `frontend/wrangler.jsonc` | content | **R2.** `WHATSAPP_*` vars stay out of the frontend (`PHONE_*` switches ship OFF) |
| `supabase/tests/104_installer_phone_alias_guard_test.sql` | content | **R2.** The R2 list includes `phone_signup_attach`; #116's lists the dropped function |
| `.github/workflows/supabase-rls.yml`, `frontend/src/types/database.types.ts` | auto-merged | **Restored to R2.** They only served the dropped migration |
| `supabase/migrations/20261102090001_*.sql`, `supabase/permissions/20261102090001.json`, pgTAP `119_*`, `phone_code_budget_concurrency_test.sh` | added by #116 | **Removed.** No migration history is edited or removed |

## The ported protection (commit `c83cd597`)
- The replay claim is one atomic statement that inserts only while fewer than `OTP_DAILY_SEND_LIMIT` claims exist in the last 24 hours. D1 serializes writes, so concurrent requests cannot overshoot (real-SQL test: 12 parallel claims against a limit of 3 gives exactly 3).
- A replay of an existing delivery stays a duplicate (200) or `409`, never a budget refusal. Claims older than 24 h are outside the window.
- **Fail closed in every environment:** a missing or invalid limit answers `503 budget_unconfigured` before the Meta token is read. An exhausted budget answers `503 budget_exhausted` before Meta and logs a numbers-only line.
- The signed preflight reports `daily_send_limit` (`0` means unconfigured) and `scripts/worker-preflight.mjs` checks it. The Acceptance preview config sets `50`; its config guard refuses a config without a positive integer.
- The app maps every non-2xx answer to a generic failure (proven by the app-to-Worker contract test), so the new answers add no user-visible wording.

## Security fixes preserved
Every protection above is either unchanged in R2 or ported. The R2 phone verification authority, the single-use grant, the legacy-account compatibility path (the hook and guard) and the Worker's replay, allowlist and signature logic are untouched. No OTP generation, verification, delivery or authorization logic was duplicated.

## Remaining decisions and blockers
- **D1 (owner): the Production budget value, and whether failed Meta calls count.** Today every claim counts (reserved, accepted, failed), which is conservative. Suggested start for Production: `200`, with Meta's own tier as a second ceiling. Production roughly 10 phone sign-ups a day recently.
- **D2 (owner): accept the unused legacy table in Production.** Migration `20261028090001` (#113) still creates `public.phone_verification_challenges`; R2 does not use it and Phase 4 drops it by its own PR. Migration history cannot change.
- **D3 (housekeeping): #116 and its newer commits are superseded.** Close them as contained after the combined merge.
- **Acceptance Worker is not redeployed.** Deployed version `4d41419c` lacks the budget. Deploying this code needs the committed `OTP_DAILY_SEND_LIMIT` var and a no-send signed preflight afterwards. It does not need another real message.
- **Still open (unchanged):** B2 mandatory CI on the final head, B3 Production Worker, B4 Production app secrets, B5 hosted rehearsals, B6 upload-only stage, B7 approvals.

## Final migration inventory (nothing applied)
- **199** repository migrations, latest `20261030090002`; the set is identical to the #127 head's. `20261102090001` is absent.
- **Production** has 193 applied (identical to `main`, latest `20261027090001`) and nothing the repo lacks.
- **Outstanding for Production, in order:** `20261028090001`, `20261028090003`, `20261029090001`, `20261029090002`, `20261030090001`, `20261030090002`.
- Permission contracts end at `20261030090002.json`. The media and View-As stacks reserve `20261101090001-3`; they are separate PRs and not part of this set.

## Test results (isolated branch, local only)
| Check | Result |
|---|---|
| WhatsApp Worker: `tsc --noEmit` | clean |
| WhatsApp Worker: `npm test` | **73 / 73** (67 existing, 5 budget tests incl. real-SQL concurrency, 1 config-guard test) |
| `check-preview-config.mjs` | PASS (also refuses a missing or invalid budget) |
| Frontend focused tests (phone verification incl. app-to-Worker contract, phone sign-up, env) | **9 files, 108 tests pass**; 2 files skipped (need a local Supabase stack) |
| Frontend ESLint on the changed test | clean |
| `inspect-auth-security.test.mjs` (migration placement and contract guard) | 32 / 32 |
| Frontend `tsc --noEmit` | one pre-existing, unrelated error: `edge/media-worker` cannot find `postgres` (that package's `node_modules` is not installed in any local worktree; no media-worker file was touched) |
| **Not run locally** (left to CI, B2) | pgTAP and the RLS replay, the RC2 upgrade path, the phone E2E and R1 matrix, the Worker E2E rig, the 2 local-integration suites, Auth CAPTCHA and Showroom E2E |

## Owner decisions after review (2026-11-02)
- **D1 accepted:** the atomic global rolling-24h budget stays, with conservative accounting (every claimed attempt and Meta failure counts). The limit must be **Admin-configurable without a deploy**; see the [Admin settings plan](WHATSAPP_OTP_ADMIN_SETTINGS_PLAN.md). The env-var form in this candidate is interim. The Production initial value is proposed in the [Production release plan](WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md), not hardcoded.
- **D2 decided:** the legacy table is **not** kept indefinitely. Its forward-only DROP stays in `supabase/proposals/` and is tracked as mandatory follow-up RF-001 ([issue #135](https://github.com/hmohamed080/aladdin/issues/135), [RELEASE_FOLLOWUPS.md](../operations/RELEASE_FOLLOWUPS.md)), checked by CI.
- **D3 decided:** #116's superseded changes are treated as contained in the reconciled stack. **The original #116 stays open until the final combined PR is merged.**

## What is deferred
Pushing, retargeting #127, running the mandatory CI, and everything in the Production preparation: each needs its own approval.

## Consequences
The combined candidate is the #127 head plus the budget port, with #116 contained and the legacy migration never shipped. It adds no migration, so the Production migration set is unchanged.

## Related files
[R2 release plan](PHONE_SIGNUP_R2_RELEASE_PLAN.md) · [R2 integration](PHONE_SIGNUP_R2_INTEGRATION.md) · [WhatsApp OTP pilot and release](WHATSAPP_OTP_R2_PILOT_AND_RELEASE.md) · [Phase C pilot plan](WHATSAPP_OTP_PHASE_C_PILOT_PLAN.md) · [Worker README](../../edge/whatsapp-otp-worker/README.md) · [work log](../operations/AGENT_WORK_LOG.md)
