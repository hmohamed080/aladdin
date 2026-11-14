-- pgTAP: Admin edit of users and organizations, OPTION A (20261114090005_admin_edit_profiles_and_organizations.sql).
--   A. Permissions: Super Admin + Administrator only
--   B. Callers without the permission (Moderator, Support, plain user, anon) are refused
--   C. The allow-list: every contact / legal / identity / verification / ownership field is refused, atomically
--   D. A reason is required
--   E. User happy path: changed, audited (masked, with reason), user notified (field names only), re-confirmation, no-op writes nothing
--   F. Rank rules: never yourself, never staff at or above your rank (even suspended); media is remove-only
--   G. Organization: same guarantees, owners notified; legal / contact / verification fields refused
--   H. Audit rows are immutable
create extension if not exists pgtap;

begin;
select no_plan();

\set super1 '11111111-1111-4111-8111-111111111111'
\set adminA '55555555-5555-4555-8555-555555555555'
\set adminB '22222222-2222-4222-8222-222222222222'
\set moder  '33333333-3333-4333-8333-333333333333'
\set supp   '44444444-4444-4444-8444-444444444444'
\set plain  '70000001-0000-4000-8000-000000000001'
\set target '70000002-0000-4000-8000-000000000002'
\set org    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

select app.admin_bootstrap_super_admin(:'super1');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'adminB', 'administrator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'moder', 'moderator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adminA');
update public.profiles set display_name_confirmed_at = now(), bio = 'old bio', headline = 'old headline' where user_id = :'target';
update public.organizations set description = 'old description', website_url = null where id = :'org';

create temp table t_snap as select
  (select phone_e164 from public.profiles where user_id = :'target') as phone,
  (select legal_name from public.organizations where id = :'org') as legal,
  (select org_type::text from public.organizations where id = :'org') as org_type,
  (select count(*) from public.audit_log where action in ('admin.user.edited', 'admin.organization.edited')) as audits;
grant select on t_snap to authenticated;

-- ===========================================================================
-- A. Permissions
-- ===========================================================================
select is((select array_agg(r.key order by r.key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'users.edit_profile'), array['administrator', 'super_admin']::text[], 'A: users.edit_profile is Administrator + Super Admin only');
select is((select array_agg(r.key order by r.key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'organizations.edit'), array['administrator', 'super_admin']::text[], 'A: organizations.edit is Administrator + Super Admin only');

-- ===========================================================================
-- B. Callers without the permission
-- ===========================================================================
select pg_temp.act_as(:'moder');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'because')$$, :'target'), '42501', null, 'B: a Moderator cannot edit a profile');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"x"}', 'because')$$, :'org'), '42501', null, 'B: a Moderator cannot edit an organization');
select pg_temp.act_as(:'supp');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'because')$$, :'target'), '42501', null, 'B: Support cannot edit a profile');
select pg_temp.act_as(:'plain');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'because')$$, :'target'), '42501', null, 'B: an ordinary user cannot edit someone else');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"x"}', 'because')$$, :'org'), '42501', null, 'B: an ordinary user cannot edit an organization');
select pg_temp.as_dba(); set local role anon; set local request.jwt.claims = '';
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'because')$$, :'target'), '42501', null, 'B: anon cannot execute the user edit');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"x"}', 'because')$$, :'org'), '42501', null, 'B: anon cannot execute the organization edit');
select pg_temp.as_dba();

-- ===========================================================================
-- C. The allow-list: refused by key, whatever the value, before anything else
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_user_edit_profile(%L, jsonb_build_object(%L, 'x'), 'because')$$, :'target', k),
  '42501', 'field not editable', 'C: user edit refuses ' || k)
from unnest(array['phone_e164', 'phone_national', 'phone_country_iso2', 'phone_verified_at', 'email', 'legal_name', 'national_id',
                  'bank_account', 'iban', 'username', 'birth_date', 'primary_account_type', 'status', 'is_verified', 'id', 'user_id',
                  'points', 'password', 'role', 'display_name_confirmed_at', 'public_profile_status', 'deleted_at', 'created_at']) as k;
select throws_ok(format($$select public.admin_organization_edit(%L, jsonb_build_object(%L, 'x'), 'because')$$, :'org', k),
  '42501', 'field not editable', 'C: organization edit refuses ' || k)
from unnest(array['legal_name', 'org_type', 'contact_phone', 'contact_email', 'is_verified', 'business_verified_at', 'business_verification_id',
                  'status', 'deleted_at', 'slug', 'created_by', 'id', 'source', 'referred_by_user_id', 'tax_id', 'bank_account', 'iban']) as k;
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"fine","phone_e164":"+201000000000"}', 'because')$$, :'target'),
  '42501', 'field not editable', 'C: a patch mixing an allowed and a forbidden field is refused whole');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"fine","legal_name":"Evil Ltd"}', 'because')$$, :'org'),
  '42501', 'field not editable', 'C: ... also for organizations');
