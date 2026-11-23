# Acceptance migration-history inspection (read-only) - how to run it and how to read it

**Purpose:** before ANY hosted migration, know exactly which migrations Acceptance has, compared with this release branch. **Nothing is applied, repaired or changed.** The tool issues ONE read-only `SELECT version FROM supabase_migrations.schema_migrations` through the Supabase Management API's read-only query endpoint (the SQL is checked in code to be a single SELECT/WITH) and diffs the result against `supabase/migrations` of the checkout it runs in. With `--only migrations` it makes no Auth-config, function-inventory or Cloudflare call.

## Run (by the holder of the scoped read-only token, in their own shell; never paste the token anywhere)
From a checkout of the final release branch (PR #127 head, which contains everything: 199 migrations, last `20261030090002`):
```
SUPABASE_ACCESS_TOKEN=<read-only token> SUPABASE_REF_ACCEPTANCE=<acceptance ref> \
  node scripts/hosted-db/inspect-auth-security.mjs --env acceptance --only migrations > acceptance-migrations.json
```
Add `SUPABASE_REF_PRODUCTION` and `--env both` for Production in the same way. Without a token it prints what it needs and calls nothing (exit 3; verified).

## What the output means (`migration_diff`)
| Field | Meaning | Decision it drives |
|---|---|---|
| `applied_count`, `repo_count`, `latest_applied` | sizes and newest hosted version | sanity |
| `applied_not_in_repo` | hosted has a migration this branch does not | **stop**: the branch is not a superset of what is deployed; reconcile before anything |
| `repo_not_applied` | what a push would add | the planned apply list |
| **`out_of_order_missing`** | repo migrations that are MISSING on the project but OLDER than its newest applied one (e.g. `20261028090001/3` absent while `20261029090001` is applied) | **`supabase db push` refuses these** (it would need `--include-all`). **Do not "repair" around it**: it needs a deliberate, owner-approved plan (apply the specific missing ones in a reviewed, ordered step), or the missing migration is not needed on that project |
| **`plain_push_possible`** | `true` only if nothing is out of order and the hosted set is a subset of the repo | `true` = a normal forward `db push` of `repo_not_applied` is possible |
| `r2_markers` | whether `20261028090001`, `20261030090001/2` are applied (`20261031090001` is not a migration; it is the contract-step proposal) | whether the legacy table exists on that project; whether the dormant authority is already there |

## Why this matters for this release
- R1's `20261030090001/2` sort **after** #113/#116's `20261028/29` migrations. If a project has the `20261029` ones but not `20261028090001/3`, those two are out of order. Memory of earlier work says Acceptance received `20261029090001/2` while `20261028090001` was recorded as not applied; the inspection settles it.
- If `out_of_order_missing` is non-empty on Acceptance, the Acceptance migration step in the pilot (step 4 of `WHATSAPP_OTP_R2_PILOT_AND_RELEASE.md`) needs its own reviewed plan **before** anything is applied.

## After it runs
Send back `acceptance-migrations.json` (versions, counts and booleans only; no secret, no data). I will fold it into the release documents and tell you whether a plain forward push is possible. The 13 historical permission discrepancies are not part of this and are not reopened.
