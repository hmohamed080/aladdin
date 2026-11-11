# Production R2: provisioning, Worker configuration and Acceptance rehearsal (preparation only)

Date: 2026-11-11. Prepared; **nothing was run**. Every `write` below is a hosted change that needs its own OWNER GO on the exact commit SHA.
Context: [Track C plan](TRACK_C_PRODUCTION_R2_LEGACY_MEDIA_PREP_20261110.md). The code pin (C-3) is in the same pull request as this file.

## Hard gate (owner)
Production R2-only writes (`R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`) stay off until (1) an independent Production **R2 media backup exists** and (2) **a restore of it has passed**. Order: source-preservation backup (Track D) then copy then R2 backup and restore then cutover. Creating buckets, tokens and Worker secrets below does not enable any write.

## Approved design decisions (owner, 2026-11-11; design only, not a GO for any hosted write)
1. **CORS on the private bucket is required.** The application uploads browser-direct with presigned `PUT` URLs (`frontend/src/server/storage/r2-provider.ts`, 120 s URLs). With no CORS rule the browser preflight fails and every upload breaks. The reviewed rule `cors-production-private.json` allows only `PUT` from `https://aladdindecore.com` and `https://www.aladdindecore.com`. The **site** bucket gets no CORS, exactly like the Acceptance site bucket.
2. **The private bucket also needs the 2-day `pending/` expiry** (`lifecycle-private.json`), besides the 7-day multipart abort, so abandoned uploads do not accumulate. The site bucket gets only the 7-day multipart abort (`lifecycle-public.json`).
3. No CORS on `aladdin-site-media`.
4. No automatic expiry on completed user or organization media or on preserved backups: the only expiry rules are the `pending/` prefix (2 days) and incomplete multipart uploads (7 days).
Both rule files already exist in the repository and are reviewed; they contain exactly these rules and nothing else.

## Preflight for every Preview or Production deployment and every R2 step (owner rule, 2026-11-11)
Before C-2, C-4, A-ACC and any Preview or Production deployment, verify the account directly and stop on a mismatch (the same check applies to the GitHub variable `CLOUDFLARE_ACCOUNT_ID` that deploy workflows pass):
```
CLOUDFLARE_ACCOUNT_ID=<the value the step will use> node scripts/r2-account-preflight.mjs   # exit 0 only if equal to a4c2b7ac45e58a81691b9165492ce6a2
```
It compares against the account pinned in `environment-manifest.ts`, character for character, and fails closed on unset, padded, differently cased or different values (`scripts/r2-account-preflight.test.mjs`). It also runs automatically as an unconditional step, right after Node setup and before any build, dry run or Cloudflare step, in all three deployment workflows (`cloudflare-frontend-preview.yml`, `cloudflare-backend-preview.yml`, `cloudflare-production.yml`), using the real `vars.CLOUDFLARE_ACCOUNT_ID`; a missing or different value fails the job before anything is deployed (tests assert the order). It deploys and changes nothing itself.

