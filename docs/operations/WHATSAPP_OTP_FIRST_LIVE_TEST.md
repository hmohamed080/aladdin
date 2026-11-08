# WhatsApp OTP: restricted single-recipient first live test

Status: PREPARED, NOT EXECUTED. Delivery stays OFF in the committed config (`WHATSAPP_DELIVERY_ENABLED="false"`). Nothing here is run by an agent.

## What the code does

- `wrangler.production.jsonc` now ships `OTP_RECIPIENT_MODE="allowlist"` plus one extra Secrets Store binding, `OTP_ALLOWED_RECIPIENTS` -> secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION`. The number lives only in that secret; it is never in Git.
- In Production the Worker honours `OTP_ALLOWED_RECIPIENTS` ONLY as that binding (a plain variable is ignored) and the value must be EXACTLY ONE valid Egyptian mobile in E.164 (`+20` then 10/11/12/15, 8 digits). Missing binding, unreadable secret, empty, malformed, or more than one entry means the allowlist is empty and every send is refused with 403 (no Meta call).
- `scripts/check-production-config.mjs` pins this shape, still forbids any plain-variable allowlist and any phone number in the file, and refuses `open` mode combined with delivery enabled. `check-production-deployment.mjs` now expects mode `allowlist` and six secret bindings.
- A bound allow-list also wins over a stray `OTP_RECIPIENT_MODE=open` (for example a dashboard edit): open mode is honoured only in Production with NO `OTP_ALLOWED_RECIPIENTS` binding.
- The send-side comparison is an exact string match against the normalised E.164 value (no hashing).

## Owner sequence (strictly in this order; each numbered step is a separate owner action and approval)

Nothing in steps 1 to 5 can send: the permit is `"false"` and no switch row exists. No value is ever typed into chat, a commit, a command line or a log.

1. **Create the secret** in the account Secrets Store (store `acfaa67f...`): name `OTP_ALLOWED_RECIPIENTS_PRODUCTION`, value = your single owner-controlled E.164 number (no commas, no spaces, ASCII digits). Do this BEFORE anything else: the Worker deploy fails while the bound secret does not exist, and the P-5 dry run and P-6 deploy below assume it exists.
2. **Merge #157** (owner approval; it stays a draft until reviewed). Merging changes nothing in Production by itself.
3. **Deploy the Worker** (rollout checklist P-6, its own approval): `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` (PASS), then `pnpm exec wrangler deploy -c wrangler.production.jsonc` from `edge/whatsapp-otp-worker`. This is the first and only Worker deploy of this change; never run it before step 1.
4. **Verify the bindings, read-only:** `node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs` (six Secrets Store bindings, `OTP_RECIPIENT_MODE="allowlist"`, delivery `"false"`). After the frontend is uploaded (P-7a), the admin "Sending service" panel must show mode `allowlist` and `allowlist_entries` = 1 (never the number).
5. **Prerequisites that already belong to the rollout:** frontend promotion (P-7 and its login gate), P-8 limits initialisation and P-9 alert-connection and attestation checks, and the remaining Meta checks below. The Super Admin page needs the promoted frontend.
6. **Super Admin: set a LOW Daily Send Limit** (for example 5) and a low Hard Ceiling on `/admin/whatsapp-otp`, within the P-8 bounds (audited).
7. **Permit change by a separate reviewed PR:** `WHATSAPP_DELIVERY_ENABLED` to `"true"` plus the matching guard update (the guard refuses it today by design), merged and deployed with its own approval. Keep `OTP_RECIPIENT_MODE="allowlist"`; the guard refuses `open` together with delivery enabled.
8. **Switch delivery ON** in the Super Admin switch.
9. **Wait for the delivery attestation** (`delivery_attested` true in the panel, age 0 to 120 s).
10. **Request exactly ONE code** for the owner-controlled allow-listed number and verify it arrives and works. Do not retry blindly: a Meta message id means accepted, not delivered.
11. **Verify** the usage counters moved by exactly 1 and that no number appears in logs or the admin panel.
12. **Switch delivery OFF** in the Super Admin switch (immediately after the test), then revert the permit in a reviewed change if the test window is over.

## Abort / rollback

- Switch delivery OFF in the Super Admin switch (immediate, no deploy).
- Set the environment permit back to `"false"` by reverting that change (deploy), or roll back to the previous Worker version.
- Replace the value of the secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION` with a non-number placeholder (do not delete the secret: a Worker bound to a missing secret cannot be deployed): with no valid single entry the Worker sends nothing (403).

## Remaining Meta checks only the owner can run

- Quality rating of sender `1458603463983505` is not Low/flagged.
- Messaging tier: the limit must allow at least 150 unique recipients per 24 h now, and at least 10,000 for a Hard Ceiling of 5000.
- Business display-name status is approved.
- `debug_token` for the system-user token: scopes include `whatsapp_business_messaging` and `whatsapp_business_management`; `granular_scopes` lists WABA `1674249287385148`; `expires_at` is 0 (non-expiring).
- The system user has the WABA and the phone-number asset assigned with Full control. The sender is in business "Business Solution" (`590771698500945`).
- Delivery-status webhook is NOT flowing today, so there are no delivery receipts: "accepted by Meta" is the only signal until it is configured. Verify receipt by the recipient's phone.
