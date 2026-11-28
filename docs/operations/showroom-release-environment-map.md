# Showroom release environment map — 2026-10-15

## Purpose and current decision

Identify the effective live deployment without modifying hosted data or disclosing environment values. PR84 remains Draft. Hosted registration tests, migrations, promotion, Auth/CAPTCHA changes and production deployment are blocked until database identity and isolation are established. A project name is not a classification.

## Confirmed read-only evidence

Vercel live-domain alias lookup and project production target both identify `dpl_6F4cLptBtEtR5LwF7mQAneigsc83`, READY, target `production`, commit `c7963c9517cb412dde0a89090ab027712dbe403f`. Project `aladdin-staging` (`prj_EMcCAQL6KA8YwEHQ8Yw8o4mTRf1Z`) uses Node24.x. This is deployed configuration metadata, not a local environment file. The deployment response exposes environment names but not the readable effective Supabase URL.

The current project has one `NEXT_PUBLIC_SUPABASE_URL` Sensitive entry targeting both Production and Preview with no branch override observed. Its value is withheld by the documented individual-variable API and by `vercel env run`; neither returns a usable public project reference. Readable environment labels are `production` and `staging` respectively, but labels do not establish separate databases. Current configured scopes share the same variable entry; a historical deployment may retain older configuration, so this alone does not prove its effective database.

Vercel project/deployment read access works. This is **not** a confirmed403 permission failure. Legacy Sensitive values act as write-only Secrets, so broader read permissions do not guarantee recovery. Required next evidence is the nonsecret Supabase project reference from the original deployment configuration, a verified provider resource mapping, or a separately approved safe runtime observation. Do not rotate/change a live setting, retrieve service keys, or add a public diagnostics route to establish this mapping. [Vercel Secret behavior](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [deployment API](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url).

| Domain / surface | Vercel project | Active environment | Supabase ref | Database classification | Real data possible? | Write acceptance permitted? |
|---|---|---|---|---|---|---|
| `aladdindecore.com` | `aladdin-staging` | Production, deployment above | **Unconfirmed** | Production-facing backend; database unknown | Yes | No |
| `aladdin-staging-aladdin8.vercel.app`, `aladdin-staging-git-main-aladdin8.vercel.app` | Same project | Aliases of same production deployment | **Unconfirmed** | Same production-facing deployment, not isolated staging | Yes | No |
| PR Preview deployments | Same project | Preview; project label `staging` | **Unconfirmed** | Unknown; shared project variable entry with Production | Yes | No |
| Supabase `aladdin-staging` | Effective application mapping unconfirmed | Name alone supplies no classification | `kkpkgjrweysgvhvkhzun` | Potentially production-connected; protected as live | Yes; existing organization/product/order records observed | No |
| Supabase `aladdin-r2-acceptance-20261011` | Application mapping unconfirmed | Unknown | `nxossqhdfltcqdwvbewi` | Separate project, isolation from live application not established | Unknown | No, pending verified ownership/isolation |
| Ephemeral PR84 GitHub runner | None | CI local test | No hosted ref; loopback65521, project `aladdin_pr84_ci` | Isolated test; fresh runner database/volumes | Synthetic fixtures only | Yes, job-owned resources only |
| Local3342 | None | Local test | No hosted ref; loopback65521, `aladdin_pr84_acceptance` | Isolated test, currently unhealthy API/Docker | Synthetic fixtures only | Authorized, but paused while infrastructure is unhealthy |

No claim is made that hosted Production and staging have independent Auth users or organizations. Two accessible Supabase project references do not establish which application environment uses each. Do not compare or copy real identities between them to guess the mapping.

## Migration assessment and release consequences

Read-only inventory on `kkpkgjrweysgvhvkhzun`: **0/6 feature versions** recorded; old `business_draft_save`9arguments and `business_draft_submit`1argument exist; v2 contracts absent. This inventory is not a production assessment until mapping is confirmed. Existing two approved active address-incomplete showrooms and their products/orders must remain intact; no writes were performed. The additive legacy exception and old/v2 coexistence pass isolated tests, but production-specific drift and eligibility snapshots still require read-only review against the actual target.

Before hosted staging: assign a distinct verified Supabase reference, separate Auth users and synthetic data, branch-specific Preview configuration and hostname/CAPTCHA ownership; then approve database-first migration/deployment operations. Keep live-domain aliases off that staging deployment. Run the same full registration/onboarding/address/approval/tenant suite against the actual hosted backend, without local CAPTCHA test keys authorizing a hosted app. Native CAPTCHA cannot be enabled without coordinating its contract with the parallel task.

Before production: verify recoverable backup/restore in disposable infrastructure; audit all six migration versions/schema drift, grants/RLS, active approvals and legacy product/order snapshots; approve beta eligibility and residual risks; apply ordered additive SQL, verify v2 then promote the exact tested application. Retain old RPCs during expand/contract. Application rollback must preserve the additive schema; do not automatically drop guards/legacy evidence or restore/reset live data. See [release gate and checklist](../security/showroom-functional-release-readiness.md).

## Deferred and related files

Deferred: hosted writes, target classification without evidence, staging deployment, production backup execution, promotion and paid/provider changes. The owner has not accepted direct-GoTrue/distributed account-attempt risk. Local diagnostics and CI evidence are documented in [work log](AGENT_WORK_LOG.md); the CI workflow (showroom-acceptance.yml, retired 2026-10-28 with the showroom phone pages) touched only runner-owned resources. No global Docker restart or shared-volume cleanup is part of recovery.
