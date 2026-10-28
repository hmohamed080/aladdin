# WhatsApp OTP — Implementation & Verification Record
**Updated:** 2026-10-28 | **Scope:** PR #114, Acceptance-only preparation | **Owner approval:** no merge, production rollout or active OTP traffic authorized

## Continuation checkpoint — 2026-10-28 (after initial ledger)
- [x] Confirmed that the *initial ledger update* CI runs **OTP #8, General CI #301, RLS #218** all completed **successfully** before further changes.
- [x] Added `edge/whatsapp-otp-worker/scripts/check-preview-config.mjs`: blocks non-preview Worker names, missing required signing secret, wrong D1/Secrets Store resource, unexpected production routes, changed sender/template, or `WHATSAPP_DELIVERY_ENABLED != false`. Wired into dedicated OTP CI **before** Wrangler dry-run.
- [x] Updated ADR-0025 and Worker README to distinguish completed D1 provisioning/schema and dry-run tests from the **not-deployed** Worker, absent signing secret and not-enabled Supabase Hook.
- [x] Created `docs/operations/WHATSAPP_OTP_PREVIEW_RELEASE_RUNBOOK.md` with preflight, secret custody, actual Preview-only deployment preparation, explicit owner approval, zero-delivery runtime smoke checks, error/rollback protocol.
- [x] Independently reconfirmed Cloudflare: token name/status active, Acceptance D1 exists, replay table empty after smoke-test cleanup, index exists and **no OTP Preview Worker** among deployed Workers.
- [x] Added seven adversarial Preview config tests at `edge/whatsapp-otp-worker/test/preview-config.test.ts` (real config passes; toggling delivery, production Worker or route, wrong D1, missing hook secret or wrong Secrets Store fails). The guard also accepts a test-fixture file path; actual CI always checks the real config with no arguments.
- [x] **OTP CI #16 (run `40695164280`) PASS:** configuration guard, Wrangler dry-run, Worker TypeScript check and the entire expanded test suite, including seven negative config tests.
- [ ] General CI and Supabase RLS final-head status must be rechecked after the latest updates; prior green CI is *not* proof that later commits passed.
- [ ] No hosted Worker change, signing secret creation, Supabase Hook enablement, real OTP sending, Production change or Merge by this continuation.
- **Security detail confirmed from Cloudflare docs:** `wrangler secret put` can deploy immediately; for the first controlled release use a reviewed secret-safe deployment mechanism and **never** treat that command as read-only staging.
- Runbook: [Preview release and rollback](WHATSAPP_OTP_PREVIEW_RELEASE_RUNBOOK.md).

## Architecture & intent
Aladdin clients (web/future mobile) → Supabase Auth as OTP issuer/verifier and session authority → signed HTTPS **Send SMS Hook** → dedicated Cloudflare `aladdin-whatsapp-otp-preview` Worker → Meta WhatsApp Cloud API → user handset. The Worker does **not** issue, persist or validate credentials. This architecture is a *target*, not an active authentication flow.

Existing installer/showroom **Phone + Password** uses synthetic email aliases, and Supabase Phone Auth is not enabled. Email signups use a separate email OTP. **Never** call phone `signInWithOtp` for existing users until canonical identity mapping, account takeover and duplicate-account implications are resolved. See ADR-0025 and `docs/frontend/entry-auth-methods.md`.

