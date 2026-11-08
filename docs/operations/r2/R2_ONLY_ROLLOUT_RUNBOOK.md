# R2-only media: Acceptance E2E and Production rollout runbook

Status: **prepared 2026-11-08, nothing executed.** No bucket, token, secret, migration, deployment, copy or deletion has been done.
Supersedes the "migrate everything" sequence in [`PRODUCTION_R2_MIGRATION_PLAN.md`](PRODUCTION_R2_MIGRATION_PLAN.md) where they differ.

## 0. Owner decisions this runbook follows

- R2 is the only application file store, Production included. Supabase keeps database, Auth and metadata (2026-10-31).
- Legacy Supabase Storage **user** media (avatars, portfolio, product, organization images, videos) is **deleted, not migrated** (2026-10-31).
- Kept and moved to R2: landing videos and posters, required documents and certificates (private), website static assets.
  Production has 0 request photos and 0 verification documents; `professional-certificates` holds 3 zero-byte objects. So the
  copy tool (`scripts/media-storage.mjs migrate`) is only needed if a kept legacy object exists at cutover time.
- Every hosted step below is a separate GO. Preparation (this document, scripts, tests) is not.

## 1. What is prepared (all local, all read-only or print-only)

| Tool | Purpose | Safety |
|---|---|---|
| `node scripts/r2-provision-plan.mjs --env acceptance\|production [--verify-only]` | Prints the exact `wrangler` commands: buckets, CORS, lifecycle, then read-only checks (r2.dev off, no custom domain, rules equal files), plus the credential list | Runs nothing; names validated by the same isolation rules the app enforces |
| `node scripts/r2-reconcile.mjs --project <ref>` | Database vs bucket: missing, size mismatch, orphans, variants, retired leftovers, stale `pending/` | Read-only; counts and 10-char fingerprints only; refuses a bucket named `*backup*`; exit 1 on blockers or orphans |
| `node scripts/media-storage.mjs delta --project <ref> --journal f` | New or replaced Supabase objects not yet on R2 | Read-only (existing) |
| `node scripts/media-reset.mjs snapshot` / `compare` | Proves no application bucket in Supabase Storage grew | Read-only (existing) |
| `supabase/activation/r2-only-storage-write-closure.sql` | Database-level closure of Supabase Storage writes | Held, never a migration (existing) |

