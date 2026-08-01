# 05 — Storage Design

Every Supabase Storage bucket for the MVP. **Supabase Storage is the only media/file store** (ADR-0001/0004) — **not** Cloudinary. Buckets are **private by default**; public read is the explicit exception. Bucket policies mirror table RLS ([06](06_rls_strategy.md)) and are security-reviewed like DB policies.

## Conventions

- **Path template:** `<owner-scope>/<owner-id>/<entity>/<uuid>.<ext>` — e.g. `org/{organization_id}/products/{product_id}/{uuid}.webp`, `user/{user_id}/avatar/{uuid}.webp`.
- **Object names are UUIDs** (never user-supplied filenames) to avoid collisions/enumeration; original filename kept in the `media`/`documents` row.
- **Access:** private buckets are read via **short-lived signed URLs** issued server-side after an RLS/capability check. Public buckets serve directly.
- **Every object has a DB row** (`media` or `documents`) carrying `bucket`, `path`, `mime_type`, `size_bytes`, and tenancy columns — RLS is evaluated on that row.
- **Uploads** are validated (MIME + size + optionally magic-byte sniff) before the DB row is committed; heavy processing (OCR, transforms) runs async ([09](09_background_jobs.md)).

## Buckets

| Bucket | Purpose | Visibility | Path root | Max size | Allowed MIME | Retention |
|---|---|---|---|---|---|---|
| `avatars` | User profile photos | **public** (read) | `user/{user_id}/avatar/` | 5 MB | image/jpeg, image/png, image/webp | until replaced; purge on account deletion |
| `logos` | Organization logos | **public** (read) | `org/{organization_id}/logo/` | 5 MB | image/jpeg, image/png, image/webp, image/svg+xml | until replaced/org archived |
| `products` | Product images/spec images | **public** (read) | `org/{organization_id}/products/{product_id}/` | 10 MB | image/jpeg, image/png, image/webp | with product; purged on hard-delete |
| `reels` | Short product/portfolio videos | **public** (read) | `org/{organization_id}/reels/{product_id}/` | 50 MB (⚑ confirm) | video/mp4, video/webm | with product |
| `portfolio` | Professional portfolio media (engineers/designers) | **public** (read) | `user/{user_id}/portfolio/` | 10 MB img / 50 MB vid | image/*, video/mp4 | with profile |
| `documents` | Project/quote/spec documents | **private** | `org/{organization_id}/documents/` | 25 MB | application/pdf, image/*, xlsx, docx | per retention policy (⚑ OPEN) |
| `verification` | Verification evidence (registers, IDs, licenses) | **private (strict)** | `org/{organization_id}/verification/` · `user/{user_id}/verification/` | 25 MB | application/pdf, image/jpeg, image/png | retain while active + legal window (⚑ OPEN); never public, never cross-tenant |
| `projects` | Project execution files | **private** | `org/{organization_id}/projects/{project_id}/` | 25 MB | application/pdf, image/*, xlsx | with project |
| `attachments` | Conversation/message attachments | **private** | `org/{organization_id}/conversations/{conversation_id}/` | 25 MB | image/*, application/pdf, xlsx, docx | with conversation |
| `ad-creatives` | Advertisement creatives | **public** (read after approval) | `org/{organization_id}/ads/` | 10 MB | image/jpeg, image/png, image/webp | with advertisement |
| `exports` | Generated exports (Excel/PDF reports, quote PDFs) | **private (owner-only)** | `org/{organization_id}/exports/` · `user/{user_id}/exports/` | 25 MB | application/pdf, xlsx, csv | **short** — auto-purge after N days (⚑ default 7d) |

## Bucket policy rules (mirror table RLS)

- **Public buckets** (`avatars`, `logos`, `products`, `reels`, `portfolio`, `ad-creatives`): public **read**; **write/delete** only by the owning user/org membership with the relevant capability; `ad-creatives` are only public after the ad is `active` (moderated).
- **Private buckets** (`documents`, `verification`, `projects`, `attachments`, `exports`): read/write gated by the same org/branch/participant/capability checks as their DB rows. `verification` additionally: only the subject + platform reviewers (Support/Moderator/Admin per [07](07_permissions_matrix.md)); **never** cross-tenant, **never** public.
- `exports` are strictly owner-only (the requesting user/org) and short-lived.
- **service_role** may write to any bucket for worker outputs (OCR text is stored in DB, not re-uploaded; generated PDFs land in `exports`/`documents`).

## Upload validation (summary; full rules in [12](12_validation_rules.md))

- Reject on MIME mismatch, over-size, zero-byte, or disallowed extension.
- Strip EXIF from images where privacy matters (verification/avatars).
- Videos: duration/size caps (⚑ confirm limits).
- Filenames sanitized to UUIDs; the DB row stores the display name.

## Retention & cleanup

- Soft-deleted parents' objects are purged by the **retention purge job** ([09](09_background_jobs.md)) past their window.
- `exports` auto-purge on a schedule (short TTL).
- `verification` objects follow a legal/compliance retention window — **⚑ OPEN (product/legal decision)**; until decided, retain and never auto-purge.

## Open items

- ⚑ Video size/duration caps (`reels`, `portfolio`).
- ⚑ Retention windows for `documents`, `verification`, soft-deleted purges.
- ⚑ Whether image transforms use Supabase's built-in image transformation vs. an in-app worker (Cloudinary is **not** approved).
