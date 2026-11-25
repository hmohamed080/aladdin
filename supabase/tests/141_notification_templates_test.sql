-- pgTAP: admin-managed notification templates (20261121090003_notification_templates.sql).
--
--   A. SEED         — the Phase 1 templates exist with Arabic + English defaults and declared variables.
--   B. WHO          — view = Administrator and higher; edit/reset = Super Admin only; plain users refused.
--   C. GUARDS       — mandatory reason, undeclared variable, empty/over-long text, unknown template, no-op writes nothing.
--   D. HISTORY      — who/when/reason, append-only, reset restores the default.
--   E. WRITER       — app.notify_from_template renders both languages, snapshots them, ignores later edits,
--                     renders a missing variable empty, refuses an unknown key, is closed to clients.
create extension if not exists pgtap;

begin;
select plan(30);

\set sup  '6e000000-0000-4000-8000-000000000001'
\set adm  '6e000000-0000-4000-8000-000000000002'
\set nobody '6e000000-0000-4000-8000-000000000003'
\set owner '6e000000-0000-4000-8000-000000000004'
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'sup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nt-sup@probe.test', now(), '{}', now(), now()),
  (:'adm', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nt-adm@probe.test', now(), '{}', now(), now()),
  (:'nobody', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nt-nobody@probe.test', now(), '{}', now(), now()),
  (:'owner', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nt-owner@probe.test', now(), '{}', now(), now());
insert into public.admin_role_assignments (user_id, role_id) select :'sup', id from public.admin_roles where key = 'super_admin';
insert into public.admin_role_assignments (user_id, role_id) select :'adm', id from public.admin_roles where key = 'administrator';

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

-- A. SEED -------------------------------------------------------------------
-- later features add templates of their own (the Marketplace stock notices, plan PR 7): this file counts the Phase 1 six
select is((select count(*)::int from public.notification_templates where key not like 'marketplace.stock.%' and key not like 'marketplace.order.%' and key not like 'marketplace.return.%'), 6, 'A1 six Phase 1 templates are seeded');
select is((select count(*)::int from public.notification_templates
            where key not like 'marketplace.stock.%' and key not like 'marketplace.order.%' and key not like 'marketplace.return.%' and char_length(default_title_ar) > 0 and char_length(default_title_en) > 0
              and char_length(default_body_ar) > 0 and char_length(default_body_en) > 0), 6,
          'A2 every template has Arabic and English defaults');
select is((select count(*)::int from public.notification_templates t
            where not (app.template_variables(t.default_title_ar || ' ' || t.default_body_ar || ' ' || t.default_title_en || ' ' || t.default_body_en) <@ t.variables)), 0,
          'A3 the seeded texts only use variables the template declares');
select ok((select bool_and(event_type = key) from public.notification_templates), 'A4 every seeded template key is its own event type');

-- B. WHO --------------------------------------------------------------------
select pg_temp.act_as(:'nobody');
select throws_ok($$select * from public.admin_notification_templates()$$, '42501', null, 'B1 a plain user cannot list templates');
select pg_temp.back();
select pg_temp.act_as(:'adm');
select is((select count(*)::int from public.admin_notification_templates() where key not like 'marketplace.stock.%' and key not like 'marketplace.order.%' and key not like 'marketplace.return.%'), 6, 'B2 an Administrator can list the templates');
select throws_ok($$select public.admin_notification_template_set('marketplace.seller.approved', 'ع', 'ع {message}', 'T', 'T {message}', 'سبب صحيح')$$,
                 '42501', null, 'B3 an Administrator cannot edit (view only)');
select pg_temp.back();

-- C. GUARDS + D. HISTORY (as Super Admin) ------------------------------------
select pg_temp.act_as(:'sup');
select throws_ok($$select public.admin_notification_template_set('marketplace.seller.approved', 'عنوان', 'نص {message}', 'Title', 'Body {message}', 'x')$$,
                 '22023', null, 'C1 a reason is mandatory');
select throws_ok($$select public.admin_notification_template_set('marketplace.seller.approved', 'عنوان', 'نص {secret}', 'Title', 'Body {message}', 'سبب صحيح')$$,
                 '22023', 'the text uses an undeclared variable', 'C2 an undeclared variable is refused');
select throws_ok($$select public.admin_notification_template_set('marketplace.seller.approved', '', 'نص', 'Title', 'Body', 'سبب صحيح')$$,
                 '22023', null, 'C3 an empty text is refused');
select throws_ok($$select public.admin_notification_template_set('marketplace.seller.approved', 'عنوان', 'نص', 'Title', repeat('x', 501), 'سبب صحيح')$$,
                 '22023', null, 'C4 an over-long body is refused');
select throws_ok($$select public.admin_notification_template_set('nope.nothing', 'عنوان', 'نص', 'Title', 'Body', 'سبب صحيح')$$,
                 '22023', 'unknown template', 'C5 an unknown template is refused');
select pg_temp.back();
select is((select count(*)::int from public.notification_template_events), 0, 'C6 refused calls write no history');
select pg_temp.act_as(:'sup');

select is((public.admin_notification_template_set('marketplace.seller.approved', 'مرحبًا {showroom_name}', 'تم الاعتماد. {message}', 'Hello {showroom_name}', 'Approved. {message}', 'تحسين الصياغة')) ->> 'changed',
          'true', 'C7 a valid edit succeeds');
select is((public.admin_notification_template_set('marketplace.seller.approved', 'مرحبًا {showroom_name}', 'تم الاعتماد. {message}', 'Hello {showroom_name}', 'Approved. {message}', 'نفس النص')) ->> 'changed',
          'false', 'C8 saving the same text is a no-op');
select pg_temp.back();
select pg_temp.back();
select is((select count(*)::int from public.notification_template_events), 1, 'C9 only the real change wrote history');
select is((select actor_id from public.notification_template_events limit 1), :'sup'::uuid, 'D1 history records the actor');
select is((select (new_content ->> 'title_en') from public.notification_template_events limit 1), 'Hello {showroom_name}', 'D2 history records the new text');
select throws_ok($$update public.notification_template_events set reason = 'tamper'$$, '23514', null, 'D3 history is append-only (update)');
select throws_ok($$delete from public.notification_template_events$$, '23514', null, 'D4 history is append-only (delete)');

-- E. WRITER -----------------------------------------------------------------
-- the edited template is used for new notifications, with both languages rendered
select app.notify_from_template(:'owner', null, 'marketplace.seller.approved', 'organization', null, '/showroom/marketplace',
                                '{"showroom_name": "معرض النيل", "message": "مبروك"}'::jsonb);
select is((select content #>> '{ar,title}' from public.notifications where recipient_user_id = :'owner'), 'مرحبًا معرض النيل',
          'E1 the Arabic title is rendered with the variable');
select is((select content #>> '{en,body}' from public.notifications where recipient_user_id = :'owner'), 'Approved. مبروك',
          'E2 the English body is rendered with the variable');
-- a later edit never rewrites a stored notification
select pg_temp.act_as(:'sup');
select public.admin_notification_template_reset('marketplace.seller.approved', 'العودة للأصل');
select pg_temp.back();
select is((select content #>> '{en,title}' from public.notifications where recipient_user_id = :'owner'), 'Hello معرض النيل',
          'E3 a later reset does not change a stored notification');
-- a missing variable renders empty and never raises
select app.notify_from_template(:'owner', null, 'marketplace.seller.rejected', 'organization', null, '/showroom/marketplace', '{}'::jsonb);
select is((select content #>> '{en,title}' from public.notifications where event_type = 'marketplace.seller.rejected' and recipient_user_id = :'owner'),
          'Your showroom was not approved for the Marketplace', 'E4 the default text is used when no edit exists');
select throws_ok($$select app.notify_from_template(null, null, 'marketplace.seller.rejected', 'organization', null, '/x', '{}'::jsonb)$$,
                 '22023', null, 'E5 a missing recipient is refused');
select throws_ok($$select app.notify_from_template('6e000000-0000-4000-8000-000000000004', null, 'no.such_template', 'organization', null, '/x', '{}'::jsonb)$$,
                 '22023', 'unknown notification template no.such_template', 'E6 an unknown template key is refused');
-- a permitted template that repeats a variable can expand past the field limits: the write must still succeed
-- (a failure would roll back the caller, e.g. a seller approval) and every rendered field must stay within its limit.
-- The 300-character value is all quotes and backslashes, the worst case for JSON escaping.
select pg_temp.act_as(:'sup');
select public.admin_notification_template_set('marketplace.product.rejected',
  'عنوان {message}{message}{message}{message}', repeat('{message}', 10),
  'Title {message}{message}{message}{message}', repeat('{message}', 10), 'اختبار التمدد');
select pg_temp.back();
select lives_ok($$select app.notify_from_template('6e000000-0000-4000-8000-000000000004', null, 'marketplace.product.rejected', 'product', null, '/x',
  jsonb_build_object('message', repeat('"\', 150), 'product_name', 'p', 'showroom_name', 's'))$$,
  'E9 an expanding template still writes the notification');
select ok((select char_length(content #>> '{ar,body}') <= 500 and char_length(content #>> '{en,body}') <= 500
              and char_length(content #>> '{ar,title}') <= 120 and char_length(content #>> '{en,title}') <= 120
           from public.notifications where event_type = 'marketplace.product.rejected' and recipient_user_id = '6e000000-0000-4000-8000-000000000004'),
  'E10 every rendered field is cut to its limit');
-- closed to clients
select pg_temp.act_as(:'sup');
select throws_ok($$select app.notify_from_template('6e000000-0000-4000-8000-000000000004', null, 'marketplace.seller.rejected', 'organization', null, '/x', '{}'::jsonb)$$,
                 '42501', null, 'E7 no client role can call the writer');
select throws_ok($$select * from public.notification_templates$$, '42501', null, 'E8 the template table is closed to clients');
select pg_temp.back();

select * from finish();
rollback;
