-- ===========================================================================
-- Marketplace PR 10 — saved buyer addresses (verified recipient mobile)
-- ===========================================================================
-- WHAT THIS IS. The buyer's saved delivery addresses (Part 4B of
-- docs/product/marketplace-requirements-walkthrough-20261119.md): Home / Work / Other, recipient first and
-- last name, recipient mobile, a place (governorate + optional area) that uses the SAME keys as the showroom
-- delivery areas of PR 8 (app.place_governorates / app.place_cities -> marketplace_delivery_rates), and an
-- optional map pin (latitude / longitude). Checkout (PR 12) reads these to price and promise delivery.
--
-- THE MOBILE IS VERIFIED BY THE EXISTING AUTHORITY, NOT BY THIS MIGRATION. There is no second code table,
-- no second sender and no second flag. "Verified" is DERIVED, live, from the one thing the phone
-- verification authority (20261030090001 phone_verification_*) writes: profiles.phone_verified_at for
-- the account's CURRENT primary phone. A recipient number is verified exactly when it equals that phone
-- and phone_verified_at is not null. If the account's phone changes, the authority's own trigger clears
-- phone_verified_at, so every address silently becomes unverified again with no extra write here. A
-- recipient number that is NOT the account's own verified number is stored but is never "verified" and so
-- never "ready": proving someone else's number would need the authority to grow a new purpose, which is an
-- owner decision (see docs/security/MARKETPLACE_ADDRESSES_PHONE.md).
--
-- SECURITY. RLS on, owner-only select, NO client write grant on either table. Every write is a SECURITY
-- DEFINER RPC bound to auth.uid() (a user id is never a parameter). Addresses and phones are personal data:
-- the append-only event trail stores only the kind of change and the address id, never a value, and has no
-- foreign key (an event outlives the account; the addresses themselves go with the account via cascade).
-- Per-user cap of 10 addresses, enforced under a per-user advisory lock so concurrent saves cannot overshoot.
-- Saving is idempotent: the client supplies the address id, so a retried request updates the same row.
--
-- ADDITIVE ONLY. New tables and functions; nothing existing is altered.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Saved addresses
-- ---------------------------------------------------------------------------
create table public.marketplace_buyer_addresses (
  id                   uuid        primary key,
  user_id              uuid        not null references public.users (id) on delete cascade,
  kind                 text        not null,
  nickname             text,
  governorate_key      text        not null,
  area_key             text        not null,
  district             text,
  street               text,
  building             text,
  floor                text,
  apartment            text,
  landmark             text,
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  -- how the location was fixed: typed in (manual), picked from the place catalogue search, the buyer's own device location (device), or a map pin
  location_source      text        not null default 'manual',
  recipient_first_name text        not null,
  recipient_last_name  text        not null,
  recipient_phone_e164 text        not null,
  is_default           boolean     not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ck_mp_buyer_addr_kind check (kind in ('home', 'work', 'other')),
  constraint ck_mp_buyer_addr_source check (location_source in ('manual', 'catalogue', 'device', 'map')),
  constraint ck_mp_buyer_addr_gov check (governorate_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint ck_mp_buyer_addr_area check (area_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint ck_mp_buyer_addr_phone check (recipient_phone_e164 ~ '^\+[1-9]\d{1,14}$'),
  constraint ck_mp_buyer_addr_text check (
    (street is null or char_length(street) between 3 and 160)
    and (nickname is null or char_length(nickname) between 1 and 40)
    and (district is null or char_length(district) between 1 and 80)
    and (building is null or char_length(building) between 1 and 40)
    and (floor is null or char_length(floor) between 1 and 20)
    and (apartment is null or char_length(apartment) between 1 and 20)
    and (landmark is null or char_length(landmark) between 1 and 120)
    and char_length(recipient_first_name) between 1 and 40
    and char_length(recipient_last_name) between 1 and 40),
  -- an Egypt bounding box (a pin outside the country is a mistake, not a delivery address); both or neither
  -- Without coordinates street, building, floor, apartment and landmark are ALL required; with coordinates (device location or pin) they are optional.
  -- The governorate and the area are ALWAYS required: the delivery fee and estimate are computed from those keys.
  constraint ck_mp_buyer_addr_where check (latitude is not null or (street is not null and building is not null and floor is not null and apartment is not null and landmark is not null)),
  constraint ck_mp_buyer_addr_pin check (
    (latitude is null and longitude is null)
    or (latitude between 21.5 and 31.95 and longitude between 24.5 and 37.0))
);
comment on table public.marketplace_buyer_addresses is
  'Saved buyer delivery addresses. PERSONAL DATA (name, phone, street, landmark, coordinates): owner-only RLS, no client write grant, written only by the marketplace_buyer_address_* RPCs. governorate_key / area_key are the keys of app.place_governorates / app.place_cities, the same keys marketplace_delivery_rates uses, so a showroom delivery quote can be priced from a saved address. Never log or put these values in a URL.';
comment on column public.marketplace_buyer_addresses.recipient_phone_e164 is
  'Canonical E.164 recipient mobile. Whether it is VERIFIED is derived, never stored: it equals profiles.phone_e164 and profiles.phone_verified_at is not null (the phone verification authority is the only writer of that proof).';

create index ix_mp_buyer_addresses_user on public.marketplace_buyer_addresses (user_id, created_at);
create unique index ux_mp_buyer_addresses_default on public.marketplace_buyer_addresses (user_id) where is_default;

create trigger set_mp_buyer_addresses_updated_at
  before update on public.marketplace_buyer_addresses
  for each row execute function app.set_updated_at();

alter table public.marketplace_buyer_addresses enable row level security;
revoke all on public.marketplace_buyer_addresses from public, anon, authenticated, service_role;
grant select on public.marketplace_buyer_addresses to authenticated;
create policy mp_buyer_addresses_select_owner on public.marketplace_buyer_addresses
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Append-only event trail (no values, no foreign keys)
-- ---------------------------------------------------------------------------
create table public.marketplace_buyer_address_events (
  id         bigint      generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid        not null,
  address_id uuid        not null,
  kind       text        not null,
  constraint ck_mp_buyer_addr_events_kind check (kind in ('created', 'updated', 'deleted', 'default_set'))
);
comment on table public.marketplace_buyer_address_events is
  'Append-only trail of address changes: who (user id), which address id, what kind. Deliberately holds NO address or phone value and has no foreign keys (audit outlives the account). Private: RLS on, no policy, no API-role privilege.';
create index ix_mp_buyer_addr_events_user on public.marketplace_buyer_address_events (user_id, at desc);

create function app.marketplace_buyer_address_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function app.marketplace_buyer_address_events_append_only() from public, anon, authenticated, service_role;
create trigger mp_buyer_addr_events_append_only
  before update or delete on public.marketplace_buyer_address_events
  for each row execute function app.marketplace_buyer_address_events_append_only();

alter table public.marketplace_buyer_address_events enable row level security;
revoke all on public.marketplace_buyer_address_events from public, anon, authenticated, service_role;

create function app.marketplace_buyer_address_event(p_user uuid, p_address uuid, p_kind text)
returns void language sql security definer set search_path = '' as $$
  insert into public.marketplace_buyer_address_events (user_id, address_id, kind) values (p_user, p_address, p_kind);
$$;
revoke all on function app.marketplace_buyer_address_event(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-user lock (one writer per buyer at a time: cap, default and upsert stay consistent)
-- ---------------------------------------------------------------------------
create function app.marketplace_buyer_address_lock(p_user uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.marketplace_buyer_addresses:' || p_user::text, 0));
$$;
revoke all on function app.marketplace_buyer_address_lock(uuid) from public, anon, authenticated, service_role;

-- Is this E.164 number the caller's own, verified primary phone? (live, derived; the authority is the only writer.)
create function app.marketplace_buyer_phone_is_verified(p_user uuid, p_e164 text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.user_id = p_user and p.deleted_at is null
                    and p.phone_e164 is not null and p.phone_e164 = p_e164 and p.phone_verified_at is not null);
$$;
revoke all on function app.marketplace_buyer_phone_is_verified(uuid, text) from public, anon, authenticated, service_role;

-- One address as the client sees it (derived verification and the delivery-place keys).
create function app.marketplace_buyer_address_json(a public.marketplace_buyer_addresses)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'nickname', a.nickname,
    'governorate_key', a.governorate_key, 'area_key', a.area_key, 'district', a.district,
    'street', a.street, 'building', a.building, 'floor', a.floor, 'apartment', a.apartment, 'landmark', a.landmark,
    'latitude', a.latitude, 'longitude', a.longitude, 'location_source', a.location_source,
    'recipient_first_name', a.recipient_first_name, 'recipient_last_name', a.recipient_last_name,
    'recipient_phone_e164', a.recipient_phone_e164,
    'recipient_phone_verified', app.marketplace_buyer_phone_is_verified(a.user_id, a.recipient_phone_e164),
    'is_default', a.is_default, 'created_at', a.created_at);
$$;
revoke all on function app.marketplace_buyer_address_json(public.marketplace_buyer_addresses) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. List
-- ---------------------------------------------------------------------------
create function public.marketplace_buyer_addresses()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.marketplace_buyer_address_json(a) order by a.is_default desc, a.created_at, a.id)
      from public.marketplace_buyer_addresses a where a.user_id = v_uid), '[]'::jsonb));
