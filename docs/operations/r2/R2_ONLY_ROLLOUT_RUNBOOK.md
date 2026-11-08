# R2-only media: Acceptance E2E and Production rollout runbook

Status: **prepared 2026-11-08, nothing executed.** No bucket, token, secret, migration, deployment, copy or deletion has been done.
Supersedes the "migrate everything" sequence in [`PRODUCTION_R2_MIGRATION_PLAN.md`](PRODUCTION_R2_MIGRATION_PLAN.md) where they differ.

## 0. Owner decisions this runbook follows

- R2 is the only application file store for **new** bytes, Production included. Supabase keeps database, Auth and metadata (2026-10-31).
- **2026-11-08 update (reverses the earlier "delete, don't migrate" assumption):** legacy Supabase user media is **not** assumed
  deletable. Every object that an active user, organization, product, request or verification record still needs is first
  **copied to R2 and verified**, then reconciled. Deletion of any legacy object is a separate, later decision that needs its own
  manifest (see section 4) and explicit approval.
- Also moved to R2: landing videos and posters, required documents and certificates (private), website static assets.
- Cloudflare account id `a4c2b7ac45e58a81691b9165492ce6a2` and site bucket names `aladdin-acceptance-site-media` / `aladdin-site-media`
  are owner-confirmed (2026-11-08). They are **not** pinned in `environment-manifest.ts` yet: existing guard tests assume an unpinned
  account, and pinning belongs in the commit that follows bucket creation (account id for both environments, both site buckets,
  Production private bucket, plus the matching `wrangler.jsonc` vars and updated guard tests). Until then Production fails closed.
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
| Site media bucket (`R2_SITE_BUCKET`) | `aladdin-acceptance-site-media` (confirmed, to create) | `aladdin-site-media` (confirmed, to create) |
| Public bucket | not used (no code path writes to it; leave unused) | none |
| Backup bucket (never media) | `aladdin-acceptance-backups-weur` | `aladdin-production-db-backups` |
| Worker | `aladdin-frontend-preview` | `aladdin-frontend-production` |

Names and account id are owner-confirmed. After creation, one reviewed commit pins the account id and bucket names in
`frontend/src/lib/storage/environment-manifest.ts` and `wrangler.jsonc` (tests keep them equal) and updates the guard tests that assume an unpinned account. Until then Production fails closed by design.

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
| P-4b | **Copy and verify all required legacy media** (section 4): `media-storage.mjs plan`, `migrate --execute` per namespace within `--max-bytes`, `rehash`, `r2-reconcile.mjs`. Needs a fresh Production backup and the Supabase egress check | P-3, P-4 |
| P-5 | Cutover window: `delta` must report `cutoverReady`; `media-reset.mjs snapshot`; promote P-4 version (R2-only writes, no fallback); run the Production E2E subset (one upload per namespace with a test account) | P-4b |
| P-6 | Close Supabase writes: `r2-only-storage-write-closure.sql`; rerun `snapshot`/`compare` | P-5 verified; no pending Supabase upload |
| P-7 | Legacy cleanup (separate, optional, irreversible): see section 4 deletion manifest; reviewed execution path (none exists: `media-reset.mjs` and `media-storage.mjs` never delete Supabase sources), a final database backup, at least 30 days after P-5 | P-6 and a clean reconcile; only objects proven copied and unreferenced |

## 4. Preserve, copy, reconcile, then (maybe) delete

**What must be preserved:** every `ready` object that a live record refers to, in all seven namespaces (avatar, portfolio,
certificate, product, organization, request, verification). `media-storage.mjs` already inventories exactly that
(`media_migration_inventory`: ready rows still on `provider = 'supabase'`). Production on 2026-11-07: 890 objects, about 193 MB
(avatars 201, portfolio 683, product 3, certificates 3 empty); 134 uploaded since Nov 5, so the inventory is re-taken at each step.
Pending and deleted rows are not copied; objects with no live record are reported (`media-reset.mjs inventory`), never copied or removed automatically.

**Verified copy (per namespace, smallest first):**
1. `media-storage.mjs plan --project <ref> --json` (metadata only; shows bytes, batches and estimated egress).
2. Fresh encrypted backup of the database plus the Storage copy of the backup track (so the originals have an independent copy).
3. `migrate --execute --namespace <ns> --max-bytes <N> --journal <file> --remaining-egress-bytes <N>`. Each object: read from Supabase, sha256 and size
   verified by read-back from R2 (`If-None-Match`, never overwritten), the source re-checked, then the reference switched in the database. Journal is append-only and resumable.
4. `rehash --journal <file>`: re-reads every R2 copy against the journal.
5. `node scripts/r2-reconcile.mjs --project <ref>`: every live R2 row has its object with the receipt size (missing = 0, sizeMismatch = 0).
6. `delta --journal <file>`: nothing new or replaced at the source; `cutoverReady` must be true, then run once more inside the cutover window.
Rollback of the pointer switch: `rollback --journal <file> [--execute]`; originals and copies are both kept.

