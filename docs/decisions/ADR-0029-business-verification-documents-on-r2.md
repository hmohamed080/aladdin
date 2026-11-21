# ADR-0029 — Business-verification documents move to R2 (Supabase Storage holds no files)

**Status:** Proposed · 2026-11-17 · needs owner approval. Nothing in this ADR is built, migrated or deployed.

**Amends:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md), the bullet "Business-verification documents stay in Supabase Storage, unchanged" (and §7 item 1 of [r2-delivery-architecture.md](../operations/showroom-admin-handoff/r2-delivery-architecture.md)). ADR-0018 stays unchanged as history. Linked both ways.

## Purpose

Decide where the files of business-verification documents live, so that **R2 is the only place that stores files** and Supabase keeps only identity, tenancy, permissions and metadata (the target state of the media architecture v3).

## Current decision (proposed)

1. **Every verification document is stored in the private R2 bucket of its environment**, under the owner-scoped layout of the media architecture:
   - organization documents: `o/{organization_id}/verification/{document_id}/original.{ext}`;
   - personal documents (when a person, not an organization, is verified): `u/{user_id}/verification/{document_id}/original.{ext}`;
   - uploads are reserved at `pending/{upload_id}/` (2-day expiry, as for all media) and activated to the final key only after verification of type, size and hash.
2. **Delivery is by the existing `media-edge` Worker**, never by a public URL. Each read is authorized by Postgres at the moment of the request (the same rule as today, `app.can_read_bv_object`: organization managers, or reviewers for `ready` documents), then served with a short-lived ticket and `Cache-Control: private, no-store`. The route `/business-verification/file/<org>/<file>` stays as the browser entry point and now resolves through the Worker instead of Supabase Storage.
3. **Postgres stays the authority.** `media_storage_locations` gains one namespace for these documents (see the spec for the exact name and constraint change) and records `provider = 'r2'`. `business_verification_documents` keeps its columns; its `object_key` becomes the R2 key.
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

- `purchase-request-images` (ADR-0017 excludes it; a separate decision).
- Identity-document types, if the product adds them later (they would use the personal layout above and need their own retention rule).
- Any change to who may read a document: this ADR moves bytes, not permissions.

## Consequences

- A migration (namespace constraint, resolver, cleanup rules), changes to the upload and read code, a media-edge route for the new namespace, and the migration tool are new work. The spec lists them and the order.
- Until the migration of the existing files is finished, the old path keeps working for rows with `provider` absent or `supabase`; the two paths coexist.
- ADR-0018's statement that these documents are not in `media_storage_locations` and the edge Worker is superseded by this ADR once it is accepted.
- Production release needs the owner's approval for each stage (code, migration, copy, switch, retirement).

## Related files

[`docs/operations/r2/business-verification-documents-spec.md`](../operations/r2/business-verification-documents-spec.md) · `supabase/migrations/20261021090002_business_verification.sql` · `supabase/migrations/20261107090005_request_and_verification_media.sql` · `frontend/src/app/business-verification/file/[orgId]/[fileName]/route.ts` · `frontend/src/features/business-verification/parts.tsx` · `ops/backups/lib.sh` (`media_coverage`) · [ADR-0017](ADR-0017-rc2-private-media-integration.md) · [ADR-0018](ADR-0018-r2-edge-media-delivery.md)
