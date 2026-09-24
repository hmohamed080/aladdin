-- ===========================================================================
-- Staging-prep Increment 4 — wholesaler org_type remap to supplier
--
-- CONSUMER AUDIT (correction #8) performed before writing this migration —
-- every repository reference to `wholesaler` as an organization_type was
-- searched (SQL/RLS/RPC validation lists, TypeScript, routing, filters,
-- tests, seed data). Findings and disposition:
--
--   * `business_save` / `business_creation_drafts` / `account_persona_decoupling`
--     / `pilot_account_activation` RPCs (4 historical migrations) each embed a
--     literal ('showroom_dealer','supplier','manufacturer','importer',
--     'wholesaler') allow-list for org_type. These are NOT touched: the
--     product-owner decision only stops the REGISTRATION PICKER from
--     offering `wholesaler` as a new choice (frontend/src/lib/onboarding/
--     account-types.ts) — it does not forbid the enum value at the RPC/schema
--     layer, matching the design precedent already set for the unused
--     `contractor_company`/`design_office` organization_type values. Rewriting
--     four historical migrations' embedded validation lists to excise one
--     enum literal is a materially larger, higher-risk change than this pass
--     asked for, for a business-rule (not security-boundary) restriction.
--   * `frontend/src/lib/workspace/supply-side.ts`, `frontend/src/server/queries/
--     directory.ts`, `frontend/src/server/actions/search.ts` treat `wholesaler`
--     as a supply-side org type. Harmless to leave: after this migration no
--     organization has org_type = 'wholesaler', so these branches are
--     unreachable in practice, and reachable-but-correct if a legacy/test row
--     ever does hold the value.
--   * `frontend/src/lib/onboarding/account-types.ts` (the picker) IS a
--     required consumer update — handled in the account-types.ts rewrite that
--     lands with the registration UI increment, dropping `wholesaler` from
--     `BUSINESS_ORG_TYPES`/`ACCOUNT_TYPE_CHOICES`.
--   * `supabase/seed-pilot.sql` seeds "Delta Wholesale Supply" with
--     org_type = 'wholesaler' directly, via a script that runs AFTER
--     migrations replay (a `db reset` applies migrations then seed) — a fresh
--     seed run would therefore create a NEW wholesaler-typed org that this
--     migration's UPDATE (which only touches rows existing at migration time)
--     can never see or remap. Seed data updated in this same commit to seed
--     Delta directly as org_type='supplier' + the 'wholesaler' activity row,
--     matching what a real remap would have produced — see that file's diff.
--   * `supabase/staging/demo-accounts.toml` documents the same demo org's
--     `org_type = "wholesaler"` for staging demo-account reference. Updated
--     to "supplier" in the same commit for consistency — it is a reference
--     doc, not applied by any migration, so leaving it stale would only
--     mislead a future reader, never break anything at runtime.
--   * Test files 25/27/28/37 (`supabase/tests/*.sql`) reference `wholesaler`
--     either as one representative valid organization_type value (still
--     valid — the enum keeps it, business_save's RPC validation list keeps
--     it), or as an org that is "not a showroom" for an affiliation check
--     (still true of org_type='supplier' too). None depend on any row
--     actually holding org_type='wholesaler' after this migration runs, so
--     none required a code change.
--
-- Idempotent: safe to re-run (on conflict do nothing / a no-op UPDATE on a
-- second pass, since no row will match org_type = 'wholesaler' after the
-- first run).
-- ===========================================================================

insert into public.organization_activities (organization_id, activity_id)
select o.id, a.id
  from public.organizations o
  join public.activities a
    on a.organization_type = 'supplier' and a.key = 'wholesaler'
 where o.org_type = 'wholesaler'
on conflict do nothing;

update public.organizations
   set org_type = 'supplier'
 where org_type = 'wholesaler';

-- The `wholesaler` value stays in the public.organization_type enum
-- (Postgres enum values are not cheaply dropped, and this matches the
-- existing low-risk precedent of leaving `contractor_company`/`design_office`
-- unused in the same enum). The registration picker simply stops offering it.