**Deletion is not part of the cutover.** Supabase originals stay untouched through P-5/P-6. If the owner later wants them gone:
1. Manifest = output of a fresh `media-reset.mjs inventory` plus, per object, proof it is `provider = 'r2'` in the database, verified in the journal (`rehash`), present and size-equal per `r2-reconcile`, and covered by the independent media backup.
2. Retained regardless of anything else: submitted verification evidence, landing assets, documents and certificates until separately released.
3. The manifest hash is approved in writing; a reviewed deletion path is written and tested on Acceptance first (it does not exist); minimum 30 days after cutover; a final backup immediately before.

New uploads between P-5 and P-6 cannot reach Supabase from the app (no fallback). The `snapshot`/`compare` pair around the window fails if any
bucket grew; after P-6 the Storage policy closure is the backstop.

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

- Create the R2 tokens (the Cloudflare OAuth credential in cloud sessions cannot create API tokens).
- Read the remaining Supabase egress for the cycle before any `migrate --execute` (about 193 MB of media; the tool refuses without `--remaining-egress-bytes`).
- Production GO-by-GO as in section 3. The legacy deletion path is intentionally not built until a manifest is approved.
- Video (HLS) stays off; its keys are already ids-only.

## 8. Cloudflare read-back, 2026-11-08 (read-only, Cloudflare MCP)

- Buckets on the account: `aladdin-acceptance-backups-weur`, `aladdin-production-db-backups`, `aladdin-r2-acceptance-20261011-private` (WEUR, Standard, default jurisdiction), `aladdin-r2-acceptance-20261011-public`. **No** site bucket and **no** Production media bucket exist yet, so nothing for Production is created.
- Workers: `aladdin-frontend-preview` / `-production`, `aladdin-backend-preview` / `-production`, `aladdin-media-edge-preview`, `aladdin-whatsapp-otp-preview` / `-production`. The preview frontend config already sets `R2_STORAGE_ENABLED=true`, `MEDIA_LEGACY_STORAGE_WRITES=false` and the private bucket; it sets no `R2_SITE_BUCKET`.
- **Not verifiable with the available tools** (the MCP returns names and dates only; the API credential is OAuth and gets an authentication error on bucket settings): CORS, lifecycle, r2.dev public URL, custom domains, Worker bindings, token permissions. The `--site-only` plan prints the read-only `wrangler` checks for these; the operator's output is the evidence.
- Acceptance site bucket only: `node scripts/r2-provision-plan.mjs --env acceptance --site-only` (2 writes: create the bucket, apply `lifecycle-public.json`; the private bucket is only read). Minimum credential: a 1-day R2 admin token (Workers R2 Storage Edit). No S3 key, Worker secret or variable changes are needed to create it; adding the bucket to a Worker credential and `R2_SITE_BUCKET` is a later GO when site media is first used.
- Rollback of the site bucket: it is empty at creation; `wrangler r2 bucket delete aladdin-acceptance-site-media` removes it. Nothing references it until the Worker variable is set.

## 9. Acceptance site bucket: final commands and safety checks (for approval, not executed)

