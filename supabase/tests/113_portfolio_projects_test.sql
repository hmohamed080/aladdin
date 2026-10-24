-- pgTAP: portfolio projects (20261024090010): 15 projects, 6 photos and videos per
-- project, attach, cover, drag-and-drop order, publication and the public projection.
create extension if not exists pgtap;

begin;
select plan(33);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
\set pro '70000009-0000-4000-8000-000000000009'
\set other '70000003-0000-4000-8000-000000000003'
\set c_pro '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}'
\set c_other '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
select id as profile from public.profiles where user_id = :'pro' \gset

-- Fixture photos become ready without bytes; byte verification is proven by the media suites.
alter table public.portfolio_items disable trigger portfolio_verified_before_ready;

-- ---------------------------------------------------------------- privileges
select ok(not has_table_privilege('authenticated', 'public.portfolio_projects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.portfolio_projects', 'UPDATE')
  and not has_table_privilege('anon', 'public.portfolio_projects', 'SELECT'), 'clients only read their own projects');
select ok(not has_function_privilege('anon', 'public.portfolio_project_create(text,text,text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.public_portfolio_projects(uuid)', 'EXECUTE'), 'writers are authenticated-only; the projection is public');

-- ---------------------------------------------------------------- create
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select set_config('t.p1', public.portfolio_project_create('Villa kitchen', 'New Cairo', 'Full marble wall')::text, true);
select ok(current_setting('t.p1') ~ '^[0-9a-f-]{36}$', 'a project is created');
select throws_ok($$select public.portfolio_project_create('   ', null, null)$$, '23514', null, 'a project needs a title');
select is((select visibility::text from public.portfolio_projects where id = current_setting('t.p1')::uuid), 'private', 'a new project is private');

-- 15 projects at most.
select public.portfolio_project_create('Project ' || n, null, null) from generate_series(2, 15) n;
select throws_ok($$select public.portfolio_project_create('Sixteenth', null, null)$$, '23514',
  'a portfolio can have at most 15 projects', 'a sixteenth project is refused');

-- ---------------------------------------------------------------- attach (6 at most)
select set_config('t.i' || n, (select item_id::text from public.portfolio_item_create('Photo ' || n, null, 'image/jpeg')), true)
  from generate_series(1, 7) n;
select lives_ok(format($$select public.portfolio_project_attach(%L, 'image', %L)$$, current_setting('t.p1'), current_setting('t.i' || n)),
  'photo ' || n || ' joins the project') from generate_series(1, 5) n;
select set_config('t.v1', public.video_upload_begin('portfolio', null, 'Walkthrough', 'video/mp4', 4096)::text, true);
select lives_ok(format($$select public.portfolio_project_attach(%L, 'video', %L)$$, current_setting('t.p1'), current_setting('t.v1')),
  'a video joins the same project');
select throws_ok(format($$select public.portfolio_project_attach(%L, 'image', %L)$$, current_setting('t.p1'), current_setting('t.i7')),
  '23514', 'a portfolio project can have at most 6 photos and videos', 'a seventh item is refused (photos and videos count together)');
select throws_ok(format($$select public.portfolio_project_attach(%L, 'image', %L)$$,
    (select id from public.portfolio_projects where title = 'Project 2'), current_setting('t.i1')),
  '42501', 'portfolio item not found', 'an item already in a project cannot be attached again');

-- Removing one frees a place.
select lives_ok(format('select public.portfolio_item_delete(%L)', current_setting('t.i5')), 'a photo is deleted');
select lives_ok(format($$select public.portfolio_project_attach(%L, 'image', %L)$$, current_setting('t.p1'), current_setting('t.i7')),
  'the freed place takes another photo');

-- ---------------------------------------------------------------- another owner
set local request.jwt.claims = :'c_other';
select throws_ok(format($$select public.portfolio_project_update(%L, 'Mine now', null, null)$$, current_setting('t.p1')),
  '42501', 'portfolio project not found', 'another person cannot edit the project');
select is((select count(*)::int from public.portfolio_projects), 0, 'and cannot see it');
set local request.jwt.claims = :'c_pro';

-- ---------------------------------------------------------------- cover and order
select lives_ok(format($$select public.portfolio_project_set_cover(%L, 'image', %L)$$, current_setting('t.p1'), current_setting('t.i3')),
  'a photo of the project becomes its cover');
