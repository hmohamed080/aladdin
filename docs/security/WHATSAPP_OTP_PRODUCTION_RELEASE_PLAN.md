# WhatsApp OTP + unified registration: Production release plan

**Status:** plan for review. Nothing in it is approved or executed. No merge, deploy, migration, secret, delivery or message. It builds on [the R2 release plan](PHONE_SIGNUP_R2_RELEASE_PLAN.md) (phases and expand/contract), [the pilot and release doc](WHATSAPP_OTP_R2_PILOT_AND_RELEASE.md) and [the B1 reconciliation report](B1_REGISTRATION_RECONCILIATION_REPORT.md) and does not repeat them.

## Purpose
Take the verified Acceptance result (real OTP delivered, code verified, single-use grant consumed, account created, `phone_verified_at` set) to Production as a **production implementation, not a pilot configuration**, without a gap in existing phone registration and without touching any existing account.

## Current decision (owner, 2026-11-02)
| # | Decision |
|---|---|
| 1 | Production supports registration for **all eligible Egyptian mobile numbers**: `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`. The Worker already accepts only `+20` 010/011/012/015 numbers and refuses everything else |
| 2 | **No** `OTP_ALLOWED_RECIPIENTS` in Production |
| 3 | Production delivery stays **OFF** (`WHATSAPP_DELIVERY_ENABLED=false`) until the approved cutover, which enables delivery together with the new registration flow |
| 4 | **No** `SUPABASE_SEND_SMS_HOOK_SECRET` is created or bound (Supabase Phone Auth and the Send SMS hook stay OFF; R2 uses the signed Worker transport) |
| 5 | The global send budget is **initialized, validated, observable and tested before activation**, and is **Admin-configurable** ([Admin settings plan](WHATSAPP_OTP_ADMIN_SETTINGS_PLAN.md)) |
| 6 | Production has its **own** D1, Meta token, signing secrets and Worker; nothing from Acceptance is reused |
| 7 | The R2 authority remains the only source of truth for OTP verification and single-use grants |

## Production Worker and app configuration
| Item | Production value | Note |
|---|---|---|
| Worker | `aladdin-whatsapp-otp-production`, workers.dev only, no zone routes | separate deployment, never a rename of the preview Worker |
| D1 | new `aladdin-whatsapp-otp-production`, migrations `0001` and the settings migration | never the Acceptance database `da65d5e4-...` |
| Vars | `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`, `WHATSAPP_PHONE_NUMBER_ID=1458603463983505`, `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_OTP_LANGUAGES=ar`, Graph `v25.0` | delivery is flipped ON only inside the cutover window |
| Meta token | a **dedicated** Secrets Store secret (not `WHATSAPP_ACCESS_TOKEN`), from a System User that has the sender's WhatsApp Account assigned with full control, generated **after** that assignment, `whatsapp_business_messaging` and `whatsapp_business_management`, no expiry | the root cause of every Acceptance failure was a token without the granular send permission, so verify with the owner-run direct send before storing it |
| Signing secret | a **dedicated** Secrets Store secret; the Production app holds the same value as `PHONE_OTP_WORKER_SECRET` | never the Acceptance value |
| Admin and notify secrets | two more dedicated Secrets Store secrets (`OTP_ADMIN_SIGNING_SECRET`, `OTP_NOTIFY_SIGNING_SECRET`, Production names); the Production app holds the same values as `PHONE_OTP_ADMIN_SECRET` and `PHONE_OTP_NOTIFY_SECRET` | four distinct secrets in all (Meta token, send, admin, notify); none shared with Acceptance; neither exists yet |
| App flags | `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY=worker` | `PHONE_*` secrets are set on the Production frontend only when it is ready; the live build ignores them |
| App secrets | `PHONE_OTP_WORKER_URL` (the Production Worker), `PHONE_OTP_WORKER_SECRET`, `PHONE_OTP_HMAC_KEYS` (at most 3 keys), `PHONE_SIGNUP_COOKIE_SECRET` (32+ characters) | names verified, values never printed |
| Database | `app.phone_verification_config`: `enabled`, `signup_enabled`, `alias_guard_mode` per phase; limits at the reviewed defaults | the per-phone, per-IP, cooldown and attempt limits are unchanged |
| Retention | the Worker's scheduled run purges journal rows older than 7 days (replaces "no cron is installed") | part of the Admin plan's cron |