## Chronological implementation log (completed, with evidence)
| Step | Provider | Completed action | Evidence / exact scope |
|---|---|---|---|
| 1 | Meta | Owner created **Aladdin OTP** App in Business Solution and connected WhatsApp API. | Owner dashboard walkthrough; not independently verified through Meta connector |
| 2 | Meta | Owner sent `hello_world` to a controlled device. | Owner confirmed receipt |
| 3 | Meta | Owner tested approved Arabic Authentication **Copy Code** template `aladdin_otp` with dummy `123456`; message delivered to controlled handset. | Owner confirmed receipt. **Not** an end-to-end Auth OTP |
| 4 | Meta | Owner created **Employee** System User `AladdinServer` after Meta rejected whitespace-bearing names; assigned app `Aladdin OTP` and WhatsApp account **Messages** privilege. | Owner screenshots and confirmations; independent Meta asset inspection unavailable |
| 5 | Meta | Owner issued non-expiring / long-lived System User access token scoped to `whatsapp_business_messaging`. | Owner confirmation; token **never** committed or pasted into PR |
| 6 | Cloudflare | Owner created account Secrets Store entry `WHATSAPP_ACCESS_TOKEN` with Workers scope. | Read-only Cloudflare API confirms name, **active**, Workers scope; value never queried |
| 7 | GitHub | Created feature branch `feat/whatsapp-otp-transport-20261028`, and Draft **PR #114**. | GitHub PR metadata (open, draft, unmerged) |
| 8 | GitHub | Added isolated Worker `edge/whatsapp-otp-worker/src/index.ts`, typecheck, tests, Wrangler config, and architecture ADR. | PR changes. No existing frontend/backend sign-in touched |
| 9 | GitHub | Connected account-level Secrets Store with async `env.WHATSAPP_ACCESS_TOKEN.get()`; added owner-provided sending phone ID `1415528588305492` as a *nonsecret* Wrangler variable. | `wrangler.jsonc` in PR. Sending ID not independently checked against Meta |
| 10 | Security | Worker verifies Standard Webhooks signature/timestamp using raw body, accepts bounded Egyptian E.164 phone and 6-digit OTP, uses approved Arabic template/body+copy-button parameters, rejects malformed/unsigned requests, avoids logging OTP/phone/token, disables automatic Meta retries. | Worker and tests |
| 11 | Security | Added atomic D1 replay journal by SHA-256 of webhook-id, reserve before Meta call, return success for already accepted event without resending and fail closed for pending/failed. Test recipient allowlist blocks all unknown numbers. | Worker, `migrations/0001_hook_events.sql`, test suite. No OTP/phone in D1 |
| 12 | Cloudflare | Owner created dedicated `aladdin-whatsapp-otp-acceptance` D1 `da65d5e4-8344-4078-9c2d-8a4bb4907f79`. Added `IDEMPOTENCY_DB` binding **in source only**. | Cloudflare D1 GET, GitHub Wrangler config |
| 13 | Cloudflare | Applied two DDL statements matching committed migration: `whatsapp_hook_events` table and `whatsapp_hook_events_created_at` index. | Cloudflare API query + `sqlite_master` confirmation |
| 14 | Cloudflare | Ran controlled D1 single-retry and simultaneous duplicate-insert smoke tests using fake 64-char hashes. Exactly one insert (`changes:1`), duplicate ignored (`changes:0`), one row read; test rows deleted. | Real D1 query results in project conversation; NOT a deployed Worker integration test |
| 15 | GitHub | Added `WhatsApp OTP Transport CI` including Wrangler `deploy --dry-run` bundling, isolated TypeScript check and mocked signature/failure/replay tests. | GitHub run **#7**, ID `40689531760`: **success**, including dry-run |
| 16 | GitHub | Checked general project CI and Supabase RLS on same reviewed commit. | GitHub CI run `40689531672`: **success**; RLS run `40689531897`: **success** |
| 17 | Supabase | Owner opened Acceptance Auth → Hooks → Send SMS Hook → HTTPS, inspected configuration fields and **cancelled** without enabling. | Owner confirmation; hosted configuration not modified |
| 18 | Cloudflare | Rechecked D1 and Secrets Store on 2026-10-28. | D1 exists, no replay rows after cleanup, index exists, token secret metadata active; Workers list has **no** `aladdin-whatsapp-otp-preview` |

## Resource & configuration matrix
| Component | Value | Hosted state |
|---|---|---|
| Meta template | `aladdin_otp` / Arabic / Copy Code | Manually tested by owner |
| Sender Phone Number ID | `1415528588305492` | Preview Wrangler variable; confirm actual Meta sender before live |
| Meta permanent token | `WHATSAPP_ACCESS_TOKEN` | Active **Cloudflare Secrets Store**, linked in source; never printed |
| D1 replay DB | `aladdin-whatsapp-otp-acceptance` | **Provisioned and migrated**; isolated from Supabase DB |
| `IDEMPOTENCY_DB` | D1 binding in Wrangler | **NOT bound to a deployed Worker** |
| `SUPABASE_SEND_SMS_HOOK_SECRET` | Standard Webhooks signature secret | **Not generated or installed** |
| `OTP_ALLOWED_RECIPIENTS` | Acceptance-only owned-number E.164 allowlist | Not configured; missing = deny |
| `WHATSAPP_DELIVERY_ENABLED` | `false` | In source, no deployed Worker |
| Cloudflare Worker | `aladdin-whatsapp-otp-preview` | **NOT deployed**; live Workers list does not contain it |
| Supabase project | `aladdin-r2-acceptance-20261011` (`nxossqhdfltcqdwvbewi`) | ACTIVE_HEALTHY; Send SMS Hook not enabled by this work |
| Production | Live Aladdin production resources | **Untouched by WhatsApp OTP work** |

