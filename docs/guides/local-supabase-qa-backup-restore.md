# Local Supabase QA — backup & restore (Database + Storage)

Applies to the **isolated local stack only** (`project_id = aladdin-marketplace`, ports `544xx`). Never run any of this against staging or production.

## The trap this procedure avoids

The local Storage service stores each object's metadata (content type, cache control, …) in the file's **extended attributes**. Copying the Storage Docker volume with `cp -a` (or any tool that does not carry xattrs) leaves the rows in `storage.objects` and the bytes intact, but every `GET` then fails with **500 `ENODATA` — "The extended attribute does not exist"**. This happened during the Migration 07 session: the QA product image and the QA avatar had to be re-uploaded. The database volume has no such problem; **Storage objects must be moved through the Storage API**, which writes the metadata itself.

## Backup

1. **Database** (stack running):

   ```bash
   docker exec supabase_db_aladdin-marketplace pg_dump -U postgres -d postgres -Fc -f /tmp/qa.dump
   docker cp supabase_db_aladdin-marketplace:/tmp/qa.dump ./qa.dump
   ```

   Alternative: stop the stack (`pnpm supabase stop`, which keeps volumes) and copy the **database** volume `supabase_db_aladdin-marketplace` — safe, it holds no xattr-dependent files.

2. **Storage objects** (stack running) — read-only, API-based, checksummed:

   ```bash
   node scripts/local-storage-snapshot.mjs backup ./qa-storage
   node scripts/local-storage-snapshot.mjs verify ./qa-storage   # proves bytes + content type + row exist
   ```

   `backup` refuses to record an object the API cannot serve (a broken object is reported, not silently saved), and writes `manifest.json` with size, content type, cache control and SHA-256 per object.

Keep both artifacts together; the dump holds the `storage.objects` rows, the folder holds the files.

## Restore

1. Restore the database (`pnpm supabase db reset` to start from the migrations, then `pg_restore --clean --if-exists -d postgres` from the dump, or restore the database volume while the stack is stopped). The `storage.objects` rows come back with it.
2. Re-create the files through Storage:

   ```bash
   node scripts/local-storage-snapshot.mjs restore ./qa-storage
   ```

   `restore` uploads every object with its recorded content type and cache control (upsert) and then **verifies** each one: HTTP 200, same byte length, same SHA-256, matching content type.
3. Prove it:

   ```bash
   node scripts/local-storage-snapshot.mjs verify ./qa-storage
   ```

   It also confirms each object still has its `storage.objects` row and lists any object not in the backup.

## What was verified (and what deliberately was not)

- `backup` and `verify` were run read-only against the real QA data (Decore Store product image + avatar): 2/2 objects, checksums identical to the original bytes.
- `restore` was run **only into two disposable buckets** (`RESTORE_BUCKET_MAP=marketplace-product-images:qa-restore-probe-mkt,avatars:qa-restore-probe-av`), 2/2 restored and verified, then the buckets were emptied and dropped. No destructive restore was repeated on the valuable QA objects to test this document.
- Bucket definitions (public flag, size limit, allowed types) come from migrations (`db reset`) — they are not part of the object backup.

## Orphan check after any restore

```sql
select o.name from storage.objects o
where o.bucket_id = 'marketplace-product-images'
  and not exists (select 1 from public.marketplace_product_images i
                  where i.storage_bucket = o.bucket_id and i.object_key = o.name);
```

Must return no rows (see [`docs/database/marketplace-product-database.md`](../database/marketplace-product-database.md), Migration 07).