A configuration guard for Production (`check-production-config.mjs`, with tests and a CI step) will assert every row above, including that **no allowlist var, no Send-SMS-hook binding and no Acceptance identifier** exist. It is part of blocker B3.

**Shared sender caveat.** There is one Meta sender number. Its quality rating and messaging tier are per number, so Acceptance sends also count against the same Meta limits. Acceptance delivery stays OFF by default and allowlisted; Meta-side volume is the sum of both.

## The send budget as a release gate
- **Authority:** the limit lives in the **Production Worker's D1** (`otp_settings`) next to the atomic claim, so enforcement costs no external request and cannot be stale. The interim environment variable is removed by the Admin settings PR (implemented, see [Admin settings plan](WHATSAPP_OTP_ADMIN_SETTINGS_PLAN.md)); the Super Admin changes the limit, the Hard Ceiling and the alert thresholds from `/admin/whatsapp-otp`, with no redeploy.
- **Fail closed:** no settings row, an invalid row, or an unreadable database means `503 budget_unconfigured` before the token is read. **Delivery and the budget are independent switches**: turning delivery OFF never needs the budget, and raising the budget never turns delivery on.
- **Initialization:** the budget is **never** seeded by code. The first value (150 / ceiling 5,000 / 70 % / 90 %, after your approval) is written by a Super Admin from the dashboard (this needs `whatsapp_otp.ceiling_manage`, the typed ceiling confirmation and a reason of 20 or more characters) and recorded in the Worker's audit table and in Supabase. Until then the Worker answers `503 budget_unconfigured`.
- **Gate before activation (all must pass):** signed preflight shows `daily_send_limit` equal to the approved value and `delivery_enabled=false`; the fail-closed tests pass in CI; the dashboard shows usage 0; a synthetic over-limit test passes on Acceptance.

### Proposed initial Production value (for your approval)
**150 sends per rolling 24 h, warning at 70 % (105), critical at 90 % (135).**
- Production shows about 71 phone-alias sign-ups in the last 7 days (about 10 a day). At about 1.5 codes per sign-up that is about 15 a day, so 150 gives about **10x headroom** for a launch spike.
- Meta limits business-initiated conversations to about **250 unique recipients per 24 h** until the business is verified (confirm in Business Settings, Security Center). 150 keeps **your budget the binding constraint**, not Meta's, with room for Acceptance sharing the number.
- Worst-case daily spend = limit x Meta's current Egypt authentication rate (read it from Meta's rate card; I did not assume a figure). Failed attempts are counted, so the figure is conservative.
- Review after 7 days of real data (p95 daily use and the failure ratio) and after business verification; raise in steps through the dashboard, each change audited. With `open` mode the budget is also the abuse cost cap, so exhaustion can block honest users: alerts at 70 / 90 % exist precisely to act before that.

