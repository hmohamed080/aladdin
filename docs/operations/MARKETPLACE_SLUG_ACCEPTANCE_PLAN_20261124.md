# Marketplace seller public slug: gated Acceptance apply plan - 2026-11-24

Status: **PLAN, prepared and NOT applied.** Nothing in this document or in the PR that carries it touched Acceptance (`nxossqhdfltcqdwvbewi`) or Production (`kkpkgjrweysgvhvkhzun`). The owner runs `acceptance-apply.sh` themself on an explicit GO.

Plan name: **`marketplace-slug`** (pinned in `scripts/hosted-db/acceptance-gate.mjs`). Acceptance **244 -> 245**, one migration, plain push, no `--include-all`. Pre contract `20261123160002`, post contract `20261124090001`.

## Decisions recorded (owner) - other agents: do NOT re-ask or redo
- Combined plan chosen: Production applies the seven `marketplace-v2` migrations and the slug migration in ONE plan, `prod-marketplace-v2`, 237 -> 245 ([runbook](MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md)).
- Acceptance (already at 244, `marketplace-v2` applied and browser-tested) gets this small separate plan, applied **before** Production, so Acceptance proves the slug migration first.
- Nothing is applied anywhere by agents; apply is owner-run on an explicit GO.

## 1. What is pending
Exactly one migration newer than `20261123160002`: `20261124090001_marketplace_seller_public_slug.sql` (PR #252). It adds `app.marketplace_assign_org_slug(uuid)` and `app.marketplace_seller_slug_trigger()` (security definer, revoked from `public`, `anon`, `authenticated`, `service_role`), the trigger `marketplace_seller_slug_assign` (after insert or update of status, when `approved`) on `marketplace_seller_accounts`, and a backfill.

**Data effect (the only data the plan writes):** `organizations.slug` is set, from the organization name (ASCII letters and digits; `-2`, `-3` on collision; an Arabic-only name becomes `showroom-<8 hex of the id>`), for every organization that has an **approved** seller account and **no slug**. Existing slugs are never changed, non-approved sellers are never touched. On Acceptance the organization `ffff` is an approved seller: expect it to receive a slug if it has none. The "before" smoke prints how many approved sellers have no slug: note that number (it is the list to reset by hand if the slugs ever had to go back to NULL; the forward-fix does not do that).

No table, column, policy, grant to a client role or enum is created or changed; `app.marketplace_seller_transition` is not touched.

## 2. Measured result (scratch proof, not hand-written)
`node scripts/hosted-db/marketplace-slug-scratch-proof.mjs` (local throwaway database, no secret, no hosted connection): the Acceptance diff 244 -> 245 is **exactly 3 objects** (the 2 functions and the trigger, which the gate's `changed` list names); the data effect on four seeded organizations was `Nile Showroom!` null -> `nile-showroom`, an Arabic-only name null -> `showroom-<8 hex>`, `keep-me` unchanged, a pending seller unchanged.

## 3. Recovery
- Pinned forward-fix `forward-fix/marketplace-slug-remove.sql` (sha256 in `FORWARD_FIX`, verified by `acceptance-gate.mjs recovery` before the password prompt). Drops the trigger and the 2 functions in one transaction. It **RAISEs before any change** if the trigger is not the expected one, another trigger runs a slug function, any object depends on them, any function body in any non-system schema mentions them, or the current role does not own them. Proven in the scratch proof: refuses with a dependent function and with an extra trigger, changes nothing then; on the 245 state it returns the catalog exactly to 244; re-applying the migration afterwards restores 245.
- **The backfilled slugs are data and are NOT reverted.** They are valid, unique and used by shared storefront links; only a restore-tested backup returns the NULLs. After the forward-fix, a seller approved later gets no slug automatically.
- No backup label is required: no table is created and only NULL slugs are filled. A pinned label (e.g. `aladdin-acceptance-20261124T092536Z`, 237) is accepted as a historical reference only. Take a fresh backup anyway if you want a data recovery point before the backfill.
- Combined Production undo order: slug first, then `marketplace-v2` ([Production runbook](MARKETPLACE_V2_PRODUCTION_PLAN_20261124.md)).

## 4. Owner steps (nothing executed)
PowerShell, from a real clone (not a git worktree) fast-forwarded to `origin/main`; use the exact 40-char sha.

1. **GO to merge this PR** (merge-commit only). Merge `origin/main` into it first if main moved.
2. Read-only preflight: `bash scripts/hosted-db/acceptance-preflight.sh marketplace-slug`. Expect: HEAD = origin/main, 244 applied, exactly `20261124090001` pending, plain push.
3. **GO to apply:** `bash scripts/hosted-db/acceptance-apply.sh --plan marketplace-slug --sha <sha>`; type `APPLY marketplace-slug TO ACCEPTANCE`. It runs `marketplace-slug-smoke.sql` before and after the push, plus the usual history, permission, structure, count and catalog-diff checks (exactly 3 objects).
4. Expected end: `MARKETPLACE SLUG SMOKE (post): OK` (functions and trigger exist and are enabled, not executable by API roles, **every approved seller has a slug**) and `PASS: plan marketplace-slug applied`.
5. Browser: open the storefront of the seller `ffff` through `/market/sellers/<its slug>`.
6. Then, and only then, the Production plan `prod-marketplace-v2` (its own GOs).

## 5. If the push fails
Nothing is retried. Read `supabase migration list --linked`. The migration is one transaction, so history stops before it. The forward-fix is valid from any state (guards inspect what exists, every drop is IF EXISTS), but is an owner decision.

## 6. Not verified
Everything against the real Acceptance database (history, dry run, ACL inventory vs `20261124090001.json`, live fingerprint, `acceptance-apply.sh` end to end); the real number of approved sellers without a slug; the forward-fix guards against Acceptance's real catalog (proven on synthetic dependents only); the browser pass.
