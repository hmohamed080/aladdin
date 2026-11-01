# WhatsApp OTP — Phase A closure and Phase B approval package

**Status:** Phase A **CLOSED** on 2026-11-01. Phase B is **prepared, not approved and not executed**. WhatsApp delivery is **OFF** on the only deployed Worker version, and it stays OFF for all of Phase B. No Supabase migration, frontend deploy, Auth activation, message or Production change was made for this document.

## Purpose

Record the evidence that closes Phase A (the isolated Acceptance delivery Worker), and give the owner one read-only, exact Phase B plan for the Acceptance app and database. Phase B must be safe to approve without re-discovering the migration history or guessing configuration values.

## Current decision

- Phase A is closed against Worker `aladdin-whatsapp-otp-preview`, active version `6eb9364d-aa89-4e30-9005-a516ac0cd29f`, with `WHATSAPP_DELIVERY_ENABLED="false"`.
- Acceptance migration history is known: **197 applied**, latest `20261029090002`, **only `20261030090001` and `20261030090002` missing**, no applied-not-in-repo and no out-of-order version. A plain forward `supabase db push` is possible; `--include-all` and history repair are not needed and must not be used.
- Phase B may apply those two dormant migrations and deploy the integrated preview build, but it must leave the Worker delivery flag `false`, make no Auth provider/hook change, and end with the database switches off. The single dry run is expected to be refused by the Worker with `503 delivery_disabled`.
- Phase C (one real WhatsApp message) remains a separate, later approval.

## Rationale

The Worker has been deployed and exercised with a signed preflight, but nothing in Acceptance calls it yet. The database authority and the app integration are still dormant. Closing Phase A separately makes the remaining risk explicit: applying two additive migrations to a project whose history is fully understood, deploying a build whose new phone flow is switched off, and proving the app → Worker signature path with delivery still disabled. The alternative — enabling delivery and testing end-to-end in one step — would remove the independent switch that currently guarantees no message can leave.

## Phase A — CLOSED

### Deployment and active version

| Item | Verified value |
|---|---|
| Worker | `aladdin-whatsapp-otp-preview` |
| URL | `https://aladdin-whatsapp-otp-preview.bstalent9.workers.dev` |
| Cloudflare account | `a4c2b7ac45e58a81691b9165492ce6a2` |
| Active version | `6eb9364d-aa89-4e30-9005-a516ac0cd29f` (100%) |
| Active version created | 2026-11-01T10:55:58Z (Secret Change) |
| Code version | `3e02b69b-865f-4eb1-854a-d22f7359a8dd` (2026-11-01T10:42:27Z) |
| Previous versions | `6dffc68b-a514-44c1-93b2-96e87c3eddea` (2026-11-01T10:47:49Z, Secret Change); `39b1dc27-8810-46f4-a328-5be1e7182ec5` (2026-10-28T16:37:12Z, first upload) |

The last two versions are secret-only changes over the same code. The Worker is not called by the Acceptance app yet, so a rollback has no application impact.

### Bindings and variables on the active version

| Binding / variable | Value | Notes |
|---|---|---|
| `IDEMPOTENCY_DB` | D1 `aladdin-whatsapp-otp-acceptance` / `da65d5e4-8344-4078-9c2d-8a4bb4907f79` | Stores SHA-256 event hashes only; no phone or code |
| `OTP_SIGNING_SECRET` | Secrets Store `acfaa67f391e499db6fde398022f50ce/PHONE_OTP_WORKER_SECRET` | Value never read into this document |
| `WHATSAPP_ACCESS_TOKEN` | Secrets Store `acfaa67f391e499db6fde398022f50ce/WHATSAPP_ACCESS_TOKEN` | Meta token stays only in Cloudflare |
| `OTP_ALLOWED_RECIPIENTS` | Worker secret present | Exactly one allow-listed number per the signed preflight |
| `OTP_ENVIRONMENT` | `acceptance` | |
| `OTP_RECIPIENT_MODE` | `allowlist` | `open` is not valid for this Worker |
| `WHATSAPP_DELIVERY_ENABLED` | `false` | The only switch that permits a message |
| `WHATSAPP_GRAPH_API_VERSION` | `v25.0` | |
| `WHATSAPP_OTP_LANGUAGES` | `ar` | |
| `WHATSAPP_OTP_TEMPLATE` | `aladdin_otp` | |
| `WHATSAPP_PHONE_NUMBER_ID` | `1415528588305492` | Sender identity configured in the Worker, not a secret |

