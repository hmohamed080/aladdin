-- pgTAP: Marketplace PR 10 — saved buyer addresses (20261124100001_marketplace_buyer_addresses.sql).
--
--   A. SHAPE     — RLS, no client write grant, owner-only select, function privileges.
--   B. SAVE      — create, validation (place catalogue keys, pin, phone, control characters), idempotent retry.
--   C. CAP       — at most 10 per user.
--   D. DEFAULT   — first address is the default, one default at a time, delete promotes.
--   E. VERIFIED  — recipient mobile verified only when it is the account's own verified phone (derived, live).
--   F. READINESS — the contract PR 12 consumes.
--   G. ISOLATION — another buyer, anon, direct table writes; the event trail holds no values and is append-only.
--
-- Fixtures: seed-pilot users 70000001 (buyer A) and 70000002 (buyer B).
create extension if not exists pgtap;

begin;
select plan(45);

select set_config('t.a', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.b', '70000002-0000-4000-8000-000000000002', true);
select set_config('t.cairo_area', (select min(key) from app.place_cities where governorate_key = 'cairo'), true);
select set_config('t.giza_area', (select min(key) from app.place_cities where governorate_key = 'giza'), true);
delete from public.marketplace_buyer_addresses where user_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
update public.profiles set phone_e164 = null, phone_country_iso2 = null, phone_national = null, phone_verified_at = null
  where user_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);

create function pg_temp.addr(p_id text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'kind', 'home', 'governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'),
    'street', '12 Example Street', 'building', '4', 'floor_apartment', '3 / 7',
    'recipient_first_name', 'Test', 'recipient_last_name', 'Buyer', 'recipient_phone_e164', '+201999000001') || p_extra;
$$;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.marketplace_buyer_addresses'::regclass, 'public.marketplace_buyer_address_events'::regclass)), true,
  'A1. both tables have RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') and privilege_type <> 'SELECT'
             and table_name in ('marketplace_buyer_addresses', 'marketplace_buyer_address_events')), 0,
  'A2. no client write grant on either table');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee = 'anon' and table_name in ('marketplace_buyer_addresses', 'marketplace_buyer_address_events')), 0,
  'A3. anon has no grant at all');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'marketplace_buyer_address_events' and grantee in ('authenticated', 'service_role')), 0,
  'A4. the event trail has no API-role grant');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_buyer_addresses', 'marketplace_buyer_address_save', 'marketplace_buyer_address_delete',
                 'marketplace_buyer_address_set_default', 'marketplace_buyer_phone_status', 'marketplace_buyer_checkout_readiness')
             and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 6,
  'A5. the six RPCs are SECURITY DEFINER, empty search_path, authenticated-only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and (p.proname like 'marketplace_buyer_address%' or p.proname = 'marketplace_buyer_phone_is_verified')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'A6. the internal helpers have no client grant');

-- ===========================================================================
-- B. Save
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';

select is((public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a001')) ->> 'recipient_phone_verified')::boolean, false,
  'B1. a new address is saved; its recipient mobile is not verified (the account has no verified phone)');
select is((public.marketplace_buyer_addresses() -> 'items' -> 0 ->> 'governorate_key'), 'cairo', 'B2. it is listed with its governorate key');
select is((select count(*)::int from public.marketplace_buyer_addresses), 1, 'B3. the owner reads their own row through RLS');

select is((public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a001', '{"street":"99 Updated Road"}')) ->> 'street'), '99 Updated Road',
  'B4. the same id updates the same row (idempotent retry)');
select is((select count(*)::int from public.marketplace_buyer_addresses), 1, 'B5. a retry never creates a second row');

select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"governorate_key":"atlantis"}'))$$, '22023', null, 'B6. an unknown governorate is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', jsonb_build_object('governorate_key', 'giza', 'area_key', current_setting('t.cairo_area'))))$$, '22023', null,
  'B7. an area that belongs to another governorate is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"latitude":"48.85","longitude":"2.35"}'))$$, '22023', null, 'B8. a pin outside Egypt is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"latitude":"30.04"}'))$$, '22023', null, 'B9. latitude without longitude is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"recipient_phone_e164":"01999000001"}'))$$, '22023', null, 'B10. a non-E.164 recipient mobile is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"kind":"office"}'))$$, '22023', null, 'B11. only Home / Work / Other');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', E'{"street":"bad\\nline"}'))$$, '22023', null, 'B12. control characters are refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a002', '{"street":"x"}'))$$, '22023', null, 'B13. a too-short street is refused');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('not-a-uuid'))$$, '22023', null, 'B14. the id must be a UUID');
select lives_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a003', '{"kind":"work","location_source":"map","latitude":"30.044420","longitude":"31.235712"}'))$$,
  'B15. a map pin inside Egypt is accepted');

