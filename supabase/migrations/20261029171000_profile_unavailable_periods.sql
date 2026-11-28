-- Explicit blocked periods are distinct from existing positive availability windows.
create table public.profile_unavailable_periods (
 id uuid primary key default extensions.gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 starts_on date not null, ends_on date,
 constraint profile_unavailable_period_order check(ends_on is null or ends_on>=starts_on)
);
create index profile_unavailable_period_owner on public.profile_unavailable_periods(user_id,starts_on);
alter table public.profile_unavailable_periods enable row level security;
revoke all on public.profile_unavailable_periods from public,anon,authenticated;
grant select,insert,delete on public.profile_unavailable_periods to authenticated;
create policy unavailable_read_own on public.profile_unavailable_periods for select to authenticated using(user_id=(select auth.uid()));
create policy unavailable_insert_own on public.profile_unavailable_periods for insert to authenticated with check(user_id=(select auth.uid()) and app.can_create_professional_asset());
create policy unavailable_delete_own on public.profile_unavailable_periods for delete to authenticated using(user_id=(select auth.uid()));
create function public.my_unavailable_periods() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'from',starts_on,'to',ends_on) order by starts_on),'[]'::jsonb) from public.profile_unavailable_periods where user_id=auth.uid(); $$;
create function public.set_unavailable_period(p_from date,p_to date default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
 if (select count(*) from public.profile_unavailable_periods where user_id=auth.uid())>=50 then raise exception 'too many periods' using errcode='22023'; end if;
 insert into public.profile_unavailable_periods(user_id,starts_on,ends_on) values(auth.uid(),p_from,p_to);
end; $$;
create function public.remove_unavailable_period(p_id uuid) returns void language sql security invoker set search_path='' as $$ delete from public.profile_unavailable_periods where id=p_id and user_id=auth.uid(); $$;
revoke all on function public.my_unavailable_periods(),public.set_unavailable_period(date,date),public.remove_unavailable_period(uuid) from public,anon;
grant execute on function public.my_unavailable_periods(),public.set_unavailable_period(date,date),public.remove_unavailable_period(uuid) to authenticated;
do $$ declare body text; begin
 select pg_get_functiondef('public.individual_save_professional'::regproc) into body;
 if position('''within_week'', ''within_month'', ''flexible''' in body)=0 then raise exception 'unexpected professional function'; end if;
 execute replace(body,'''within_week'', ''within_month'', ''flexible''','''immediate'', ''within_week'', ''within_month'', ''flexible''');
end $$;