Run from `frontend/` with only the 1-day R2 admin token in the environment (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID=a4c2b7ac45e58a81691b9165492ce6a2`). Stop at the first unexpected result.

**Before (read-only; all must hold)**
1. `pnpm exec wrangler whoami` shows the Aladdin account only.
2. `pnpm exec wrangler r2 bucket list` shows the four known buckets and **no** `aladdin-acceptance-site-media` (if it exists, stop: reuse it, run only the checks below).
3. `node scripts/r2-provision-plan.mjs --env acceptance --site-only` prints exactly 2 `write` steps, both naming `aladdin-acceptance-site-media`.

**Execute (the only two writes)**
```
pnpm exec wrangler r2 bucket create aladdin-acceptance-site-media --location weur
pnpm exec wrangler r2 bucket lifecycle set aladdin-acceptance-site-media --file ../docs/operations/r2/lifecycle-public.json
```

**After (read-only; record the output as evidence)**
```
pnpm exec wrangler r2 bucket info aladdin-acceptance-site-media            # WEUR, Standard, default jurisdiction
pnpm exec wrangler r2 bucket dev-url get aladdin-acceptance-site-media     # must be disabled
pnpm exec wrangler r2 bucket domain list aladdin-acceptance-site-media     # must be empty
pnpm exec wrangler r2 bucket lifecycle list aladdin-acceptance-site-media  # only the 7-day multipart abort
pnpm exec wrangler r2 bucket list                                           # the four known buckets + this one, nothing else changed
pnpm exec wrangler r2 bucket info aladdin-r2-acceptance-20261011-private   # unchanged
```
Then delete the admin token. Not part of this GO: CORS, any change to the private bucket, S3 keys, Worker variables or secrets, Production.
Rollback: `pnpm exec wrangler r2 bucket delete aladdin-acceptance-site-media` (valid only while empty).

## 10. Acceptance seven-flow E2E: evidence matrix (prepared, not run)

Preconditions: Acceptance at 207/207 migrations (done 2026-11-08), site bucket decision (section 9) is independent of this E2E, the Preview Worker runs with `R2_STORAGE_ENABLED=true` and `MEDIA_LEGACY_STORAGE_WRITES=false` (already in `wrangler.jsonc`), and the R2 app credential is scoped to the private bucket only. Use two real Acceptance test accounts (A owns, B is an unrelated user; for organization flows B is a non-member), with genuine Turnstile and Access (no bypass).

**Before:** record `T0` (UTC ISO), then
`node scripts/media-reset.mjs snapshot --project nxossqhdfltcqdwvbewi > before.json` (Supabase Storage object counts).

| # | Flow (namespace) | Physical key to see in R2 | A does | B must fail to |
|---|---|---|---|---|
| 1 | Avatar (`avatar`) | `u/<A>/profile/<id>/original.<ext>` + `v/{thumb,card,full}.webp` | upload, replace, remove | read, replace, delete A's avatar object |
| 2 | Portfolio (`portfolio`) | `u/<A>/portfolio/<id>/original.<ext>` | upload, publish, unpublish, delete | read while unpublished, delete |
| 3 | Certificate (`certificate`, PDF) | `u/<A>/certificates/<id>/original.pdf` | upload, delete | read, upload into A's slot, delete |
| 4 | Product image (`product`) | `o/<org>/products/<product>/<id>/original.<ext>` (or `u/<A>/products/...` for an independent publisher) | upload, replace, delete | write to A's product |
| 5 | Organization image (`organization`) | `o/<org>/profile/<id>/original.<ext>` | upload logo, replace, delete | change another organization's logo |
| 6 | Purchase-request photo (`request`) | `u/<A>/requests/<request>/<id>/original.<ext>` or `o/<org>/requests/...` | attach to a draft, remove | read a request it cannot see, attach to a submitted request |
| 7 | Verification document (`verification`) | `o/<org>/verification/<id>/original.<ext>` | upload to a draft, submit | read before ready, delete after submission |

For every flow: the object appears only under `u/` or `o/` with ids, never a name; B's attempts return the same 404/denied as a missing object (no existence oracle); replace and delete leave no original, `pending/` copy or variant (checked by reconcile); a deleted object's URL stops working on the next request.

**Ownership proof is isolation evidence, not key shape.** A `u/` or `o/` prefix only shows where bytes went. While running the matrix the operator records each result in an evidence file (no ids, keys or tokens) and checks it with `node scripts/r2-e2e-evidence.mjs evidence.json`. It requires, for every one of the seven flows: A reads (allow), **B read, replace and delete (all denied)**, A read after delete (denied), and anonymous results: `avatar` current allow and replaced deny; `portfolio` published allow and unpublished deny; the other five anonymous read denied. A missing cell or an unexpected result fails the file. The reconcile `window` block additionally proves each new key's `u/<id>` or `o/<id>` equals the record's own owner or organization (`ownerMismatch = 0`), which shows consistency of key and record, not authorization. Database side: `supabase/tests/125_media_anon_resolve_test.sql` (anon can never resolve organization-scoped, certificate, upload or delete).

**Negative/guard checks (once):** with the Preview Worker pointed at a private bucket whose name lacks "acceptance", uploads are refused; with `R2_ACCESS_KEY_ID` disabled, uploads pause and create no Supabase object; Production Supabase URL is refused (covered by `environment-guard.test.ts`; the hosted run proves the deployed variables).

**After (all read-only):**
1. `node scripts/r2-reconcile.mjs --project nxossqhdfltcqdwvbewi --since <T0>` must exit 0: `missing = 0`, `sizeMismatch = 0`, no orphans (or each orphan explained by a test the operator aborted), and the `window` block shows `supabaseCreated = 0`, `missingStorageKey = 0`, `badKeyShape = 0`, `ownerMismatch = 0`, `allFlowsCovered = true`. Needs read-only R2 keys and `SUPABASE_SERVICE_ROLE_KEY` in the operator shell only.
2. `node scripts/media-reset.mjs snapshot ... > after.json` then `node scripts/media-reset.mjs compare --before before.json --after after.json` (no Supabase Storage bucket grew).
3. `node scripts/r2-e2e-evidence.mjs evidence.json` exits 0 (all isolation cells recorded and as expected).
4. `node scripts/media-storage.mjs cleanup --project nxossqhdfltcqdwvbewi` (dry run) lists no candidate that still has bytes.

**Rollback / abort:** the E2E writes only test-account media. To undo: delete the test objects through the app (preferred, which retires rows and removes bytes), then `media-storage.mjs cleanup --execute` on Acceptance for anything left; reconcile again. Setting `R2_STORAGE_ENABLED=false` on the Preview Worker version pauses new uploads without data change. Nothing in this E2E touches Production or legacy Supabase Storage objects.

**Evidence:** save the command outputs and the evidence file under `docs/operations/evidence/` with the run date and the Worker version id.
