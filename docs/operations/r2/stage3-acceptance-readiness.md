# R2-only media: Acceptance readiness (Stage 3)

Status: prepared locally, **nothing here has been run against a hosted environment**. Every step below needs its own
owner GO. WhatsApp delivery stays off on hosted environments until separately approved.

## 1. Retiring legacy Supabase Storage files (plan, not executed)

Decision (2026-11-01): legacy application files are removed, never migrated; R2 is the only media store.

| Class | Buckets | Treatment |
| --- | --- | --- |
| Application media | avatars, professional-portfolio, professional-certificates, product-images, organization images, request photos | Removed by `scripts/media-reset-execute.mjs` after an approved object-level manifest. |
| Unsubmitted verification uploads (draft) | business-verification-documents, rows with no `submission_id` | Removed with the above. |
| **Submitted verification evidence** | business-verification-documents, rows with `submission_id` | **Retained, always.** The tool cannot select them (plan excludes them, and every batch is re-checked). Included in backups. Retirement of these is a separate compliance decision. |

Order, each step separately approved (full runbook: `acceptance-activation-runbook.md`):

1. Read-only `media-reset-execute.mjs manifest --project <ref> --out manifest.json` writes the **object-level approval
   manifest** once (exclusive create, mode 0400): for every Storage object the bucket, key, storage id, size, eTag,
   updated_at, owning row and state, whether anything points at it, and the retention decision (delete or retain, with
   the reason: `legacy-row`, `orphan-object`, `r2-located`, `submitted-verification-evidence`,
   `unreferenced-verification-object`); plus rows without an object and stale legacy locations. `summary` prints counts
   and the SHA-256 of the complete canonical entries (no keys). The owner approves that hash, not a count summary.
   The reader pages in byte order and fails closed if any total differs from the database's own counts or the counts
   changed while reading.
2. Fresh dated backup of the target proven restorable (section 3).
3. Install the held SQL `supabase/activation/legacy-media-reset.sql` (service-role functions; deletes nothing itself).
4. `MEDIA_RESET_EXECUTE_ENABLED=true media-reset-execute.mjs execute --project <ref> --manifest manifest.json
   --approved-sha256 <hash> --confirm "delete legacy media in <ref>" --before before.json --journal reset-journal.jsonl`.
   Refused unless: the flag; the manifest file's recomputed hash equals the approved hash; a LIVE manifest still equals it
   (a new upload, a replaced object with the same name, or a verification status change makes the approval stale);
   the exact phrase; a before-snapshot of the same project whose bucket counts equal the manifest; a hash-chained journal
   bound to this project and manifest. Each batch (at most 100) is then revalidated **by the database under row locks**
   (storage id and eTag equal the manifest, submitted evidence, row-less verification objects and R2-located keys are
   refused, all-or-nothing), which also clears every avatar/cover/logo/portfolio-project-cover pointer and tombstones the
   row; only then are Storage objects removed and each confirmed gone; finally tombstones and legacy locations are
   deleted. Success is reported only if `media_reset_verify` finds no broken pointer, legacy row, legacy object or
   legacy location. Resumable and idempotent; fail-stop; counts and hashes only.
5. `media-reset.mjs snapshot` and `compare`; then the Storage write-closure SQL, last.

Submitted verification evidence is never selected: the manifest validator refuses any file that marks it for deletion,
the database refuses it again under lock, and `bv-evidence-migrate.mjs` is the only (separately approved) path that
moves it, by adding a sha256-verified private R2 copy and keeping the Supabase copy.

Rollback: Storage deletion is not reversible; the backup of step 2 is the only recovery, which is why it gates the run.
`legacy-media-reset-rollback.sql` removes the functions and keeps the journal.

## 2. Acceptance E2E for the seven media flows

Preconditions (each its own GO): dry-run then CLI push of migrations 20261102090001 and 20261103090001/2; preview app
and edge Worker deployed from the exact final commit; R2 flags set with account and bucket pinned; test user per flow.

Procedure: `media-reset.mjs snapshot` -> run the matrix -> snapshot -> `compare` (no bucket may grow in Supabase Storage).

| # | Flow | Namespace | Pass criteria |
| --- | --- | --- | --- |
| 1 | Avatar upload and replace | avatar | object in R2 under an id-only key; previous original removed; no Supabase Storage object. |
| 2 | Portfolio item | portfolio | same; owner-only delete. |
| 3 | Professional certificate | certificate | same; private read via ticket. |
| 4 | Product image | product | same; public variant served via the edge. |
| 5 | Organization logo/cover | organization | same; membership-gated. |
| 6 | Request photo | request | R2, private; visible only to the request's parties. |
| 7 | Business-verification document | verification | R2, private; submitted document is retained and never selected by cleanup or reset. |

Per flow also check: wrong-owner access refused, oversized/wrong-type refused, a failed upload leaves no row and
`media-storage.mjs cleanup` (dry run) counts the orphan. Counts only; no keys in any report.

## 3. Backups and restore verification

Coverage already in tree: `r2-media-backup.sh`, `r2-eligibility.sql` (one rule for live, dump and restore),
`r2-new-namespaces-test.py` (request and verification namespaces are always required, including deleted rows),
`media-verify.sh` (inventory vs restored database, copies, sampled sha256). Before any reset or cleanup on a target:
a manual backup and a restore test of that same snapshot must pass (Acceptance: snapshot aladdin-acceptance-20261101T102928Z
passed). `PRODUCTION_BACKUP_ENABLED` stays false and no schedule is switched on without its own GO.

## 4. Scheduled cleanup

`.github/workflows/media-cleanup.yml` is disabled by default (repository variables per environment, Production also needs
a typed confirmation). It runs `media-storage.mjs cleanup`: per-row, retry-safe, counts only, non-zero on any failure.
Verification evidence is never a candidate.

## 5. Minimum separately approved Acceptance steps

1. CLI dry run, then push of 20261102090001, 20261103090001, 20261103090002.
2. Deploy preview app and edge Worker (exact final commit); set R2 flags (account and bucket pinned).
3. Snapshot, seven-flow matrix, snapshot, compare.
4. Fresh backup and restore test of Acceptance; then reset plan/execute if approved.
5. Closure SQL last. Enable the cleanup schedule variable for Acceptance only if approved.
