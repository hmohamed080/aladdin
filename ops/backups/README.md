# Aladdin backups (Phase 1)

Daily encrypted backups of the database and of the media files in Supabase Storage, a monthly restore test and a daily freshness alarm. The job runs in a **separate private repo, `aladdin-backups`**. Its secrets are therefore out of reach of the main repo's workflows and PR branches. This folder is the tested source of that repo: `build-repo.sh` assembles it.

Status: built and tested locally (`selftest.sh`, 17 checks). **Not active anywhere yet.** Acceptance runs first. Production starts only after a separate owner GO (`PRODUCTION_BACKUP_ENABLED=true`).

## What runs

| Workflow | When | Does | Credentials it sees |
|---|---|---|---|
| Daily backup | 01:30 Cairo. Production daily after the GO; Acceptance on Sundays | `db-backup.sh` then `media-backup.sh`. Read-only on the project; writes new objects only | Database URL, service-role key (media read), R2 **write** token, age **public** keys |
| Backup freshness | 07:00 Cairo | `freshness.sh`: fails and emails if the newest backup is older than 26 h, less than half the previous size, or missing | R2 **read** token, Resend key |
| Monthly restore test | 06:00 Cairo on the 2nd | `restore-test.sh`: restores the newest backup into a throwaway local Supabase stack on the runner. Proves schema and row counts are exact, restores 20 random media files and checks their sha256 | R2 **read** token, restore-test **private** key |

Nothing in these workflows can write to a database, delete a backup or decrypt one, except the restore test. The restore test can decrypt but holds no write token.

## What is stored (bucket `aladdin-production-db-backups`)

```
db/<label>/daily/YYYY/MM/DD/aladdin-<label>-<UTC stamp>.tar.age   kept 14 days (locked 14)
db/<label>/weekly/YYYY/...                                         Sundays, kept 8 weeks (locked 56 days)
db/<label>/monthly/YYYY/...                                        the 1st, kept 12 months (locked 365 days)
db/.../<same name>.json                                            manifest: sha256, sizes, migration count, row counts; no row data
media/<label>/supabase/objects/<bucket>/<object id>-<etag>.age     every file once, encrypted; sha256 in object metadata; locked 35 days, never auto-deleted
media/<label>/supabase/inventory/YYYY/MM/DD/<stamp>.tsv.age        object id -> path -> backup key, for restores; kept 90 days
phase-a/                                                           the manual 2026-10-25 backup, untouched (no rule covers it)
```

Each `.tar.age` holds:
- `roles.sql`, `schema.sql`, `data.sql`: the Supabase CLI dump.
- `security-tail.out.sql`: exact grants, plus the storage and auth policies and triggers that `db dump` drops.
- `fingerprint.txt`, `columns.txt`, `history.txt`, `rowcounts.txt` (counts from the dump itself) and `SHA256SUMS`.

This is the same method as `scripts/hosted-db/production-rehearsal.sh`, whose restore of Production was proven exact on 2026-10-25.

Keys never contain names: database files are named by project and time; media by Storage's random object id.

## One-time setup (owner)

Each step is something only you can do (accounts, secrets, hosted settings). Nothing here touches Production data.

1. **Two age key pairs**, on your PC (`age` for Windows: `winget install FiloSottile.age`):
   ```sh
   age-keygen -o aladdin-backup-owner.key        # the recovery key: password manager + a printed copy, never online
   age-keygen -o aladdin-backup-restore-test.key # its private part goes ONLY into the restore-test environment
   ```
   The two `# public key: age1...` lines, space separated, become the repo variable `AGE_RECIPIENTS`. Every backup is encrypted to both keys. Losing the owner key is survivable while the restore-test key exists, and the other way round.
2. **Read the current bucket settings first** (Phase 0, read-only), and send me the output:
   ```sh
   pnpm exec wrangler r2 bucket lock list aladdin-production-db-backups
   pnpm exec wrangler r2 bucket lifecycle list aladdin-production-db-backups
   pnpm exec wrangler r2 bucket dev-url get aladdin-production-db-backups
   ```
3. **Lock and lifecycle rules** on `aladdin-production-db-backups`. `set` replaces every existing rule, which is why step 2 comes first:
   ```sh
   pnpm exec wrangler r2 bucket lock set aladdin-production-db-backups --file r2/backup-bucket-lock.json
   pnpm exec wrangler r2 bucket lifecycle set aladdin-production-db-backups --file r2/backup-bucket-lifecycle.json
   ```
   Once a lock is on, nobody can delete or overwrite a locked object until it expires, not even you, and the bucket cannot be emptied.
4. **Two R2 API tokens** (dashboard: R2, Manage API tokens), both limited to the bucket `aladdin-production-db-backups`:
   - `aladdin-backup-write`: *Object Read & Write*. It goes to `R2_BACKUP_WRITE_KEY_ID` / `R2_BACKUP_WRITE_SECRET`.
   - `aladdin-backup-read`: *Object Read only*. It goes to `R2_BACKUP_READ_KEY_ID` / `R2_BACKUP_READ_SECRET`.