Tests: `node --test scripts/r2-reconcile.test.mjs scripts/r2-provision-plan.test.mjs` (also run by CI's `scripts/*.test.mjs`).

## 2. Proposed resources

| | Acceptance | Production |
|---|---|---|
| Supabase | `nxossqhdfltcqdwvbewi` | `kkpkgjrweysgvhvkhzun` |
| Private user media bucket | `aladdin-r2-acceptance-20261011-private` (exists) | `aladdin-media-private` (ADR-0018 name) |
| Site media bucket (`R2_SITE_BUCKET`) | `aladdin-acceptance-site-media` (to create) | `aladdin-site-media` (to create) |
| Public bucket | not used (no code path writes to it; leave unused) | none |
| Backup bucket (never media) | `aladdin-acceptance-backups-weur` | `aladdin-production-db-backups` |
| Worker | `aladdin-frontend-preview` | `aladdin-frontend-production` |

The site bucket names are **proposals**; the owner confirms them at GO-3. After creation a reviewed commit pins them (and the
R2 account id) in `frontend/src/lib/storage/environment-manifest.ts`. Until then Production fails closed by design.

### Credentials (least privilege, one per consumer)

| Credential | Scope | Where it lives |
|---|---|---|
| R2 admin token | Account: Workers R2 Storage Edit, 1 day | operator, deleted after the stage |
| App S3 credential | Object Read & Write on that environment's private + site buckets only | Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Tooling S3 credential | Object **Read** on the private bucket only | operator shell (reconcile, rehash); never CI |
| Transcode credential | Object Read & Write on the private bucket, only if video is approved | container secrets |

Worker variables per environment: `R2_STORAGE_ENABLED`, `MEDIA_LEGACY_STORAGE_WRITES=false`, `R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET`,
`R2_SITE_BUCKET`; Production additionally `R2_PRODUCTION_WRITES_APPROVED=true` (only at GO-6). Dashboard edits need "Promote version".

### Media Worker (`edge/media-worker`, edge delivery)

Not on the critical path. The application proxy (`/api/media/*`) already delivers every namespace from R2 with a per-request
database check. Edge delivery (`MEDIA_EDGE_DELIVERY_ENABLED`) is a later, separate GO that needs: the `media_edge` role migration
(already in main), a `media_edge_worker` login role, Hyperdrive with caching disabled, the custom domain
`media.aladdindecore.com`, and `TICKET_KEYS`. Steps are in `edge/media-worker/README.md`; do Acceptance first.

## 3. Critical path

Acceptance (own GOs):

1. **A-1** Backup and migrations: owned by the database and backup tracks (migrations `20261107090003`-`090006` on Acceptance). R2 work waits for `090004`/`090005` (ids-only keys, request and verification media).
2. **A-2** Create the Acceptance site bucket; apply CORS and lifecycle to the private bucket: `node scripts/r2-provision-plan.mjs --env acceptance`, run the `write` steps, then every `read` step. Record the output.
3. **A-3** Preview Worker: set `R2_STORAGE_ENABLED=true`, `MEDIA_LEGACY_STORAGE_WRITES=false`, `R2_SITE_BUCKET`, as an undeployed version; promote on approval.
4. **A-4** Before the E2E: `node scripts/media-reset.mjs snapshot --project nxossqhdfltcqdwvbewi > before.json`.
5. **A-5** E2E, seven flows (avatar, portfolio, product, organization image, certificate, request photo, verification document) as in `r2-only-media-stage2.md` section "Acceptance E2E activation requirements": bytes only under `u/<id>/` or `o/<id>/`; user B cannot read, replace or delete; replace and delete leave no object; wrong bucket name, Production Supabase URL and disabled credentials are refused with no Supabase object created.
6. **A-6** After: `media-reset.mjs snapshot` then `compare --before before.json --after after.json` (must pass: no bucket grew), and `node scripts/r2-reconcile.mjs --project nxossqhdfltcqdwvbewi` (missing = 0, size mismatch = 0, orphans reviewed). Evidence goes under `docs/operations/evidence/`.
7. **A-7** Backup-restore check of R2 media is part of the backup track; its R2 media backup must pass on Acceptance before Production.

Production (each its own GO, none implied):

| GO | Action | Preconditions |
|---|---|---|
| P-1 | Apply `20261105090001` (`--include-all`), `090004`-`090006` | Acceptance A-1..A-6 green; fresh encrypted backup and recovery check (`production-recovery-snapshot.sh`, `production-p2-push.sh`) |
| P-2 | Create Production buckets, CORS, lifecycle, tokens: `r2-provision-plan.mjs --env production`; commit manifest names | P-1 done |
| P-3 | Independent R2 media backup active and one restore test (ADR-0027 decision 6) | P-2 done |
| P-4 | Worker version with R2 variables and secrets (undeployed), verify bindings | P-2 |
| P-5 | Cutover window: `media-reset.mjs snapshot`; promote P-4 version (R2-only writes, no fallback); run the Production E2E subset (one upload per namespace with a test account) | P-3, P-4 |
| P-6 | Close Supabase writes: `r2-only-storage-write-closure.sql`; rerun `snapshot`/`compare` | P-5 verified; no pending Supabase upload |
| P-7 | Legacy cleanup (separate): deletion manifest from a fresh `media-reset.mjs inventory` including post-2026-10-25 uploads, its hash approved, a reviewed execution path (none exists yet: `media-reset.mjs` has no delete mode on purpose), a final database backup | P-6; keep landing videos, documents and certificates |

Kept-object copy (only if the P-5 inventory shows any): `media-storage.mjs plan`, then `migrate --execute` per namespace with `--max-bytes`, `rehash`, and
`delta` until `cutoverReady` is true, run once more inside the window. Production execution also needs `MEDIA_MIGRATION_APPROVED_PROJECT`.

## 4. Delta handling under the delete decision

Because user media is not copied, "delta" means two checks only:

1. **Nothing kept is left behind.** `media-storage.mjs delta` for `certificate`, `request`, `verification` must report nothing waiting (cutover precondition).
2. **Nothing new lands in Supabase.** The `snapshot`/`compare` pair around the window fails if any bucket grew; after P-6 the policy closure is the backstop.

New uploads between GO-5 and GO-6 are impossible from the app (no fallback); a Supabase write from any other path shows up as growth and blocks P-6.

## 5. Rollback

- Before P-5: nothing user-visible changed; delete nothing.
- P-5: redeploy the previous frontend version (record its id before promoting; 2026-11-07 target `39bdf3a2`). R2 uploads made meanwhile stay valid in R2 and in the database; they are not served by the old version, so decide before rollback whether to wait for a fix forward.
- P-6: run `r2-only-storage-write-closure-rollback.sql` (restores the exact saved policies).
- P-7 is irreversible; hence its separate approval and the backup beforehand. R2 originals are never deleted by any step above except `media-storage.mjs cleanup` for retired rows.

## 6. Reconcile readings

| Finding | Meaning | Action |
|---|---|---|
| `missing` > 0 | A verified row has no object | Blocker. Investigate before cutover; do not cleanup |
| `sizeMismatch` > 0 | Object differs from the receipt | Blocker; `rehash` and compare sha256 |
| `orphan`, `orphanVariant` | Object no row refers to | Review fingerprints; not auto-deleted |
| `retiredLeft` | Cleanup did not finish | `media-storage.mjs cleanup --execute` (Acceptance first) |
| `stalePending` | `pending/` older than the lifecycle window | Lifecycle rule not applied; rerun the provision plan's lifecycle step |

## 7. Not done / needs the owner

- Confirm the two site-bucket names and the R2 account id (GO-3/A-2).
- Create the R2 tokens (the Cloudflare OAuth credential in cloud sessions cannot create API tokens).
- The deletion execution path for P-7 is intentionally not built until its manifest is approved.
- Video (HLS) stays off; its keys are already ids-only.
