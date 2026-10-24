# Media storage monitoring, alerting and bulk-migration runbook

**Status:** Proposed · 2026-10-18 · Tooling is local and tested. Every hosted step listed here needs owner approval and has **not** been done.

## Purpose

Two things for the Supabase → R2 media move (ADR-0017):

1. A safe, resumable way to copy the existing media without spending the remaining Supabase egress.
2. The signals, thresholds and alert locations that show early when media delivery, quota or revocation goes wrong.

## Current decision

### Bulk migration (`scripts/media-storage.mjs`)

- Dry-run is the default. Nothing is copied or switched without `--execute`. Production execution is blocked; only `local` and staging (`kkpkgjrweysgvhvkhzun`) can execute.
- **Budget before bytes.** Each run sizes objects from Storage metadata (`info`, no object bytes), then picks rows in order until the next row would go over `--max-bytes`. A row is only downloaded once it fits, and the download is capped at its metadata size.
- **Egress guard.** `migrate --execute` against a hosted project needs `--remaining-egress-bytes`, the remaining quota read from the Supabase Usage page (no API exposes it). The run is refused before any download when the planned bytes plus 4 kB of request overhead per object exceed `--egress-safety-fraction` (default 0.5, maximum 0.9) of that figure. An HTTP 402 from Supabase aborts the run at once.
- **Verification.** Source bytes are decoded and hashed (`verifyMediaBytes`). They go to R2 with `IfNoneMatch:*`, are read back, and the size and sha256 must match before `media_migration_switch` runs. On a mismatch the reference stays on Supabase, the result is journaled and the run moves to the next row.
- **Never overwrite.** If an object already exists at the R2 key, the tool compares hashes. If they are the same it reuses the object. If they differ it records a conflict and leaves both copies and the reference as they are.
- **Journal.** `--journal <file>` is an append-only JSON-lines file. Each step is fsynced: `source` (size, sha256, etag), `put` (created / exists_same / conflict), `readback` (sha256, ok), `switch`, `failed`, `rollback`, `rehash`. A lock file stops two runs from sharing a journal. The journal holds object keys but no URLs or credentials, so keep it **outside the repository** with mode 0600.
- **Resume.** Rerun the same command. Rows already on R2 are skipped. A row whose verified copy reached R2 is switched again from an R2 read-back, with no new Supabase download. A torn last line is ignored. Rolled-back rows are skipped unless you pass `--retry-rolled-back`.
- **Rollback.** `media_migration_rollback` runs per journal entry (`--key`), per namespace, or from the database ledger (`--from-ledger`). It is refused when the Supabase source is gone or its size has changed. It deletes nothing: Supabase sources and R2 copies are both kept.
- **Source deletion is out of scope.** It needs separate owner approval, at least 30 days of retention, and a clean `rehash` pass first.

