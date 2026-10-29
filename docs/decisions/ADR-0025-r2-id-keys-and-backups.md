# ADR-0025 — IDs-only R2 keys for new uploads, and independent encrypted backups

**Status:** Accepted (code) · 2026-10-29 · owner decisions ("Start Phase 1"; "Use stable IDs only, with separate user (`u/`) and organization (`o/`) namespaces", 2026-10-29). Nothing is active on a hosted project yet: each needs its own owner GO.

**Refines:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md) (R2 store and edge delivery; only the physical key layout changes). [ADR-0001](ADR-0001-approved-architecture.md) is unchanged.

## Context

- R2 keys were `<namespace>/<key>` with variants under `v/<namespace>/<key>/` and the upload stage under `pending/<namespace>/<key>`. A product key starts with an organization **or** publisher id, so one folder can mean either. No key could be listed by owner.
- Supabase Free has no daily backups, and a database backup never contains Storage bytes. The last Production backup was the manual one of 2026-10-25. R2's durability is not an independent copy.

## Decision

1. **Physical keys of new R2 uploads hold only stable ids**, under the owning user or organization:

   | Namespace | Key of the original |
   |---|---|
   | avatar (and cover) | `u/<user>/profile/<media id>/original.<ext>` |
   | portfolio | `u/<user>/portfolio/<media id>/original.<ext>` |
   | certificate | `u/<user>/certificates/<media id>/original.<ext>` |
   | product | `o/<org>/products/<product>/<media id>/original.<ext>`, or `u/<user>/products/...` for an independent publisher |
   | organization | `o/<org>/profile/<media id>/original.<ext>` |

   Variants: `<same folder>/v/<thumb|card|full>.webp`. Upload stage: `pending/<key>`. No account type, business name, username or display text ever enters a key.
2. **The database mints and records the key.** `media_storage_locations.storage_key` (migration `20261029090001`) is set by a trigger when the backend reserves a new R2 upload, checked against the ids-only shape, unique, and immutable. The logical identity `(namespace, object_key)` and every resolver are unchanged: **authorization is still decided by the database, never by the path.** The app reads the key through the service-role-only `media_storage_object`; the edge grant (`app.media_edge_grant`) returns it; the media Worker accepts it only in the folder that belongs to the ticket's namespace.
3. **Existing keys stay valid.** `storage_key` is NULL for every existing row and for rows the Supabase-to-R2 migration tool writes; they keep `<namespace>/<object_key>`. Nothing is moved, copied or deleted.
4. **Backups run outside the main repo** (private repo `aladdin-backups`, built from `ops/backups/`): a daily encrypted database dump and a copy of every Supabase Storage file into `aladdin-production-db-backups`, encrypted with age to an offline owner key and a restore-test key, written with If-None-Match and protected by R2 bucket locks (14 days daily, 8 weeks weekly, 12 months monthly, 35 days media). A monthly job restores the newest backup into a throwaway stack and checks schema, row counts and media sha256; a daily job alarms on a stale or shrunken backup.

## Not covered

- Video keys stay `video/<video id>/...` (ids only already; video is off and no video exists). Moving them under `u/`/`o/` is a follow-up if video ships.
- Backing up R2 media itself: Production media is on Supabase Storage today. When Production moves to R2, the media copy job gains an R2 source.

## Consequences

- One extra service-role lookup per R2 read, write or delete in the app proxy.
- Per-owner prefixes make a per-user or per-organization export, audit or delete a prefix operation; it still goes through the database records first.
- Production activation of backups is a separate owner GO (`PRODUCTION_BACKUP_ENABLED=true`). The migration reaches each hosted project only when the owner pushes it.
