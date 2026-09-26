-- pgTAP: the FINAL approved Tradespeople vocabulary (product-owner sign-off
-- 2026-09-24). Exactly 14 active, all selectable by a freshly registered
-- Tradesperson; the 7 legacy trades inactive and never newly selectable;
-- plastering_and_gypsum present and active; foutek_installation keeps its key
-- (only its display label is "Futec" — i18n, not data); nothing extra.
create extension if not exists pgtap;

begin;
select plan(11);

select set_eq(
  $$ select key from public.trades where is_active $$,
  $$ values ('wallpaper_installation'), ('gypsum_board_installation'),
            ('wood_alternative_installation'), ('marble_alternative_installation'),
            ('vinyl_flooring_installation'), ('hdf_flooring_installation'),
            ('painting'), ('spray_paint_and_foundation'), ('decorative_paints'),
            ('astarji'), ('plastering_and_gypsum'), ('epoxy_flooring'),
            ('door_installation'), ('foutek_installation') $$,
  'the active set is exactly the 14 approved specializations');
select is((select count(*)::int from public.trades where is_active), 14, 'exactly 14 are active');
select set_eq(
  $$ select key from public.trades where not is_active $$,
  $$ values ('kitchens_doors'), ('plumbing'), ('electrical'), ('hvac'),
            ('gypsum_paint'), ('tiling'), ('marble_granite') $$,
  'the 7 legacy trades are inactive and still present (readable history)');
select is((select count(*)::int from public.trades), 21, 'no extra trade exists (14 + 7)');
select is((select count(*)::int from public.trades where key = 'plastering_and_gypsum' and is_active), 1,
  'plastering_and_gypsum exists once and is active');
select is((select count(*)::int from public.trades where key = 'foutek_installation'), 1,
  'foutek_installation keeps its key');
select is((select count(*)::int from public.trades where key ilike '%futec%'), 0,
  'no renamed/duplicate futec key was created');

-- A freshly registered Tradesperson can select ALL 14.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
values ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'p63-t@example.test', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$,
  'a fresh Tradesperson registers');
select lives_ok($$ select public.user_trades_set(array(select key from public.trades order by sort_order)) $$,
  'and saves every trade they can see in one whole-set write');
select is((select count(*)::int from public.user_trades ut join public.trades t on t.id = ut.trade_id
            where ut.user_id = '63000000-0000-4000-8000-000000000001' and t.is_active), 14,
  'all 14 active specializations are held');
select throws_ok($$ select public.user_trades_set(array['plastering_and_gypsum', 'plumbing']) $$,
  '22023', 'trade is not available', 'a legacy trade still cannot be newly selected');

select * from finish();
rollback;
