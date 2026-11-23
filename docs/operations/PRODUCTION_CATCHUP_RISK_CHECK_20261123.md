# Production catch-up: real-data risk check - 2026-11-23

Status: READ-ONLY evidence. Nothing was written to Production or Acceptance. Every query below is a SELECT run through the Supabase MCP `execute_sql` on Production (`kkpkgjrweysgvhvkhzun`, 210 migrations, latest `20261112090001`, read live 2026-11-23). Plan: [`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md).

## Purpose
Show that each of the 27 pending migrations can run against Production's actual rows, find every statement that can fail or change rows, and prove each one safe or name the residual risk.

## Method
1. Every statement of the 27 files that touches an existing table was listed (ALTER, ADD CONSTRAINT, UPDATE/INSERT/DELETE, triggers, DROP, ALTER TYPE, storage). There is no `ALTER TYPE`, no new `NOT NULL`/`UNIQUE` on an existing table, no index on an existing table, no backfill `UPDATE` of an existing table at top level. Everything else creates new objects (Marketplace 30 tables, `media_limits*`, `notification_template*`) or replaces functions.
2. Each risky statement was checked on Production with the queries named in the table.
3. The whole sequence was replayed on the scratch container in ONE transaction that was rolled back (`scripts/hosted-db/prod-catchup-scratch-proof.mjs`).

## Findings

| Migration | Risky statement | Query on Production (SELECT) | Result |
|---|---|---|---|
| `20261115090002` | `DROP/ADD CONSTRAINT ck_verifications_reason_required` (now only `needs_more_info` needs a reason: a LOOSENING) | verifications with `needs_more_info` and empty reason | 0 of 54 rows violate; old constraint validated; also 0 rejected rows without a reason |
| `20261115090002` | `app.audit_actions_add(['verification.admin_initiated'])` rebuilds `ck_audit_action_known` | helper md5 and constraint state | helper md5 `e48699c1...` equals the scratch copy; constraint validated; set only grows (220 -> 221 members); 3,703 audit rows, 1.2 MB: the re-validation is instant |
| `20261115090002` | `DROP TRIGGER showroom_review_complete` + `DROP FUNCTION app.showroom_review_guard()`, `craftsman_review_complete` dropped | triggers on `verifications` | trigger exists and is enabled (`O`); `craftsman_review_complete` does not exist yet (drop is IF EXISTS). Behaviour change, not a failure: 48 verifications are open (44 submitted, 3 under review, 1 needs_more_info) and are reviewed under the new rules |
| `20261114090001`, `20261115090001`, `090005` | reviewer gate on apply, craftsman submit, notify owner on approve | `notifications.event_type` values | only `verification.approved` (3 rows), which stays in the vocabulary |
| `20261116100013` | `DROP/ADD CONSTRAINT media_storage_locations_namespace_check` (adds `marketplace`) | rows outside the new 8-namespace list | 0 of 1,544 (`portfolio` 1151, `avatar` 382, `organization` 3, `product` 8); old constraint validated |
| `20261121090003` | `DROP/ADD CONSTRAINT ck_notifications_event_type_known` (adds 6 Marketplace events), `ADD COLUMN content jsonb`, `ADD CONSTRAINT ck_notifications_content_shape` | rows outside the new list; table size | 0 of 3 rows; the new column is NULL for every row and the shape check allows NULL |
| `20261121090001` | `UPDATE storage.buckets SET file_size_limit = 10485760` for 3 legacy buckets | `storage.buckets` | `professional-portfolio`, `product-images`, `purchase-request-images` are all 5,242,880 now, so all three change. Not covered by the catalog fingerprint. `media-notify-remove.sql` puts exactly 5,242,880 back. Safe (raises a limit) |
| `20261121090001` | `media_videos_cap_on_insert` BEFORE INSERT trigger on an existing table | rows in `media_videos` | 0 rows; the trigger only looks at new rows |
| `20261121090001` | `marketplace_rejected_images_purge` | n/a | touches Marketplace tables only, and nothing schedules it in the migration |
| `20261116100004`, `100009`, `20261121090002`, `090003` | `INSERT` into `admin_permissions` (7 keys) and `admin_role_permissions` | existing keys, roles, uniqueness | none of the 7 keys exists; `super_admin`, `administrator`, `moderator` exist with `is_system`; PK `(key)` and unique `(resource, action)` cannot clash (new resources). `sort_order` is not unique (80/81 are reused by `roles.*`, cosmetic). All inserts are `ON CONFLICT DO NOTHING` |
| `20261116100001`-`100014`, `20261121090002/3` | 30 + 4 new tables, indexes, triggers, policies, seed rows | name collisions | 0 functions, 0 relations with any `marketplace_*`, `media_limit*`, `notification_template*` name on Production (all 146 added functions and 45 added relations checked) |
| `20261116100010`, `100013` | `DROP FUNCTION` (overloads, `marketplace_public_image_ref`, 5 `app.marketplace_storage_*`) | n/a | all are created earlier in the same sequence; the catalog diff shows no net trace |
| `20261122090001`-`090002` | `app.api_pre_request` (PostgREST pre-request hook) now refuses state-changing requests of accounts whose registration is unfinished | users by status | 1,093 users, 1,039 not `active`. Classified in the plan document: 69 would be refused (60 never signed in, 3 signed in within 30 days). Behaviour change for real accounts, not a failure; repeat the count right before the apply |
| all | any function the catch-up replaces differs from what Production has | md5 of `pg_get_functiondef`, ACL and comment of the 24 replaced functions | 24/24 definitions and 23/24 ACL equal the scratch pre-state. `admin_users_directory` ACL differs only because the scratch container has local grants; Production's equals the contract |
| all | permission drift before the push | hash of the function ACL inventory (`scripts/function-permissions.sql` logic) vs `supabase/permissions/20261112090001.json` | 755 functions, 16/16 hash buckets equal: **no mismatch** (kind, owner, definer, config, grants, effective roles, schema usage) |

## Scratch replay (rolled back)
`node scripts/hosted-db/prod-catchup-scratch-proof.mjs` (container `supabase_db_aladdin_r2_rc2_fresh`, 207 migrations, plus the 3 migrations Production already has, then the 27, then the three forward-fixes, ROLLBACK):
- No error. Statement time 2.3 s (wall 2.9 s) for the 27 migrations on an empty database. Production's tables are small (largest touched: `audit_log` 3,703 rows), so lock time is not a concern.
- Catalog diff pre to post: exactly 1,583 objects, all in the `changed` list of plan `prod-catchup` (170 function names, the four replaced constraints, one dropped trigger, one added trigger, new-table prefixes).
- After the three forward-fixes the catalog fingerprint equals the pre-state: `no catalog differences`.
- Container afterwards: still 207 migrations.

## Differences between the scratch container and Production (measured)
The container is NOT fully Production-identical, so only what was measured against Production is claimed as Production-exact:
- 9 functions differ in definition (`app.can_participate`, `app.conversation_parties`, `app.mandatory_registration_business_type`, `public.job_application_reject`, `public.job_assignment_cancel`, `public.job_assignment_complete`, `public.job_progress_add`, `public.mark_conversation_read`, `public.open_conversation`). None is touched by the 27 migrations or by any forward-fix.
- 2 pgTAP helper views (`tap_funky`, `pg_all_foreign_keys`) and their columns and grants exist only locally.
- The `ck_audit_action_known` text has the same 220 members as Production but another order.
The post-push catalog diff of `production-apply.sh` is taken on Production itself, so these differences cannot hide a change there.

## Residual risks (owner decisions, not blockers)
1. Behaviour changes: the registration gate (69 accounts), the review rules for the 48 open verifications, three raised bucket limits.
2. After the push, rows written to the new tables, `verifications`, `audit_log`, `notifications` are recoverable ONLY from the restore-tested backup; the forward-fixes restore objects, not rows, and refuse (RAISE) while Marketplace or notification-template rows exist.
3. Marketplace PR 5 / PR 6 migrations are not covered yet; add them with `PC_LATER` (see the plan).

## Related files
- `scripts/hosted-db/acceptance-gate.mjs` (plan `prod-catchup`), `scripts/hosted-db/forward-fix/prod-catchup-restore-previous.sql`, `marketplace-remove.sql`, `media-notify-remove.sql`
- [`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md), [`BACKUPS_ENABLEMENT_PLAN_20261123.md`](BACKUPS_ENABLEMENT_PLAN_20261123.md)