### Trigger evidence

- Cloudflare reports the `workers.dev` subdomain enabled (`enabled:true`, `previews_enabled:true`).
- The Worker's `wrangler.jsonc` has `"routes": []` and `"workers_dev": true`.
- The `aladdindecore.com` zone has **zero** Worker routes, and the Worker has no custom domain.
- The only intended trigger is the `workers.dev` URL above. There is no frontend/backend route or DNS record attached to it.

### Signed preflight evidence

The signed `POST /v1/preflight` against the active Worker returned:

```json
{
  "ok": true,
  "checks": {
    "signing_secret_bound": true,
    "meta_token_bound": true,
    "d1_reachable": true,
    "allowlist_has_entries": true,
    "recipient_mode_is_allowlist": true
  },
  "delivery_enabled": false,
  "environment": "acceptance",
  "allowlist_entries": 1
}
```

This proves the real Secrets Store binding, D1 reachability, the allowlist and the delivery-disabled gate without calling Meta or sending a message. The preflight is read-only; it does not create a D1 claim.

### Phase A rollback

The previous deployment is `6dffc68b-a514-44c1-93b2-96e87c3eddea`; the code version before the secret changes is `3e02b69b-865f-4eb1-854a-d22f7359a8dd`.

1. In the Cloudflare dashboard: Workers → `aladdin-whatsapp-otp-preview` → Deployments → choose the previous deployment → Rollback.
2. Or from `edge/whatsapp-otp-worker`: `npx wrangler rollback --yes` (previous deployment), or target a version with `npx wrangler versions deploy <version-id>@100% --yes`.
3. A rollback to `3e02b69b` also restores the secrets as they were at that version; re-apply the current signing secret and `OTP_ALLOWED_RECIPIENTS` before re-running the preflight.
4. Re-run the signed preflight and confirm `delivery_enabled:false`. No app, Supabase or Production rollback is involved because nothing calls the Worker yet.

**Phase A verdict:** CLOSED. The Worker is deployed, isolated, signed-request capable, allow-listed and delivery-disabled.

## Phase B — read-only findings on Acceptance

All findings below are from read-only Supabase Management API calls made on 2026-11-01: [acceptance-migrations-20261101.json](../operations/evidence/whatsapp-otp/acceptance-migrations-20261101.json), generated 11:30:55Z; [acceptance-inspection-20261101.json](../operations/evidence/whatsapp-otp/acceptance-inspection-20261101.json), generated 11:31:14Z. Both are version/count/boolean evidence only: no secret, token, e-mail or phone number. No migration, Auth setting, function, row or secret was changed.

### Project and migration history

| Check | Result |
|---|---|
| Supabase project | `nxossqhdfltcqdwvbewi` (`aladdin-r2-acceptance-20261011`), active/healthy |
| Applied migrations | **197** |
| Repository migrations on the release branch | **199** |
| Latest applied | `20261029090002` |
| Applied but not in the repository | none |
| In the repository but not applied | `20261030090001`, `20261030090002` |
| Out-of-order missing | none |
| Plain forward push possible | **true** |
| R2 markers | `20261028090001=true`, `20261030090001=false`, `20261030090002=false`, `20261031090001=false` |

The repository branch is `integration/whatsapp-otp-worker-r2-20261031`, reviewed code head `39523e4b042774a48b4a3e36e61c02ba69343e13`.

### Auth configuration (read-only, unchanged)

| Setting | Value |
|---|---|
| Email confirmation required | yes (`mailer_autoconfirm:false`) |
| Public sign-up | open (`disable_signup:false`) |
| CAPTCHA | on, Turnstile |
| Phone provider | **off** (`external_phone_enabled:false`) |
| Send SMS hook | **off** (`hook_send_sms_enabled:false`) |
| Before-user-created hook | off |
| Anonymous sign-ins | off |
| Google / Facebook | on / on |
| Leaked-password protection | off |
| Phone MFA | off |
| SMS provider configured but unused | Twilio |
| Site URL / redirect allowlist | `https://aladdin-frontend-preview.bstalent9.workers.dev` and its `/auth/callback**` and `/auth/forgot-password/reset` entries; no stale Vercel, local or insecure entries |

