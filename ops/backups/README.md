# Aladdin backups (Phase 1)

This kit takes daily encrypted backups of the database and of the media files in Supabase Storage. A monthly restore test checks them, and a daily freshness alarm watches them. The job runs in a **separate private repo, `aladdin-backups`**, so its secrets are out of reach of the main repo's workflows and PR branches. This folder is the tested source of that repo: `build-repo.sh` assembles it. Decision record: [ADR-0027](../../docs/decisions/ADR-0027-r2-id-keys-and-backups.md).

Status: built and tested locally. **Not active anywhere yet.** Acceptance runs first, after its own GO. Production starts only after a separate owner GO.

## What runs

| Workflow | When | Does | Credentials it sees |
|---|---|---|---|
| Daily backup | Fires at 22:30 and 23:30 UTC. `plan.sh` keeps the firing that is 01:30 Cairo, in summer and in winter | `db-backup.sh`, then `media-backup.sh`. Read-only on the project; it only writes new objects | Database URL, service-role key (media read), R2 **write** token, age **public** keys |
| Backup freshness | 05:00 UTC (07:00 or 08:00 Cairo) | `freshness.sh` for every active project. It fails and emails when the newest backup is older than the limit, less than half the size of the one before, missing, or when that snapshot's media step did not finish complete | R2 **read** token, Resend key |
| Monthly restore test | 04:00 UTC on the 2nd | `restore-test.sh`: restores the newest backup, or any retained snapshot you name, into a throwaway local Supabase stack on the runner (details below) | R2 **read** token, restore-test **private** key |

The restore test proves three things:
- the schema and every table's row count are exact;
- the snapshot's media inventory lists exactly the files that database references;
- a sample of those files restores with the recorded size and sha256.

Nothing in these workflows can write to a database or delete a backup. Only the restore test can decrypt, and it holds no write token.

### Which projects a run covers

