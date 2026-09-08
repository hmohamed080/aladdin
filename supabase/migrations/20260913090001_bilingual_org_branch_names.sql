-- Migration: bilingual display names for organizations and branches.
--
-- CONTEXT. `organizations.name` and `branches.name` are single free-text
-- columns an owner enters once at creation — there is no Arabic/English split
-- today. The Showroom Owner dashboard's header needs to show a business's
-- Arabic and English trading names distinctly (Arabic UI prefers the Arabic
-- value, English UI prefers the English value), and this is genuinely new: no
-- existing bilingual pattern in this schema transfers. The codebase's
-- established bilingual pattern — a stable machine KEY plus `en.ts`/`ar.ts` —
-- is for a fixed, finite, product-defined vocabulary (`product_category`,
-- `trades`; see 20260901090001_trade_taxonomy.sql's own comment on exactly
-- why that pattern would be wrong here). An organization's trading name is
-- the OWNER'S free-text data, not the product's vocabulary, so it gets its
-- own nullable columns instead.
--
-- RULES (enforced in the frontend display helper, `lib/i18n/bilingual.ts`,
-- not in the database — these are display fallback rules, not data
-- constraints):
--   - Arabic UI prefers `name_ar`; English UI prefers `name_en`.
--   - Either falls back to the single `name` column when its preferred
--     translation was never entered.
--   - No dual entry is required, and nothing here auto-translates or
--     overwrites `name` — these are ADDITIVE, optional columns.
--
-- Purely additive: every new column is nullable with no default, so every
-- existing row is unaffected and every existing read of `name` is unchanged.
-- No RLS change — these columns live on rows already covered by the existing
-- `organizations`/`branches` policies (same row, same tenant boundary).

alter table public.organizations
  add column if not exists name_ar text,
  add column if not exists name_en text;

alter table public.organizations
  drop constraint if exists ck_organizations_name_ar_len,
  add constraint ck_organizations_name_ar_len check (name_ar is null or char_length(name_ar) between 1 and 120),
  drop constraint if exists ck_organizations_name_en_len,
  add constraint ck_organizations_name_en_len check (name_en is null or char_length(name_en) between 1 and 120);

comment on column public.organizations.name_ar is
  'Optional Arabic trading name, entered by the owner. Arabic UI prefers this over `name` when present; never auto-translated. See lib/i18n/bilingual.ts.';
comment on column public.organizations.name_en is
  'Optional English trading name, entered by the owner. English UI prefers this over `name` when present; never auto-translated. See lib/i18n/bilingual.ts.';

alter table public.branches
  add column if not exists name_ar text,
  add column if not exists name_en text,
  add column if not exists address_ar text,
  add column if not exists address_en text;

alter table public.branches
  drop constraint if exists ck_branches_name_ar_len,
  add constraint ck_branches_name_ar_len check (name_ar is null or char_length(name_ar) between 1 and 120),
  drop constraint if exists ck_branches_name_en_len,
  add constraint ck_branches_name_en_len check (name_en is null or char_length(name_en) between 1 and 120),
  drop constraint if exists ck_branches_address_ar_len,
  add constraint ck_branches_address_ar_len check (address_ar is null or char_length(address_ar) between 1 and 300),
  drop constraint if exists ck_branches_address_en_len,
  add constraint ck_branches_address_en_len check (address_en is null or char_length(address_en) between 1 and 300);

comment on column public.branches.name_ar is 'Optional Arabic branch name, entered by the owner. See lib/i18n/bilingual.ts.';
comment on column public.branches.name_en is 'Optional English branch name, entered by the owner. See lib/i18n/bilingual.ts.';
comment on column public.branches.address_ar is 'Optional Arabic branch address, entered by the owner. Free text — no structured address model exists yet.';
comment on column public.branches.address_en is 'Optional English branch address, entered by the owner. Free text — no structured address model exists yet.';

-- NO grant is added here for either table, deliberately.
--
-- `organizations` has never had a direct-client UPDATE grant — no "rename my
-- organization" path exists at all today, bilingual or otherwise.
-- `branches` briefly had one (20260802090002's `branches_update_manager`
-- policy plus a column grant covering name/locality_id/is_active/deleted_at),
-- but 20260804090001 (write-path security hardening) REVOKED it outright —
-- `revoke insert, update, delete on public.branches from authenticated,
-- service_role;` plus dropping `branches_update_manager` — with the comment
-- "branch lifecycle writes are prohibited until their own auditable RPC
-- lands." The stale column grant from 20260802090002 is still present in the
-- catalog (harmless: RLS now has zero permissive UPDATE policies on
-- `branches`, so it grants no real access), but adding a new grant for
-- name_ar/name_en/address_ar/address_en would be inconsistent with that
-- hardening decision and would misleadingly suggest a write path exists.
--
-- So both tables end up in the SAME state: name_ar/name_en (and address_*)
-- are populated only once a future, auditable rename/edit RPC exists for
-- that table — recorded as debt on the map ticket, not solved here, since
-- building either RPC is outside this migration's additive, schema-only
-- scope.