select throws_ok(format($$select public.portfolio_project_set_cover(%L, 'image', %L)$$, current_setting('t.p1'), current_setting('t.i6')),
  '42501', 'portfolio item not found', 'an item outside the project cannot be its cover');

select set_config('t.before', (select string_agg(sort_order::text, ',' order by sort_order) from (
  select sort_order from public.portfolio_items where project_id = current_setting('t.p1')::uuid and state <> 'deleted'
  union all select sort_order from public.media_videos where project_id = current_setting('t.p1')::uuid) s), true);
select lives_ok(format($$select public.portfolio_project_reorder(%L, %L::jsonb)$$, current_setting('t.p1'),
  jsonb_build_array(
    jsonb_build_object('kind', 'video', 'id', current_setting('t.v1')),
    jsonb_build_object('kind', 'image', 'id', current_setting('t.i7')),
    jsonb_build_object('kind', 'image', 'id', current_setting('t.i4')),
    jsonb_build_object('kind', 'image', 'id', current_setting('t.i3')),
    jsonb_build_object('kind', 'image', 'id', current_setting('t.i2')),
    jsonb_build_object('kind', 'image', 'id', current_setting('t.i1')))), 'the project is reordered by drag and drop');
select ok((select sort_order from public.media_videos where id = current_setting('t.v1')::uuid)
  < (select sort_order from public.portfolio_items where id = current_setting('t.i1')::uuid), 'the video now comes first');
select is((select string_agg(sort_order::text, ',' order by sort_order) from (
  select sort_order from public.portfolio_items where project_id = current_setting('t.p1')::uuid and state <> 'deleted'
  union all select sort_order from public.media_videos where project_id = current_setting('t.p1')::uuid) s),
  current_setting('t.before'), 'the project keeps the positions it held, so nothing outside it moves');
select throws_ok(format($$select public.portfolio_project_reorder(%L, %L::jsonb)$$, current_setting('t.p1'),
  jsonb_build_array(jsonb_build_object('kind', 'image', 'id', current_setting('t.i1')))),
  '22023', 'the order must list every item of the project once', 'a partial order is refused');

-- ---------------------------------------------------------------- publication
-- Photos 1-4 and 7 are made ready; the video is still uploading.
reset role;
update public.portfolio_items set state = 'ready'
 where id in (current_setting('t.i1')::uuid, current_setting('t.i2')::uuid, current_setting('t.i3')::uuid,
              current_setting('t.i4')::uuid, current_setting('t.i7')::uuid);
set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.portfolio_project_set_visibility(%L, true)', current_setting('t.p1')), 'the project is published');
select is((select count(*)::int from public.portfolio_items where project_id = current_setting('t.p1')::uuid and visibility = 'public'),
  5, 'its ready photos are published with it');
reset role;
update public.media_videos set state = 'ready', revision = gen_random_uuid(), renditions = array['360p'], duration_seconds = 4
 where id = current_setting('t.v1')::uuid;
select is((select visibility::text from public.media_videos where id = current_setting('t.v1')::uuid), 'public',
  'a video that finishes processing inside a published project is published with it');

select is((select cover_id from public.public_portfolio_projects(:'profile') where id = current_setting('t.p1')::uuid),
  current_setting('t.i3')::uuid, 'the public projection shows the chosen cover');
select is((select count(*)::int from public.public_portfolio_project_media(:'profile') where project_id = current_setting('t.p1')::uuid),
  6, 'and every published photo and video of the project');
select is((select count(*)::int from public.public_portfolio_projects(:'profile') where id <> current_setting('t.p1')::uuid),
  0, 'private and empty projects are not shown');

set local role authenticated;
set local request.jwt.claims = :'c_pro';
select lives_ok(format('select public.portfolio_project_set_visibility(%L, false)', current_setting('t.p1')), 'unpublishing the project');
select is((select count(*)::int from public.public_portfolio_project_media(:'profile')), 0, 'withdraws every item at once');

-- ---------------------------------------------------------------- delete
select throws_ok(format('select public.portfolio_project_delete(%L)', current_setting('t.p1')), '55000', null,
  'a project with photos or videos cannot be removed directly');
reset role;
alter table public.portfolio_items enable trigger portfolio_verified_before_ready;

select * from finish();
rollback;
