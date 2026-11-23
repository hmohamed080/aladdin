-- pgTAP: Marketplace seller approval v2 (20261123090001_marketplace_seller_approval_v2.sql).
--
--   A. REQUEST       — the showroom owner asks for approval; only an owner (org.manage) can; eligibility re-checked.
--   B. REJECT        — needs a reason; preset / custom owner message; the owner (only) is notified in both languages.
--   C. APPROVE       — reason optional; reversible after reject and revoke; revoke is no longer terminal; after a
--                      revoke the OWNER can request again (approval stays admin-only); custom message = AR + EN fields.
--   D. REASON RULES  — required for reject / suspend / revoke / reinstate, bounded, never both preset and custom.
--   E. PRESETS       — listed for seller admins, edited only under notification_templates.manage, audited.
--   F. OVERVIEW      — reports why an organization is not eligible; deleted organizations with an account stay listed.
--   G. PRIVILEGE     — no client role can run the internal functions; old signatures stay next to the new ones
--                      (expand/contract) and a V1 call is not ambiguous; new tables closed.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001: org.manage), staff 55555555 (administrator).
-- Created here: a Super Admin, a manager without org.manage in A, and a plain user.
create extension if not exists pgtap;

begin;
select plan(67);

\set a '9c000000-cccc-4ccc-8ccc-000000000001'
\set owner '70000001-0000-4000-8000-000000000001'
\set adm '55555555-5555-4555-8555-555555555555'
\set sup '6f000000-0000-4000-8000-000000000001'
\set mgr '6f000000-0000-4000-8000-000000000002'
\set nobody '6f000000-0000-4000-8000-000000000003'

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'sup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-sup@probe.test', now(), '{}', now(), now()),
  (:'mgr', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-mgr@probe.test', now(), '{}', now(), now()),
  (:'nobody', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-nobody@probe.test', now(), '{}', now(), now());
insert into public.users (id) select v.id::uuid from (values (:'sup'), (:'mgr'), (:'nobody')) v(id)
  where not exists (select 1 from public.users u where u.id = v.id::uuid);
update auth.users set email_confirmed_at = now() where id in (:'owner', :'adm');
insert into public.admin_role_assignments (user_id, role_id) select :'sup', id from public.admin_roles where key = 'super_admin';
-- a manager of A who is NOT an owner (org.members.manage only)
insert into public.memberships (id, user_id, organization_id, status, accepted_at)
  values ('6f000000-0000-4000-8000-0000000000a2', :'mgr', :'a', 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
  values ('6f000000-0000-4000-8000-0000000000a2', 'org.members.manage');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.preset(p_action text, p_order integer default 10) returns uuid language sql security definer as $$
  select id from public.marketplace_seller_message_presets where action = p_action and sort_order = p_order;
$$;

create function pg_temp.preset_text_ar(p_action text) returns text language sql security definer as $$
  select text_ar from public.marketplace_seller_message_presets where action = p_action and sort_order = 10;
$$;

-- A. REQUEST ----------------------------------------------------------------
select pg_temp.act_as(:'mgr');
select throws_ok($$select public.marketplace_seller_request_approval('9c000000-cccc-4ccc-8ccc-000000000001')$$,
  '42501', null, 'A1 a manager without org.manage cannot request approval');
select pg_temp.back();
select pg_temp.act_as(:'nobody');
select throws_ok($$select public.marketplace_seller_request_approval('9c000000-cccc-4ccc-8ccc-000000000001')$$,
  '42501', null, 'A2 a stranger cannot request approval');
select pg_temp.back();

update public.organizations set status = 'suspended' where id = :'a';
select pg_temp.act_as(:'owner');
select throws_ok($$select public.marketplace_seller_request_approval('9c000000-cccc-4ccc-8ccc-000000000001')$$,
  '42501', null, 'A3 an organization that is not active has no owner authority at all, so it cannot request');
select pg_temp.back();
update public.organizations set status = 'active' where id = :'a';

select pg_temp.act_as(:'owner');
select is(public.marketplace_seller_request_approval(:'a'), 'pending', 'A4 the owner requests approval');
select throws_ok($$select public.marketplace_seller_request_approval('9c000000-cccc-4ccc-8ccc-000000000001')$$,
  '23514', null, 'A5 a second request while pending is refused');
select pg_temp.back();
select is((select status from public.marketplace_seller_accounts where organization_id = :'a'), 'pending',
  'A6 the account is pending');
select is((select count(*)::int from public.marketplace_seller_account_events
            where organization_id = :'a' and action = 'requested' and from_status is null and to_status = 'pending'
              and reason is null and actor_user_id = :'owner'), 1,
  'A7 a `requested` event records the owner, with no reason');
select is((select count(*)::int from public.notifications where organization_id = :'a' and event_type like 'marketplace.seller.%'), 0,
  'A8 a request notifies nobody (it is not a decision)');
select pg_temp.act_as(:'owner');
select throws_ok($$select status_reason from public.marketplace_seller_accounts$$, '42501', null,
  'A9 the owner still cannot read the internal reason');
select pg_temp.back();

-- B. REJECT -----------------------------------------------------------------
select pg_temp.act_as(:'adm');
select throws_ok($$select public.admin_marketplace_seller_reject('9c000000-cccc-4ccc-8ccc-000000000001', null, null, null, null)$$,
  '22023', null, 'B1 a rejection needs a reason');
select throws_ok(format($$select public.admin_marketplace_seller_reject(%L, 'incomplete papers', %L, null, null)$$, :'a', pg_temp.preset('suspend')),
  '22023', null, 'B2 a preset of another action is refused');
select throws_ok(format($$select public.admin_marketplace_seller_reject(%L, 'incomplete papers', %L, 'نص', 'also custom')$$, :'a', pg_temp.preset('reject')),
  '22023', null, 'B3 a preset and a custom message together are refused');
select is(public.admin_marketplace_seller_reject(:'a', 'incomplete papers', pg_temp.preset('reject'), null, null), 'rejected',
  'B4 an admin rejects a pending request with a reason and a preset message');
select pg_temp.back();
select is((select owner_message_en from public.marketplace_seller_accounts where organization_id = :'a'),
  (select text_en from public.marketplace_seller_message_presets where action = 'reject' and sort_order = 10),
  'B5 the owner-facing preset text is stored on the account');
select is((select count(*)::int from public.notifications
            where recipient_user_id = :'owner' and event_type = 'marketplace.seller.rejected'
              and content -> 'ar' ->> 'body' like '%' || (select text_ar from public.marketplace_seller_message_presets where action = 'reject' and sort_order = 10) || '%'
              and content -> 'en' ->> 'body' like '%' || (select text_en from public.marketplace_seller_message_presets where action = 'reject' and sort_order = 10) || '%'
              and content -> 'en' ->> 'body' like '%' || (select name from public.organizations where id = :'a') || '%'), 1,
  'B6 the owner gets one notification with each language carrying its own preset text and the showroom name');
select is((select count(*)::int from public.notifications where recipient_user_id = :'mgr'), 0,
  'B7 a manager who is not an owner is not notified');
select is((select count(*)::int from public.notifications where content::text like '%incomplete papers%'), 0,
  'B8 the internal reason never reaches a notification');
select pg_temp.act_as(:'owner');
select is((select owner_message_ar from public.marketplace_seller_accounts), pg_temp.preset_text_ar('reject'),
  'B9 the owner can read the message of the decision');
select is(public.marketplace_seller_request_approval(:'a'), 'pending', 'B10 after a rejection the owner can request again');
select pg_temp.back();
select is((select owner_message_ar is null and status_reason is null from public.marketplace_seller_accounts where organization_id = :'a'), true,
  'B11 a new request clears the previous decision text');

-- C. APPROVE, REVOKE, REVERSIBILITY -----------------------------------------
select pg_temp.act_as(:'adm');
select throws_ok(format($$select public.admin_marketplace_seller_approve(%L, 'ab', null, null, null)$$, :'a'), '22023', null,
  'C1 an approval reason, when given, must still be 3-500 characters');
select throws_ok(format($$select public.admin_marketplace_seller_approve(%L, null, null, null, 'English only')$$, :'a'), '22023', null,
  'C1b a custom message in one language alone is refused (it is two separate fields)');
select throws_ok(format($$select public.admin_marketplace_seller_approve(%L, null, null, 'عربي فقط', null)$$, :'a'), '22023', null,
  'C1c ...in either language');
select is(public.admin_marketplace_seller_approve(:'a', null, null, 'مرحبًا، أضف منتجاتك', 'Welcome, please add your products'), 'approved',
  'C2 approving needs no reason; a custom owner message is accepted, Arabic and English separately');
select pg_temp.back();
select is((select status_reason is null and owner_message_ar = 'مرحبًا، أضف منتجاتك' and owner_message_en = 'Welcome, please add your products'
             from public.marketplace_seller_accounts where organization_id = :'a'), true,
  'C3 a custom message is stored per language (not one text copied to both), with no internal reason');
select is((select count(*)::int from public.notifications
            where recipient_user_id = :'owner' and event_type = 'marketplace.seller.approved'
              and content -> 'ar' ->> 'body' like '%مرحبًا، أضف منتجاتك%'
              and content -> 'ar' ->> 'body' not like '%Welcome%'
              and content -> 'en' ->> 'body' like '%Welcome, please add your products%'
              and content -> 'en' ->> 'body' not like '%مرحبًا%'), 1,
  'C4 each language of the approval notification carries its own custom text');
select pg_temp.act_as(:'owner');
select throws_ok(format($$select public.admin_marketplace_seller_revoke(%L, 'owner tries it', null, null, null)$$, :'a'), '42501', null,
  'C4b the owner cannot run an admin decision: approval and revocation stay admin-only');
select pg_temp.back();
select pg_temp.act_as(:'adm');
select throws_ok(format($$select public.admin_marketplace_seller_revoke(%L, null, null, null, null)$$, :'a'), '22023', null, 'C5 revoke needs a reason');
select throws_ok(format($$select public.admin_marketplace_seller_suspend(%L, '  ', null, null, null)$$, :'a'), '22023', null, 'C6 suspend needs a reason');
select is(public.admin_marketplace_seller_revoke(:'a', 'breach of terms', pg_temp.preset('revoke'), null, null), 'revoked', 'C7 an approved seller is revoked');
select throws_ok(format($$select public.marketplace_seller_request_approval(%L)$$, :'a'), '42501', null,
  'C8 the admin session is not the owner, so it cannot request on the owner''s behalf');
select is(public.admin_marketplace_seller_approve(:'a', null, null, null, null), 'approved', 'C9 REVOKE IS NOT TERMINAL: an admin can approve a revoked seller again');
select is(public.admin_marketplace_seller_suspend(:'a', 'review', pg_temp.preset('suspend'), null, null), 'suspended', 'C11 suspend an approved seller');
select throws_ok(format($$select public.admin_marketplace_seller_reinstate(%L, null, null, null, null)$$, :'a'), '22023', null, 'C12 reinstate needs a reason');
select is(public.admin_marketplace_seller_reinstate(:'a', 'review done', pg_temp.preset('reinstate'), null, null), 'approved', 'C13 reinstate a suspended seller');
select throws_ok(format($$select public.admin_marketplace_seller_reinstate(%L, 'not suspended', null, null, null)$$, :'a'), '23514', null,
  'C14 only a suspended seller can be reinstated');
select is(public.admin_marketplace_seller_revoke(:'a', 'second withdrawal', null, null, null), 'revoked', 'C15 revoked again');
select pg_temp.back();
select pg_temp.act_as(:'owner');
select is(public.marketplace_seller_request_approval(:'a'), 'pending',
  'C16 AFTER A REVOKE THE OWNER CAN REQUEST APPROVAL AGAIN (it only becomes pending: an admin still decides)');
select throws_ok(format($$select public.marketplace_seller_request_approval(%L)$$, :'a'), '23514', null,
  'C16b ...but not twice while it is pending');
select pg_temp.back();
select is((select status_reason is null and owner_message_ar is null and owner_message_en is null
             from public.marketplace_seller_accounts where organization_id = :'a'), true,
  'C16c a new request clears the revoke decision text');
select pg_temp.act_as(:'adm');
select is((select array_agg(action order by sequence) from public.admin_marketplace_seller_history_v2(:'a')),
  array['requested', 'rejected', 'requested', 'approved', 'revoked', 'approved', 'suspended', 'reinstated', 'revoked', 'requested']::text[],
  'C17 the history lists every transition, in order');
select pg_temp.back();

-- D. EVENT SHAPE ------------------------------------------------------------
select is((select count(*)::int from public.marketplace_seller_account_events
            where organization_id = :'a' and action not in ('requested', 'approved') and reason is null), 0,
  'D1 every reject / suspend / revoke / reinstate event carries a reason');
select throws_ok(format($$insert into public.marketplace_seller_account_events (organization_id, action, from_status, to_status, reason)
  values (%L, 'revoked', 'approved', 'revoked', null)$$, :'a'), '23514', null,
  'D2 the database itself refuses a revoke event without a reason');
select is((select preset_id from public.marketplace_seller_account_events where organization_id = :'a' and action = 'rejected'),
  pg_temp.preset('reject'), 'D3 an event remembers the preset it used');

select is((select reason from public.marketplace_seller_account_events where organization_id = :'a' and action = 'rejected'),
  'incomplete papers', 'D4 the internal decision reason stays in the audit event, independent of the notification template text');

-- E. PRESETS ----------------------------------------------------------------
select pg_temp.act_as(:'nobody');
select throws_ok($$select * from public.admin_marketplace_seller_presets()$$, '42501', null, 'E1 a plain user cannot list presets');
select pg_temp.back();
select pg_temp.act_as(:'adm');
select is((select count(*)::int from public.admin_marketplace_seller_presets() where is_active and action <> 'image_reject'), 10, 'E2 an Administrator sees the ten seeded seller-transition presets (image rejection presets come with PR 6)');
select throws_ok($$select public.admin_marketplace_seller_preset_save(null, 'reject', 'ل', 'L', 'ن', 'T', true, 5, 'adding one')$$,
  '42501', null, 'E3 an Administrator cannot edit presets');
select is((select count(*)::int from public.admin_marketplace_seller_presets() where action = 'reject' and is_active), 4,
  'E3b the structured rejection reasons: four seeded, each with a label and a text in Arabic AND English');
select pg_temp.back();
create temp table t_new (id uuid);
grant all on t_new to public;
select pg_temp.act_as(:'sup');
insert into t_new select public.admin_marketplace_seller_preset_save(null, 'reject', 'تجربة', 'Trial', 'نص تجريبي', 'Trial text', true, 5, 'adding one');
select is((select count(*)::int from t_new), 1, 'E4 a Super Admin creates a preset');
select throws_ok($$select public.admin_marketplace_seller_preset_save(null, 'reject', 'ل', 'L', 'ن', 'T', true, 5, '')$$,
  '22023', null, 'E5 an edit needs a reason');
select throws_ok(format($$select public.admin_marketplace_seller_preset_save(null, 'reject', 'ل', 'L', 'ن', %L, true, 5, 'too long')$$, repeat('x', 301)),
  '22023', null, 'E6 an over-long owner text is refused');
select throws_ok($$select public.admin_marketplace_seller_preset_save(null, 'delete', 'ل', 'L', 'ن', 'T', true, 5, 'bad action')$$,
  '22023', null, 'E7 an unknown action is refused');
select ok(public.admin_marketplace_seller_preset_save((select id from t_new), 'reject', 'تجربة', 'Trial', 'نص جديد', 'New text', false, 5, 'switching it off') is not null,
  'E8 a Super Admin deactivates a preset');
select pg_temp.back();
select is((select array_agg(action order by id) from public.marketplace_seller_preset_events where preset_id = (select id from t_new)),
  array['created', 'updated'], 'E9 each edit is audited');
select throws_ok($$update public.marketplace_seller_preset_events set reason = 'tampered'$$, '23514', null, 'E10 the preset audit is append-only');
select pg_temp.act_as(:'adm');
select is(public.admin_marketplace_seller_approve(:'a', null, null, null, null), 'approved', 'E11 the admin approves the re-request');
select pg_temp.back();
select pg_temp.act_as(:'adm');
select throws_ok(format($$select public.admin_marketplace_seller_suspend(%L, 'review', %L, null, null)$$, :'a', (select id from t_new)), '22023', null,
  'E12 an inactive preset cannot be used');
select pg_temp.back();

-- F. OVERVIEW ---------------------------------------------------------------
update public.organizations set status = 'suspended' where id = :'a';
select pg_temp.act_as(:'adm');
select is((select eligible is false and org_status = 'suspended' and org_type = 'showroom_dealer' and org_deleted is false
             from public.admin_marketplace_seller_overview_v2() where organization_id = :'a'), true,
  'F1 the overview says why an organization is not eligible (status)');
select pg_temp.back();
update public.organizations set status = 'active', deleted_at = now() where id = :'a';
select pg_temp.act_as(:'adm');
select is((select eligible is false and org_deleted is true from public.admin_marketplace_seller_overview_v2() where organization_id = :'a'), true,
  'F2 a deleted organization that holds a seller account stays listed, flagged deleted');
select pg_temp.back();
update public.organizations set deleted_at = null where id = :'a';

-- G. PRIVILEGE --------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_marketplace_seller_approve', 'admin_marketplace_seller_reject',
              'admin_marketplace_seller_suspend', 'admin_marketplace_seller_revoke', 'admin_marketplace_seller_reinstate',
              'admin_marketplace_seller_overview', 'admin_marketplace_seller_history')), 11,
  'G1 expand/contract: the V1 signatures (approve, suspend, revoke, reinstate, overview, history) stay next to the new ones');
