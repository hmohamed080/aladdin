# Business-verification documents on R2: specification

**Status:** Accepted with [ADR-0029](../../decisions/ADR-0029-business-verification-documents-on-r2.md) (owner decision, 2026-11-23). This text was written on 2026-11-17 as a proposal and describes the work as if nothing existed; **much of it is already built and applied** (migration `20261107090005`, the `verification` namespace in `/api/media`, the upload action and the file route; verified on Production and Acceptance on 2026-11-23). Read ADR-0029 "Implementation status" first; where this spec and the ADR differ, the ADR wins.

## Purpose

Say exactly what changes, in what order and with which gates, so the files of business-verification documents live only in R2 and Supabase Storage holds none.

## Today (as first written, 2026-11-16/17; superseded by the implementation status in ADR-0029)

| Item | Fact |
|---|---|
| Table | `public.business_verification_documents` (`20261021090002`): `object_key` unique, `doc_type`, `content_type` (PDF/JPEG/PNG/WebP), `size_bytes` 1 to 10 MB, `state` in `pending/ready/deleted` |
| Storage | private Supabase bucket `business-verification-documents`, key `{organization_id}/{file}` |
| Authorization | `app.can_read_bv_object` (organization managers, or reviewers for `ready` documents), policies `bv_documents_*` |
| Read path | route `/business-verification/file/[orgId]/[fileName]`, a caller-signed 30 s URL streamed by the app |
| Registry | `20261107090005` allows the namespace `verification` in `media_storage_locations`; new documents are recorded there with `provider = r2` (verified 2026-11-23). Only legacy rows have no record |
| Backup | counted as "Supabase Storage objects" (`storage_objects` in the snapshot manifest). With the legacy media backup off, any such file makes `Verify complete coverage` fail. Acceptance, 2026-11-16: one test document, removed by the owner |

## Target layout (R2, private bucket per environment)

```
o/{organization_id}/verification/{document_id}/original.{ext}     organization documents
u/{user_id}/verification/{document_id}/original.{ext}             personal documents (if used)
pending/{upload_id}/                                              reserved upload, expires after 2 days
```

Names carry ids only (no file name, no document type), as for all media. The original file name stays in `business_verification_documents.file_name`. These are PHYSICAL keys (`media_storage_locations.storage_key`); `business_verification_documents.object_key` stays the logical key `<organization_id>/<uuid>.<ext>` that the file route and the resolver use.

## Work items

1. **Database (one migration, additive).**
   - Reuse the existing `verification` namespace of `media_storage_locations` if its resolver can express "organization document"; otherwise add `business_verification` to `media_storage_locations_namespace_check`. Decide in review, then write the contract (`supabase/permissions/<version>.json`) like any function change.
   - `media_storage_resolve` / `media_edge_authorize` learn the namespace and call the existing `app.can_read_bv_object` rule. No new reader. No public exposure.
   - Cleanup candidates and retire functions cover the namespace (a `deleted` document is removed from R2 after its retention period).
2. **Upload.** The browser upload (`browser-upload`) reserves a `pending/` key, uploads, then the server activates after type/size/SHA-256 checks and writes `object_key`. Same flow as the other media namespaces. The Supabase upload branch is kept only for rollback and is closed when the switch flips.
3. **Read.** `/business-verification/file/...` resolves the document, asks Postgres, and returns a media-edge ticket redirect or stream. Headers: `private, no-store`, no CDN caching, no public URL.
4. **Migration tool** (extend `scripts/media-storage.mjs`): inventory, copy to the R2 key, compare size and SHA-256, flip `provider` per object, report. Idempotent and resumable. The Supabase original stays for at least 30 days.
5. **Backup.** The existing R2 media backup counts the namespace in `r2_required_originals`. After the copy and one restore test, switch `LEGACY_MEDIA_BACKUP` off everywhere (Production currently has it on in all three environments, which fails the final preflight).
6. **Retire** the Supabase bucket and `bv_documents_*` policies in a last migration, only with the owner's approval after the 30-day window.

## Order and gates (nothing runs without the owner's approval)

| Stage | Where | Gate |
|---|---|---|
| A. Code and migration merged | main | CI green (`migration-policy`, `supabase-rls`, permission contract) |
| B. Apply to Acceptance | Acceptance | fresh restore-tested backup first; gate plan reviewed |
| C. Test upload, read, review, delete | Acceptance | owner sign-off on a real document flow |
| D. Copy existing files | Acceptance, then Production | dry run first; counts and hashes equal; backup restore test after |
| E. Switch reads and writes to R2 | Acceptance, then Production | flag change, rollback = flip back (Supabase originals intact) |
| F. Switch off `LEGACY_MEDIA_BACKUP` | all environments | restore test passes with R2 coverage only |
| G. Retire the Supabase bucket | Production | 30 days after E, explicit approval |

## Risks and mitigations

- **A document unreadable during the switch:** reads fall back to Supabase while `provider` is absent or `supabase`; the flip is per object after verification.
- **Reviewer access regression:** the authorization function is reused, not rewritten; pgTAP tests cover manager, reviewer, other organization, `pending` and `deleted`.
- **Backup coverage gap in between:** until stage F, Production keeps the legacy step on; the Acceptance backup is clean only while Storage is empty.

## Open questions for the owner

1. Reuse the `verification` namespace or add `business_verification`?
2. Retention of `deleted` documents in R2 (proposal: 30 days).
3. Are personal (non-organization) identity documents in scope now?
4. Production file count to migrate: not yet measured (read-only inventory is the first task of stage D).

## Related files

[ADR-0029](../../decisions/ADR-0029-business-verification-documents-on-r2.md) · [ADR-0018](../../decisions/ADR-0018-r2-edge-media-delivery.md) · [r2-delivery-architecture.md](../showroom-admin-handoff/r2-delivery-architecture.md) · `ops/backups/lib.sh` · `ops/backups/README.md`