-- ===========================================================================
-- D. Default
-- ===========================================================================
select is((select count(*)::int from public.marketplace_buyer_addresses where is_default), 1, 'D1. exactly one default');
select is((select id::text from public.marketplace_buyer_addresses where is_default), 'a0000000-0000-4000-8000-00000000a001', 'D2. the first address became the default');
select is(public.marketplace_buyer_address_set_default('a0000000-0000-4000-8000-00000000a003'), true, 'D3. another address can be made the default');
select is((select id::text from public.marketplace_buyer_addresses where is_default), 'a0000000-0000-4000-8000-00000000a003', 'D4. and it is the only one');
select is(public.marketplace_buyer_address_delete('a0000000-0000-4000-8000-00000000a003'), true, 'D5. deleting the default succeeds');
select is((select id::text from public.marketplace_buyer_addresses where is_default), 'a0000000-0000-4000-8000-00000000a001', 'D6. the oldest remaining address becomes the default');
select is(public.marketplace_buyer_address_delete('a0000000-0000-4000-8000-00000000a003'), false, 'D7. deleting again is a no-op (idempotent)');

-- ===========================================================================
-- E. Verified recipient mobile (derived from the authority's proof)
-- ===========================================================================
reset role;
update public.profiles set phone_e164 = '+201999000001', phone_country_iso2 = 'EG', phone_national = '01999000001', phone_verified_at = null
  where user_id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_buyer_addresses() -> 'items' -> 0 ->> 'recipient_phone_verified')::boolean, false, 'E1. the account phone exists but is not proven: not verified');
reset role;
update public.profiles set phone_verified_at = now() where user_id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_buyer_addresses() -> 'items' -> 0 ->> 'recipient_phone_verified')::boolean, true, 'E2. the address whose recipient mobile is the proven account phone is verified');
select is((public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a004', '{"recipient_phone_e164":"+201999000099"}')) ->> 'recipient_phone_verified')::boolean, false,
  'E3. someone else''s number is stored but never verified');
reset role;
update public.profiles set phone_e164 = '+201999000002', phone_country_iso2 = 'EG', phone_national = '01999000002' where user_id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select bool_or((i ->> 'recipient_phone_verified')::boolean) from jsonb_array_elements(public.marketplace_buyer_addresses() -> 'items') i), false,
  'E4. changing the account phone un-verifies every address (the authority clears its proof)');

-- ===========================================================================
-- F. Readiness
-- ===========================================================================
select is(public.marketplace_buyer_checkout_readiness() -> 'missing', '["phone_unverified"]'::jsonb, 'F1. default address, unverified mobile: phone_unverified');
reset role;
update public.profiles set phone_e164 = '+201999000001', phone_national = '01999000001', phone_verified_at = now() where user_id = current_setting('t.a')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.marketplace_buyer_checkout_readiness() ->> 'ready', 'true', 'F2. verified mobile on the default address: ready');
select is(public.marketplace_buyer_checkout_readiness('a0000000-0000-4000-8000-00000000a004') -> 'missing', '["phone_unverified"]'::jsonb, 'F3. an address with another number is not ready');

-- ===========================================================================
-- C. Cap
-- ===========================================================================
do $$ begin
  for i in 5..12 loop
    perform public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0')));
  end loop;
end $$;
select is((select count(*)::int from public.marketplace_buyer_addresses), 10, 'C1. ten addresses saved');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-0000000000ff'))$$, '54000', null, 'C2. the eleventh is refused');
select lives_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a001', '{"nickname":"Mum"}'))$$, 'C3. updating an existing address at the cap still works');

-- ===========================================================================
-- G. Isolation, direct writes, events
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_buyer_addresses), 0, 'G1. another buyer reads none of them');
select is(public.marketplace_buyer_address_delete('a0000000-0000-4000-8000-00000000a001'), false, 'G2. another buyer cannot delete it');
select throws_ok($$select public.marketplace_buyer_address_save(pg_temp.addr('a0000000-0000-4000-8000-00000000a001'))$$, '42501', null, 'G3. another buyer cannot overwrite it by reusing the id');
select throws_ok($$insert into public.marketplace_buyer_addresses (id, user_id, kind, governorate_key, street, recipient_first_name, recipient_last_name, recipient_phone_e164)
  values (gen_random_uuid(), '70000002-0000-4000-8000-000000000002', 'home', 'cairo', 'direct insert', 'a', 'b', '+201999000003')$$, '42501', null, 'G4. a direct INSERT is refused');
reset role;
set local role anon;
select throws_ok($$select public.marketplace_buyer_addresses()$$, '42501', null, 'G5. anon cannot call the RPCs');
reset role;
select is((select count(*)::int from public.marketplace_buyer_address_events where user_id = current_setting('t.a')::uuid and kind = 'created'), 11,
  'G6. every creation left an event (ten saved plus the deleted one)');
select throws_ok($$update public.marketplace_buyer_address_events set kind = 'deleted'$$, '23514', null, 'G7. the event trail is append-only');

select * from finish();
rollback;
