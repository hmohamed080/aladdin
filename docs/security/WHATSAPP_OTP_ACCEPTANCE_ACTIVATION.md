# WhatsApp OTP: exact Acceptance activation steps (for approval; nothing here has been run)

**Hard rules for every step:** `WHATSAPP_DELIVERY_ENABLED` stays `"false"` until Phase C. Do not recreate the template, create another access token, or change the sender. No real message leaves until Phase C is approved **separately**. Never paste a secret into chat: each secret is typed or piped in your own shell.

**Already confirmed by you (Meta UI):** sender Connected / Live / Verified / High quality; display name "Aladdin" approved; template `aladdin_otp` Active, Authentication, Arabic, Copy Code button, 5-minute expiry. **Checked in code:** the Worker's send payload equals Meta's Copy Code authentication contract (body parameter + button `sub_type:"url"`, `index:"0"`, same code; golden test), the template expiry (5 min) equals the authority's code lifetime (`challenge_ttl` 5 min, transport `ttlSeconds` 300), and the preflight now resolves the **real WABA** (it asks Graph for each id's node type and requires the WABA to own the sender) instead of trusting a supplied id, which is what caused error #100.

## Phase 0: confirm with the read-only preflight (you run it; no change anywhere)
```
WHATSAPP_ACCESS_TOKEN=<from your secret store> WHATSAPP_PHONE_NUMBER_ID=<sender phone-number id> \
  node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs
```
`WHATSAPP_BUSINESS_ACCOUNT_ID` is now optional (a wrong value no longer breaks it). Expected: `sender.ok`, `waba.resolved` (with `source`), `template.ok` including `button_is_copy_code` and `expiry_matches_authority`, `ready_for_pilot: true`. Send me that JSON (it holds booleans and 4-digit suffixes only). If `waba.resolved` is false, its `hint` says what the token lacks (`whatsapp_business_management` on the WABA that owns the sender).

