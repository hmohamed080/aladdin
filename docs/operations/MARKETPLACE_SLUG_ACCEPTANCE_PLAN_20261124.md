# Marketplace seller public slug: gated Acceptance apply plan - 2026-11-24

Status: **PLAN, prepared and NOT applied.** Nothing in this document or in the PR that carries it touched Acceptance (`nxossqhdfltcqdwvbewi`) or Production (`kkpkgjrweysgvhvkhzun`). The owner runs `acceptance-apply.sh` themself on an explicit GO.

Plan name: **`marketplace-slug`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance **244 -> 246**, TWO migrations (slug `20261124090001`, then the stock-notification fix `20261124120001`), plain push, no `--include-all`. Pre contract `20261123160002`, post contract `20261124120001`. The plan keeps its name `marketplace-slug` (renaming would break the scripts, tests and links for no benefit).

## Decisions recorded (owner) - other agents: do NOT re-ask or redo
- Combined plan chosen: Production applies the seven `marketplace-v2` migrations and the slug migration in ONE plan, `prod-marketplace-v2`, 237 -> 245 ([runbook](MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md)).
- Acceptance (already at 244, `marketplace-v2` applied and browser-tested) gets this small separate plan, applied **before** Production, so Acceptance proves the slug migration first.
- Nothing is applied anywhere by agents; apply is owner-run on an explicit GO.
- Owner approved (2026-11-24) fixing the English product name in stock notifications by a NEW EXPAND-only migration, `20261124120001_marketplace_stock_notify_localized.sql`, included in this plan (Acceptance 244 -> 246) and in `prod-marketplace-v2` (Production 237 -> 246). See section 7.

