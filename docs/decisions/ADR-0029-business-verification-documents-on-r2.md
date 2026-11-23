# ADR-0029 — Business-verification documents move to R2 (Supabase Storage holds no files)

**Status:** Accepted by the owner on 2026-11-23 (no exception: every file, including business-verification documents and `purchase-request-images`, lives in R2 only) · first written 2026-11-17. See "Implementation status" for what already exists and what is still open.

**Amends:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md), the bullet "Business-verification documents stay in Supabase Storage, unchanged" (and §7 item 1 of [r2-delivery-architecture.md](../operations/showroom-admin-handoff/r2-delivery-architecture.md)). ADR-0018 stays unchanged as history. Linked both ways.

## Purpose

Decide where the files of business-verification documents live, so that **R2 is the only place that stores files** and Supabase keeps only identity, tenancy, permissions and metadata (the target state of the media architecture v3).

## Owner decision (2026-11-23)

Production and Acceptance hold **all** media in R2 with the same architecture and the same security. No file is kept in Supabase Storage and no new write may enter it. This removes the `business-verification-documents` exception of ADR-0018 and the `purchase-request-images` exception of ADR-0017 / the "deferred" item below.

## Current decision

1. **Every verification document is stored in the private R2 bucket of its environment**, under the owner-scoped layout of the media architecture (these are the PHYSICAL keys; the logical `object_key` in the database does not change, see point 3):
   - organization documents: `o/{organization_id}/verification/{document_id}/original.{ext}`;
   - personal documents (when a person, not an organization, is verified): `u/{user_id}/verification/{document_id}/original.{ext}`;
   - uploads are reserved at `pending/{upload_id}/` (2-day expiry, as for all media) and activated to the final key only after verification of type, size and hash.
2. **Delivery is by the existing `media-edge` Worker**, never by a public URL. Each read is authorized by Postgres at the moment of the request (the same rule as today, `app.can_read_bv_object`: organization managers, or reviewers for `ready` documents), then served with a short-lived ticket and `Cache-Control: private, no-store`. The route `/business-verification/file/<org>/<file>` stays as the browser entry point and now resolves through the Worker instead of Supabase Storage.
3. **Postgres stays the authority.** `media_storage_locations` gains one namespace for these documents (see the spec for the exact name and constraint change) and records `provider = 'r2'`. `business_verification_documents` keeps its columns, and **its `object_key` stays the logical key** `<organization_id>/<uuid>.<ext>` (the shape the file route and `isBvKey` accept, and the key the resolver is called with). The **physical R2 key** is recorded separately in `media_storage_locations.storage_key` (`o/<organization_id>/verification/<media id>/original.<ext>`, uploaded first under `pending/`), so the browser entry point does not change.
4. **Existing files are migrated, not recreated.** A migration tool copies each Supabase object to its R2 key, checks size and SHA-256, flips `provider` in one step per object, and keeps the Supabase original for at least 30 days as the rollback source (the same rule as ADR-0018 §3). Nothing is deleted before a restore-tested backup covers the R2 copy.
5. **Backup covers the files through the existing R2 media backup** (`r2_required_originals` counts them). Once Supabase Storage is empty, the legacy Supabase media backup (`LEGACY_MEDIA_BACKUP`, which needs a service-role key the backup job intentionally does not have) is no longer needed and is switched off in every environment.
6. **The Supabase bucket `business-verification-documents` is retired last**, only after the 30-day window and an explicit owner approval. Its policies are removed with it.

## Rationale

- **One storage model.** Today a verification document is the only user file left that lives in Supabase Storage. That forces two read paths, two backups and two sets of policies for one product.
- **The backup gap this closed in practice.** On 2026-11-16 the Acceptance backup failed its coverage check because exactly one verification document sat in Supabase Storage with no independent copy. It was fixed by deleting a test file. Any new document would break the check again, and Production will hit it. R2 documents are covered by the backup that already works.
- **Separation of duties.** The backup job must not hold a Supabase service-role key. Keeping files in R2 removes the only reason a legacy step would need one.
- **Egress and cost.** R2 serves without egress charges; Supabase egress hit its quota once (ADR-0018 context).

## Scope

- Files of `business_verification_documents` (PDF, JPEG, PNG, WebP, up to 10 MB), upload, read, replace, delete, review and the admin review views that open them.
- The migration of existing rows and files in Acceptance and Production.
- The R2 backup and restore-test coverage of the new namespace.

## What is deferred

