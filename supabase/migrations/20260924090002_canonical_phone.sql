-- ===========================================================================
-- Staging-prep Increment 2 — canonical phone-on-profile
--
-- CORRECTED DESIGN: an earlier draft hard-coded a small "Egypt + GCC" set of
-- calling codes as a DB reference table and validated shape with a hand-built
-- regex. That geographic scope was never approved, and hand-building
-- numbering-plan rules is exactly the kind of thing this product should not
-- invent — real numbering plans are irregular per country. The corrected
-- design instead:
--
--   * lets the caller pick ANY country (a full ISO-3166 country-code picker,
--     Egypt pre-selected as the default), implemented client/server-side in
--     TypeScript against `libphonenumber-js` (frontend/src/lib/contact/phone.ts);
--   * has that library do the real parse + numbering-plan validation and
--     produce the canonical E.164 string;
--   * passes the ALREADY-CANONICAL E.164 value into Postgres. The database is
--     never asked to validate a calling code or a national numbering plan —
--     it only enforces (a) global uniqueness and (b) that whatever arrives
--     still has E.164's outer shape (leading '+', 1-9 first digit, <=15
--     digits total) as a defense-in-depth backstop, not the source of truth.
--
-- `phone_e164` is therefore a plain STORED column, not a generated one —
-- Postgres cannot run the parsing library, so the canonical value is computed
-- in the application and written explicitly by profile_set_phone.
-- ===========================================================================

alter table public.profiles
  -- ISO 3166-1 alpha-2, e.g. 'EG'. Display/redisplay only (which flag + which
  -- calling code the picker should show again) — carries no authority.
  add column phone_country_iso2 text,
  -- Raw as typed (national significant number, no calling code, no '+').
  -- Kept purely so the picker can redisplay what the caller entered; never
  -- validated by the database beyond the two backstop constraints below.
  add column phone_national text,
  -- Canonical E.164, computed by libphonenumber-js in the application and
  -- written verbatim by profile_set_phone. NOT a generated column.
  add column phone_e164 text;

alter table public.profiles
  add constraint ck_profiles_phone_country_iso2_shape check (
    phone_country_iso2 is null or phone_country_iso2 ~ '^[A-Z]{2}$'
  ),
  add constraint ck_profiles_phone_e164_shape check (
    -- ITU E.164 outer shape only: leading '+', first digit 1-9, <=15 digits
    -- total. This is a backstop, not numbering-plan validation — the real
    -- validation already happened in libphonenumber-js before this value
    -- ever reaches Postgres.
    phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{1,14}$'
  );

comment on column public.profiles.phone_e164 is
  'Canonical E.164 phone number, computed by libphonenumber-js (frontend/src/lib/contact/phone.ts) and written only via public.profile_set_phone. The database enforces uniqueness and the outer E.164 shape as a backstop; it never validates a calling code or numbering plan itself.';

create unique index uq_profiles_phone_e164
  on public.profiles (phone_e164)
  where phone_e164 is not null;

-- ---------------------------------------------------------------------------
-- public.profile_set_phone — the only write path. Takes the ALREADY-VALIDATED
-- canonical E.164 string (computed application-side) alongside the display
-- fields; re-checks the outer shape itself (defense in depth) and never
-- reveals whether a collision was with another account (enumeration-safe,
-- mirrors isAccountExistsError's normalization for registration).
-- ---------------------------------------------------------------------------
create or replace function public.profile_set_phone(
  p_country_iso2 text,
  p_national     text,
  p_e164         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_e164 !~ '^\+[1-9]\d{1,14}$' then
    raise exception 'phone number is not in a valid format' using errcode = '22023';
  end if;
  if p_country_iso2 is not null and p_country_iso2 !~ '^[A-Z]{2}$' then
    raise exception 'invalid country code' using errcode = '22023';
  end if;

  begin
    update public.profiles
      set phone_country_iso2 = p_country_iso2,
          phone_national     = p_national,
          phone_e164         = p_e164
      where user_id = v_uid;
  exception
    when unique_violation then
      -- GENERIC, never "already used by another account" — mirrors
      -- isAccountExistsError's enumeration-normalization in
      -- server/actions/auth-password-preview.ts exactly.
      raise exception 'phone number is unavailable' using errcode = '23505';
  end;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  perform app.record_audit_event('profile.phone_set', 'user', v_uid, null, '{}'::jsonb);
end;
$$;

comment on function public.profile_set_phone(text, text, text) is
  'The only write path for profiles.phone_*. Takes an ALREADY-CANONICALIZED E.164 value (computed by libphonenumber-js in the application, never re-derived in Postgres) and raises a GENERIC "phone number is unavailable" error on a uniqueness collision, never revealing that another account holds the number.';

revoke execute on function public.profile_set_phone(text, text, text) from public;
grant execute on function public.profile_set_phone(text, text, text) to authenticated;