5. **Database URLs**: Supabase dashboard, Connect, **Session pooler** (port 5432, IPv4), for Acceptance and later Production: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. The scripts open every query session read-only, and `pg_dump` only reads. The `postgres` role is used because the CLI's role dump needs it.
6. **Create the private repo** `aladdin-backups` (GitHub, New, Private, no template). Then build its contents and push:
   ```sh
   bash ops/backups/build-repo.sh ~/aladdin-backups
   cd ~/aladdin-backups && git init -b main && git add -A && git commit -m "Backup kit" \
     && git remote add origin https://github.com/hmohamed080/aladdin-backups.git && git push -u origin main
   ```
7. **Settings in `aladdin-backups`** (Settings, Environments; limit each to the `main` branch):

   | Where | Name | Value |
   |---|---|---|
   | Repo variables | `BACKUP_BUCKET` | `aladdin-production-db-backups` |
   | | `R2_ACCOUNT_ID` | your Cloudflare account id |
   | | `AGE_RECIPIENTS` | the two public keys from step 1 |
   | | `ALERT_EMAIL` | where alerts go |
   | | `PRODUCTION_BACKUP_ENABLED` | `false` (until the Production GO) |
   | Environment `backup-acceptance` | secrets `BACKUP_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_BACKUP_WRITE_KEY_ID`, `R2_BACKUP_WRITE_SECRET`; variable `SUPABASE_URL` | Acceptance values |
   | Environment `backup-production` | the same four secrets and `SUPABASE_URL` | Production values (can wait for the GO) |
   | Environment `backup-check` | secrets `R2_BACKUP_READ_KEY_ID`, `R2_BACKUP_READ_SECRET`, `RESEND_API_KEY` | |
   | Environment `restore-test` | secrets `R2_BACKUP_READ_KEY_ID`, `R2_BACKUP_READ_SECRET`, `AGE_RESTORE_TEST_IDENTITY` (the whole restore-test key file) | |

8. **Acceptance week**: Actions, *Daily backup*, Run workflow, label `acceptance`. Then *Monthly restore test*, label `acceptance`. The run summary shows the report. It must end with `RESULT: PASS`.

**Production activation is a separate GO.** After it: fill `backup-production`, set `PRODUCTION_BACKUP_ENABLED=true`, run *Daily backup* once with label `production`, then run the restore test with label `production`.

## Restoring for real

The restore test is a rehearsal of exactly this, run every month.

1. Pick the backup: the newest daily file before the incident, or a weekly or monthly one. Download it with the read token (`aws s3api get-object`, or the R2 dashboard). Check its sha256 against its `.json` manifest.
2. Decrypt it with the owner key and unpack it: `age -d -i aladdin-backup-owner.key -o b.tar <file>.tar.age && tar -xf b.tar`, then run `sha256sum -c SHA256SUMS` inside the folder.
3. Restore into a **new** Supabase project, never over the damaged one. In the same order as `restore-test.sh` step 4: `roles.sql` (parameter grants apart), `schema.sql`, `data.sql` with `session_replication_role = replica`, then `security-tail.out.sql`. Daily backups carry no role passwords: reset `media_edge_worker` and any other custom role afterwards.
4. Media: for every `storage.objects` row in the restored database, find its backup key in the newest inventory, decrypt the file, and upload it to the same bucket and path. Check the sha256 against the object metadata. A row whose file is not in the backup (deleted before the first backup ran) is reported, not left pointing at nothing.
5. Point the app at the new project only after the counts in `rowcounts.txt` match.

## Local test

```sh
pnpm exec supabase start                                     # a local stack with the demo seed
docker run -d --name backup-s3 -p 8333:8333 -v "$PWD/s3:/etc/s3" chrislusf/seaweedfs server -s3 -s3.config=/etc/s3/s3.json -volume.max=200
bash ops/backups/selftest.sh                                 # needs age, psql, aws (pip install awscli)
```

`s3/s3.json` holds one identity with keys `testkey` / `testsecret`. Every script refuses a hosted target under `BACKUP_LABEL=local-test`, and refuses a local target under a hosted label.

Last run (2026-10-29, with migration `20261029090001` included):
- 17 of 17 checks passed, both from this checkout and from the built `aladdin-backups` layout.
- The restore was exact: schema fingerprint and all 151 tables, 2,687 rows, and 2 of 2 media files with the recorded sha256.
- A corrupted copy, a wrong key, a replaced object and every target mix-up were refused.

The selftest uploads two small throwaway files to local Storage and removes them on exit.

## Cost

About $0 a month today. Roughly 0.3 GB is kept in R2 (10 GB free), and about 170 of the 2,000 free GitHub Actions minutes are used. A 2 GB database would still cost under $0.50 a month.