- ~~`purchase-request-images`~~: no longer deferred; covered by the owner decision of 2026-11-23 (the `request` namespace is already part of the central media system, migration `20261107090005`).
- Identity-document types, if the product adds them later (they would use the personal layout above and need their own retention rule).
- Any change to who may read a document: this ADR moves bytes, not permissions.

## Consequences

- A migration (namespace constraint, resolver, cleanup rules), changes to the upload and read code, a media-edge route for the new namespace, and the migration tool are new work. The spec lists them and the order.
- Until the migration of the existing files is finished, the old path keeps working for rows with `provider` absent or `supabase`; the two paths coexist.
- ADR-0018's statement that these documents are not in `media_storage_locations` and the edge Worker is superseded by this ADR once it is accepted.
- Production release needs the owner's approval for each stage (code, migration, copy, switch, retirement).

## Implementation status (verified read-only, 2026-11-23)

- **Already in the code and applied.** Migration `20261107090005_request_and_verification_media.sql` (on Production since the 210-migration state) extends `media_storage_locations` and the central media functions to the namespaces `request` and `verification`; `/api/media/[namespace]` accepts `verification`; `/business-verification/file/<org>/<file>` serves through `deliverMedia(..., "verification", key)`; the upload action asks `authorizeMediaUpload(..., "verification", ...)` for the provider. No front-end file uploads to the bucket directly.
- **Exercised on Acceptance.** One verification document (PDF, 2026-11-08) is recorded with `provider = r2`, verified. Another Acceptance document row (2026-11-04, PNG) is `ready` but has no `media_storage_locations` row and no object in Supabase Storage (which is empty there): a dangling reference to decide on.
- **Production data and end-to-end proof.** Before 2026-11-23 there were 0 documents and 0 objects in the bucket, so there was nothing to migrate. On 2026-11-23 (evening) the owner uploaded a verification document through the live site and submitted it: `business_verification_documents` holds one `ready` row (PNG, about 0.4 MB, `commercial_register`) with `provider = r2`, `verified_at`, `sha256` and an R2 key recorded, one submission, and an earlier replaced draft marked `deleted`. Supabase Storage stayed empty. This is the first real Production proof of the R2 path for this namespace (reserve, direct PUT to the private R2 bucket, server verification, submit).
- **Supabase side closed (Production, 2026-11-23).** `storage.objects` holds 0 files; the held activation `r2-only-storage-write-closure.sql` was applied, so no INSERT/UPDATE policy remains on the seven application buckets (including `bv_documents_insert_authorized`). Reads and deletes stay until the buckets are retired. Acceptance is not closed yet.
- **Acceptance verified end to end (2026-11-23).** The first Acceptance run failed: the browser PUT to the private bucket returned HTTP 503 and nothing was written, because the preview Worker signed with an R2 key that had no write permission (only a read-only token existed for that bucket). After the owner created a read-and-write token for the two Acceptance buckets and updated the two Worker secrets, uploads worked from two organization owners: each document is `ready`, `provider = r2`, with `verified_at`, `sha256` and an ids-only key (`o/<organization>/...`). Delivery checks, made with real sessions: the owner reads its own document (200, exact byte count, `cache-control: no-store, no-cache, must-revalidate, private`, `cdn-cache-control: no-store`, `x-content-type-options: nosniff`); an owner of another organization gets 404 for a ready document that exists; a Super Admin session reads both organizations' documents (200); an unknown document is 404. The database resolver also returned NULL (denied) for every member of the other organization.
- **Still open.** (1) A PDF upload (the 10-draft cap from earlier failed tries clears after an hour) and a `request` / certificate upload on Acceptance (the checklist is in `docs/operations/BV_DOCUMENTS_R2_ONLY_PLAN_20261123.md`); (2) the security review of that plan; (3) the closure on Acceptance; (4) retiring the empty buckets; (5) switching off `LEGACY_MEDIA_BACKUP` everywhere (done for Production's three environments).

## Related files

[`docs/operations/r2/business-verification-documents-spec.md`](../operations/r2/business-verification-documents-spec.md) · `supabase/migrations/20261021090002_business_verification.sql` · `supabase/migrations/20261107090005_request_and_verification_media.sql` · `frontend/src/app/business-verification/file/[orgId]/[fileName]/route.ts` · `frontend/src/features/business-verification/parts.tsx` · `ops/backups/lib.sh` (`media_coverage`) · [ADR-0017](ADR-0017-rc2-private-media-integration.md) · [ADR-0018](ADR-0018-r2-edge-media-delivery.md)