end;
$$;
revoke all on function public.marketplace_buyer_addresses() from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_addresses() to authenticated;
comment on function public.marketplace_buyer_addresses() is
  'The caller''s saved addresses, default first, each with the derived recipient_phone_verified. Owner-only by construction (auth.uid()).';

-- ---------------------------------------------------------------------------
-- 5. Save (create or update, idempotent on the client-supplied id)
-- ---------------------------------------------------------------------------
-- p_address: { id, kind, nickname?, governorate_key, area_key, district?, street?, building?, floor?, apartment?,
--              landmark?, latitude?, longitude?, location_source?, recipient_first_name, recipient_last_name,
--              recipient_phone_e164, make_default? }
-- Errors (SQLSTATE): 42501 not signed in / id belongs to someone else; 22023 invalid input; 54000 address limit (10).
create function public.marketplace_buyer_address_save(p_address jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_id      uuid;
  v_kind    text;
  v_gov     text;
  v_area    text;
  v_street  text;
  v_first   text;
  v_last    text;
  v_phone   text;
  v_source  text;
  v_lat     numeric;
  v_lng     numeric;
  v_default boolean;
  v_exists  public.marketplace_buyer_addresses;
  v_count   integer;
  v_has     boolean;
  v_row     public.marketplace_buyer_addresses;
  s_nick text; s_dist text; s_bld text; s_flr text; s_apt text; s_lmk text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'invalid address' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = v_uid and u.status in ('active', 'pending_verification')) then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  begin
    v_id := (p_address ->> 'id')::uuid;
  exception when others then
    raise exception 'invalid address id' using errcode = '22023';
  end;
  if v_id is null then
    raise exception 'invalid address id' using errcode = '22023';
  end if;

  v_kind   := lower(btrim(coalesce(p_address ->> 'kind', '')));
  v_gov    := lower(btrim(coalesce(p_address ->> 'governorate_key', '')));
  v_area   := nullif(lower(btrim(coalesce(p_address ->> 'area_key', ''))), '');
  v_street := nullif(btrim(coalesce(p_address ->> 'street', '')), '');
  v_first  := btrim(coalesce(p_address ->> 'recipient_first_name', ''));
  v_last   := btrim(coalesce(p_address ->> 'recipient_last_name', ''));
  v_phone  := btrim(coalesce(p_address ->> 'recipient_phone_e164', ''));
  v_source := lower(btrim(coalesce(nullif(p_address ->> 'location_source', ''), 'manual')));
  s_nick := nullif(btrim(coalesce(p_address ->> 'nickname', '')), '');
  s_dist := nullif(btrim(coalesce(p_address ->> 'district', '')), '');
  s_bld  := nullif(btrim(coalesce(p_address ->> 'building', '')), '');
  s_flr  := nullif(btrim(coalesce(p_address ->> 'floor', '')), '');
  s_apt  := nullif(btrim(coalesce(p_address ->> 'apartment', '')), '');
  s_lmk  := nullif(btrim(coalesce(p_address ->> 'landmark', '')), '');

  if v_kind not in ('home', 'work', 'other') then raise exception 'invalid address type' using errcode = '22023'; end if;
  if v_source not in ('manual', 'catalogue', 'device', 'map') then raise exception 'invalid location source' using errcode = '22023'; end if;
  if not exists (select 1 from app.place_governorates g where g.key = v_gov) then
    raise exception 'unknown governorate' using errcode = '22023';
  end if;
  if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
    raise exception 'unknown area' using errcode = '22023';
  end if;
  if v_street is not null and char_length(v_street) not between 3 and 160 then raise exception 'invalid street' using errcode = '22023'; end if;
  if char_length(v_first) not between 1 and 40 or char_length(v_last) not between 1 and 40 then
    raise exception 'invalid recipient name' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9]\d{1,14}$' then raise exception 'invalid recipient phone' using errcode = '22023'; end if;
  -- control characters and line breaks never belong in an address field
  if concat_ws(' ', v_street, v_first, v_last, s_nick, s_dist, s_bld, s_flr, s_apt, s_lmk) ~ '[[:cntrl:]]' then
    raise exception 'invalid characters' using errcode = '22023';
  end if;
  if (s_nick is not null and char_length(s_nick) > 40) or (s_dist is not null and char_length(s_dist) > 80)
     or (s_bld is not null and char_length(s_bld) > 40) or (s_flr is not null and char_length(s_flr) > 20)
     or (s_apt is not null and char_length(s_apt) > 20) or (s_lmk is not null and char_length(s_lmk) > 120) then
    raise exception 'a field is too long' using errcode = '22023';
  end if;

  if nullif(p_address ->> 'latitude', '') is null and nullif(p_address ->> 'longitude', '') is null then
    v_lat := null; v_lng := null;
  else
    begin
      v_lat := (p_address ->> 'latitude')::numeric;
      v_lng := (p_address ->> 'longitude')::numeric;
    exception when others then
      raise exception 'invalid map pin' using errcode = '22023';
    end;
    if v_lat is null or v_lng is null or v_lat not between 21.5 and 31.95 or v_lng not between 24.5 and 37.0 then
      raise exception 'invalid map pin' using errcode = '22023';
    end if;
    v_lat := round(v_lat, 6); v_lng := round(v_lng, 6);
  end if;
  if v_source in ('map', 'device') and v_lat is null then raise exception 'a pin needs coordinates' using errcode = '22023'; end if;
  -- area is always required; without coordinates street, building, floor, apartment and landmark are too
  if v_area is null then raise exception 'area required' using errcode = '22023'; end if;
  if v_lat is null and (v_street is null or s_bld is null or s_flr is null or s_apt is null or s_lmk is null) then raise exception 'address details required' using errcode = '22023'; end if;

  v_default := coalesce((p_address ->> 'make_default')::boolean, false);

  perform app.marketplace_buyer_address_lock(v_uid);

  select * into v_exists from public.marketplace_buyer_addresses where id = v_id;
  v_has := found;
  if v_has and v_exists.user_id <> v_uid then
    -- somebody else's id: indistinguishable from "cannot save"
    raise exception 'address not available' using errcode = '42501';
  end if;

  select count(*) into v_count from public.marketplace_buyer_addresses where user_id = v_uid;

  if not v_has then
    if v_count >= 10 then
      raise exception 'address limit reached' using errcode = '54000';
    end if;
    -- the first address is always the default
    v_default := v_default or v_count = 0;
    if v_default then
      update public.marketplace_buyer_addresses set is_default = false where user_id = v_uid and is_default;
    end if;
    insert into public.marketplace_buyer_addresses (id, user_id, kind, nickname, governorate_key, area_key, district, street, building,
        floor, apartment, landmark, latitude, longitude, location_source, recipient_first_name, recipient_last_name,
        recipient_phone_e164, is_default)
    values (v_id, v_uid, v_kind, s_nick, v_gov, v_area, s_dist, v_street, s_bld, s_flr, s_apt, s_lmk, v_lat, v_lng, v_source,
        v_first, v_last, v_phone, v_default)
    returning * into v_row;
    perform app.marketplace_buyer_address_event(v_uid, v_id, 'created');
  else
    if v_default and not v_exists.is_default then
      update public.marketplace_buyer_addresses set is_default = false where user_id = v_uid and is_default;
    end if;
    update public.marketplace_buyer_addresses
       set kind = v_kind, nickname = s_nick, governorate_key = v_gov, area_key = v_area, district = s_dist, street = v_street,
           building = s_bld, floor = s_flr, apartment = s_apt, landmark = s_lmk, latitude = v_lat, longitude = v_lng,
           location_source = v_source, recipient_first_name = v_first, recipient_last_name = v_last,
           recipient_phone_e164 = v_phone, is_default = (v_exists.is_default or v_default)
     where id = v_id
     returning * into v_row;
    perform app.marketplace_buyer_address_event(v_uid, v_id, 'updated');
  end if;

  return app.marketplace_buyer_address_json(v_row);