## Test matrix / interpretation
- **PASS, local mock:** invalid signatures, timestamp expiry, malformed phone/OTP, disabled delivery, secret not read if disabled, missing token, valid Arabic Meta template shape, safe provider error handling, duplicate event response, parallel duplicate calls via mocked D1, failed provider no retry, lack of D1/allowlist.
- **PASS, GitHub:** Wrangler compile-only dry-run, Worker typecheck, Worker mock test suite, general CI and RLS.
- **PASS, hosted D1 only:** real D1 `INSERT OR IGNORE` prevents sequential and simultaneous double-insert; smoke-test rows cleaned.
- **NOT TESTED:** real signed HTTP Worker invocation against hosted D1; Secrets Store runtime binding; provider acceptance/delivery via Worker; Supabase phone Auth actual flow; complete registration or recovery and identity preservation; webhook failure and replay cleanup at scale.
- **Not a claim:** a Meta API message ID indicates *acceptance*, not handset delivery; successful unit tests are not proof of authentication safety or production readiness.

## Security decisions & known limitations
1. **Fail closed:** missing signing secret, untrusted hook, invalid body, missing D1, unavailable test allowlist, or delivery-disabled all reject. Default delivery flag `false`.
2. **Durable idempotency:** SQL unique event hash reservation before provider call means no duplicate billable send for the same webhook-id. Different legitimate hook IDs are independently processed and require upstream phone/IP/cooldown throttling.
3. **Ambiguous provider errors:** don't retry automatically, so a network timeout may leave user without code; future UX must offer controlled fresh OTP.
4. **No personal data in replay storage:** hashes of opaque webhook event IDs and state only. **Retention purge is not implemented**; choose deletion period longer than provider retry horizon and implement audited cleanup.
5. **Threats not yet closed:** replay with different event IDs, compromised upstream, OTP brute force, account enumeration, phone recycling/takeover, orphan alias users, phone/Google linking issues, template expiry mismatch, and provider outage.
6. **Operational security:** Meta access token must remain in Secrets Store; Supabase signing secret must be a separate Worker Secret, never public/GitHub. Restrict test delivery to owned allowlisted numbers.

## Activation gates / exact next steps
- [x] Meta template and manual delivery proved.
- [x] Permanent Meta token generated by owner; secret metadata confirmed active.
- [x] D1 creation, schema migration and database-only replay smoke tests.
- [x] Wrangler dry-run and GitHub tests passed for reviewed commit.
- [ ] Verify full CI against final documentation-only updates and test full runtime Worker+D1 on a nonpublic or controlled Preview deployment.
- [ ] Produce Supabase hook signing secret safely and configure it on both sides; no values in logs/chat.
- [ ] Provision test-recipient allowlist via protected Worker secret/config.
- [ ] Deploy isolated Preview Worker with delivery **OFF**; test unsigned/malformed requests and real D1 state. Get **explicit owner approval before hosted deployment**.
- [ ] Design and adversarially test canonical phone account mapping for existing installer/showroom email-alias users, signup and account recovery.
- [ ] Set and verify Supabase Phone Auth anti-abuse controls, CAPTCHA, OTP TTL, user/IP rate limits, resend attempts and Meta failure UX.
- [ ] Activate Send SMS Hook in **Acceptance only** following approval; run owned-number E2E delivery + verifyOtp, preserve canonical user ID, check delivery webhook status where available.
- [ ] Separate security sign-off and explicit **Production GO** required for merge/config changes. No silent activation.

## Rollback and controls
- Revert Preview Hook to disabled first; set delivery flag `false`; revoke/rotate token if compromise is suspected.
- Do not delete D1 replay records during an incident until impact reviewed (helps avoid duplicates).
- Existing password and email Auth flows remain untouched until migration/compatibility is explicitly approved.
- Keep production secrets and the active frontend/backend Workers isolated.

## Evidence links
- [Draft PR #114](https://github.com/hmohamed080/aladdin/pull/114)
- [OTP CI run #16 — current guarded dry-run + expanded suite](https://github.com/hmohamed080/aladdin/actions/runs/40695164280)
- [OTP CI run #7 — earlier green dry-run](https://github.com/hmohamed080/aladdin/actions/runs/40689531760)
- [General CI run](https://github.com/hmohamed080/aladdin/actions/runs/40689531672)
- [RLS CI run](https://github.com/hmohamed080/aladdin/actions/runs/40689531897)
- [Supabase Send SMS Hook docs](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [Cloudflare Secrets Store binding docs](https://developers.cloudflare.com/secrets-store/integrations/workers/)
- [Cloudflare D1 docs](https://developers.cloudflare.com/d1/get-started/)