## 1. What is pending
Exactly two migrations newer than `20261123160002`: `20261124090001_marketplace_seller_public_slug.sql` (PR #252) and `20261124120001_marketplace_stock_notify_localized.sql` (section 7). It adds `app.marketplace_assign_org_slug(uuid)` and `app.marketplace_seller_slug_trigger()` (security definer, revoked from `public`, `anon`, `authenticated`, `service_role`), the trigger `marketplace_seller_slug_assign` (after insert or update of status, when `approved`) on `marketplace_seller_accounts`, and a backfill.

**Data effect (the only data the plan writes):** `organizations.slug` is set, from the organization name (ASCII letters and digits; `-2`, `-3` on collision; an Arabic-only name becomes `showroom-<8 hex of the id>`), for every organization that has an **approved** seller account and **no slug**. Existing slugs are never changed, non-approved sellers are never touched. On Acceptance the organization `ffff` is an approved seller: expect it to receive a slug if it has none. The "before" smoke prints how many approved sellers have no slug: note that number (it is the list to reset by hand if the slugs ever had to go back to NULL; the forward-fix does not do that).

No table, column, policy, grant to a client role or enum is created or changed; `app.marketplace_seller_transition` is not touched.

## 2. Measured result (scratch proof, not hand-written)
`node scripts/hosted-db/marketplace-slug-scratch-proof.mjs` (local throwaway database, no secret, no hosted connection): the slug part of the Acceptance diff is 3 objects (the 2 functions and the trigger; with the stock fix the total is 4, section 7); the data effect on four seeded organizations was `Nile Showroom!` null -> `nile-showroom`, an Arabic-only name null -> `showroom-<8 hex>`, `keep-me` unchanged, a pending seller unchanged.

## 3. Recovery
- Pinned forward-fix `forward-fix/marketplace-slug-remove.sql` (sha256 in `FORWARD_FIX`, verified by `acceptance-gate.mjs recovery` before the password prompt). Drops the trigger and the 2 functions in one transaction. It **RAISEs before any change** if the trigger is not the expected one, another trigger runs a slug function, any object depends on them, any function body in any non-system schema mentions them, or the current role does not own them. Proven in the scratch proof: refuses with a dependent function and with an extra trigger, changes nothing then; on the 245 state it returns the catalog exactly to 244; re-applying the migration afterwards restores 245.
- **The backfilled slugs are data and are NOT reverted.** They are valid, unique and used by shared storefront links; only a restore-tested backup returns the NULLs. After the forward-fix, a seller approved later gets no slug automatically.
- No backup label is required: no table is created and only NULL slugs are filled. A pinned label (e.g. `aladdin-acceptance-20261124T092536Z`, 237) is accepted as a historical reference only. Take a fresh backup anyway if you want a data recovery point before the backfill.
- Combined Production undo order: stock-notify, slug, then `marketplace-v2` ([Production runbook](MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md)).

## 7. Stock notification fix (migration 20261124120001)
The Acceptance test showed the stock e-mail as "<Arabic product name> has only 5 left": one variable `product_name` (Arabic name first) was rendered into both languages. The migration `CREATE OR REPLACE`s `app.marketplace_stock_notify()` (same signature, still revoked from every client role) so it passes `product_name` (unchanged value), `product_name_ar` and `product_name_en`, and updates only the DEFAULT texts and `variables` of the two templates `marketplace.stock.low` / `marketplace.stock.out`. Admin override columns, `version` and `updated_by` are never written: an edit that still uses `{product_name}` keeps working. A notification already written never changes. No new permission (contract `20261124120001.json` = `20261124090001.json` except version and note).

Measured by the same scratch proof: the Acceptance diff 244 -> 246 is **exactly 4 objects** (the 2 slug functions, the slug trigger, and the replaced `app.marketplace_stock_notify()`); the 2 template rows are data, not catalog objects. Smoke: read-only `marketplace-stock-notify-smoke.sql` / `.mjs` run before and after the push by `acceptance-apply.sh`. pgTAP: `supabase/tests/223_marketplace_stock_notify_localized_test.sql`.

Recovery: pinned forward-fix `forward-fix/marketplace-stock-notify-restore-previous.sql` restores the previous function and the previous default texts / variables; it RAISEs before any change when an admin edit uses `{product_name_ar}` or `{product_name_en}` (they would render empty). **Undo order: stock-notify, then slug** (proven in the scratch proof: stock -> fixS equals the 245 catalog, then slug fix equals 244).

## 4. Owner steps (nothing executed)
PowerShell, from a real clone (not a git worktree) fast-forwarded to `origin/main`; use the exact 40-char sha.

1. **GO to merge this PR** (merge-commit only). Merge `origin/main` into it first if main moved.
2. Read-only preflight: `bash scripts/hosted-db/acceptance-preflight.sh marketplace-slug`. Expect: HEAD = origin/main, 244 applied, exactly `20261124090001` and `20261124120001` pending, plain push.
3. **GO to apply:** `bash scripts/hosted-db/acceptance-apply.sh --plan marketplace-slug --sha <sha>`; type `APPLY marketplace-slug TO ACCEPTANCE`. It runs `marketplace-slug-smoke.sql` before and after the push, plus the usual history, permission, structure, count and catalog-diff checks (exactly 4 objects).
4. Expected end: `MARKETPLACE STOCK-NOTIFY SMOKE (post): OK` and `MARKETPLACE SLUG SMOKE (post): OK` (functions and trigger exist and are enabled, not executable by API roles, **every approved seller has a slug**) and `PASS: plan marketplace-slug applied`.
5. Browser: open the storefront of the seller `ffff` through `/market/sellers/<its slug>`.
6. Then, and only then, the Production plan `prod-marketplace-v2` (its own GOs).

## 5. If the push fails
Nothing is retried. Read `supabase migration list --linked`. Each migration is one transaction, so history stops before the failing one. The forward-fix is valid from any state (guards inspect what exists, every drop is IF EXISTS), but is an owner decision.

## 6. Not verified
Everything against the real Acceptance database (history, dry run, ACL inventory vs `20261124120001.json`, live fingerprint, `acceptance-apply.sh` end to end); the real number of approved sellers without a slug; the forward-fix guards against Acceptance's real catalog (proven on synthetic dependents only); the browser pass (including a real stock notification in both languages after the push); the pgTAP files 123/128/191/220 fail identically WITHOUT this change on the scratch database used here (pre-existing, environment: not investigated).