## Phase A: configure the Acceptance Worker with delivery OFF (needs your approval)
Resources: Worker `aladdin-whatsapp-otp-preview`, D1 `aladdin-whatsapp-otp-acceptance`, Secrets Store `acfaa67f391e499db6fde398022f50ce` (all created for #114 and referenced in `edge/whatsapp-otp-worker/wrangler.jsonc`; the Meta token secret `WHATSAPP_ACCESS_TOKEN` already exists there and is **not touched**). Run from `edge/whatsapp-otp-worker`:
1. **Guard:** `node scripts/check-preview-config.mjs` (must print PASS: delivery false, allowlist mode, acceptance environment, no phone numbers in the repo, no SMS-hook secret).
2. **New signing secret** (a fresh value, generated and stored only in your secret manager; the app gets the same value in step 7):
   `node -e "console.log('whsec_'+require('crypto').randomBytes(32).toString('base64'))"` then
   `npx wrangler secrets-store secret create acfaa67f391e499db6fde398022f50ce --name PHONE_OTP_WORKER_SECRET --scopes workers --remote` (it prompts for the value).
3. **D1 schema:** `npx wrangler d1 migrations list aladdin-whatsapp-otp-acceptance --remote`; only if `0001_hook_events.sql` is not applied: `npx wrangler d1 migrations apply aladdin-whatsapp-otp-acceptance --remote` (it is `CREATE TABLE IF NOT EXISTS`; it stores only hashes and a state, no number, no code).
4. **Deploy with delivery OFF:** `npx wrangler deploy` (config: `WHATSAPP_DELIVERY_ENABLED:"false"`, `OTP_ENVIRONMENT:"acceptance"`, `OTP_RECIPIENT_MODE:"allowlist"`, template `aladdin_otp`, languages `ar`). The deploy replaces the #114 preview Worker's bindings: the Supabase hook secret binding and the `/hooks/supabase/send-sms` route are gone.
5. **Recipient allowlist** (your authorised test number, E.164, e.g. `+201...`) stored as a **Worker secret**, not a repository value and not a plain dashboard variable: `npx wrangler secret put OTP_ALLOWED_RECIPIENTS` (type the number; one number, or comma-separated).
6. **Prove it, still OFF:** `PHONE_OTP_WORKER_SECRET=<same value> node scripts/worker-preflight.mjs https://aladdin-whatsapp-otp-preview.<your-subdomain>.workers.dev` must show `ok:true`, `meta_token_bound:true`, `d1_reachable:true`, `allowlist_entries:1`, `recipient_mode_is_allowlist:true`, **`delivery_enabled:false`**, `environment:"acceptance"`. It reports presence only; it never reveals a value and never calls Meta.
**Rollback for Phase A:** redeploy the previous Worker version (`npx wrangler rollback`) or delete the new secret; nothing else depends on it yet.

## Phase B: connect the Acceptance app and database, still no message (separate approval)
7. **App env** (Acceptance frontend Worker secrets, set in your shell): `PHONE_OTP_WORKER_URL=https://<worker>.workers.dev/v1/otp/send`, `PHONE_OTP_WORKER_SECRET=<the step-2 value>`, `PHONE_OTP_DELIVERY=worker`, `PHONE_OTP_HMAC_KEYS` (new keyring), `PHONE_SIGNUP_COOKIE_SECRET` (new). Leave `PHONE_VERIFICATION_ENABLED` / `PHONE_SIGNUP_VERIFICATION_ENABLED` **false** for now.
8. **Exact migration history first (read-only):** `docs/security/ACCEPTANCE_MIGRATION_HISTORY_INSPECTION.md`. Proceed only if `plain_push_possible` is `true` or the owner approves a reviewed plan for `out_of_order_missing`. No repair, no `--include-all` shortcut.
9. **Dormant migrations** `20261030090001`, `20261030090002` to Acceptance (switches ship OFF: `enabled=false`, `signup_enabled=false`, `alias_guard_mode='off'`). Check: `select enabled, signup_enabled, alias_guard_mode from app.phone_verification_config` = `f,f,off`; the permission gate passes.
10. **Deploy the R2 + Worker-integrated build to the Acceptance preview** (the existing manual `Cloudflare frontend preview` workflow, run from the final reviewed branch). This is the step that puts the new registration routes on Acceptance.
11. **Switch on, in this order:** `update app.phone_verification_config set alias_guard_mode='observe';` then `set enabled=true, signup_enabled=true;` then set the two app flags `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true` and redeploy the preview.
12. **Dry run through the whole stack with delivery still OFF:** sign up with the allow-listed number. Expected: the code screen appears; the Worker answers `503 delivery_disabled`; the app silently closes that challenge (`select invalidated_why from app.phone_verification_challenges ... order by created_at desc limit 1` = `delivery_failed`); **no message leaves**. That proves app, authority, signature, allowlist and Worker are wired.
**Rollback for Phase B:** `update app.phone_verification_config set signup_enabled=false, alias_guard_mode='off';`, set `PHONE_OTP_DELIVERY=off`, redeploy the previous preview build.

## Phase C: the single controlled real message (a SEPARATE approval, in your words)
13. Only now: `npx wrangler deploy --var WHATSAPP_DELIVERY_ENABLED:true` (or the dashboard variable). The repository value stays `"false"`.
14. Sign up once with your allow-listed number. **Success = the code arrives on your handset (Copy Code button, Arabic) and entering it creates the account with `phone_verified_at` set** (`select phone_verified_at is not null from public.profiles where ...`), and the D1 journal shows one `accepted` claim. Meta "accepted" alone is not success.
15. **Immediately set delivery back OFF** (redeploy without the `--var`, or dashboard) unless you approve leaving the pilot open for more tests. One message = one Meta conversation charge; do not retry-spam.
**Rollback for Phase C:** `WHATSAPP_DELIVERY_ENABLED` back to `"false"` (instant, on the Worker only).

## The approval request I will ask for, in this order
1. "Approve Phase A (configure the Acceptance Worker with delivery OFF)." 
2. "Approve Phase B (connect the Acceptance app and database; no message)." This also needs the read-only migration-history result.
3. "Approve Phase C: exactly one real WhatsApp message to <your authorised test number>."
