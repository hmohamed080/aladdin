-- ===========================================================================
-- The Installer Reviews "ratings trend" card: the caller's own monthly average and count, EXACT and in SQL.
--
-- SECURITY INVOKER over public.my_job_reviews, which already scopes every row to the signed-in professional and
-- already excludes suppressed reviews, so this function sees exactly what the Reviews list sees and nothing more.
-- Months with no reviews are returned with a NULL average (not 0: no review is not a bad score). At most 12 months.
-- ===========================================================================
create or replace function public.my_review_monthly(p_months integer default 6)
returns table (month date, reviews integer, average numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_months, 6), 1), 12) as n,
           date_trunc('month', now() at time zone 'Africa/Cairo')::date as this_month
  ), months as (
    select (b.this_month - make_interval(months => g))::date as month
      from bounds b, generate_series(0, (select n - 1 from bounds)) g
  )
  select m.month,
         count(r.id)::integer,
         round(avg(r.rating)::numeric, 1)
    from months m
    left join public.my_job_reviews r
      on date_trunc('month', r.created_at at time zone 'Africa/Cairo')::date = m.month
   group by m.month
   order by m.month;
$$;
comment on function public.my_review_monthly(integer) is
  'The caller''s own reviews per calendar month (Africa/Cairo) for the last 1-12 months: count and average (NULL when none). SECURITY INVOKER over my_job_reviews, so it is scoped and moderated exactly like the Reviews list.';
revoke execute on function public.my_review_monthly(integer) from public, anon;
grant execute on function public.my_review_monthly(integer) to authenticated;
