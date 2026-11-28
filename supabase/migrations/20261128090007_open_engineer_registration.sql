-- ===========================================================================
-- Open Engineer self-service registration (owner request 2026-11-28).
--
-- Removes 'engineer' from the one database list of closed account types. It must
-- equal the frontend comingSoon set (coming-soon-parity.test.ts). This also
-- opens the Engineering Office (design_office) application, which is the
-- Engineer account's organization operating model (20261015090030).
-- Applied last, after the Engineer account migrations above.
--
-- Rollback: restore array['end_consumer', 'engineer', 'contractor'].
-- ===========================================================================
create or replace function app.coming_soon_account_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['end_consumer', 'contractor']::text[];  -- COMING_SOON_ACCOUNT_TYPES
$$;