`plan.sh` decides; `plan-test.sh` tests it offline (39 checks, also run in the main repo's CI).

- **Production** is backed up only when the repository variable `PRODUCTION_BACKUP_ENABLED` is exactly `true`. A manual Production run also needs the typed confirmation `back up production`. `db-backup.sh` and `media-backup.sh` refuse a Production label without the same variable, so the gate holds even if a workflow is edited.
- **Acceptance** follows `ACCEPTANCE_BACKUP_SCHEDULE`:
  - `off` (default): no scheduled runs and no freshness check;
  - `daily`: the trial; freshness allows 26 h;
  - `weekly`: Sundays, Cairo; freshness allows 8 days.
  
  A manual Acceptance run is always allowed.
- **Cairo time:** Egypt changes the clock on the last Friday of April and the last Thursday of October. Two cron firings, plus "Cairo hour 01 to 03 counts", put the backup at 01:30 Cairo all year. In summer both firings count, and the second one finds today's backup and does nothing (`SKIP_IF_TAKEN`). `plan-test.sh` prints the real firings around both changes (UTC to Cairo):
  - 2026-04-23 22:30 UTC is 01:30 Cairo (summer time from that day), and it runs.
  - 2026-10-29 22:30 UTC is 00:30 Cairo, and it is skipped.
  - 2026-10-29 23:30 UTC is 01:30 Cairo (winter time from that night), and it runs.

### Wrong-project protection

Each label is pinned to its project in `lib.sh`. Production is `kkpkgjrweysgvhvkhzun`; Acceptance is `nxossqhdfltcqdwvbewi`. Each run checks, before any request:

- **Database URL:** user `postgres.<ref>` on `*.pooler.supabase.com:5432`, or `db.<ref>.supabase.co`. The transaction pooler (6543) is refused.
- **`SUPABASE_URL`:** exactly `https://<ref>.supabase.co`.
- **Service-role key:** a JWT key must name the same `ref` and role `service_role`. A newer `sb_secret_` key carries no project, so it is bound by the URL check.
- **Bucket:** each label has its own, checked in `lib.sh` (`expected_bucket`): Production `aladdin-production-db-backups`, Acceptance `aladdin-acceptance-backups`, with an R2 endpoint. Acceptance and Production share no bucket, token, rule file or GitHub environment.
- **Manifests:** every manifest records `label` and `project_ref`. The restore test refuses a backup of another label or project.

## What is stored (one bucket per project: Production `aladdin-production-db-backups`, Acceptance `aladdin-acceptance-backups`; same layout in both)

```
db/<label>/daily/YYYY/MM/DD/aladdin-<label>-<UTC stamp>.tar.age     kept 15 days (locked 14)
db/<label>/weekly/YYYY/...                                          Sundays, kept 57 days (locked 56)
db/<label>/monthly/YYYY/...                                         the 1st, kept 366 days (locked 365)
  <same name>.json          manifest: label, project ref, sha256, sizes, migrations, row and media counts; no row data
  <same name>.r2media.tsv.age / .r2media.json    the same for the R2-hosted originals (independent media backup)
  <same name>.media.tsv.age / .media.json        LEGACY, opt-in: Supabase Storage files (LEGACY_MEDIA_BACKUP=1)
media/<label>/r2/<YYYYMM>/objects/<sha256>.age   R2 originals, encrypted, named by hash only; a monthly generation,
                                                 EXPIRES after 90 days (no long lock)
media/<label>/supabase/objects/<bucket>/<id>-<etag>.age   LEGACY copies, only if switched on; EXPIRE after 30 days
phase-a/                                                            the manual 2026-10-25 backup, untouched (no rule covers it)
```

The media inventories of a snapshot sit next to its database backup, so they live as long as it does; the media COPIES live shorter (below).

### Retention: database 366 days, media copies 90, guaranteed full restore 59

| Part of a snapshot | Lives | Why |
|---|---|---|
| Database (`.tar.age`, `.json`) | daily 15 d, weekly 57 d, monthly 366 d | locks 14 / 56 / 365 days |
| Inventory (`*.tsv.age`, `*.json`) | as long as its snapshot | tiny; proves what existed |
| R2 media copies | 90 days **after the copy is written** | bounded on purpose: removed personal media leaves the backup |
| Legacy Supabase copies (opt-in) | 30 days after written | time-boxed recovery only |

A copy is written at the first run that needs it in its monthly generation, so a snapshot can rely on a copy up to 31 days older than itself. The **guaranteed full restore window (database plus files) is therefore 59 days** for R2 media (90 minus 31), and for legacy copies there is none beyond the day of the snapshot. A weekly (57 d) snapshot is always inside it; **a monthly snapshot older than 59 days is a database-only restore**: its inventory is still compared with the restored database exactly, and `media-verify.sh` reports `DATABASE-ONLY` and counts the copies that already expired instead of failing, while every copy that still exists must be intact. `retention-test.sh` fails if the rule files, the constants in `lib.sh` and this section disagree.

### Two media backups, and why their retention differs

User photos and videos are personal data, and the owner decided to delete the legacy user media from Supabase Storage for good. So:

| | R2 media backup (new, independent) | Legacy Supabase-Storage media backup |
|---|---|---|
| Switch | `R2_MEDIA_BACKUP=1` (variable) | `LEGACY_MEDIA_BACKUP=1`, **off by default** |
| Covers | verified originals in the R2 media bucket (`media_storage_locations`, provider r2) | `storage.objects` files with bytes |
| Source access | a **read-only** token on the media bucket, different from the write token of the backup bucket | the project's service role (read) |
| Retention | monthly generation, expires after **90 days**; a user's removed original leaves the backup within about 90 days | **30 days** at most, and only for a documented, time-boxed recovery need |
| Lock | none (a lock would keep deleted personal media) | none |
| Existing retention | the pre-existing `phase-a/` archive (database only, no media) is untouched and not covered by any rule; database snapshots keep their own 14 d / 8 w / 12 m locks | no legacy media was ever backed up, so there is nothing long-lived to unwind |

The source bytes must hash to the sha256 the database recorded at upload verification, or the file is a failure and nothing is stored for it. Derivatives (thumb/card/full) are regenerated from originals, and `pending/` uploads are unverified, so neither is copied. If you need a deleted original back after 90 days, it is not recoverable by design.

Restore verification (`media-verify.sh`, run by the restore test for each switched-on kind) compares the inventory with the restored database on identity (object id, bucket and path for legacy; physical key and sha256 for R2), size and copy key, checks that every copy exists with its recorded size, and decrypts a sample and compares its sha256.

The inventory is built from the dump itself (`snapshot-objects.py` reads the `storage.objects` rows in `data.sql`), so it matches that exact snapshot.

A file deleted between the dump and the copy is found by its earlier copy. A file that was never copied is marked `MISSING`; the snapshot is marked incomplete, the run fails, and the freshness alarm reports it.

Each `.tar.age` holds:
- `roles.sql`, `schema.sql`, `data.sql`: the Supabase CLI dump;
- `security-tail.out.sql`: exact grants, plus the storage and auth policies and triggers that `db dump` drops;
- `fingerprint.txt`, `columns.txt`, `history.txt`, `rowcounts.txt` (counts from the dump itself) and `SHA256SUMS`.

This is the same method as `scripts/hosted-db/production-rehearsal.sh`, whose restore of Production was proven exact on 2026-10-25.

Keys never contain names. Database files are named by label and time, and media files by Storage's random object id.

### Media in R2, and website assets

R2's durability is not a second copy: a deleted or overwritten object is gone. `r2-media-backup.sh` therefore copies every verified R2 original (`media_storage_locations`, provider r2) into the project's own backup bucket, a different bucket from the media bucket, read through a read-only token (`R2_MEDIA_BACKUP=1`). Until it is switched on, every snapshot records `r2_media_records_not_covered`; the freshness alarm fails for Production when that number is above 0 and only warns for Acceptance.

Source-of-truth for what must be recoverable, and where its independent copy comes from:

| Content | Primary | Independent recovery source |
|---|---|---|
| Landing videos `1.mp4`-`5.mp4` and thumbnails `1.jpg`-`5.jpg`, website static assets | public bucket, served by CDN | the git repository (`frontend/public/preview/landing/videos/`, deleted from the tree only after R2 playback is verified) plus the media backup if the assets are registered in the Asset Registry |
| Certificates, verification evidence, business documents | private media bucket | the encrypted R2 media backup above (90-day generations; see the window rules) |
| User photos and videos (new, R2) | private media bucket | the same media backup |
| Legacy user photos and videos in Supabase Storage | scheduled for deletion | **none, on purpose**; `LEGACY_MEDIA_BACKUP` stays off |

## One-time setup (owner)

Part A is read-only preparation and changes nothing hosted. Part B changes hosted settings; do it only after the Acceptance GO. Part C needs the separate Production GO.

### A. Read-only preparation

1. **Two age key pairs**, on your PC (`age` for Windows: `winget install FiloSottile.age`):
   ```sh
   age-keygen -o aladdin-backup-owner.key        # the recovery key: password manager + a printed copy, never online
   age-keygen -o aladdin-backup-restore-test.key # its private part goes ONLY into the restore-test environment
   ```
   The two `# public key: age1...` lines, space separated, become `AGE_RECIPIENTS`. Every backup is encrypted to both keys, so losing one of them is survivable.
2. **Read the current bucket settings** (read-only) of `aladdin-production-db-backups` and send me the output; `aladdin-acceptance-backups` does not exist yet:
   ```sh
   pnpm exec wrangler r2 bucket lock list aladdin-production-db-backups
   pnpm exec wrangler r2 bucket lifecycle list aladdin-production-db-backups
   pnpm exec wrangler r2 bucket dev-url get aladdin-production-db-backups
   pnpm exec wrangler r2 object list aladdin-production-db-backups --prefix phase-a/   # or the R2 dashboard
   ```
   Already confirmed by the owner (2026-10-31): no lock rules, only the default 7-day multipart-abort rule, r2.dev disabled, `phase-a/` holds the encrypted rehearsal archive and its SHA256 sidecar.
3. **Find the Acceptance database URL**: Supabase dashboard, Acceptance project, Connect, **Session pooler** (port 5432, IPv4): `postgresql://postgres.nxossqhdfltcqdwvbewi:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. The scripts open every query session read-only, and `pg_dump` only reads.

### B. Hosted changes for the Acceptance trial (after the Acceptance GO)

4. **Create the Acceptance backup bucket, then rules** (one file set per bucket; `set` replaces every existing rule, so compare with step 2 first):
   ```sh
   pnpm exec wrangler r2 bucket create aladdin-acceptance-backups                 # Acceptance only; new, private, no public access
   pnpm exec wrangler r2 bucket lifecycle set aladdin-acceptance-backups --file r2/acceptance/lifecycle.json
   # Production bucket: only at the Production GO
   pnpm exec wrangler r2 bucket lock set aladdin-production-db-backups --file r2/production/lock.json
   pnpm exec wrangler r2 bucket lifecycle set aladdin-production-db-backups --file r2/production/lifecycle.json
   ```
   Once a lock is on, nobody can delete or overwrite a locked object until it expires, not even you. Only Production database snapshots are locked; the Acceptance trial bucket has no lock (it is disposable), and media copies are never locked (R2 90 days, legacy 30). `phase-a/` is left as it is. The Production bucket has no lock rules and only the default 7-day multipart-abort rule, which its lifecycle file repeats.
5. **R2 API tokens, per project** (dashboard: R2, Manage API tokens). Each token is limited to ONE backup bucket; create the Acceptance pair first and the Production pair only at the Production GO:
   - `aladdin-acceptance-backup-write` / `-read` on `aladdin-acceptance-backups`, and `aladdin-production-backup-write` / `-read` on `aladdin-production-db-backups`. *Write* is Object Read & Write, *read* is Object Read only. They become `R2_BACKUP_WRITE_KEY_ID` / `R2_BACKUP_WRITE_SECRET` and `R2_BACKUP_READ_KEY_ID` / `R2_BACKUP_READ_SECRET` in that project's environments only.
   - `R2_MEDIA_READ_*`: *Object Read only* on that project's media bucket (Acceptance: `aladdin-r2-acceptance-20261011-private`). Never the backup bucket.
6. **The private repo** `hmohamed080/aladdin-backups` exists. Its contents are built from this folder, which stays the only source (never edit the built repo by hand):
   ```sh
   bash ops/backups/build-repo.sh ~/aladdin-backups              # inactive build: no schedule trigger in any workflow
   cd ~/aladdin-backups && git add -A && git commit -m "Backup kit" && git push -u origin main
   ```
   At the activation GO, rebuild with `--scheduled` to turn the nightly, freshness and monthly triggers on.
7. **Settings in `aladdin-backups`.** Under Settings, Environments, limit each environment to the `main` branch. If your plan allows it, add yourself as a *required reviewer* on `backup-production`. Everything project-specific lives in **per-project environments**, so a workflow for one project cannot read the other's values; the repo level only holds the two switches the planner reads.

   | Where | Name | Value |
   |---|---|---|
   | Repo variables | `PRODUCTION_BACKUP_ENABLED` | `false` |
   | | `ACCEPTANCE_BACKUP_SCHEDULE` | `daily` for the trial (`off` stops it) |
   | Environment `backup-acceptance` | variables `BACKUP_BUCKET` = `aladdin-acceptance-backups`, `R2_ACCOUNT_ID`, `AGE_RECIPIENTS` (the two public keys from step 1), `SUPABASE_URL` = `https://nxossqhdfltcqdwvbewi.supabase.co`, `R2_MEDIA_BACKUP` = `1` once the media backup is wanted, `R2_MEDIA_SOURCE_BUCKET` = `aladdin-r2-acceptance-20261011-private`; `LEGACY_MEDIA_BACKUP` unset (off) | Acceptance only |
   | | secrets `BACKUP_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_BACKUP_WRITE_KEY_ID`, `R2_BACKUP_WRITE_SECRET`, `R2_MEDIA_READ_KEY_ID`, `R2_MEDIA_READ_SECRET` | |
   | Environment `backup-check-acceptance` | variables `BACKUP_BUCKET`, `R2_ACCOUNT_ID`, `ALERT_EMAIL`, `R2_MEDIA_BACKUP`; secrets `R2_BACKUP_READ_KEY_ID`, `R2_BACKUP_READ_SECRET`, `RESEND_API_KEY` | |
   | Environment `restore-test-acceptance` | variables `BACKUP_BUCKET`, `R2_ACCOUNT_ID`, `R2_MEDIA_BACKUP`; secrets `R2_BACKUP_READ_KEY_ID`, `R2_BACKUP_READ_SECRET`, `AGE_RESTORE_TEST_IDENTITY` (the whole restore-test key file) | |
   | The same three environments for Production | `backup-production`, `backup-check-production`, `restore-test-production`, with the Production bucket, Production `SUPABASE_URL`, Production tokens and a **different** restore-test key | created only at the Production GO |

8. **Acceptance trial** (7 nights), in this order:
   - Run *Daily backup* manually with label `acceptance`, then *Backup freshness*, then *Monthly restore test* with label `acceptance`. Each run summary must end with `RESULT: PASS`.
   - Then let the schedule run nightly. Check that each night's daily backup exists and that freshness stays green.

### C. Production (only after the separate Production GO)

9. Create the three Production environments from the table above (`SUPABASE_URL` = `https://kkpkgjrweysgvhvkhzun.supabase.co`, bucket `aladdin-production-db-backups`), apply the Production lock and lifecycle rules, then set `PRODUCTION_BACKUP_ENABLED=true`.
10. Run *Daily backup* with label `production` and the confirmation `back up production`.
11. Run the restore test with label `production`.

## Acceptance validation and rollback

Each check below must pass:
- **Manual backup:** both steps green. The `.json` manifest says `"label":"acceptance","project_ref":"nxossqhdfltcqdwvbewi"`, and the `.media.json` says `"complete":true`.
- **Restore test:** `RESULT: PASS`. Schema and row counts are exact, the inventory is exact, and the sampled media restore.
- **Wrong-project test:** temporarily put the Production URL into `backup-acceptance`. The run must stop at "is not the acceptance project" before any request. Then put the Acceptance URL back.
- **Nightly runs:** for 7 nights, one Acceptance snapshot per Cairo night (summer and winter alike) and green freshness.
- **Freshness alarm:** set `ACCEPTANCE_BACKUP_SCHEDULE=off` for one night. Freshness checks nothing, which is expected. Then run freshness manually with the schedule set back to `daily` and `MAX_AGE_HOURS` low, and confirm the alert email arrives.

Rollback: set `ACCEPTANCE_BACKUP_SCHEDULE=off`. Nothing else runs on its own.
- The backups never write to Acceptance. Turning them off leaves nothing to undo there.
- Objects already written stay until their lock and expiry pass. Daily copies go after about 15 days. Media copies are not locked and expire on their own (R2 generations after 90 days, legacy copies after 30).
- If the lock or lifecycle rules have to go, `wrangler r2 bucket lock set` and `lifecycle set` with an empty rule list remove them. Objects that are already locked stay locked until their own expiry.
- Revoke the two tokens to cut all access.

## Restoring for real

The restore test is a rehearsal of exactly this, run every month.

1. **Pick the snapshot.** Take the newest daily backup before the incident, or a weekly or monthly one. Download its `.tar.age`, `.json`, `.media.tsv.age` and `.media.json` with the read token. Check the sha256 against the `.json` manifest, and check that `project_ref` is the project you are restoring.
2. **Decrypt and unpack** with the owner key: `age -d -i aladdin-backup-owner.key -o b.tar <file>.tar.age && tar -xf b.tar`. Then run `sha256sum -c SHA256SUMS` inside the folder.
3. **Restore into a new Supabase project**, never over the damaged one. Use the order of `restore-test.sh` step 4:
   - `roles.sql` (parameter grants apart);
   - `schema.sql`;
   - `data.sql` with `session_replication_role = replica`;
   - then `security-tail.out.sql`.
   
   Daily backups carry no role passwords, so reset `media_edge_worker` and any other custom role afterwards.
4. **Media:** decrypt the snapshot's `.media.tsv.age`. For every line (object id, bucket, path, size, backup key), decrypt the backup copy and upload it to the same bucket and path. Check the size and the sha256 against the copy's metadata. The inventory lists exactly the snapshot's `storage.objects` rows.
5. **Switch over:** point the app at the new project only after the counts in `rowcounts.txt` match.

**Limits:**
- Data written after the chosen snapshot is lost. The worst case is about one day, because backups are daily.
- Media uploaded and deleted within the same day may never have been copied.
- A snapshot older than 59 days restores the database only; its media copies may have expired (see Retention).
- Auth users' sessions do not survive a restore; people sign in again.

## Local test

```sh
pnpm exec supabase start                                     # a local stack with the demo seed
docker run -d --name backup-s3 -p 8333:8333 -v "$PWD/s3:/etc/s3" chrislusf/seaweedfs server -s3 -s3.config=/etc/s3/s3.json -volume.max=200
bash ops/backups/selftest.sh                                 # needs age, psql, aws (pip install awscli)
bash ops/backups/plan-test.sh                                # offline: schedule, Production gate, target checks
bash ops/backups/retention-test.sh                           # offline: rules, constants, buckets and the 59-day window agree
```

`s3/s3.json` holds one identity with keys `testkey` / `testsecret`. Every script refuses a hosted target under `BACKUP_LABEL=local-test`, and refuses a local target under a hosted label. The selftest uploads small throwaway files to local Storage and removes them on exit.

Last run: see the PR. The run covers:
- an exact restore of the newest and of an older snapshot;
- a file deleted after the older snapshot, restored from it;
- an incomplete media run, which is detected;
- a second firing on the same day, which does nothing;
- tampering, a wrong key, overwrites and target mix-ups, which are all refused.

## Cost

About $0 a month at today's sizes. Every figure below is inside the free allowances:

**R2 storage.** The 10 GB free tier covers it:
- About 35 retained database snapshots per project: 15 daily, 8 weekly, 12 monthly.
- Every media file version ever seen: about 42 MB for Production today, growing with uploads and never shrinking.

**R2 operations.** Daily Class A and B counts stay far below 1M and 10M a month.

**GitHub Actions.** About 400 of the 2,000 free minutes a month for a private repo:
- the plan job rounds up to one minute per firing;
- a backup takes about 5 minutes;
- the trial adds about 150 minutes.

**At larger sizes:**
- a 2 GB database would cost under $0.50 a month;
- each extra 10 GB of media costs $0.15 a month.

**If media grows large,** expire copies older than a year that no retained snapshot references. That needs a prune tool, which is not built, rather than a lifecycle rule.