Phase B does not change any of these. Supabase Phone Auth and the Send SMS Hook are not part of this architecture; the Worker receives the app's signed request directly.

### Existing accounts, aliases and phone claims

| Check | Result |
|---|---|
| Alias accounts (`@craftsman-login.aladdin.invalid`) | **0** |
| Unconfirmed alias accounts | 0 |
| Unconfirmed users without a profile | 0 |
| Profiles with a phone | 4 |
| Profiles with `phone_verified_at` | 0 |
| Legacy `public.phone_verification_challenges` | exists, approximately 0 rows |
| Authority objects | absent (`phone_authority_applied:false`, `signup_authority_applied:false`, `alias_guard_installed:false`) |

There is no hosted alias fixture to disturb. The four phone-bearing profiles are not updated by either migration at install time.

### Permissions

- The 13 historically disputed functions were checked directly: all 13 have `service_role_exec:false`, `anon_exec:false`, `authenticated_exec:true`. The expected count is 13 and the found count is 13.
- The inspector's general `permission_diff` reports 108 entries. They are paired signature-rendering differences: the same functions appear once with `public.`-qualified argument types and once without (for example `app._apply_branch_location(verifications)` versus `app._apply_branch_location(public.verifications)`). They are not an EXECUTE-right delta, and this comparison is not the permission gate for this release.
- Neither migration grants or revokes anything on an existing object. Every `GRANT`/`REVOKE` in the two files targets a new table, function or index; the new public RPCs are `service_role` only, with no `anon`, `authenticated` or `PUBLIC` execute.
- `authority_switches` returned HTTP 400 only because `app.phone_verification_config` does not exist yet. It will resolve after `20261030090001`; until then the expected state is "absent".

## Phase B — exact migration diff

| Order | Migration | What it adds | Shipped state |
|---|---|---|---|
| 1 | `supabase/migrations/20261030090001_phone_verification_authority.sql` | `app.phone_verification_config` (singleton), `app.phone_verification_challenges`, `app.phone_verification_ip_buckets`; internal locking/rate-limit helpers; `public.phone_verification_start`, `_verify`, `_invalidate`, `_purge`; a `BEFORE UPDATE OF phone_e164` trigger on `public.profiles` that closes open challenges | `enabled=false`; no key material; all new tables have RLS and no API-role privileges |
| 2 | `supabase/migrations/20261030090002_phone_signup_authority.sql` | `signup_enabled` / `alias_guard_mode` and limits on the config; `app.phone_verification_config_log`; `app.phone_signup_grants`; `app.phone_alias_guard_observations`; `public.phone_signup_start`, `_verify`, `_attach`, `_invalidate`; a deferred `AFTER INSERT` constraint trigger `phone_alias_guard` on `auth.users` for alias-domain e-mails | `signup_enabled=false`, `alias_guard_mode='off'`; the guard is installed but inert |

Both files are additive. At install time they do not `UPDATE` or `DELETE` any `auth.users`, `auth.identities`, `auth.mfa_factors`, `public.users` or `public.profiles` row, and they do not alter any existing login method or role. The only `auth.users` object is the deferred trigger, which fires only on a future insert and returns immediately while the mode is `off`. The one `public.profiles` trigger is a no-op when there is no open challenge.

The two files sort after `20261029090002`, so the hosted history accepts them in a plain forward push. There is no `20261031090001` migration in this branch; that version is a contract-step proposal, not a file.

## Phase B — local rehearsal evidence

`supabase/tests/r2/acceptance_order_rehearsal.sh` was run on 2026-11-01 against an isolated local stack (`aladdin_r2acc`, ports 541xx) rebuilt to the exact hosted history: 197 applied through `20261029090002`, only the two target migrations held back.

The rehearsal **PASSED** with these results:

- Pre-state: 197 migrations, latest `20261029090002`, both target versions absent, authority absent.
- Plain `supabase db push --local --dry-run` listed exactly `20261030090001` and `20261030090002`; no `--include-all` was suggested or used.
- Plain `supabase db push --local` applied both in version order and ended at 199 migrations.
- Existing email/password and phone-alias accounts: `auth.users` fingerprint, counts and passwords unchanged; both password logins returned HTTP 200 after the push.
- `public.users` and the phone/verified fingerprint of `public.profiles` unchanged.
- Pre-existing migration-history rows unchanged (no repair).
- Switches: `enabled=false`, `signup_enabled=false`, `alias_guard_mode=off`.
- `phone_alias_guard` present on `auth.users`, `tgdeferrable=true`, `tginitdeferred=true`.
- No `anon`, `authenticated` or `PUBLIC` execute on the seven new public phone RPCs.
- A new alias sign-up and login still succeeded while the guard was `off`, proving the default mode is inert.
- A second dry run reported the project up to date.

This is local evidence, not a hosted apply. It proves the ordered forward push and the protection properties on a database with the same migration set as Acceptance.

## Phase B — exact hosted changes (only after approval)

| # | System | Change | Rollback |
|---|---|---|---|
| 1 | Supabase Acceptance `nxossqhdfltcqdwvbewi` | Apply `20261030090001` then `20261030090002` with a plain `supabase db push`. Dry-run first and abort if anything other than those two is listed. | Behavioral: set the config switches off. No down migration and no table drop during an incident. |
| 2 | Cloudflare `aladdin-frontend-preview` | Deploy the integrated R2 + Worker build from the reviewed branch. This removes the stale plain var `WHATSAPP_OTP_TEMPLATE=aladdin_login_code` because the old direct Meta sender is gone. | Deploy the previous preview version `da4eb8c9-f4f2-4434-9184-d92d9b18a90f`. |
| 3 | Cloudflare `aladdin-frontend-preview` secrets | Set the seven `PHONE_*` values listed below, with both feature flags `false` and `PHONE_OTP_DELIVERY=worker`. Each `wrangler secret put` publishes a new Worker version; no message can leave because the edge flag is still `false`. | Set the flags back to `false`, `PHONE_OTP_DELIVERY=off`, or roll the frontend Worker back to `da4eb8c9`. |
| 4 | Supabase Acceptance config row | For the single dry run only: `alias_guard_mode='observe'`, then `enabled=true, signup_enabled=true`. | `update app.phone_verification_config set enabled=false, signup_enabled=false, alias_guard_mode='off';` |
| 5 | Worker `aladdin-whatsapp-otp-preview` | **No change.** `WHATSAPP_DELIVERY_ENABLED` stays `false`. | None needed. |
| 6 | Supabase Auth | **No change.** Phone provider off, Send SMS hook off, CAPTCHA and social providers unchanged. | None. |
| 7 | Production | **No change.** No Production Supabase, Worker, DNS, secret or deploy. | None. |
| 8 | GitHub | **No merge.** The branch stays unmerged for this phase. | None. |

### Exact app configuration

Set these as Worker secrets on `aladdin-frontend-preview` (preview environment), never in `wrangler.jsonc` and never in Git:

| Name | Value / source | Notes |
|---|---|---|
| `PHONE_OTP_WORKER_URL` | `https://aladdin-whatsapp-otp-preview.bstalent9.workers.dev/v1/otp/send` | The Worker's send route, not the preflight route |
| `PHONE_OTP_WORKER_SECRET` | the same `whsec_...` value as the Worker's `OTP_SIGNING_SECRET` (Secrets Store `PHONE_OTP_WORKER_SECRET`) | Never the Meta token; never paste into chat |
| `PHONE_OTP_HMAC_KEYS` | `{"current":"k1","keys":{"k1":"<base64 of 32 random bytes>"}}` | Generate as a new keyring; server-only |
| `PHONE_SIGNUP_COOKIE_SECRET` | at least 32 random characters | Seals the pending-sign-up cookie; separate from every other secret |
| `PHONE_OTP_DELIVERY` | `worker` | `worker` needs both the URL and the secret; a half-configuration fails loudly |
| `PHONE_VERIFICATION_ENABLED` | `false` initially | Anything other than the literal `true` is off |
| `PHONE_SIGNUP_VERIFICATION_ENABLED` | `false` initially | Needs `PHONE_VERIFICATION_ENABLED=true` as well |

Generation examples for the operator's shell (run locally, keep the output in the secret manager, not in the repo or chat):