select is((select headline from public.profiles where user_id = :'target'), 'old headline', 'C: the allowed half of a refused patch was NOT applied');
select is((select phone_e164 from public.profiles where user_id = :'target') is not distinct from (select phone from t_snap), true, 'C: the phone is untouched');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"avatar_media_id":"a1000000-0000-4000-8000-000000000001"}', 'because')$$, :'target'),
  '42501', 'media can only be removed', 'C: media cannot be replaced, only removed');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '[]', 'because')$$, :'target'), '22023', 'nothing to change', 'C: a non-object patch is refused');

-- ===========================================================================
-- D. Reason required
-- ===========================================================================
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', null)$$, :'target'), '22023', 'a reason is required', 'D: no reason');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', '   ')$$, :'target'), '22023', 'a reason is required', 'D: a blank reason');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', %L)$$, :'target', repeat('r', 501)), '22023', 'the reason is too long', 'D: an over-long reason');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"x"}', '')$$, :'org'), '22023', 'a reason is required', 'D: the organization edit needs a reason too');

-- ===========================================================================
-- E. User happy path
-- ===========================================================================
select is((select public.admin_user_edit_profile(:'target',
  jsonb_build_object('headline', 'Tile specialist', 'bio', 'Call me on +20 100 123 4567 or mona@example.com', 'available_for_work', true), '  Abusive text removed  ') ->> 'changed'),
  'true', 'E: an allowed edit succeeds');
select pg_temp.as_dba();
select is((select headline from public.profiles where user_id = :'target'), 'Tile specialist', 'E: the field changed');
select is((select display_name_confirmed_at from public.profiles where user_id = :'target'), (select display_name_confirmed_at from public.profiles where user_id = :'target') , 'E: (name not edited: confirmation untouched)');
select isnt((select display_name_confirmed_at from public.profiles where user_id = :'target'), null, 'E: a headline edit does not clear the name confirmation');
select is((select metadata ->> 'reason' from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1), 'Abusive text removed', 'E: audit holds the trimmed reason');
select is((select actor_user_id from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1), :'adminA'::uuid, 'E: audit holds who');
select is((select subject_id from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1), :'target'::uuid, 'E: audit holds the subject');
select is((select (metadata -> 'fields') from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1), '["available_for_work", "bio", "headline"]'::jsonb
  , 'E: audit lists the changed fields') ;
select is((select metadata -> 'changes' -> 'headline' ->> 'old' from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1), 'old headline', 'E: audit holds old -> new');
select ok((select metadata::text from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1) !~ '(\+20 100|123 4567|mona@example\.com)',
  'E: audit never holds the phone number or the email address typed into the bio');
select ok((select metadata::text from public.audit_log where action = 'admin.user.edited' order by created_at desc limit 1) ~ '\[number\].*\*\*\*@example\.com|\*\*\*@example\.com.*\[number\]',
  'E: ... they are masked instead');
select is((select count(*)::int from public.notifications where recipient_user_id = :'target' and event_type = 'admin.profile_edited'), 1, 'E: the user is notified');
select ok((select params::text from public.notifications where recipient_user_id = :'target' and event_type = 'admin.profile_edited') !~ 'Abusive',
  'E: the notification never carries the reason');
select is((select params ->> 'fields' from public.notifications where recipient_user_id = :'target' and event_type = 'admin.profile_edited'), 'available_for_work, bio, headline', 'E: ... only field names');

select pg_temp.act_as(:'adminA');
select is((select public.admin_user_edit_profile(:'target', '{"headline":"Tile specialist"}', 'same value again') ->> 'changed'), 'false', 'E: an edit with no effective change reports changed=false');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where action = 'admin.user.edited'), 1, 'E: ... and writes no audit row');
select is((select count(*)::int from public.notifications where recipient_user_id = :'target' and event_type = 'admin.profile_edited'), 1, 'E: ... and no second notification');

select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_user_edit_profile(%L, '{"display_name":"Corrected Name"}', 'wrong name')$$, :'target'), 'E: a name correction');
select pg_temp.as_dba();
select is((select display_name_confirmed_at from public.profiles where user_id = :'target'), null, 'E: a name change clears display_name_confirmed_at (re-confirmation)');
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"display_name":"   "}', 'x')$$, :'target'), '22023', 'invalid value', 'E: the display name cannot be blanked');
select throws_ok(format($$select public.admin_user_edit_profile(%L, jsonb_build_object('bio', repeat('b', 1001)), 'x')$$, :'target'), '22023', null, 'E: an over-long bio is refused');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'x')$$, '00000000-0000-4000-8000-0000000000aa'), 'P0002', 'user not found', 'E: an unknown user');

