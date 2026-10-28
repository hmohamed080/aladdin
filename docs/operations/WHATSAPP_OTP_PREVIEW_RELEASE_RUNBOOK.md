# WhatsApp OTP — Acceptance Preview Deployment Runbook (NOT EXECUTED)
**Status:** prepared on PR #114, 2026-10-28. **NO release approval** for delivery or Production. No new Worker deployed as of this document.

> Do not treat this runbook as an instruction to enable SMS/WhatsApp Auth. The current Phone + Password installer/showroom identities are synthetic email-alias accounts; enabling Supabase Phone Auth without a migration/linking design can create duplicate users.

## Scope and invariants
- Deploy only `aladdin-whatsapp-otp-preview` (`workers.dev`), never existing backend/frontend Workers or the `aladdindecore.com` zone.
- `WHATSAPP_DELIVERY_ENABLED=false` at all times in this release. No real message sending.
- `SUPABASE_SEND_SMS_HOOK_SECRET` is a separate Standard Webhooks secret, NEVER the Meta access token. **Operator created it and Cloudflare Secrets Store shows active; the value is retained only in the owner's password manager.** Both are bound by `secrets_store_secrets`, loaded with async `get()`. No secret value in GitHub, chat or command history.
- `OTP_ALLOWED_RECIPIENTS` is intentionally unset during this zero-delivery release.
- D1 database `aladdin-whatsapp-otp-acceptance` and table `whatsapp_hook_events` already exist.
- Meta token remains in the account-level Cloudflare Secrets Store (`WHATSAPP_ACCESS_TOKEN`, scope Workers); `await env.WHATSAPP_ACCESS_TOKEN.get()` resolves only on a valid signed request while delivery enabled.
- Obtain **explicit owner approval** for any first Preview deployment, and a second approval before accepting any signed real OTP traffic. Do not call Supabase Hook creation until after identity review.

## Identity gate (documented, not implemented)
- The [account identity compatibility investigation](WHATSAPP_OTP_IDENTITY_PILOT.md) confirms current installer/showroom Phone + Password goes through synthetic email aliases; the read-only Acceptance inventory has 0 such user fixtures.
- The **proposed** first pilot uses signed-in `auth.updateUser({phone})` followed by `verifyOtp({type:"phone_change"})`, preserving user ID. It is NOT approved or implemented, and enabling the hosted Phone Auth provider could affect other flows.
- Keep Supabase Phone Auth/Send SMS Hook disabled until a local seeded alias fixture and adversarial identity test prove no duplicate user or privilege crossover. A delivery-disabled Worker Preview deployment can be considered separately after explicit authorization, but it does not imply identity approval.
- Replay retention helper for hashes older than seven days is now implemented and tested locally, capped at 250 rows per call, **but not scheduled or authorized against hosted D1**.

## Preflight (safe; no remote writes)
Working directory is repository `edge/whatsapp-otp-worker`; Node.js >=22 and Cloudflare Wrangler v4.
1. Verify checkout at feature PR SHA; inspect `git diff`, avoid local environment file leaks.
2. `node scripts/check-preview-config.mjs` must print **PASS**. Any failed invariant blocks deploy.
3. `npm run typecheck` and `npm test` must pass. CI verifies the same.
4. `npx wrangler deploy --dry-run` must pass; build only, does not upload.
5. Confirm GitHub branch CI and RLS passing on the **final** commit.
6. Verify Cloudflare account and D1 UUID `da65d5e4-8344-4078-9c2d-8a4bb4907f79`; verify no `aladdin-whatsapp-otp-preview` Worker currently exists (avoid unexpected replacement).
7. Verify the Meta sender ID in Meta API Setup independently; a matching configuration string in the repository is not enough.

## Secret preparation (Cloudflare completed; Supabase NOT DONE)
- Owner has generated a dedicated 32-byte high-entropy `v1,whsec_<base64>` signing secret and saved it in a password manager. Same value has been entered in the account Secrets Store, scoped Workers; **not** yet entered in Supabase.
- If Supabase Dashboard generates a secret during hook creation, coordinate initial disabled Preview Worker deployment separately; do not invent a value or reuse the Meta token. Record only that both sides match, never the value.
- **Current source now declares both credentials as account-level `secrets_store_secrets` bindings**; it no longer declares a per-Worker `secrets.required`. Confirm this current state when reviewing. Never run `wrangler secret put` as harmless preparation: it immediately deploys a Worker version.
- **No secret upload via `--secrets-file` is required for this architecture.** Bind both existing account-level secrets in Wrangler and verify those bindings at first separately approved Preview deployment. Do not duplicate the secret as an untracked Worker-level secret.
- Avoid putting the secret in `wrangler.jsonc`, `.dev.vars` tracked by Git, any `NEXT_PUBLIC_*` variable, GitHub PR comments, terminal command lines or shell history. The signed hook remains disabled at Supabase.
- Do not configure test recipient numbers until a separate explicitly approved end-to-end test; then keep them only in protected Worker secret storage.

