# R2-only media: Stage 3 (request photos, verification documents, lifecycle, closure)

Status: local implementation, draft PRs, nothing applied or deployed. Decision of 2026-11-01: no application files in
Supabase Storage; R2 is the only store for new bytes.

## What moved to R2

| Flow | Namespace | Physical key (ids only) | Authorization (database, never the path) |
|---|---|---|---|
| Purchase-request photo | `request` | `u/<user>/requests/<request>/<id>/original.<ext>` or `o/<org>/requests/<request>/<id>/original.<ext>` | upload: requester side while the request is a draft; read: requester side, or a workspace that may read the request right now (`app.request_image_viewable`) |
| Business-verification document | `verification` | `o/<org>/verification/<id>/original.<ext>` | upload/delete: `org.manage` and an unsubmitted draft; read: `org.manage`, or a reviewer of a **ready** document (`app.can_read_bv_object`) |

Both reuse reservation, verification receipt (type, size, SHA-256), resolver, ids-only key trigger and cleanup of the other
five namespaces (migration `20261103090002`, `create or replace` only: no signature or grant changes). Compliance rules are
unchanged: a document attached to a submission is evidence, cannot be removed, is never a cleanup candidate and is never
excluded from a media backup.

Delivery: application proxy `/api/media/request`, `/business-verification/file/<org>/<file>` (unchanged URL), and the private
edge Worker (`/m/request|verification/original`). The ticket carries the viewing workspace for `product`, `organization`
and `request` only. Verification documents are never stored in the edge byte cache. `media_edge_authorize` re-runs the
same resolvers on every request.

Failure behaviour: R2 down or disabled fails the upload action (no fallback to Supabase). A failed byte delete after a
removal is reported to the user and retried by the cleanup tool (the record is already retired).

## Lifecycle

`scripts/media-storage.mjs cleanup`: candidates (deleted rows and pending uploads older than 24 h) -> `media_cleanup_retire`
-> delete original, `pending/` copy and variants -> read back, original must be absent -> `media_cleanup_complete`. One
row's failure never stops the others; the command exits non-zero when any row failed; rerunning is safe. The dry run prints
counts per provider and namespace only.

## Held, not applied

- `supabase/activation/r2-only-storage-write-closure.sql` (+ rollback): drops INSERT/UPDATE policies on `storage.objects`
  for the seven application buckets after saving their exact definitions. CI proves it closes every bucket and that the
  rollback restores the exact policies. Preconditions in `supabase/activation/README.md`. Activate only after every upload
  path above is live and verified on that environment.
- `scripts/media-reset-execute.mjs` removes Storage objects only, disabled by default, gated (see stage3-acceptance-readiness.md). `scripts/media-reset.mjs` is read-only: `inventory` (counts, retained items, scope, SHA-256), `snapshot` and `compare`
  (before/after per-bucket object counts; fails if any bucket grew). It has no delete mode. Any deletion of hosted media
  needs a separate approval of a refreshed inventory (including files uploaded after 2026-10-25) and a reviewed execution
  path; the existing reviewed purge (avatars and portfolio only) is not extended here.

## Existing Supabase documents (legacy)

Request photos and verification documents already stored in Supabase Storage keep working through the legacy provider
(reads and deletes). They are neither moved nor deleted by this work. Retirement or migration of compliance documents is a
separate, approved plan.


Next steps (reset executor, legacy retirement, seven-flow matrix, backups): [stage3-acceptance-readiness.md](stage3-acceptance-readiness.md).
