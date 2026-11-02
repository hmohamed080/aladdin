# WhatsApp OTP: exact Acceptance activation steps

**Status:** **Phase A is CLOSED** (2026-11-01). The Worker is deployed with delivery OFF and has passed the signed preflight. **Phase B is prepared but not approved and not executed.** Phase C (one real message) is a separate approval. Evidence and the full approval package: [Phase A closure and Phase B plan](WHATSAPP_OTP_PHASE_A_CLOSURE_AND_PHASE_B_PLAN.md).

**Hard rules for every step:** `WHATSAPP_DELIVERY_ENABLED` stays `"false"` until Phase C. Do not recreate the template, create another access token, or change the sender. No real message leaves until Phase C is approved **separately**. Never paste a secret into chat: each secret is typed or piped in your own shell. Do not use `supabase db push --include-all` or repair migration history on Acceptance.

**Already confirmed by you (Meta UI):** sender Connected / Live / Verified / High quality; display name "Aladdin" approved; template `aladdin_otp` Active, Authentication, Arabic, Copy Code button, 5-minute expiry. **Checked in code:** the Worker's send payload equals Meta's Copy Code authentication contract (body parameter + button `sub_type:"url"`, `index:"0"`, same code; golden test), the template expiry (5 min) equals the authority's code lifetime (`challenge_ttl` 5 min, transport `ttlSeconds` 300), and the preflight resolves the **real WABA** (it asks Graph for each id's node type and requires the WABA to own the sender) instead of trusting a supplied id, which is what caused error #100.

## Phase 0: confirm with the read-only preflight (you run it; no change anywhere)

Graph v25.0 no longer supports `?metadata=1` node introspection, so the script does not use it. It proves the sender and account with supported fields only: the sender's own fields plus an **exact echo of its Phone Number ID** (and equality with `wrangler.jsonc`); the account by a successful `aladdin_otp` template lookup; and the **account-to-sender association** by the account listing the sender under `/phone_numbers` (paged). That association is not weakened: if Meta's 2026 account model does not list the number there, the script says not ready and prints the sanitized Graph error code/message (no token, number or full id) instead of guessing. The token is sent only in the `Authorization` header, never in a URL; `debug_token` is not called by default.

```
WHATSAPP_ACCESS_TOKEN=<from your secret store> \nWHATSAPP_PHONE_NUMBER_ID=<Phone Number ID shown in Meta: WhatsApp Manager > Phone numbers > Aladdin sender> \nWHATSAPP_BUSINESS_ACCOUNT_ID=<WABA / Messaging Account ID that holds aladdin_otp> \n  node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs
```