| Step | Command (staging; set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*` in the shell) |
|---|---|
| Plan | `node scripts/media-storage.mjs plan --project kkpkgjrweysgvhvkhzun --max-bytes 20MB --remaining-egress-bytes 290MB` |
| Rehearsal dry-run | `node scripts/media-storage.mjs migrate --project kkpkgjrweysgvhvkhzun --namespace avatar,certificate --batch-size 25 --max-bytes 20MB --remaining-egress-bytes 290MB --journal ~/aladdin-media/staging.jsonl` |
| Rehearsal (copy) | same command plus `--execute` (about 16.3 MB, 147 objects; the guard allows 145 MB at 290 MB remaining) |
| Resume | rerun the identical command |
| Portfolio (after cycle reset or Pro) | `... migrate --namespace portfolio --batch-size 25 --max-bytes 45MB --remaining-egress-bytes <today's figure> --journal ~/aladdin-media/staging.jsonl --execute`, repeated about 7 times |
| Verify copies | `node scripts/media-storage.mjs rehash --project kkpkgjrweysgvhvkhzun --journal ~/aladdin-media/staging.jsonl` |
| Rollback | `node scripts/media-storage.mjs rollback --project kkpkgjrweysgvhvkhzun --journal ~/aladdin-media/staging.jsonl --namespace avatar [--key avatar/<key>] --execute` |
| Usage report | `node scripts/usage-report.mjs --project kkpkgjrweysgvhvkhzun --egress-used <Usage page> --egress-quota 5GB` (exit 2 = an alert fired) |

Before each run, read the remaining egress figure fresh and run the usage report. Stop for the day if Supabase storage egress for the day goes over 400 MB.

### Alerts

"Owner" means the step changes a hosted service or a billing setting and needs owner approval. None of these are configured yet.

| Signal | Threshold | Where it is configured |
|---|---|---|
| Supabase egress, cycle to date | **50 %** notice · **80 %** warn (stop non-essential copies) · **95 %** page (freeze migration and media-heavy traffic; 100 % means HTTP 402 on every API call) | `scripts/usage-report.mjs --egress-used/--egress-quota` (local, exit 2). Supabase Usage page and usage e-mails (Owner: confirm the billing e-mail recipients). Optional scheduled Logs Explorer sum over `edge_logs` response bytes, as in the usage audit (Owner). |
| Supabase egress per day | > 300 MB storage egress in a day outside a migration run; > 400 MB on a run day → stop | Same Logs Explorer query on a daily schedule (Owner) |
| Media authority health | `stale_pending > 0` for 24 h; references without a source (`missing_references > 0`); `supabase` provider count rising after cutover | `media_storage_metrics()` and `media_source_inventory_summary()` through `scripts/usage-report.mjs` (local; a scheduled run is Owner) |
| Migration integrity | any `rehash` mismatch or missing copy | weekly `media-storage.mjs rehash` (R2 reads only, no Supabase egress) |
| R2 Class A ops (writes) | > 500k/month (50 % of the free 1M) | Cloudflare dashboard → R2 → Metrics; billing notifications (Owner) |
| R2 Class B ops (reads) | > 5M/month (50 % of the free 10M); storage > 8 GB of the free 10 GB | Cloudflare dashboard → R2 → Metrics; billing notifications (Owner) |
| Media Worker 5xx | > 1 % of requests for 5 min, or any Hyperdrive/DB error burst | Workers Observability / Cloudflare Notifications where the plan offers them, otherwise a scheduled poll of the GraphQL Analytics API grouped by status (Owner) |
| Media Worker 4xx | The Worker answers every denial with 404, so watch the 404 rate: > 3× its 7-day median = a broken ticket signer, abuse or broken references (check Worker logs for the internal reason) | Same as above (Owner) |
| Worker free-plan limits | > 70 % of 100k requests/day; CPU p99 > 8 ms | Workers analytics (Owner) |
| Auth request rate | `/auth/v1/user` > 1k/day after the session fix; any day > 3× its 7-day median | Supabase Logs Explorer over `auth_logs` / `edge_logs` (Owner for a schedule) |
| Revocation canary | any **200** for a deleted (or unpublished) canary object; alert after 1 failure | Scheduled staging probe with a dedicated canary account: upload → fetch 200 → delete → fetch expects **404** right away through the app route and the Worker URL. Runs as a scheduled CI job every 15 min to 1 h (Owner: workflow, secrets and canary account) |
| Vercel bandwidth | > 50 % of included Fast Data Transfer; any image-route bytes after cutover | Vercel Spend Management (Owner) |

## Rationale

About 0.29 GB of the 5 GB monthly Supabase egress remained on 2026-10-18. A full copy needs about 0.273 GB (portfolio 256.8 MB, avatars 8.4 MB, certificates 7.9 MB), and going over the quota takes the whole project down with HTTP 402. So the tool budgets from metadata before downloading, refuses to plan past a safety fraction of the operator-supplied remaining quota, and never downloads the same object twice when a verified R2 copy already exists.

## Scope

This covers Supabase → R2 copying for the five ADR-0017 namespaces, and the usage and alert signals for media storage and delivery. It does not cover business-verification documents or purchase-request images (ADR-0017 keeps them out), or the Worker implementation.

## What is deferred

- Every hosted step marked Owner above, including the scheduled jobs, notification routing and the canary account.
- The canary probe's code. Its planned home is a canary mode in `supabase/tests/public_media_exposure_test.mjs`, owned by another work package.
- A source-size column in `media_migration_inventory`. Today each object is sized with one Storage `info` call, a few hundred bytes of egress. A future RPC could return `storage.objects.metadata->>'size'` so that sizing costs one query.
- Deleting Supabase sources (separate approval, at least 30 days).

## Consequences

Migration runs are slower than a blind copy, because of the metadata pass and the read-back on every object, and they need the operator to type in the quota figure. In exchange, a crash, a rerun or a corrupted copy cannot lose data or overwrite anything. The journal is the operator's audit record and has to be kept until source deletion is approved.

## Related files

[`scripts/media-storage.mjs`](../../scripts/media-storage.mjs) · [`scripts/usage-report.mjs`](../../scripts/usage-report.mjs) · [ADR-0017](../decisions/ADR-0017-rc2-private-media-integration.md) · [monitoring and observability](monitoring-and-observability.md) · [professional media](../database/professional-asset-storage.md) · migration `supabase/migrations/20261021090005_rc2_verified_media_storage.sql`
