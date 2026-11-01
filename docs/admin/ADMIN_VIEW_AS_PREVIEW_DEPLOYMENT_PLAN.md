# Admin View-As — isolated Preview deployment plan and security checklist

**Status:** PLAN for the owner's separate approval (2026-11-01). Prepared locally only. **Nothing hosted has been created, configured, deployed, migrated or inserted.**
Supersedes section 2 of [`ADMIN_VIEW_AS_PREVIEW_ROLLOUT_PLAN.md`](ADMIN_VIEW_AS_PREVIEW_ROLLOUT_PLAN.md).

## What was prepared (all in the integration branch, none of it active)
| Item | File |
|---|---|
| Worker environment `viewas-preview` (dark: `workers_dev:false`, `preview_urls:false`) | `frontend/wrangler.jsonc` |
| Config isolation test (7 checks, runs in CI) | `frontend/src/lib/cloudflare/viewas-preview-config.test.ts` |
| Manual deploy workflow, own GitHub environment `cloudflare-viewas-preview`, two independent switches, exposure check | `.github/workflows/cloudflare-frontend-viewas-preview.yml` |
| Synthetic fixture (apply / verify / retire) | `supabase/fixtures/view-as-acceptance/` |
| Read-only migration preflight | `scripts/view-as-acceptance-preflight.sh` |

## Isolation review (the owner's six checks)

**1. Access protects the Worker before it is reachable.** The Worker deploys with no public route at all. The workflow refuses to upload unless
the environment variable `VIEWAS_ACCESS_CONFIRMED` is `true`, then proves the Worker answers nothing anonymously (fails the run on HTTP 200).
Cloudflare's one-click "Enable Cloudflare Access" for a Worker's `workers.dev` route attaches the policy to the Worker itself (documented; policy named
`<worker-name> - Production` for the production `workers.dev` URL). Residual risk to be honest about: if the dashboard only offers the Access toggle after the
route is on, there is a window of seconds between enabling the route and Access; the Worker serves nothing without a session, and the workflow's check runs immediately after.
*Operator step: enable Access, then the route, then run the workflow with `smoke` on.* Zero Trust must already be enabled on the account (the existing Preview implies it is; plan/seat limits were not inspected).

**2. Registration's Worker is not touched.** Different Worker name, different `wrangler` environment, different workflow, different GitHub environment and concurrency group.
`aladdin-frontend-preview` was redeployed today (13:15 UTC), i.e. Registration is actively using it. The new Worker's name is free (confirmed by listing the account's Workers: `aladdin-frontend-preview`, `-production`, `aladdin-backend-preview/-production`, `aladdin-media-edge-preview`, `aladdin-whatsapp-otp-preview`).

**3. No shared cache keys, sessions or secrets.**
- *Redis:* **off** on the new Worker (the owner accepted Redis for `preview` only). No key can collide because nothing is read or written. Test-enforced.
- *Sessions/cookies:* host-only cookies on a different hostname: no cookie is shared. Supabase Auth sessions belong to the user, not the origin, so the same account signed in on both Workers has two sessions. **One cross-effect to know:** the app's `signOut()` ends the user's sessions globally; signing out on one Worker signs the same account out of the other. Use different accounts for Registration testing and View-As review (the Admin account is not a Registration test account).
- *Secrets:* Worker secrets are per Worker. None are copied; the operator sets only what the app needs, by `wrangler secret put --env viewas-preview`, never printed. **No WhatsApp sender configuration** is present on this Worker (test-enforced), so mobile sign-up cannot send from it. The View-As feature needs no service-role key.
- *Media:* `R2_STORAGE_ENABLED=false` (test-enforced): no hosted media delivery.

**4. Shared Acceptance database and backend cannot break concurrent Registration testing.**
- *Backend:* `aladdin-backend-preview` is a stateless service binding (modified 2026-10-27); View-As adds no calls to it.
- *Database:* the three migrations are additive. Compatibility with the four Registration migrations was checked (no shared objects; clean replay of all migrations on the combined branch, full pgTAP green). Locking: `…090001` replaces two verification functions with `create or replace` (milliseconds); it changes `review_approve`'s default for admin approvals only, which Registration flows do not call. Apply during a quiet window, announced to Registration testers.
- *Data:* View-As writes only `admin_view_sessions` and audit rows, both only when an admin presses the eye. The fixture is namespaced and uses no existing account.
- *Residual:* the one super-admin account is shared; do not use it for Registration tests while reviewing.