## First controlled Preview deployment (NOT DONE)
1. After owner approval, use isolated Cloudflare account credentials limited to deploying this Worker. Ensure production Cloudflare variables/domains are not targeted.
2. Repeat the preflight guard, then upload the tested bundle and required signing secret in the same reviewed transaction (or prepare a non-deployed version and deploy separately), always with delivery disabled.
3. Confirm the deployment actually has exactly the planned bindings: `IDEMPOTENCY_DB` (Acceptance D1) and `WHATSAPP_ACCESS_TOKEN` (Secrets Store). Never echo secret values.
4. Capture the **actual deployed** `workers.dev` URL from Cloudflare; **do not invent one**. Record version/deployment ID and time in the implementation ledger.
5. Keep Supabase Send SMS Hook disabled and avoid real-auth traffic until identity compatibility is approved.

## Host runtime smoke tests (NOT DONE)
Only use the actual deployed Worker URL once available. All cases below must result in **zero Meta calls**:
- `GET /hooks/supabase/send-sms` → HTTP 404.
- `POST` with wrong Content-Type → 415.
- `POST` JSON without `webhook-*` headers → 401 if signing secret is present.
- `POST` with malformed Standard Webhooks signature → 401.
- `POST` with a **locally signed dummy** payload to an owned test number while `WHATSAPP_DELIVERY_ENABLED=false` → HTTP 503 (`delivery_disabled`), no D1 replay record and no WhatsApp messages.
- Signed request timestamp outside 5-minute window → 401.
- Confirm D1 remains empty and `WHATSAPP_ACCESS_TOKEN` was not read for the disabled case. Runtime binding introspection must not retrieve or expose the token.
- Only after a separately approved controlled test with delivery enabled, verify a new `webhook-id` is reserved in D1 and a replay is suppressed, including concurrent requests, provider failure and cleanup. **That later test is not part of this zero-delivery deployment.**

## Go/no-go & rollback
- **Current verdict: NO-GO for any delivery, account migration, Supabase Hook, merge to main or Production.** A Preview Worker deployment with delivery disabled requires explicit approval but cannot be mistaken for Auth readiness.
- On unexpected responses, keep Hook disabled and delivery flag false. If necessary, use the Cloudflare dashboard to disable the new preview Worker or roll back to the prior preview version after reviewing traffic impact; don't delete Production Workers.
- In case of token leak, revoke/rotate via Meta and Cloudflare. Never use the Meta token for signing hooks.
- Preserve D1 replay records during incident investigation; don't aggressively erase event claims before the maximum replay horizon. Introduce and test a bounded retention job before real OTP sending.
- Use the implementation log at `docs/operations/WHATSAPP_OTP_IMPLEMENTATION_LOG.md` to record actual deployment ID, real smoke results, screenshots/links and outstanding blockers.

## Evidence
- [PR #114](https://github.com/hmohamed080/aladdin/pull/114)
- [OTP CI with Wrangler dry-run PASS](https://github.com/hmohamed080/aladdin/actions/runs/40691700519)
- [Cloudflare secrets deployment semantics](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Secrets Store Worker bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/)
- [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)

## Secrets Store signing-key checkpoint — 2026-10-28
- Operator generated and retained a dedicated `v1,whsec_…` signature secret in a password manager; **the value is not included in repo or conversation**.
- Cloudflare API confirmed both account secrets `WHATSAPP_ACCESS_TOKEN` and `SUPABASE_SEND_SMS_HOOK_SECRET` are **active** and scoped to Workers in store `acfaa67f391e499db6fde398022f50ce`. Values not fetched.
- `wrangler.jsonc` now binds **both** via `secrets_store_secrets`. `src/index.ts` reads signing key via async `get()` and returns 503 if missing/throwing. Removed the old per-Worker secret declaration; Preview guard verifies both exact account resources.
- Miniflare local HTTP cannot emulate account Secrets Store `get()` via a plaintext binding. Its bundle test now explicitly verifies refusal when that binding is unavailable; signed handler/D1 tests inject a fake `get()`. **A hosted Worker smoke test is required to prove the real Cloudflare Secrets Store runtime binding.** Do not claim end-to-end coverage from local mocks.
- The secret has **not** been entered in the Supabase Acceptance Send SMS Hook. Do not enable/create the Hook yet; the operator must use the identical saved value on the Supabase side at the separately approved activation stage. No Worker deployed, no messages sent, no Production changes.