## Release sequence (all owner-approved, one step at a time)
1. **Prerequisites:** B1 merged into #127; mandatory CI green on the final combined commit; the Admin settings PR merged into the integration and re-run through CI; the Production Worker configuration guard and an upload-only frontend stage exist (B3, B6).
2. **Infrastructure, no user impact:** create the Production D1; deploy the Production Worker with delivery OFF; set the dedicated secrets; initialize the budget; signed preflight PASS; owner-run Meta preflight and direct-send check with the new Production token.
3. **Production app secrets:** set `PHONE_*` secret names (the live build ignores them).
4. **Database:** a fresh read-only history check, then a plain `db push` of the outstanding set (the six from the B1 report plus the Admin settings migration), then `enabled=true, signup_enabled=true, alias_guard_mode='observe'`. The live build ignores the switches.
5. **Upload the new frontend as a non-active version** (no traffic). Production has `workers_dev=false`; the owner reaches it with Cloudflare's version-override header, which must be verified on a test Worker first.
6. **Cutover window opens:** Worker delivery ON (the live build does not call the Worker, so nothing reaches it yet). **Owner verification through the override:** one real OTP, enter the code, account created, budget counter 1, then a kill-switch drill (delivery OFF then ON).
7. **Activate the new version** in stages (for example 10 %, then 100 %). Both builds serve phone registration during the stages, so there is no gap. Watch the dashboard (usage, failure ratio), Auth 5xx and `had_grant=false` (must be 0).
8. **Record `production_activated_on`** in [RELEASE_FOLLOWUPS.md](../operations/RELEASE_FOLLOWUPS.md) in the same change. This starts the 14-day clock for RF-001.
9. **`alias_guard_mode='enforce'`** only when no grant-less build can serve traffic (the previous version is no longer a rollback target, or the rollback plan is rewritten without it).
10. **Mandatory follow-ups:** RF-001 (drop the legacy table, [issue #135](https://github.com/hmohamed080/aladdin/issues/135)) and the recommended items below.

## Rollback
| Situation | Action | Status |
|---|---|---|
| Delivery misbehaves | Worker `WHATSAPP_DELIVERY_ENABLED=false` (version flip, about 14 s, dead-man timer) | **tested** on Acceptance |
| Budget misconfigured or exhausted | fix in the dashboard (audited); delivery switch untouched | designed, tested in the Admin PR |
| App problem | app `PHONE_OTP_DELIVERY=off`; DB `signup_enabled=false` | tested |
| New build must go | reactivate the previous Production version (`39bdf3a2`, 2026-10-28) | **not yet rehearsed** (blocker B5: Acceptance build-swap drill) |
| After `enforce` | set `alias_guard_mode='observe'` first, then redeploy | documented in the R2 plan |
| Migrations | not rolled back: all additive; the legacy table is removed later by RF-001 | by design |

## Mandatory launch blockers (open)
B2 mandatory CI on the final combined commit; **the Admin settings PR** (implemented and stacked on #127, awaiting CI and your review; applying its Supabase migration `20261103090001` to each hosted environment is a separate approval); B3 the Production Worker, D1, secrets and config guard; B4 the Production app secrets; B5 the Acceptance rehearsals (enforce mode with rollback to `observe`, the build-swap drill, hosted email / Google / Facebook / legacy-account login on the new build); B6 the upload-only deploy stage; B7 approvals and a planned window. Decision still needed: confirm the initial budget (above) and the alert channel.

## Recommended after launch (not blockers)
Meta delivery webhooks (needs the app published), display-name activation, a service binding between the app and the Worker, a second alert channel, a Meta-side spend alert, leaked-password protection, the redirect allow-list cleanup, deleting the Acceptance test account.

## What is deferred
Everything executable. This plan changes no hosted state.

## Consequences
The Production launch is gated by a configurable, audited, fail-closed budget and a tracked cleanup of the legacy table, and it preserves every existing account, sign-in method and rollback path.

## Related files
[R2 release plan](PHONE_SIGNUP_R2_RELEASE_PLAN.md) · [Admin settings plan](WHATSAPP_OTP_ADMIN_SETTINGS_PLAN.md) · [B1 report](B1_REGISTRATION_RECONCILIATION_REPORT.md) · [Release follow-ups](../operations/RELEASE_FOLLOWUPS.md) · [Worker README](../../edge/whatsapp-otp-worker/README.md)

## Admin-controlled limits: what remains before Production (added with the Admin settings PR)
1. Apply Supabase migration `20261103090001` to Acceptance, then Production (separate approvals; additive; permission contract `20261103090001.json`).
2. Production D1 `aladdin-whatsapp-otp-production` has no `d1_migrations` table (created by hand, empty). Run `node scripts/d1-baseline-check.mjs` (read-only; reports `untracked_partial`), then `wrangler d1 migrations apply --remote`: `0001` is `IF NOT EXISTS`, so it is safe, and `0002` is additive.
3. Create the Production Secrets Store secrets for the admin and notify signing keys and set the matching `PHONE_OTP_ADMIN_SECRET` / `PHONE_OTP_NOTIFY_SECRET` on the Production app; set `OTP_NOTIFY_URL` to the Production app's `/api/internal/whatsapp-otp/notify`.
4. Write `wrangler.production.jsonc` plus `check-production-config.mjs` once the Production D1 id, the app URL and the secret names are final (needs your decisions; the Acceptance guard is the template).
5. Verify the real Meta messaging limit of the WhatsApp Business Portfolio in Business Settings. The dashboard limits never override it.
6. Acceptance rehearsal: initialize, change, lower the ceiling (refusal), exhaust the budget, observe the alert in the notification panel, kill-switch independence. No real message is needed for most of it.