```bash
node -e "console.log(JSON.stringify({current:'k1',keys:{k1:require('crypto').randomBytes(32).toString('base64')}}))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app env schema is `frontend/src/lib/env/phone-verification.ts`; the Worker contract is `frontend/src/server/phone-verification/delivery.ts`. The preview Worker currently has **no** `PHONE_*` bindings, so every value above is a new hosted secret.

## Phase B — sequence

### B0. Preconditions

- The branch is `integration/whatsapp-otp-worker-r2-20261031` at the reviewed code head; the only later commits are documentation and the local rehearsal script.
- The read-only migration inspection was run against this branch on 2026-11-01 and still shows only the two missing versions. Re-run it immediately before B1 if the branch head moved.
- The operator has the Acceptance DB password, the Supabase access token, the Cloudflare preview credentials, the Worker signing secret and the allow-listed test number.
- The test number is not already attached to an Acceptance account, and the browser can complete Turnstile.

### B1. Dry-run the hosted push

From the repository root, in the owner's shell:

```bash
npx supabase link --project-ref nxossqhdfltcqdwvbewi   # skip if already linked
npx supabase db push --linked --dry-run
```

**Abort** unless the dry run lists exactly `20261030090001` and `20261030090002`. Do not use `--include-all`; do not repair `supabase_migrations.schema_migrations`.

### B2. Apply the two migrations

```bash
npx supabase db push --linked
```

No other command should be needed. Capture the CLI output (versions only; no secrets).

### B3. Verify the dormant state

Run the read-only inspection again:

```bash
node scripts/hosted-db/inspect-auth-security.mjs --env acceptance > acceptance-after-phase-b.json
```

Expected: `applied_count=199`, `repo_count=199`, latest `20261030090002`, empty `repo_not_applied`, `plain_push_possible=true`. In the same report, `authority_switches` should now be `false|false|off` and the authority objects should be present.

Also run the direct switch query:

```sql
select enabled, signup_enabled, alias_guard_mode from app.phone_verification_config;
-- false | false | off
```

If either check differs, stop and roll back the switches before touching the app.

### B4. Deploy the integrated preview build

Run the manual GitHub workflow `Cloudflare frontend preview` from the reviewed branch with `CLOUDFLARE_PREVIEW_ENABLED=true`. It builds with OpenNext and deploys `aladdin-frontend-preview`. Record the new version/deployment ID and time. The previous active version is `da4eb8c9-f4f2-4434-9184-d92d9b18a90f`; that is the rollback target.

Do not set any `PHONE_*` value in `frontend/wrangler.jsonc`. The preview config intentionally omits them, and the values live in Worker secrets.

### B5. Set the app secrets with the feature still off

From `frontend/`, set the values in this order so a half-configuration is never live:

```bash
npx wrangler secret put PHONE_OTP_WORKER_URL --env preview
npx wrangler secret put PHONE_OTP_WORKER_SECRET --env preview
npx wrangler secret put PHONE_OTP_HMAC_KEYS --env preview
npx wrangler secret put PHONE_SIGNUP_COOKIE_SECRET --env preview
npx wrangler secret put PHONE_OTP_DELIVERY --env preview        # worker
npx wrangler secret put PHONE_VERIFICATION_ENABLED --env preview # false
npx wrangler secret put PHONE_SIGNUP_VERIFICATION_ENABLED --env preview # false
```

Each command prompts for the value; do not put it on the command line or in shell history. Each successful `secret put` creates and deploys a new version of the same code; that is expected. Confirm in the dashboard that the preview Worker has the seven names, and that no value is visible.

### B6. Verify the app is still OFF

- Open the Acceptance preview sign-up page. Phone sign-up should report the existing "WhatsApp unavailable" state and create no challenge. Email, Google and Facebook entry points and existing phone-alias password sign-in must be unchanged.
- Confirm the Worker is still `delivery_enabled:false` with the signed preflight.
- Confirm `select count(*) from app.phone_verification_challenges` is still 0.

If phone sign-up is not cleanly unavailable, stop and roll back the frontend build before enabling anything.

### B7. Enable the dry-run state

In the Acceptance SQL editor (or an approved admin connection), in this order:

```sql
update app.phone_verification_config set alias_guard_mode = 'observe';
update app.phone_verification_config set enabled = true, signup_enabled = true;
select enabled, signup_enabled, alias_guard_mode from app.phone_verification_config;
-- true | true | observe
```

Then set the two app flags to `true`:

```bash
npx wrangler secret put PHONE_VERIFICATION_ENABLED --env preview        # true
npx wrangler secret put PHONE_SIGNUP_VERIFICATION_ENABLED --env preview # true
```

The config update is audited in `app.phone_verification_config_log` (setting, old value, new value, who and when). The Worker delivery flag is still `false`.

### B8. The single dry run

1. Sign up once with the allow-listed number on the Acceptance preview.
2. Complete the form and Turnstile. The code screen should appear; the app's reply is intentionally independent of delivery.
3. The app posts a signed request to `POST /v1/otp/send`. The Worker checks `WHATSAPP_DELIVERY_ENABLED` **before** reading the Meta token or reserving a D1 claim, so it returns **HTTP 503 `{"error":"delivery_disabled"}`**.
4. The deferred delivery handler catches the non-2xx response and calls `phone_signup_invalidate(..., 'delivery_failed')`.
5. Verify:

```sql
select id, purpose, invalidated_why, consumed_at, invalidated_at, created_at
from app.phone_verification_challenges
order by created_at desc
limit 1;
-- invalidated_why = 'delivery_failed', consumed_at is null
```

```sql
select count(*) from auth.users;  -- unchanged from before the dry run
```

D1: the journal count must be unchanged; the disabled gate returns before the claim insert. No WhatsApp message should arrive; no Meta Graph call should be made.

### B9. Return to the safe state

Recommended end state after the dry run (do not leave a standing user-facing OTP surface):

```sql
update app.phone_verification_config
set enabled = false, signup_enabled = false, alias_guard_mode = 'off';
```

```bash
npx wrangler secret put PHONE_VERIFICATION_ENABLED --env preview        # false
npx wrangler secret put PHONE_SIGNUP_VERIFICATION_ENABLED --env preview # false
npx wrangler secret put PHONE_OTP_DELIVERY --env preview                # off
```

Keep the deployed build and the two migrations. The tables and functions remain dormant and are not dropped. The challenge row from B8 is retained as evidence.

## Phase B — smoke tests and expected evidence

| Test | Expected |
|---|---|
| Signed Worker preflight after B3/B5 | `ok:true`, `delivery_enabled:false`, `environment:"acceptance"`, `allowlist_entries:1` |
| Acceptance DB switch query after B2 | `false | false | off` |
| Acceptance phone sign-up before B7 | "WhatsApp unavailable"; no challenge row |
| Existing email/password login | works, unchanged |
| Existing phone-alias password login | works, unchanged |
| Google/Facebook entry points | present and unchanged (providers remain on) |
| Dry-run sign-up after B7 | code screen appears |
| Worker response during dry run | HTTP 503, `delivery_disabled` |
| Challenge after dry run | `invalidated_why='delivery_failed'`, not consumed |
| D1 journal during dry run | no new claim; count unchanged |
| Meta / handset | no Graph call, no message |
| New Auth user during dry run | none (the code was never verified) |
| Audit log | three config changes recorded with old/new values |
| After B9 | `false | false | off`; both app flags false; delivery off |
| Worker after B9 | still `delivery_enabled:false` |

The Worker log line for the refusal must not contain a phone number, code, secret or full request body. If it does, stop and treat it as a security incident.

## Phase B — rollback

### Immediate (seconds)

1. **Stop the user-facing surface:** set both app flags to `false` and `PHONE_OTP_DELIVERY=off`; the DB switches off. This is independent of the edge and takes effect on the next request after the new Worker version is live.
2. **Stop any possible edge send:** confirm `WHATSAPP_DELIVERY_ENABLED=false` on the Worker. If it was ever changed, set it back to `false` first; this is the master gate.
3. **Close open challenges:** the config update plus the `phone_verification_on_phone_change` trigger covers phone changes; for an incident, `update app.phone_verification_config set enabled=false, signup_enabled=false, alias_guard_mode='off';` stops new starts. Existing challenges expire within 5 minutes (signup grants within 10 minutes).

### Frontend

Roll back `aladdin-frontend-preview` to `da4eb8c9-f4f2-4434-9184-d92d9b18a90f` (deployment `7b2aac60-5f48-49ee-a5ac-5c2547c1c694`, 2026-10-31T08:29:10Z) using the dashboard or `npx wrangler rollback --env preview --yes`. Re-check that email, Google and Facebook sign-in and the existing phone-alias password flow are unchanged.

### Database

There is no down migration. Do not drop `app.phone_verification_config`, the challenge/grant tables or the triggers during an incident: the app build may still reference them, and the rows are the audit trail. Keep them dormant with the switches off. If a future removal is required, author a separate reviewed forward migration after the app no longer calls the objects.

### Worker

No Phase B change is planned. If a Worker rollback is needed for an unrelated reason, use `6dffc68b` (previous secret state) or `3e02b69b` (code) and re-apply the signing secret and allowlist before re-running the preflight.

### Production

Nothing in Phase B touches Production. If a Production change is ever proposed, it needs its own plan, its own migration-history inspection and its own approval; this document is not that approval.

## What is explicitly deferred

- Enabling `WHATSAPP_DELIVERY_ENABLED=true` and sending one real message (Phase C).
- Supabase Phone Auth, the Send SMS Hook, phone MFA and any Auth provider change.
- Production rollout, Production Worker, Production D1, Production secrets, DNS or merge to `main`.
- Dropping the legacy `public.phone_verification_challenges` table (`20261031090001` proposal) and any contract step.
- Retention scheduling for the D1 journal and the authority purge functions.
- Turning `alias_guard_mode` to `enforce`; Phase B uses `observe` only.
- A browser E2E through a fake Meta provider. Phase B proves the app → Worker refusal path, not a delivered code.

## Consequences

- After B2 the Acceptance database gains dormant phone-authority tables, functions and two triggers. They are inert while the switches are off and do not change existing logins.
- After B4 the Acceptance preview runs the integrated build. Phone sign-up is unavailable until B7; email, Google, Facebook and existing phone-alias password sign-in are unchanged.
- After B7 the app can create challenges and attempt signed delivery; the Worker refuses every attempt while its flag is `false`. This is the intended proof, not a pilot.
- After B9 the surface is off again. The only lasting changes are the two dormant migrations, the deployed build and the recorded evidence.

## Approval request

> **Approve Phase B on Acceptance only.** Apply `20261030090001` then `20261030090002` to `nxossqhdfltcqdwvbewi` with a plain forward `supabase db push` (dry-run first; abort on any other migration); deploy the integrated preview build to `aladdin-frontend-preview`; set the seven `PHONE_*` Worker secrets with both feature flags false. For one dry run, set `alias_guard_mode='observe'`, `enabled=true`, `signup_enabled=true` and the two app flags true, sign up once with the allow-listed number, expect the Worker to refuse with `503 delivery_disabled` and the challenge to close as `delivery_failed`, then return all switches to off. No WhatsApp message, no Worker delivery enablement, no Auth provider/hook change, no Production change, no merge.

Phase C — one real message to the allow-listed handset — remains a separate approval after Phase B passes.

## Related files

- [Exact activation and rollback steps](WHATSAPP_OTP_ACCEPTANCE_ACTIVATION.md)
- [Read-only migration-history inspection](ACCEPTANCE_MIGRATION_HISTORY_INSPECTION.md)
- [Acceptance migration evidence (2026-11-01)](../operations/evidence/whatsapp-otp/acceptance-migrations-20261101.json)
- [Acceptance Auth/DB/permission evidence (2026-11-01)](../operations/evidence/whatsapp-otp/acceptance-inspection-20261101.json)
- [Worker integration and pilot plan](WHATSAPP_OTP_R2_PILOT_AND_RELEASE.md)
- [Preview release runbook (historical; superseded for the R2 route)](../operations/WHATSAPP_OTP_PREVIEW_RELEASE_RUNBOOK.md)
- [Implementation log](../operations/WHATSAPP_OTP_IMPLEMENTATION_LOG.md)
- [First missing migration](../../supabase/migrations/20261030090001_phone_verification_authority.sql)
- [Second missing migration](../../supabase/migrations/20261030090002_phone_signup_authority.sql)
- [Local rehearsal script](../../supabase/tests/r2/acceptance_order_rehearsal.sh)
- [App environment schema](../../frontend/src/lib/env/phone-verification.ts)
- [Preview deployment workflow](../../.github/workflows/cloudflare-frontend-preview.yml)