## C-2: bucket provisioning commands (one GO)
Run from `frontend/` by the owner with only a 1-day R2 admin token in the environment (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID=a4c2b7ac45e58a81691b9165492ce6a2`). Stop at the first unexpected output.

Before (read-only; all must hold; first run the account preflight above):
```
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID node ../scripts/r2-account-preflight.mjs
pnpm exec wrangler whoami                      # the Aladdin account only
pnpm exec wrangler r2 bucket list              # the known buckets; NEITHER aladdin-media-private NOR aladdin-site-media exists (if one does, stop and reuse it, run only the checks)
```
Writes (the only five):
```
pnpm exec wrangler r2 bucket create aladdin-media-private --location weur
pnpm exec wrangler r2 bucket create aladdin-site-media --location weur
pnpm exec wrangler r2 bucket cors set aladdin-media-private --file ../docs/operations/r2/cors-production-private.json
pnpm exec wrangler r2 bucket lifecycle set aladdin-media-private --file ../docs/operations/r2/lifecycle-private.json
pnpm exec wrangler r2 bucket lifecycle set aladdin-site-media --file ../docs/operations/r2/lifecycle-public.json
```
After (read-only; record the output as evidence):
```
for b in aladdin-media-private aladdin-site-media; do
  pnpm exec wrangler r2 bucket info $b           # WEUR, Standard, default jurisdiction
  pnpm exec wrangler r2 bucket dev-url get $b    # must be disabled (r2.dev off)
  pnpm exec wrangler r2 bucket domain list $b    # must be empty
done
pnpm exec wrangler r2 bucket cors list aladdin-media-private        # equals cors-production-private.json
pnpm exec wrangler r2 bucket cors list aladdin-site-media           # no CORS policy
pnpm exec wrangler r2 bucket lifecycle list aladdin-media-private   # pending/ 2 days + multipart 7 days
pnpm exec wrangler r2 bucket lifecycle list aladdin-site-media      # multipart 7 days only
pnpm exec wrangler r2 bucket list                                   # known buckets plus these two, nothing else changed
```
Rollback: both buckets are empty at creation; `wrangler r2 bucket delete <name>` removes them (valid only while empty). Then delete the admin token.

### Tokens and credentials (least privilege, never shared between roles)
| Credential | Scope | Lives in | Needed for |
|---|---|---|---|
| R2 admin token | Account: Workers R2 Storage Edit, 1 day | operator shell, deleted after C-2 | C-2 |
| App S3 credential | Object Read & Write on `aladdin-media-private` and `aladdin-site-media` only | Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` on `aladdin-frontend-production` | C-4, runtime |
| Copy credential | Object Read & Write on `aladdin-media-private` only (the copy tool writes with `If-None-Match`, never overwrites) | operator shell during C-6, revoked after | C-6 |
| Verify/reconcile credential | Object Read on `aladdin-media-private` only | operator shell, never CI | reconcile, rehash |
| Backup credentials | separate, per Track D; never valid on application buckets | backup repo environments | B-R2 |
`node frontend/scripts/check-r2-credential-scope.mjs` proves a credential reaches only its bucket (run after creating each).

## C-3: code pin (this pull request)
`frontend/src/lib/storage/environment-manifest.ts`: Production account `a4c2b7ac45e58a81691b9165492ce6a2`, private `aladdin-media-private`, site `aladdin-site-media`; Acceptance account pinned to the same account and site bucket `aladdin-acceptance-site-media` (exists since 2026-11-08). `frontend/wrangler.jsonc` production vars add the same three values (`R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET`, `R2_SITE_BUCKET`); the existing test keeps wrangler and manifest equal; `R2_STORAGE_ENABLED` and `R2_PRODUCTION_WRITES_APPROVED` stay `"false"` and the production guard script still passes. Merging changes nothing at runtime while the switches are false. One risk: the Acceptance Preview Worker passes `R2_ACCOUNT_ID` from the repository variable `CLOUDFLARE_ACCOUNT_ID`; if that variable were a different account, Acceptance media would now fail closed. Verified 2026-11-11 from the log of the Cloudflare frontend preview run 42826005238 (2026-11-10), which prints `CLOUDFLARE_ACCOUNT_ID: a4c2b7ac45e58a81691b9165492ce6a2` (exact match; the owner also confirmed the live Acceptance Worker `R2_ACCOUNT_ID`). The variable cannot be read directly through the available tools, so the next preview deploy log is the re-check.

## C-4: Worker configuration for `aladdin-frontend-production` (one GO, undeployed version)
- Variables: already committed by C-3 (`R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET`, `R2_SITE_BUCKET`).
- Secrets to add (never in files): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (App S3 credential). Existing required secrets unchanged: `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `AUTH_PASSWORD_PREVIEW_GRANT_SECRET`.
- Do **not** add the two R2 secrets to the `secrets.required` list yet (it would block deploys that do not need them).
- Preflight first: `node scripts/r2-account-preflight.mjs` with the account the command will use; stop on mismatch.
- Method: `pnpm exec wrangler versions secret put <NAME> --env production` then read back the binding list; the version is not promoted. Dashboard variable edits need "Promote version" to go live, so promotion is deliberately left to C-7.
- Flags stay: `R2_STORAGE_ENABLED=false`, `R2_PRODUCTION_WRITES_APPROVED=false`, `MEDIA_LEGACY_STORAGE_WRITES` default (true), `MEDIA_EDGE_DELIVERY_ENABLED` off, `VIDEO_ENABLED` off.
- Verification: version binding list shows the three variables and the two secrets by name only; no promotion; production still serves from Supabase Storage.

## A-ACC: the single Acceptance rehearsal (one GO, Acceptance only)
Goal: prove migration `20261110090001` and the copy tool end to end before Production. Project `nxossqhdfltcqdwvbewi`; Production untouched.
1. **Preconditions:** `node scripts/r2-account-preflight.mjs` passes for the account in use; Acceptance at 207 migrations; a fresh Acceptance backup (existing Admin/CI path); `node scripts/media-reset.mjs snapshot --project nxossqhdfltcqdwvbewi > before.json`.
2. **Dry run:** `supabase db push --linked --dry-run` from the Acceptance-linked checkout lists exactly `20261110090001`.
3. **Apply:** plain `supabase db push --linked`; then the post-check `node scripts/hosted-db/acceptance-postcheck.mjs` and the permission contract gate; migration count 208.
4. **Plan:** `node scripts/media-storage.mjs plan --project nxossqhdfltcqdwvbewi --json`. **Decision point:** if Acceptance has no `provider=supabase` ready object, there is nothing to copy; the GO then must also name exactly which test objects may be created (one avatar and one product image through a test account while Acceptance legacy writes are open, or direct fixtures), because the rehearsal needs at least one avatar, one product and one organization image still on Supabase.
5. **Copy** (needs the Copy credential for the Acceptance private bucket, operator shell): `migrate --execute --namespace organization,product,avatar --max-bytes <N> --journal rehearsal.json --remaining-egress-bytes <N>`; expect keys `u/<user>/profile/<id>/original.<ext>`, `o/<org>/products/<product>/<id>/...`, `o/<org>/profile/<id>/...` and `storage_key` set on each record.
6. **Verify:** `rehash --journal rehearsal.json`; `node scripts/r2-reconcile.mjs --project nxossqhdfltcqdwvbewi` (the recorded Acceptance baseline of 2 missing and 1 orphan is compared, not hidden; any new defect fails); `delta` shows `cutoverReady`; the app serves each migrated object through `/api/media/<namespace>` for its owner and denies another user.
7. **Rollback drill:** `rollback --journal rehearsal.json --execute` on one object; record provider back to `supabase`, key cleared, R2 object still present; re-run `migrate` and confirm the identical key; originals in Supabase untouched throughout.
8. **After:** `media-reset.mjs snapshot` then `compare` (no Supabase bucket grew; shrinking is not expected). Evidence files go under `docs/operations/evidence/`.
Stop conditions: any new missing or size mismatch, any key outside `u/` or `o/`, a denied-user read that succeeds, any change to a Supabase object.