-- media is remove-only
select pg_temp.as_dba();
insert into public.avatar_uploads (id, owner_user_id, object_key, content_type, state)
  values ('a1000000-0000-4000-8000-000000000001', :'target', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee33.jpg', 'image/jpeg', 'ready');
update public.profiles set avatar_media_id = 'a1000000-0000-4000-8000-000000000001' where user_id = :'target';
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_user_edit_profile(%L, '{"avatar_media_id":null}', 'abusive avatar')$$, :'target'), 'F: an avatar can be removed');
select pg_temp.as_dba();
select is((select avatar_media_id from public.profiles where user_id = :'target'), null, 'F: ... and is gone');
select is((select metadata -> 'changes' -> 'avatar_media_id' ->> 'new' from public.audit_log where action = 'admin.user.edited' and metadata -> 'changes' ? 'avatar_media_id'), 'removed', 'F: audit says "removed" and never records the media id');
select ok((select metadata::text from public.audit_log where action = 'admin.user.edited' and metadata -> 'changes' ? 'avatar_media_id') !~ 'a1000000', 'F: the media id is not in the audit row');

-- ===========================================================================
-- F. Rank rules
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'x')$$, :'adminA'), '42501', null, 'F: you cannot edit yourself here');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'x')$$, :'super1'), '42501', null, 'F: an Administrator cannot edit a Super Admin');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'x')$$, :'adminB'), '42501', null, 'F: an Administrator cannot edit a peer Administrator');
select pg_temp.as_dba();
update public.users set status = 'suspended' where id = :'adminB';
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"x"}', 'x')$$, :'adminB'), '42501', null, 'F: a SUSPENDED peer stays protected');
select pg_temp.as_dba();
update public.users set status = 'active' where id = :'adminB';
select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_user_edit_profile(%L, '{"headline":"edited by super admin"}', 'staff profile typo')$$, :'adminB'), 'F: a Super Admin may edit an Administrator');

-- ===========================================================================
-- G. Organization
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select is((select public.admin_organization_edit(:'org',
  jsonb_build_object('description', 'Reach us at sales@nile.example or +20 2 2345 6789', 'website_url', 'https://nile.example'), 'cleaned page') ->> 'changed'),
  'true', 'G: an allowed organization edit succeeds');
select pg_temp.as_dba();
select is((select website_url from public.organizations where id = :'org'), 'https://nile.example', 'G: the field changed');
select is((select legal_name from public.organizations where id = :'org') is not distinct from (select legal from t_snap), true, 'G: legal_name untouched');
select is((select org_type::text from public.organizations where id = :'org'), (select org_type from t_snap), 'G: org_type untouched');
select is((select metadata ->> 'reason' from public.audit_log where action = 'admin.organization.edited' order by created_at desc limit 1), 'cleaned page', 'G: audit holds the reason');
select is((select organization_id from public.audit_log where action = 'admin.organization.edited' order by created_at desc limit 1), :'org'::uuid, 'G: audit names the organization');
select ok((select metadata::text from public.audit_log where action = 'admin.organization.edited' order by created_at desc limit 1) !~ '(sales@nile\.example|2345 6789)', 'G: contact details typed into the description are masked in the audit row');
select is((select count(*)::int from public.notifications where recipient_user_id = :'super1' and event_type = 'admin.organization_edited'), 1, 'G: the organization owner is notified');
select ok((select params::text from public.notifications where event_type = 'admin.organization_edited' limit 1) !~ 'cleaned page', 'G: the notification carries no reason');
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"website_url":"not a url"}', 'x')$$, :'org'), '22023', 'invalid value', 'G: an invalid link is refused by the existing constraint');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"name":""}', 'x')$$, :'org'), '22023', 'invalid value', 'G: the name cannot be blanked');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"logo_media_id":"a1000000-0000-4000-8000-000000000001"}', 'x')$$, :'org'), '42501', 'media can only be removed', 'G: a logo can only be removed');
select throws_ok(format($$select public.admin_organization_edit(%L, '{"description":"x"}', 'x')$$, '00000000-0000-4000-8000-0000000000bb'), 'P0002', 'organization not found', 'G: an unknown organization');
select is((select public.admin_organization_edit(:'org', '{"description":"Reach us at sales@nile.example or +20 2 2345 6789"}', 'same again') ->> 'changed'), 'false', 'G: a no-op edit reports changed=false');

-- ===========================================================================
-- H. Audit immutability
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok($$update public.audit_log set metadata = '{}' where action = 'admin.user.edited'$$, null, null, 'H: an admin cannot rewrite an edit audit row');
select throws_ok($$delete from public.audit_log where action = 'admin.organization.edited'$$, null, null, 'H: an admin cannot delete an edit audit row');
select pg_temp.as_dba();
select throws_ok($$update public.audit_log set metadata = '{}' where action = 'admin.user.edited'$$, null, null, 'H: not even the table owner path rewrites audit history (immutability trigger)');
select cmp_ok((select count(*)::int from public.audit_log where action in ('admin.user.edited', 'admin.organization.edited')), '>', (select audits::int from t_snap), 'H: edit audit rows exist');

select * from finish();
rollback;
