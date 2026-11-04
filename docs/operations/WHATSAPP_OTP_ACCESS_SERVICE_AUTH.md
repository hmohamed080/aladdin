# WhatsApp OTP: Cloudflare Access service authentication for the alert callback (Acceptance)

Status: PREPARED, not deployed. No Access application, policy, token or secret has been created. Acceptance only; Production is untouched.

## Why

The Acceptance preview `aladdin-frontend-preview.bstalent9.workers.dev` sits behind Cloudflare Access. The private OTP Worker calls
`POST /api/internal/whatsapp-otp/notify` on that hostname for (a) the Admin "Test the alert connection" probe and (b) real budget alerts.
Access answers the Worker with a redirect to the login page, so the probe reports "unexpected" (A7 G-NOTIFY failed) and real alerts would never arrive.

Decision: keep Access, add **Service Auth** for exactly this call. A public Bypass policy is rejected.

## Layers (all remain)

| Layer | Where | Role |
|---|---|---|
| Access Service Auth | Cloudflare edge | decides whether the request reaches the app at all (new, additional) |
| HMAC signature + 5-minute timestamp window | `/api/internal/whatsapp-otp/notify` | authenticity and freshness (unchanged) |
| Replay protection (`webhook-id`) | same route | single use (unchanged) |
| `source_env` must equal this environment | same route | an Acceptance event can never raise a Production alert (unchanged) |
| Supabase authorization | service-role RPC from the app | what an alert may record (unchanged) |

## Worker changes (this branch)

- `edge/whatsapp-otp-worker/src/notify-transport.ts`: ONE `postSignedNotify` used by the probe and by real alert delivery, so they cannot diverge. It adds
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` and the unchanged HMAC headers, and **never follows redirects** (before, an Access login redirect
  followed to a 200 HTML page would have been recorded as a delivered alert).
- Credentials: two Secrets Store bindings of the Worker only, `OTP_NOTIFY_ACCESS_CLIENT_ID` and `OTP_NOTIFY_ACCESS_CLIENT_SECRET`. Both or neither:
  neither = no Access headers (an app not behind Access); one missing, empty, unreadable or malformed = **nothing is sent** (probe says `not_configured`;
  delivery is skipped without consuming a retry attempt). Values are never logged or returned, and not accepted from request input.
- A redirect to `*.cloudflareaccess.com` is classified `blocked_by_cloudflare` (an existing result the Admin page already words), so no frontend change or frontend deploy is needed.
- `check-preview-config.mjs` now requires the seven distinct bindings and rejects reusing the notify signing secret as the Access secret. The frontend never holds these values.
- The probe contract is unchanged: a fixed, deliberately invalid body `{"probe":true}`; a healthy path answers 400; nothing is recorded, nobody is notified, nothing is sent to WhatsApp.

## Least-privilege Access design

1. **Dedicated service token**, used by nothing else (do NOT reuse the smoke-check token in the `cloudflare-preview` GitHub environment).
   Suggested name `aladdin-otp-worker-notify-acceptance`; shortest duration you can maintain (rotate before expiry; set a reminder).
2. **A separate self-hosted Access application scoped to the single path**
   `aladdin-frontend-preview.bstalent9.workers.dev/api/internal/whatsapp-otp/notify`.
   Access evaluates the most specific matching application, so this path is governed by its own policy while every other path stays under the existing application and its user policies (unchanged).
3. **One policy on it: action `Service Auth`, Include = Service Token = that one token** (never "Any Access Service Token", never `Everyone`, never `Allow` for humans).

Limitations to check (I could not inspect Access: the available Cloudflare login has no Zero Trust scope):
- If the existing protection is the Workers "Enable Cloudflare Access" toggle for the workers.dev hostname, confirm the dashboard lets you add a second, path-scoped application on that hostname.
  If it does not, the fallback is to add the same Service Auth policy (this token only) to the existing application. The token is then authorized on the **whole preview hostname**, not just this path.
  That is acceptable only because the token is held by one private Worker, every other route keeps its own authentication, and the notify route still demands a valid HMAC. Record that decision if you take it.
- Access does not prove the caller is *this* Worker; the HMAC (a separate secret) does. Both are needed.

## Owner steps (nothing is done for you)

Read first (read-only): Zero Trust > Access > Applications: note the application that covers the preview hostname and its policies. Do not change them.

1. Zero Trust > Access > Service credentials > Service Tokens > Create. Name as above. Copy the Client ID and Client Secret **when shown** (the secret is shown once). Keep them out of chat, files and shell history.
2. Store them in the account Secrets Store (store `acfaa67f391e499db6fde398022f50ce`), scope **Workers**, names exactly:
   - `OTP_NOTIFY_ACCESS_CLIENT_ID`
   - `OTP_NOTIFY_ACCESS_CLIENT_SECRET`

   Dashboard (Secrets Store > Add secret) or the prompt form `npx wrangler secrets-store secret create acfaa67f391e499db6fde398022f50ce --name <NAME> --scopes workers` (it prompts for the value; do not pass it as an argument).
3. Create the path-scoped Access application and its single Service Auth policy (design above). Save.
4. Tell me when 1-3 are done. I then deploy ONLY `aladdin-whatsapp-otp-preview` (a Worker deploy is refused if a bound secret does not exist, so step 2 must come first), confirm delivery is still OFF, and re-run "Test the alert connection". Expected: `reachable`.
5. Verify without the Worker: an unauthenticated POST to the notify path must still be refused by Access (302/403), and a browser user must not be admitted to that path.

## Rollback

- Worker: `wrangler rollback <previous version>` for `aladdin-whatsapp-otp-preview` (previous version recorded before deploy). Rolling it back does not restore workers.dev for the Worker.
- Access: delete the path application/policy (the host application is unchanged); revoke the token; delete the two Secrets Store entries once unbound.
- Deploying the Worker before the Access application exists is harmless: the headers are ignored and the probe reports `blocked_by_cloudflare`, as now.
