-- ===========================================================================
-- The Installer Points page (approved design): the caller's own points overview, EXACT and in SQL.
--
-- SECURITY INVOKER over public.points_ledger, whose owner policy (user_id = auth.uid()) already scopes every row, so this
-- function can read nothing the Points history cannot. Nothing is stored: the balance stays SUM(points_delta) exactly as
-- points_balance() computes it, and the month figures are the same ledger read for the current Africa/Cairo month.
-- ===========================================================================
create or replace function public.my_points_overview()
returns table (balance integer, month_earned integer, month_deducted integer, entries integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') as month_start
  )
  select coalesce(sum(l.points_delta), 0)::integer,
         coalesce(sum(l.points_delta) filter (where l.points_delta > 0 and l.created_at >= (select month_start from bounds)), 0)::integer,
         coalesce(-sum(l.points_delta) filter (where l.points_delta < 0 and l.created_at >= (select month_start from bounds)), 0)::integer,
         count(l.id)::integer
    from public.points_ledger l
   where l.user_id = (select auth.uid());
$$;
comment on function public.my_points_overview() is
  'The caller''s own points: balance (SUM of the ledger, as points_balance), this Africa/Cairo month''s earned and deducted totals, and the number of ledger entries. SECURITY INVOKER over points_ledger (owner policy). Stores nothing.';
revoke execute on function public.my_points_overview() from public, anon;
grant execute on function public.my_points_overview() to authenticated;
