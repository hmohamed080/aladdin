# Cloudflare cutover plan: 15 stages (revised 2026-10-22, not approved)

**Purpose.** Moves Aladdin from Vercel to Cloudflare in the owner's 15-stage order (brief of 2026-10-22, sections 4, 5 and 12). The stack after the move:
- the Next.js frontend on Workers ([ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md));
- R2 media with the edge Worker ([ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md), [ADR-0020](../decisions/ADR-0020-video-r2-hls.md));
- Redis over Upstash REST ([ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md));
- FastAPI on Cloudflare Containers.

This revision replaces the 2026-10-20 three-stage plan. The file keeps its name so existing links stay valid.

**Status. Nothing in this plan has been done.** Read-only facts were gathered on 2026-10-22 and are recorded in:
- the [R2 audit](r2/README.md);
- the [credentials checklist](cloudflare-credentials-checklist.md);
- the [DNS export](dns-records-aladdindecore-2026-10-22.md).

Every stage needs the owner's explicit approval at its gate. No stage deletes or disables the Vercel project, its deployments, its domains or its environment variables before stage 15.

## Rules that hold in every stage

- **One stage at a time.** The next stage starts only after the previous stage's exit criteria are met and recorded in `AGENT_WORK_LOG.md`.
- **Preview stages (1 to 6)** use only:
  - the isolated acceptance Supabase project `nxossqhdfltcqdwvbewi`;
  - the acceptance R2 buckets `aladdin-r2-acceptance-20261011-private` and `-public`;
  - workers.dev hostnames.
- **The live Supabase project `kkpkgjrweysgvhvkhzun`** is touched only read-only until stage 8, and from stage 8 only with the approvals named there.
- **Vercel stays the rollback until stage 15.** "Rollback to Vercel" always means pointing traffic or configuration back at the untouched Vercel project `aladdin-staging` (team `aladdin8`).
- **No secret is written into the repository, a PR, a log or a chat.** Names are in the [credentials checklist](cloudflare-credentials-checklist.md).
- **"Approval gate" means a written yes from the owner** for that stage, recorded in the work log with the date.

## Facts this plan rests on

- DNS for `aladdindecore.com` is on Vercel nameservers today: 11 records, Zoho mail, and no DMARC ([export](dns-records-aladdindecore-2026-10-22.md)). A Worker can serve a hostname only in a zone that is active on Cloudflare, so the zone moves before any production hostname. That is the only slow-to-undo step, because nameserver changes take hours to propagate. It is done alone and changes no traffic (stage 10).
- Supabase auth cookies are host-only and `SameSite=Lax`. Serving the same hostname from another host keeps sessions in both directions, so a switch or a rollback signs nobody out.
- The frontend Worker forwards `/api/backend/*` to `BACKEND_ORIGIN`, so browsers keep calling the same origin wherever FastAPI runs.
- On 2026-10-22 the Cloudflare account has:
  - one Worker, `aladdin-frontend-preview` (workers.dev subdomain `bstalent9`);
  - three R2 buckets: the two acceptance buckets and `aladdin-production-db-backups`;
  - **no** Hyperdrive, **no** media Worker, **no** production media bucket.
- The FastAPI-on-Containers work (stage 4) belongs to another thread. ADR-0021 still says FastAPI stays on Vercel; that thread's ADR supersedes that line when it is accepted.

---

## Stage 1: database acceptance

Verify the acceptance Supabase project as a faithful, isolated copy of the schema the Cloudflare stack will use.

- **Entry:**
  - `nxossqhdfltcqdwvbewi` exists, and its owner and isolation from live data are confirmed in writing (the [environment map](showroom-release-environment-map.md) still lists them as unconfirmed).
  - The migration set of the branch being accepted is frozen.
- **Work:**
  - Apply the branch's migrations to the acceptance project only.
  - Run pgTAP and the permission contracts (`supabase/permissions/*.json`).
  - Load the disposable acceptance accounts.
  - Read-only comparison with live: migration list and function signatures, no data.
- **Exit:**
  - The acceptance migration list matches the branch.
  - pgTAP is green.
  - `get_advisors` shows no new security error.
  - Acceptance accounts exist for Personal, Showroom owner and staff, Admin and Installer.
  - No live credential appears in any preview location.
