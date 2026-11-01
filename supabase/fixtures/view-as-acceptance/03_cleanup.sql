-- RETIRES the Admin View-As fixture created by 01_apply.sql. Touches only rows reachable from the reserved ids below.
--
-- Why "retire" and not "delete": the platform deliberately makes points_ledger, job_reviews, job_progress_updates and the audit trail
-- append-only (a trigger forbids DELETE, including through ON DELETE CASCADE), and an account that owns such rows cannot be deleted.
-- That is a protection, not an obstacle to work around, so this script never disables a trigger. It:
--   1. deletes every deletable fixture row (portfolio, certificate, secondary phone, notifications, capabilities, memberships);
--   2. deactivates the two accounts and archives the organization, so they stop acting and can be told apart at a glance;
--   3. leaves the append-only history (2 assignments, 1 review, 2 points rows, audit events), which carries the fixture ids/names.
-- Re-running is a no-op. A rebuilt Acceptance project removes everything.
do $cleanup$
declare
  c_craft  constant uuid := '7fa00001-0000-4000-8000-0000000000c1';
  c_poster constant uuid := '7fa00002-0000-4000-8000-0000000000c2';
  c_org    constant uuid := '7fa000a1-aaaa-4aaa-8aaa-0000000000a1';
  v_env text := coalesce(current_setting('app.environment', true), '');
begin
  if v_env = 'production' then
    raise exception 'view-as fixture cleanup refuses to run: app.environment is production';
  end if;
  -- Only ever touch accounts that carry the fixture marker AND the reserved address.
  if exists (select 1 from auth.users where id in (c_craft, c_poster)
             and not (email like '%@fixture.invalid' and raw_user_meta_data ->> 'fixture' = 'admin-view-as-fixture-2026-11')) then
    raise exception 'a reserved fixture id is held by an account that is not the fixture; refusing to change anything';
  end if;
  if not exists (select 1 from auth.users where id in (c_craft, c_poster)) then
    raise notice 'view-as fixture absent: nothing to do';
    return;
  end if;

  delete from public.notifications where recipient_user_id in (c_craft, c_poster);
  delete from public.portfolio_items where owner_user_id = c_craft;
  delete from public.portfolio_projects where owner_user_id = c_craft;
  delete from public.professional_certificates where owner_user_id = c_craft;
  delete from public.secondary_phone_reservations where user_id = c_craft;
  delete from public.membership_capabilities where membership_id in (select id from public.memberships where organization_id = c_org);
  update public.memberships set status = 'revoked' where organization_id = c_org and status = 'active';
  update public.organizations set status = 'archived' where id = c_org;
  update public.users set status = 'deactivated' where id in (c_craft, c_poster);
  raise notice 'view-as fixture retired (deactivated accounts, archived organization, deletable data removed; append-only history kept)';
end
$cleanup$;
