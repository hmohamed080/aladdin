# WhatsApp OTP: private Service Binding for the alert callback (Acceptance)

Status: implemented on PR #136 (Acceptance only). Supersedes `WHATSAPP_OTP_ACCESS_SERVICE_AUTH.md` (kept for history; the Access token path is no longer used).

## Why (root cause, proven)

The OTP Worker's alert callback (the Admin "Test the alert connection" probe and real budget alerts) went to the app's public `workers.dev` hostname with global `fetch()`.
On 2026-11-04 the probe's diagnostic returned `{"status":404,"origin":"cloudflare_routing","cf_error_code":"1042"}`: Cloudflare error 1042, "Worker tried to fetch from another Worker on the same zone".
The request never reached Cloudflare Access or the app (the frontend tail showed no request on the notify path). Access service-token authentication could therefore never have worked from a Worker.

## Architecture

```
Browser (Super Admin) -> frontend Worker --OTP_WORKER binding--> OTP Worker
                                                                   |  APP_NOTIFY binding (private, no Access, no public hop)
                                                                   v
                         frontend Worker  POST /api/internal/whatsapp-otp/notify  -> Supabase RPC
```

- `OTP_WORKER` (frontend -> OTP Worker, existing) and `APP_NOTIFY` (OTP Worker -> `aladdin-frontend-preview`, new) are distinct and one-directional per call.
- ONE transport (`src/notify-transport.ts`) serves the probe and real alerts. It calls `env.APP_NOTIFY.fetch(...)` as a method, never follows redirects, and sends NO Access credential.
- FAIL CLOSED: no binding means nothing is sent and the public URL is never fetched (probe: `not_configured`; delivery: skipped `notify_transport_unavailable`, no retry attempt consumed, events wait in the outbox). Only `OTP_ENVIRONMENT=local` rigs may inject a loopback fetcher.
- `OTP_NOTIFY_URL` stays as the host/path the app sees; it is not fetched publicly.
- The endpoint is NOT made public and no bypass policy exists. The app still verifies the HMAC signature, the 5-minute timestamp window, replay (`webhook-id`) and `source_env`, and authorizes the write through Supabase. The public hostname stays behind Cloudflare Access for browsers; a Service Binding simply does not traverse it.
- No `global_fetch_strictly_public` (it would push the call through the public front door, keep a long-lived Access credential and change every `fetch()` of the Worker). The guard rejects it.

## Recursion, ordering and middleware review

- The notify handler (`route.ts`, `server/whatsapp-otp/notify.ts`) never calls the OTP Worker; the chain ends at Supabase. Depth is two hops; Cloudflare's loop limit is 16. Regression tests assert this statically and that neither Worker binds itself.
- Next middleware runs on `/api/internal/...` but only redirects `/b2b`, `/admin`, `/home`, `/onboarding` to sign-in, so a session-less binding call reaches the route (tested).
- Deployment order: a Service Binding requires the target Worker to exist. Both Workers exist on Acceptance. For a FRESH environment the two Workers reference each other: deploy the first without the new binding, deploy the second, then redeploy the first with the binding.
- Binding calls bypass Access, so Access never sees this traffic; the HMAC layer is the authentication.

## Production (NOT changed here)

`wrangler.production.jsonc` and its guard are untouched. With this code a Production Worker without an `APP_NOTIFY` binding fails closed (alerts wait in the outbox, probe `not_configured`). Before any Production deploy of this code, add `APP_NOTIFY -> aladdin-frontend-production` to the Production config and guard (part of B3 preparation; separate approval).

## Guard

`scripts/check-preview-config.mjs` requires: exactly one service binding `APP_NOTIFY -> aladdin-frontend-preview` (no environment/entrypoint, no production target), five distinct Secrets Store bindings, no Access credential binding, no `global_fetch_strictly_public`, delivery disabled, private Worker, Acceptance D1.

## Verification (after deploy)

1. Record the Worker version and rollback target (`wrangler deployments list`).
2. Super Admin "Test the alert connection" once -> `reachable` (HTTP 400 from the app).
3. `wrangler tail aladdin-frontend-preview` shows `POST .../api/internal/whatsapp-otp/notify` during that probe (the handler was reached).
4. D1: `otp_notification_outbox`, `otp_settings`, `otp_settings_audit` unchanged; no WhatsApp send; `WHATSAPP_DELIVERY_ENABLED=false`.
5. Unauthenticated `POST` to the public notify URL still refused by Access (403).

## Rollback

`wrangler rollback <previous version>` for `aladdin-whatsapp-otp-preview`. Nothing else changed (no Access policy, no frontend deploy, no secret).

## Cleanup candidates (do NOT remove without separate approval)

- Access service token `aladdin-otp-worker-notify-acceptance`
- Access application `Aladdin OTP Notify - Acceptance` and its policy `Aladdin OTP Notify Service Auth`
- Secrets Store entries `OTP_NOTIFY_ACCESS_CLIENT_ID`, `OTP_NOTIFY_ACCESS_CLIENT_SECRET` (no longer bound by the Worker)
