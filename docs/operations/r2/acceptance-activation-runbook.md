# R2-only media: Acceptance activation runbook

Nothing here has been run. Every numbered step needs its own explicit owner GO, in this order, and a step never
implies the next. Cleanup (step 5) is never combined with the first R2 activation (steps 2 and 3). WhatsApp delivery
stays off on hosted environments. Production is out of scope until step 7 and has its own GO.

Project: Acceptance `nxossqhdfltcqdwvbewi`; Cloudflare preview Workers; R2 private bucket
`aladdin-r2-acceptance-20261011-private`. Candidate: the PR #134 head commit named in the GO request.

## 1. Acceptance migrations (database)
- Preconditions: preflight report green; fresh Acceptance backup exists.
- Run: `supabase db push --linked --dry-run`, compare with the expected plan below, then `supabase db push --linked`
  (no `--include-all`, no repair). Expected plan, in order: `20261102090001` phone send budget, `20261103090001`
  media id storage keys, `20261103090002` request and verification media.
- Verify: `supabase migration list` shows 202 applied; function privileges hash equals the contract of
  `20261103090002`; `select count(*) from media_storage_locations` unchanged (9).
- Rollback: forward-only. A defect is fixed by a new migration; no data is rewritten by these three.

## 2. Preview app and Media Worker deployment
- Deploy `aladdin-frontend-preview`, `aladdin-backend-preview`, `aladdin-media-edge-preview` from the exact candidate
  commit (Cloudflare preview workflows). Account and bucket stay pinned; `R2_PRODUCTION_WRITES_APPROVED=false`.
- Verify: health endpoints; hosted read-only E2E (`hosted-acceptance-e2e`, 11 tests) passes.
- Rollback: redeploy the previous Worker version.

## 3. Acceptance R2 configuration and the seven-flow E2E
- Confirm bindings read-only (bucket name, no public access, CORS/lifecycle files in `docs/operations/r2`).
- `media-reset.mjs snapshot --project nxossqhdfltcqdwvbewi > before.json`.
- Run the matrix in `stage3-acceptance-readiness.md` section 2 (avatar, portfolio, certificate, product, organization,
  request photo, verification document) with a test account per flow, plus negative cases per flow.
- `snapshot` again and `compare`: no application bucket may have grown in Supabase Storage.
- Stop here. Report counts only.

## 4. Acceptance backup and restore
- Fresh manual backup including the R2 originals and the protected verification documents
  (`R2_MEDIA_BACKUP=1`), restore into a scratch project, `media-verify.sh` passes (inventory, copies, sampled sha256).
  Needs Supabase CLI 2.119.0 for the restore. Schedules stay off.

## 5. Optional approved legacy-media reset (separate GO)
- Install `supabase/activation/legacy-media-reset.sql`; `manifest` (private file, 0400); `summary`; owner approves the
  printed hash after reviewing counts including files uploaded after 2026-10-25; backup from step 4 is younger than the
  manifest. Then `execute` (flags, phrase, before-snapshot, journal as in the readiness doc) and `verify`.
- Acceptance's application buckets currently hold no objects and no verification rows, so this step is expected to be a
  no-op there; its value on Acceptance is proving the tool, not freeing space.
- Optional protected evidence path: `bv-evidence-r2-adoption.sql` + `bv-evidence-migrate.mjs plan|execute|verify`
  (adds a verified private R2 copy, keeps Supabase copy). Its own GO and plan hash.

## 6. Storage write-closure SQL (separate GO)
- Only after steps 3 to 5 are accepted: `r2-only-storage-write-closure.sql` in one transaction; rollback file restores
  the exact policies. Verify an authenticated user can no longer write any application bucket.

## 7. Production readiness and later activation (separate GOs)
- Readiness: Production R2 buckets and pinned bindings created and reviewed; Production backups encrypted with the
  restore proven; Production hosted CAPTCHA state decided; the same three migrations dry-run against Production
  (read-only first); dump before any Production write (Free plan has no PITR); Vercel stays as rollback.
- Activation: Production migrations, Workers deployment, `R2_STORAGE_ENABLED=true`, DNS cutover; each needs an explicit
  Production GO. Production reset of the 321 legacy files follows the same step-5 procedure with its own manifest.