- **Rollback:** reset the acceptance project from its own backup or recreate it. Live is untouched by design.
- **Approval gate:** the owner approves applying migrations to the acceptance project, and confirms that the project is disposable.

## Stage 2: real R2 and Hyperdrive (acceptance)

- **Entry:**
  - Stage 1 is done.
  - The acceptance R2 credential exists, scoped to the private acceptance bucket only ([checklist §2](cloudflare-credentials-checklist.md#2-preview-worker-aladdin-frontend-preview-runtime)).
  - Public access and `r2.dev` are confirmed **off** on the private bucket (read with `wrangler r2 bucket dev-url get`).
- **Work:**
  1. Apply [`r2/cors-acceptance-private.json`](r2/cors-acceptance-private.json) and [`r2/lifecycle-private.json`](r2/lifecycle-private.json) to the private acceptance bucket, and [`r2/lifecycle-public.json`](r2/lifecycle-public.json) to the public one. Read them back with `cors list` and `lifecycle list`.
  2. In the acceptance project, create the `media_edge_worker` role (`edge/media-worker/README.md`).
  3. Create Hyperdrive **with caching disabled** for that role.
  4. Deploy the media Worker `aladdin-media-edge` on its workers.dev URL, bound to the private acceptance bucket and that Hyperdrive, with `TICKET_KEYS` set.
  5. Run the real-R2 items marked 🟡 and 🔴 in the [R2 requirement map](r2/README.md#4-requirement-map): byte verification, WebP variants, private recheck, revocation, ETag and cache keys, certificates, large and interrupted uploads. Run `r2.live.test.ts` and `media.live.test.ts` against the acceptance bucket too.
- **Exit:**
  - Every row of the requirement map is green against real R2, with evidence (commands, outputs and object listings) in an acceptance report.
  - A revoked object returns 404 on the next request through both the proxy and the edge.
  - No orphan objects remain after the test cleanup.
  - Hyperdrive shows caching disabled.
- **Rollback:**
  - Set `R2_STORAGE_ENABLED=false` and `MEDIA_EDGE_DELIVERY_ENABLED=false` on the preview Worker.
  - Remove the media Worker and the Hyperdrive config.
  - `wrangler r2 bucket cors delete`, and restore the previous lifecycle from `lifecycle list` output saved before the change.
  - Rows already on R2 stay readable through the proxy (ADR-0017).
- **Approval gate:** the owner approves the bucket rules, the database role, Hyperdrive, the media Worker on workers.dev, and Workers Paid if the media Worker needs it for CPU.

## Stage 3: Redis

- **Entry:**
  - Stage 2 is done.
  - The Upstash database is chosen (existing or a dedicated preview database), and its REST URL and token are available ([upstash-setup.md](../guides/upstash-setup.md)).
- **Work:**
  - Set `REDIS_CACHE_ENABLED=true`, `REDIS_REST_URL` (var) and `REDIS_REST_TOKEN` (secret) on the preview Worker. `REDIS_KEY_ENV=cf-preview` is already in config.
  - Run the cache and rate-limit tests against it.
  - Confirm that Redis is never an authorization input.
- **Exit:**
  - Rate limits trigger on the preview (media upload, video part, auth).
  - With Redis made unreachable, the fallbacks apply: Postgres reads and per-instance limits.
  - The monthly command count is projected under the plan's allowance.
- **Rollback:** `REDIS_CACHE_ENABLED=false`. Nothing else depends on Redis.
- **Approval gate:** the owner approves the Upstash database, its plan and the token placement.

## Stage 4: FastAPI preview on Cloudflare Containers (another thread)

- **Entry:**
  - Stage 3 is done.
  - The containers thread's ADR and container image are reviewed.
  - The container variables in [checklist §3 and §4](cloudflare-credentials-checklist.md#3-fastapi-container-cloudflare-containers-preview-owned-by-the-containers-thread) are ready. **`APP_ENV` is set explicitly**: off Vercel, an unset value means `local`.
- **Work** (done by that thread):
  - Deploy the FastAPI container and, if video is in scope, the transcode container, against the acceptance project and bucket.
  - Set `BACKEND_ORIGIN` on the preview frontend Worker to the container's https origin.
- **Exit:**
  - `/api/backend/health` through the preview Worker answers 200 (not 503 `misconfigured`).
  - An authenticated endpoint refuses without a JWT and works with one.
  - If video is in scope, one video goes `uploading → processing → ready` on real R2.
- **Rollback:** point `BACKEND_ORIGIN` back at the Vercel FastAPI (`https://aladdindecore.com/api/backend` stays served by Vercel), or unset it (503 on `/api/backend` only).
- **Approval gate:** the owner approves Containers billing and the deployment, as asked by that thread.

## Stage 5: Next.js preview

- **Entry:**
  - Stages 1 to 4 are done.
  - The preview Worker's runtime secrets are complete ([checklist §2](cloudflare-credentials-checklist.md#2-preview-worker-aladdin-frontend-preview-runtime)).
  - The Turnstile widget and the Supabase redirect URLs include `aladdin-frontend-preview.bstalent9.workers.dev`.
- **Work:**
  - Deploy through the `Cloudflare frontend preview` workflow, which is already working: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PREVIEW_ENABLED=true` exist.
  - Run the smoke check and a manual pass: sign-in, sign-up with Turnstile, recovery, Showroom, Admin, uploads.
- **Exit:**
  - The smoke check passes (`/api/health`, `/`, `/auth/sign-in`, `/legal/terms`, `/showroom`).
  - The manual pass works.
  - No `exceededCpu` or `exceededMemory` in Workers Observability during the pass.
  - Performance is no worse than Vercel on the measured routes ([performance report](performance-cloudflare-2026-10-20.md)).
- **Rollback:** `wrangler rollback --env preview` to the previous version, or set `CLOUDFLARE_PREVIEW_ENABLED` to anything other than `true` to stop uploads. No user traffic is involved.
- **Approval gate:** the owner approves the preview deployment, which is already given for the workers.dev preview, and Workers Paid if the Free plan's 10 ms CPU is exceeded.

## Stage 6: full end-to-end acceptance

- **Entry:** stage 5 is done; the E2E and security suites are pointed at the preview URL with acceptance accounts.
- **Work:**
  - Run the full Playwright E2E suite and the security suites against the preview: auth, Admin, Showroom, Sales, uploads, video, revocation, cross-tenant denial, and the session revocation checks.
  - Run a short load test within plan limits.
- **Exit:**
  - Every suite is green, or each failure is reproduced on Vercel too and recorded as pre-existing.
  - There is a written GO report.
- **Rollback:** none needed. Findings go back to the stage that owns them.
- **Approval gate:** the owner signs the GO report. This is the gate for every production stage below.

## Stage 7: production R2

- **Entry:**
  - Stage 6 is GO.
  - The owner approves creating production media storage.
- **Work:**
  - Create `aladdin-media-private` with public access and `r2.dev` off.
  - Apply [`r2/cors-production-private.json`](r2/cors-production-private.json) and [`r2/lifecycle-private.json`](r2/lifecycle-private.json).
  - Create one bucket-scoped credential per consumer (frontend, transcode).
  - Create the production `media_edge_worker` role on the live project, with its migration already applied through the normal release process.
  - Create the production Hyperdrive (caching disabled).
- **Exit:**
  - The bucket rules are read back and match the files.
  - A write and read smoke test with a disposable key on the production bucket succeeds, run by the operator. The object is deleted afterwards.
  - Hyperdrive connects as `media_edge_worker`, and `select count(*) from public.users` is refused for that role.
- **Rollback:** delete the smoke object, revoke the credentials, remove Hyperdrive. The bucket can stay empty. Production keeps running on Vercel with `R2_STORAGE_ENABLED=false`.
- **Approval gate:**
  - the owner approves the bucket, credentials, live-project role and Hyperdrive;
  - this is the first change that touches the live Supabase project: the role only, no data.

## Stage 8: production Workers and FastAPI

- **Entry:** stage 7 is done; the GitHub Environment `cloudflare-production` exists with required reviewers ([checklist §6](cloudflare-credentials-checklist.md#6-production-later-stages-7-8-and-11-each-needs-its-own-approval)).
- **Work:**
  - Deploy `aladdin-frontend-production`, built with production `NEXT_PUBLIC_*` values, with all production secrets set. **No route or custom domain yet**, and `workers_dev: false`.
  - Deploy the production media Worker, also without a route.
  - Deploy the production FastAPI and transcode containers (containers thread).
  - Keep `R2_PRODUCTION_WRITES_APPROVED=false` until stage 11 says otherwise.
- **Exit:**
  - Every Worker deploys.
  - `wrangler secret list --env production` shows every name in the checklist.
  - The containers' health checks pass.
  - No hostname serves any of them yet.
- **Rollback:** `wrangler delete` or `wrangler rollback` on the production Workers, and stop the containers. No traffic is involved.
- **Approval gate:** the owner approves the production deployments and Workers Paid (required for production CPU, ADR-0021).

## Stage 9: DNS export

- **Entry:** stage 8 is done (or in parallel with it: this stage is read-only).
- **Work:**
  - Re-export the Vercel zone right before stage 10 and compare it with the [2026-10-22 export](dns-records-aladdindecore-2026-10-22.md): 11 records. Vercel's system records may change without notice.
  - Identify the registrar, and check DNSSEC and any DS record there.
- **Exit:**
  - A dated export with zero unexplained differences.
  - The registrar's name and login are confirmed by the owner.
  - DS status is known.
  - The owner has decided on DMARC: a separate change, not part of the move.
- **Rollback:** none (read-only).
- **Approval gate:** none for the export; the owner confirms the registrar access.

## Stage 10: DNS to Cloudflare with no traffic change

- **Entry:** stage 9 export is fresh (same day); the registrar login is available; no other stage is in progress.
- **Work:**
  1. Add `aladdindecore.com` to Cloudflare (Free plan).
  2. Import the BIND snippet from the export with **"Proxy imported DNS records" off**. Every record must be DNS only (grey cloud), so the apex and the wildcard still point at Vercel.
  3. Compare the Cloudflare zone with the export record by record. That includes MX priorities, the exact DKIM string, SPF, the Zoho verification and CAA, with `ssl.com` added.
  4. Add `backend.aladdindecore.com` only if the containers thread needs a hostname for FastAPI. Otherwise skip it.
  5. Lower nothing further, then change the nameservers at the registrar to the two Cloudflare nameservers.
  6. Verify from several resolvers (`dig @1.1.1.1`, `@8.8.8.8`, `@9.9.9.9`): web, mail send and receive through Zoho, the DKIM signature on a sent message, and the existing verifications.
- **Exit:**
  - Cloudflare shows the zone **Active**.
  - All records resolve identically to the export.
  - Mail flows both ways with DKIM pass.
  - `https://aladdindecore.com` is still served by Vercel (response headers show `server: Vercel`).
  - Vercel still shows the domain as valid.
- **Rollback:** set the registrar back to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`. The Vercel zone is untouched, so its records still exist. Propagation can take up to 48 h, which is why nothing else changes in this stage.
- **Approval gate:** the owner approves the nameserver change, on a day chosen for low traffic.

## Stage 11: test production on separate hostnames

- **Entry:**
  - Stage 10 is done and stable for at least 24 h.
  - `next.aladdindecore.com` is added to Turnstile and to the live Supabase redirect URLs.
  - `next.aladdindecore.com` is added to the production CORS file ([r2/cors-production-private.json](r2/cors-production-private.json)).
- **Work:**
  - Attach Workers Custom Domains: `next.aladdindecore.com` → `aladdin-frontend-production`, and `media.aladdindecore.com` → production media Worker.
  - Run the read-only staging smoke and a manual pass with real accounts: sign-in, Showroom, Admin.
  - With approval, set `R2_STORAGE_ENABLED=true` and `R2_PRODUCTION_WRITES_APPROVED=true` for one controlled upload and delete.
- **Exit:**
  - Smoke and manual pass are green on `next.aladdindecore.com`.
  - A real upload is verified, served and revoked.
  - No 5xx or CPU and memory limit errors.
  - Cookies on `next` are separate from the live site's, as expected.
- **Rollback:** detach the Custom Domains. Set `R2_STORAGE_ENABLED=false` (R2 rows already written stay readable through the proxy). The main hostname was never involved.
- **Approval gate:** the owner approves the test hostnames, the live-project redirect URL, and the first production R2 write.

## Stage 12: switch traffic (only on approval at the time)

- **Entry:**
  - Stage 11 is green.
  - The owner gives a time-boxed go, with someone watching for 60 minutes.
  - The rollback steps below have been rehearsed on `next`.
- **Work:**
  - Attach Custom Domains `aladdindecore.com` and `www.aladdindecore.com` to `aladdin-frontend-production`. Cloudflare replaces the grey-cloud records that pointed at Vercel.
  - Keep the wildcard DNS-only to Vercel.
  - Keep every Vercel deployment and domain untouched.
- **Exit:** the 60-minute watch passes against the failure criteria below.
- **Rollback (minutes):**
  - Detach the two Custom Domains.
  - Restore the original DNS-only records from the export: the `@` CNAME to `cc39f6c51d632b81.vercel-dns-017.com`, or `A 76.76.21.21`, and `www` through the wildcard.
  - Sessions survive because the hostname does not change.
- **Approval gate:** the owner's explicit go at the time of the switch. No standing approval counts.

## Stage 13: monitor

- **Entry:** stage 12 is done.
- **Work:** watch these sources for the agreed period (proposal: 7 days):
  - Workers Observability: status codes, exceptions, CPU, memory;
  - Supabase logs and API usage;
  - Upstash command count;
  - the media Worker's analytics;
  - Images usage (Free: 5,000 transformations a month).

**Roll back at once (stage 14 procedure) if any of these holds for 5 minutes:**
- 5xx above 1% of requests, or any `exceededCpu` (1102) or `exceededMemory`;
- sign-in, sign-up, recovery or sign-out failing;
- Server Actions failing (Showroom product save, Admin decisions);
- `/api/backend/health` not 200;
- mobile LCP p75 worse than Vercel by more than 20%;
- Images error 9422 on uploads.

- **Exit:** the period ends with no rollback trigger. Costs are within the approved plan.
- **Rollback:** the stage 12 rollback.
- **Approval gate:** the owner sets the monitoring period.

## Stage 14: verify rollback to Vercel

Prove that the way back still works before anything Vercel-side is removed.

- **Entry:**
  - Stage 13 is done.
  - A low-traffic window is agreed.
  - The Vercel project still has its latest production deployment and environment variables.
- **Work:**
  - Run the stage 12 rollback for real for a short, announced window, or on `next.aladdindecore.com` re-pointed to Vercel if the owner prefers no production flip.
  - Confirm Vercel serves, sign-in persists, and R2 rows are readable on Vercel through the proxy, with the same `R2_*` values on Vercel.
  - Then switch back to Cloudflare.
- **Exit:**
  - Both directions worked within minutes, with no sign-outs.
  - The measured switch time is recorded.
- **Rollback:** the stage 12 attach steps (back to Cloudflare).
- **Approval gate:** the owner approves the window.

## Stage 15: retire Vercel (last)

- **Entry:**
  - Stage 14 is done.
  - Cloudflare has served production without a rollback for the period the owner chooses.
  - The FastAPI containers have run in production for the same period.
- **Work, in this order, each step reversible until the last:**
  1. Remove the Vercel production domain assignment.
  2. Keep the project, deployments and variables for an agreed grace period.
  3. Export the Vercel environment-variable names for the record (names only).
  4. Delete Vercel environment variables.
  5. Delete or downgrade the project.
  6. Update ADR-0009, ADR-0021 and the architecture guide to "Vercel retired".
- **Exit:**
  - No traffic or DNS points at Vercel.
  - Billing is closed or downgraded.
  - The docs are updated.
- **Rollback:** before step 4, re-add the domain and redeploy. After step 4, Vercel is a fresh setup from the names exported in step 3.
- **Approval gate:** the owner approves each of steps 1, 4 and 5 separately.

## Related

- [R2 audit and prepared rules](r2/README.md)
- [Credentials checklist](cloudflare-credentials-checklist.md)
- [DNS export, 2026-10-22](dns-records-aladdindecore-2026-10-22.md)
- [Cloudflare frontend guide](../guides/cloudflare-frontend.md)
- [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md), [ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md), [ADR-0020](../decisions/ADR-0020-video-r2-hls.md), [ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md)