end;
$$;
revoke all on function public.marketplace_buyer_address_save(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_address_save(jsonb) to authenticated;
comment on function public.marketplace_buyer_address_save(jsonb) is
  'Creates or updates one of the caller''s addresses; the client supplies the id so a retry is idempotent. Validates the place against the catalogue keys used by showroom delivery areas. Max 10 per user (54000). The first address becomes the default. Writes an event with no values. Verification of the recipient mobile is derived from the phone verification authority, never set here.';

-- ---------------------------------------------------------------------------
-- 6. Delete and set default
-- ---------------------------------------------------------------------------
create function public.marketplace_buyer_address_delete(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_was_default boolean;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform app.marketplace_buyer_address_lock(v_uid);
  delete from public.marketplace_buyer_addresses where id = p_id and user_id = v_uid returning is_default into v_was_default;
  if not found then return false; end if;       -- idempotent: already gone (or never the caller's) answers the same
  if v_was_default then
    update public.marketplace_buyer_addresses set is_default = true
     where id = (select a.id from public.marketplace_buyer_addresses a where a.user_id = v_uid order by a.created_at, a.id limit 1);
  end if;
  perform app.marketplace_buyer_address_event(v_uid, p_id, 'deleted');
  return true;
end;
$$;
revoke all on function public.marketplace_buyer_address_delete(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_address_delete(uuid) to authenticated;
comment on function public.marketplace_buyer_address_delete(uuid) is
  'Deletes one of the caller''s addresses (true) or answers false when there is nothing to delete. If the default was deleted the oldest remaining address becomes the default.';

create function public.marketplace_buyer_address_set_default(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform app.marketplace_buyer_address_lock(v_uid);
  if not exists (select 1 from public.marketplace_buyer_addresses where id = p_id and user_id = v_uid) then return false; end if;
  update public.marketplace_buyer_addresses set is_default = false where user_id = v_uid and is_default and id <> p_id;
  update public.marketplace_buyer_addresses set is_default = true where id = p_id and user_id = v_uid and not is_default;
  if found then perform app.marketplace_buyer_address_event(v_uid, p_id, 'default_set'); end if;
  return true;
end;
$$;
revoke all on function public.marketplace_buyer_address_set_default(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_address_set_default(uuid) to authenticated;
comment on function public.marketplace_buyer_address_set_default(uuid) is
  'Makes one of the caller''s addresses the default (true), or false when it is not theirs. Idempotent.';

-- ---------------------------------------------------------------------------
-- 7. The caller's phone state and checkout readiness (read by the address page and, later, checkout PR 12)
-- ---------------------------------------------------------------------------
create function public.marketplace_buyer_phone_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into p from public.profiles where user_id = v_uid and deleted_at is null;
  return jsonb_build_object('phone_e164', p.phone_e164, 'verified', p.phone_e164 is not null and p.phone_verified_at is not null);
end;
$$;
revoke all on function public.marketplace_buyer_phone_status() from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_phone_status() to authenticated;
comment on function public.marketplace_buyer_phone_status() is
  'The caller''s OWN account phone (E.164, or null) and whether the phone verification authority has proven it. Owner-only by construction.';

-- Codes: address_missing (none saved / not the caller's), phone_unverified (the recipient mobile is not the caller's verified phone).
create function public.marketplace_buyer_checkout_readiness(p_address_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  a public.marketplace_buyer_addresses;
  v_missing text[] := '{}';
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_address_id is null then
    select * into a from public.marketplace_buyer_addresses where user_id = v_uid and is_default;
  else
    select * into a from public.marketplace_buyer_addresses where id = p_address_id and user_id = v_uid;
  end if;
  if not found then
    return jsonb_build_object('ready', false, 'address_id', null, 'missing', jsonb_build_array('address_missing'));
  end if;
  if not app.marketplace_buyer_phone_is_verified(v_uid, a.recipient_phone_e164) then
    v_missing := array_append(v_missing, 'phone_unverified');
  end if;
  return jsonb_build_object('ready', cardinality(v_missing) = 0, 'address_id', a.id, 'missing', to_jsonb(v_missing),
                            'governorate_key', a.governorate_key, 'area_key', a.area_key);
end;
$$;
revoke all on function public.marketplace_buyer_checkout_readiness(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_checkout_readiness(uuid) to authenticated;
comment on function public.marketplace_buyer_checkout_readiness(uuid) is
  'Can checkout use this address (the default when no id is given)? ready needs the address to exist and its recipient mobile to be the caller''s verified phone. Also returns the place keys so the delivery estimate can be computed for the address.';