**5. Cost (checked against Cloudflare's current documentation, 2026-11-01; account billing was not inspected).**
- Workers Paid is a flat account subscription ($5/month minimum); an additional Worker adds no fixed fee. Included monthly: 10 M requests and 30 M CPU-ms; beyond that $0.30 per M requests and $0.02 per M CPU-ms. A review session is a few thousand requests.
- `observability.enabled` is on: Workers Logs include 20 M events/month (then $0.60 per M) until 2026-12-01, after which Observability pricing applies (50 GB ingestion/month included, then $0.25/GB). Review traffic is negligible, but this is an **account-level shared allowance** with the other Workers.
- No R2, Redis, Hyperdrive or media-edge usage is added. The Images binding is present but View-As shows placeholders.
- Cloudflare Access: no per-Worker charge is documented for the one-click policy; the Zero Trust seat plan is unchanged. **Expected incremental cost: effectively $0**; the only way to a bill is sustained heavy traffic or a log storm, neither expected.
- Supabase Acceptance: no new project; a handful of RPC calls.

**6. Auth redirects and Turnstile for the new hostname** (hosted configuration — owner action or separately approved):
- Supabase Auth (Acceptance) → URL configuration: add `https://aladdin-frontend-viewas-preview.bstalent9.workers.dev/**` to the redirect allow-list. Not changed; current allow-list was **not** read (needs the dashboard or a management token).
- Turnstile widget (Acceptance site key) → add the hostname to the widget's allowed hostnames; the Worker's `TURNSTILE_ALLOWED_HOSTNAMES` already names only itself. Hosted CAPTCHA is ON for Acceptance, so sign-in on the new origin fails closed until both are done.

## Procedure (every step needs the owner's go; none has run)
0. **Preconditions:** combined branch green in CI and merged-reviewed as Draft; fresh migration preflight (`scripts/view-as-acceptance-preflight.sh`) passes; Registration notified.
1. **Migrations** (separate GO): owner runs `supabase db push --linked` from the combined branch after the dry run lists exactly the three versions.
2. **GitHub:** create environment `cloudflare-viewas-preview`; deployment branch = the one integration branch only; variables `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SUPABASE_URL` (the workflow accepts only the Acceptance URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; secret `CLOUDFLARE_API_TOKEN` scoped to Workers Scripts:Edit. Leave both switches unset.
3. **Dry run:** run the workflow (builds, bundles, runs the isolation test, uploads nothing).
4. **Access + Auth + Turnstile:** create the Access policy and allow-list entries; set `VIEWAS_ACCESS_CONFIRMED=true` and `CLOUDFLARE_VIEWAS_PREVIEW_ENABLED=true`.
5. **Upload dark;** operator sets Worker secrets; run the workflow (upload + exposure check).
6. **Enable the route + Access** in the dashboard; run the workflow with `smoke` on (anonymous must not get 200; the service-token run must; `GET …/view/start` must not be 2xx).
7. **Fixtures** (separate GO): `01_apply.sql`, `02_verify.sql` (see fixture README).
8. **Review** with the owner's Admin sign-in (existing `ACCEPTANCE_ADMIN_*` secrets are for CI; the owner uses their own credentials).

## Security checklist before the URL is shared
- [ ] Anonymous request to the Worker is blocked by Access (not 200).
- [ ] Access policy lists only named reviewers.
- [ ] `ADMIN_VIEW_AS_ENABLED` is set only on this Worker (not `preview`, not production — test-enforced in the repo).
- [ ] Worker secrets set individually; none printed; none copied from another Worker.
- [ ] Redis, R2 and WhatsApp absent (test-enforced).
- [ ] Auth redirect and Turnstile hostname added; sign-in works.
- [ ] Migrations applied by the owner; `users.view_as` held only by Super Admin and Administrator.
- [ ] Fixture verified (`02_verify.sql` passes): not listed, no open job, no credential, no contact row.
- [ ] Registration smoke on `aladdin-frontend-preview` still passes after the migrations.

## Rollback
Set `VIEWAS_ACCESS_CONFIRMED`/`ENABLED` to false and disable the route (instant). Delete the Worker `aladdin-frontend-viewas-preview` (it has no data). Database: flag off is sufficient; kill switch is the forward migration described in the rollout plan. Fixture: `03_cleanup.sql` retires it.