Add `WHATSAPP_ACCOUNT_ID=<WhatsApp Account ID>` only if the account holding the number has a different id than the one holding the template (the same single id must still do both: serve the template and list the sender). Expected: `sender.ok`, `sender_id.matches_repo_config: true`, `sender_id.echoed_id_matches: true`, `waba.resolved: true`, `template.ok: true`, `ready_for_pilot: true`. The report includes `template.button_diagnostic` (button type, OTP subtype, and for a URL button only booleans about Meta's authentication OTP URL pattern, never the URL). A retrieved approved template may show the Copy Code button as `type: URL` to `whatsapp.com/otp/code` with `otp_type=COPY_CODE`; that form is accepted, any other URL button, ONE_TAP or ZERO_TAP is not. Optional `META_PREFLIGHT_RESOLVE_FROM_TOKEN=1` finds candidate ids from the token's grants (POST body, never a URL).

## Phase A: configure the Acceptance Worker with delivery OFF — CLOSED

Completed on 2026-11-01. The exact evidence is in the [Phase A closure](WHATSAPP_OTP_PHASE_A_CLOSURE_AND_PHASE_B_PLAN.md#phase-a--closed); in summary:

- Active Worker version `6eb9364d-aa89-4e30-9005-a516ac0cd29f` (100%), code version `3e02b69b-865f-4eb1-854a-d22f7359a8dd`, both secret changes after it.
- URL `https://aladdin-whatsapp-otp-preview.bstalent9.workers.dev`; `workers.dev` is the only trigger and the `aladdindecore.com` zone has zero Worker routes.
- Bindings: `IDEMPOTENCY_DB` → Acceptance D1 `da65d5e4-8344-4078-9c2d-8a4bb4907f79`; `OTP_SIGNING_SECRET` and `WHATSAPP_ACCESS_TOKEN` → Secrets Store `acfaa67f391e499db6fde398022f50ce`; `OTP_ALLOWED_RECIPIENTS` is a Worker secret.
- Vars: `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=allowlist`, `WHATSAPP_DELIVERY_ENABLED=false`, `WHATSAPP_GRAPH_API_VERSION=v25.0`, `WHATSAPP_OTP_LANGUAGES=ar`, `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_PHONE_NUMBER_ID=1415528588305492`.
- Signed preflight: `ok:true`, `signing_secret_bound:true`, `meta_token_bound:true`, `d1_reachable:true`, `allowlist_has_entries:true`, `recipient_mode_is_allowlist:true`, `delivery_enabled:false`, `environment:"acceptance"`, `allowlist_entries:1`.

**Rollback:** previous deployment `6dffc68b-a514-44c1-93b2-96e87c3eddea`; code version `3e02b69b-865f-4eb1-854a-d22f7359a8dd`. Use the Cloudflare dashboard rollback or `npx wrangler rollback --yes`, then re-run the signed preflight and confirm `delivery_enabled:false`. If you roll back to `3e02b69b`, re-apply the signing secret and the allowlist first.

## Phase B: connect the Acceptance app and database, still no message (separate approval)

The full sequence, exact values, smoke tests and rollback are in the [Phase B plan](WHATSAPP_OTP_PHASE_A_CLOSURE_AND_PHASE_B_PLAN.md#phase-b--sequence). The short version:

1. **Dry-run the push:** `npx supabase db push --linked --dry-run` must list exactly `20261030090001` and `20261030090002`. Abort on anything else; no `--include-all`.
2. **Apply:** `npx supabase db push --linked`. Verify 199 migrations, latest `20261030090002`, and `select enabled, signup_enabled, alias_guard_mode from app.phone_verification_config` = `false | false | off`.
3. **Deploy the integrated preview build** with the manual `Cloudflare frontend preview` workflow (`CLOUDFLARE_PREVIEW_ENABLED=true`). The previous version for rollback is `da4eb8c9-f4f2-4434-9184-d92d9b18a90f`.
4. **Set the app secrets** on `aladdin-frontend-preview` with the feature still off: `PHONE_OTP_WORKER_URL`, `PHONE_OTP_WORKER_SECRET` (same `whsec_` value as the Worker), `PHONE_OTP_HMAC_KEYS`, `PHONE_SIGNUP_COOKIE_SECRET`, `PHONE_OTP_DELIVERY=worker`, `PHONE_VERIFICATION_ENABLED=false`, `PHONE_SIGNUP_VERIFICATION_ENABLED=false`. Use `npx wrangler secret put <NAME> --env preview` from `frontend/`; never put a value on the command line.
5. **Verify it is still OFF:** phone sign-up says unavailable and creates no challenge; email, Google, Facebook and existing phone-alias password sign-in are unchanged; the Worker preflight still says `delivery_enabled:false`.
6. **Enable only the dry-run state:** `update app.phone_verification_config set alias_guard_mode='observe';` then `set enabled=true, signup_enabled=true;`, then set the two app flags `true`.
7. **One dry run:** sign up with the allow-listed number. Expected: the code screen appears; the Worker answers `503 delivery_disabled`; `select invalidated_why from app.phone_verification_challenges order by created_at desc limit 1` = `delivery_failed`; no Meta call, no message, no new Auth user, D1 journal unchanged.
8. **Return to off:** `update app.phone_verification_config set enabled=false, signup_enabled=false, alias_guard_mode='off';` and set both app flags `false`, `PHONE_OTP_DELIVERY=off`. Keep the migrations; do not drop the tables.

**Rollback for Phase B:** the three switches off, both app flags false, `PHONE_OTP_DELIVERY=off`, and roll the frontend Worker back to `da4eb8c9` if the build is at fault. `WHATSAPP_DELIVERY_ENABLED` must remain `false` throughout. There is no SQL down migration; the tables are additive and stay dormant.

## Phase C: the single controlled real message (a SEPARATE approval, in your words)

1. Only now: `npx wrangler deploy --var WHATSAPP_DELIVERY_ENABLED:true` (or the dashboard variable). The repository value stays `"false"`.
2. Sign up once with your allow-listed number. **Success = the code arrives on your handset (Copy Code button, Arabic) and entering it creates the account with `phone_verified_at` set** (`select phone_verified_at is not null from public.profiles where ...`), and the D1 journal shows one `accepted` claim. Meta "accepted" alone is not success.
3. **Immediately set delivery back OFF** (redeploy without the `--var`, or dashboard) unless you approve leaving the pilot open for more tests. One message = one Meta conversation charge; do not retry-spam.
4. **Rollback for Phase C:** `WHATSAPP_DELIVERY_ENABLED` back to `"false"` (instant, on the Worker only).

## The approval request I will ask for, in this order

1. ~~"Approve Phase A (configure the Acceptance Worker with delivery OFF)."~~ **Done 2026-11-01.**
2. "Approve Phase B (connect the Acceptance app and database; no message)." This includes the read-only migration-history result, which is clean: 197 applied, only `20261030090001` and `20261030090002` missing, no out-of-order history, plain forward push possible.
3. "Approve Phase C: exactly one real WhatsApp message to <your authorised test number>."
