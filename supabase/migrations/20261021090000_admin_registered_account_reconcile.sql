-- ===========================================================================
-- Reconcile PR #96 (registration data sync) with PR #88 (Admin Users account type).
--
-- PR #88 rewrote admin_users_list to delegate to admin_users_directory and made admin_user_detail read
-- app.user_account_type. PR #96 adds a `registered_account` key (app.registered_account) that the Admin
-- user page shows when no personal account type exists. Whatever order the two chains reached a database
-- in, this migration leaves both #88 functions carrying `registered_account`, exactly once.
-- Each rewrite refuses to run unless the #88 text occurs exactly once (same technique as 20261020090001),
-- and is skipped when `registered_account` is already present, so a re-run or drifted body never
-- half-patches silently.
-- ===========================================================================

create or replace function pg_temp.patch_once(p_fn regprocedure, p_pattern text, p_replacement text)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  if v_def ~ '''registered_account''' then
    return;
  end if;
  select count(*) into v_n from regexp_matches(v_def, p_pattern, 'g');
  if v_n <> 1 then
    raise exception 'patch %: expected 1 match of %, found %', p_fn, p_pattern, v_n;
  end if;
  execute regexp_replace(v_def, p_pattern, p_replacement, 'g');
end $$;

select pg_temp.patch_once('public.admin_users_directory(text,text,text,text,text,text,integer,integer)'::regprocedure,
  '''account_type'', app\.user_account_type\(u\.id\),',
  '''account_type'', app.user_account_type(u.id), ''registered_account'', app.registered_account(u.id),');

select pg_temp.patch_once('public.admin_user_detail(uuid)'::regprocedure,
  '''account_type'', app\.user_account_type\(u\.id\),',
  '''account_type'', app.user_account_type(u.id), ''registered_account'', app.registered_account(u.id),');
