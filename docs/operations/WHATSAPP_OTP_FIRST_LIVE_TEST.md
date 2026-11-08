# WhatsApp OTP: restricted single-recipient first live test

Status: PREPARED, NOT EXECUTED. Delivery stays OFF in the committed config (`WHATSAPP_DELIVERY_ENABLED="false"`). Nothing here is run by an agent.

## What the code does

- `wrangler.production.jsonc` now ships `OTP_RECIPIENT_MODE="allowlist"` plus one extra Secrets Store binding, `OTP_ALLOWED_RECIPIENTS` -> secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION`. The number lives only in that secret; it is never in Git.
- In Production the Worker honours `OTP_ALLOWED_RECIPIENTS` ONLY as that binding (a plain variable is ignored) and the value must be EXACTLY ONE valid Egyptian mobile in E.164 (`+20` then 10/11/12/15, 8 digits). Missing binding, unreadable secret, empty, malformed, or more than one entry means the allowlist is empty and every send is refused with 403 (no Meta call).
- `scripts/check-production-config.mjs` pins this shape, still forbids any plain-variable allowlist and any phone number in the file, and refuses `open` mode combined with delivery enabled. `check-production-deployment.mjs` now expects mode `allowlist` and six secret bindings.
- The send-side comparison is an exact string match against the normalised E.164 value (no hashing).

## Owner steps (no values in Git, chat or logs)

1. Create the secret in the account Secrets Store (store `acfaa67f...`): name `OTP_ALLOWED_RECIPIENTS_PRODUCTION`, value = your single E.164 number, no commas, no spaces. Do this BEFORE deploying: the Worker deploy fails while the bound secret does not exist.
2. Run `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` (PASS), then the P-6 deploy per the rollout checklist, then `check-production-deployment.mjs`.
3. P-7a: the admin "Sending service" panel must show mode `allowlist` and `allowlist_entries` = 1 (never the number).

## First-test sequence (each step is a separate owner action)

1. Complete the remaining Meta checks below.
2. As Super Admin set a LOW Daily Send Limit (for example 5) and a low Hard Ceiling; keep both within the P-8 bounds.
3. Open the environment permit: a reviewed change of `WHATSAPP_DELIVERY_ENABLED` to `"true"` plus a guard update (the guard currently refuses it by design, so this is a separate reviewed PR) and deploy.
4. Switch delivery ON in the Super Admin switch.
5. Wait for the delivery attestation to be recorded (`delivery_attested` true in the panel).
6. Request exactly ONE code for the allow-listed number and verify it arrives and works. Do not retry blindly: a Meta message id means accepted, not delivered.
7. Verify the usage counters moved by exactly 1.

## Abort / rollback

- Switch delivery OFF in the Super Admin switch (immediate, no deploy).
- Set the environment permit back to `"false"` by reverting that change (deploy), or roll back to the previous Worker version.
- Remove or empty the secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION` value: with no valid single entry the Worker sends nothing.

## Remaining Meta checks only the owner can run

- Quality rating of sender `1458603463983505` is not Low/flagged.
- Messaging tier: the limit must allow at least 150 unique recipients per 24 h now, and at least 10,000 for a Hard Ceiling of 5000.
- Business display-name status is approved.
- `debug_token` for the system-user token: scopes include `whatsapp_business_messaging` and `whatsapp_business_management`; `granular_scopes` lists WABA `1674249287385148`; `expires_at` is 0 (non-expiring).
- The system user has the WABA and the phone-number asset assigned with Full control. The sender is in business "Business Solution" (`590771698500945`).
- Delivery-status webhook is NOT flowing today, so there are no delivery receipts: "accepted by Meta" is the only signal until it is configured. Verify receipt by the recipient's phone.