select pg_temp.act_as(:'adm');
select throws_ok(format($$select public.admin_marketplace_seller_reinstate(%L, 'v1 call')$$, :'a'), '23514', null,
  'G1b a call with the V1 argument list resolves to the V1 function (no ambiguity) and keeps its V1 rules');
select pg_temp.back();
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                  unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where n.nspname = 'app' and p.proname in ('marketplace_seller_transition', 'notify_from_template')
              and has_function_privilege(r, p.oid, 'execute') and r <> 'public'), 0,
  'G2 no client role can run the transition or the notification writer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('marketplace_seller_request_approval', 'admin_marketplace_seller_reject',
              'admin_marketplace_seller_presets', 'admin_marketplace_seller_preset_save') and has_function_privilege('anon', p.oid, 'execute')), 0,
  'G3 anon can run none of the new RPCs');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('marketplace_seller_request_approval', 'admin_marketplace_seller_reject',
              'admin_marketplace_seller_presets', 'admin_marketplace_seller_preset_save') and has_function_privilege('authenticated', p.oid, 'execute')), 4,
  'G4 authenticated can run them (each re-checks its own permission)');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
              and table_name in ('marketplace_seller_message_presets', 'marketplace_seller_preset_events')), 0,
  'G5 the preset tables are closed to every client role');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relrowsecurity and c.relname in ('marketplace_seller_message_presets', 'marketplace_seller_preset_events')), 2,
  'G6 RLS is on for both preset tables');

select * from finish();
rollback;
