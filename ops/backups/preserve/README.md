# Source preservation of Supabase Storage (owner-run, one-off)

Gate S of the Production R2 plan: one encrypted, read-back-verified copy of every file in a project's Supabase Storage, taken BEFORE any copy to R2. Run on the owner's PC. Nothing here is scheduled and nothing writes to Supabase.

## Credential rules
- A Supabase Storage S3 key is a FULL Storage-access credential (read, write, delete), not read-only. Treat it that way: create it only for this run, revoke it right after.
- The copy script holds only that key. It refuses to start if a database URL, service-role key, R2 secret or age private key is in its environment.
- The database dump is a separate run (`db-backup.sh`, database URL only, own GO). The verify script holds only the age private key.
- Output stays local and encrypted (age, owner + restore-test public keys). Uploading it to R2 is a third step with an R2 write token only.

## Steps (each needs its own OWNER GO; none given yet)
1. Check the real Supabase egress allowance first (dashboard Usage). The Production run reads about 222 MB plus the 34 other objects.
2. Create the Storage S3 key (Dashboard > Storage > S3 connection). Note the region.
3. Copy (OUT_DIR must be new or empty: after a failed run use a fresh folder, never reuse the partial one):
   ```sh
   export PROJECT_REF=kkpkgjrweysgvhvkhzun S3_ENDPOINT=https://kkpkgjrweysgvhvkhzun.storage.supabase.co/storage/v1/s3 S3_REGION=<region>
   export AWS_ACCESS_KEY_ID=<key id> AWS_SECRET_ACCESS_KEY=<secret> AGE_RECIPIENTS="<owner pub> <restore-test pub>"
   export OUT_DIR=/d/preserve/production-<new date>/storage CONFIRM="preserve production media"
   bash ops/backups/preserve/storage-preserve.sh
   ```
4. Revoke the S3 key, close the shell, then verify with the owner private key only:
   ```sh
   AGE_IDENTITY_FILE=aladdin-backup-owner.key EXPECT_OBJECTS=1080 bash ops/backups/preserve/storage-preserve-verify.sh /d/preserve/production-20261110
   ```
   Pass means `RESULT: PASS`. Expected on Production today: 1,080 objects, 3 of them empty. If uploads happened meanwhile, the count is higher; compare `summary.json` start/finish times with the DB inventory.
5. Reconcile against the database inventory (`production-media-inventory.sql`): the 317 known missing records are baseline, not failures of this run.
6. Upload the folder to the Production backup bucket under its own non-expiring prefix (separate script and token, not built yet).

`upload-preserved.sh` (step 6) pushes the verified encrypted folder to the Production backup bucket under `source-preservation/<date>/`, holding only a temporary R2 write token, with conditional puts and a read-back check; `upload-preserved-test.sh` covers it offline (15 checks).

`storage-preserve-test.sh` proves the guards, the empty-object entries, the read-back and tamper detection offline (10 checks).
