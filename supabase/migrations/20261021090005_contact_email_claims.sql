-- ===========================================================================
-- Optional contact email: single-use link verification, global uniqueness, support release
--
-- PORTED from the Settings Part 2B rehearsal (20261017090008-010), adapted to the canonical PR #88 schema:
--   * EMAIL ONLY. The rehearsal's shared phone+email key registry (app.personal_contact_keys) is NOT imported: phone
--     ownership stays where PR #88 put it (profiles.phone_e164 + public.secondary_phone_reservations + app.lock_phone).
--   * The claims live in their own private table, app.contact_emails. The legacy public.contacts table, its policies,
--     its readers (admin_rbac_staff, contact visibility) and its writers are untouched.
--   * Password proof: PR #88's reauth receipt (contact_email.set / contact_email.remove, 20261021090001). One attempt
--     budget per account; no second gate.
--   * Support release is authorized by the Admin RBAC permission contacts.support_release (Super Admin; delegable).
--
-- THE CONTRACT.
--   * One VERIFIED contact email per account and at most one PENDING claim. A pending claim reserves nothing.
--   * The link only IDENTIFIES the claim: contact_email_token_peek never writes. Verification needs an explicit user
--     action: contact_email_claim_confirm refuses unless p_explicit_action = true, only for the claim's own user, only
--     while the token is unexpired and unused. Only a SHA-256 of the token is stored; it is erased when spent.
--   * GLOBAL UNIQUENESS of personal email identities, enforced in the database for every writer under one per-address
--     advisory lock (app.lock_email): a verified contact email can never equal ANOTHER account's sign-in email or
--     another account's verified contact email, and a sign-in email (GoTrue sign-up or email change) can never take an
--     address another account holds as a verified contact email (the GoTrue write fails closed, nothing is displaced).
--     The Installer login alias (@craftsman-login.aladdin.invalid) is never a contact address.
--   * The account's own CONFIRMED sign-in email is the same identity: claiming it verifies at once (no mail).
--   * Abuse controls (database-enforced, counted even for refused attempts because refusals are RETURNED, not raised):
--     claims 60 s apart and 3 per account per hour; failed confirmations 10 per account per hour.
--   * Generic answers: an address held by another account is 'suppressed' at start (nothing created, nothing sent; the
--     caller shows the same text as 'sent') and 'unavailable' at confirm.
--   * Audit metadata carries ids and a purpose only - never an address, a token or a reason.
-- Every function here is SECURITY DEFINER with an empty search_path and callable by service_role ONLY (the server
-- passes the session user); the table is private (RLS on, no policy, no API privilege).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permission and audit vocabulary
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('contacts.support_release', 'contacts', 'support_release',
   'Look up who holds a personal contact email and release a contact-email claim for a genuine dispute, with a case reference and a written reason (audited).', 62)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'contacts.support_release', true
  from public.admin_roles r
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

select app.audit_actions_add(array['contact.email_claim_started', 'contact.email_verified', 'contact.email_removed',
                                   'contact.support_lookup', 'contact.support_released']);

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table app.contact_emails (
  id                uuid        primary key default extensions.gen_random_uuid(),
  user_id           uuid        not null references public.users (id) on delete cascade,
  email             text,
  status            text        not null,
  token_hash        bytea,
  token_expires_at  timestamptz,
  token_consumed_at timestamptz,
  last_sent_at      timestamptz,
  verified_at       timestamptz,
  verified_via      text,
  released_at       timestamptz,
  release_reason    text,
  created_at        timestamptz not null default now(),
  constraint ck_contact_emails_status check (status in ('pending', 'verified', 'expired', 'released')),
  constraint ck_contact_emails_value_state check ((status in ('pending', 'verified')) = (email is not null)),
  constraint ck_contact_emails_shape check (
    email is null
    or (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and right(email, 32) <> '@craftsman-login.aladdin.invalid')),
  constraint ck_contact_emails_pending check (
    status <> 'pending' or (token_hash is not null and token_expires_at is not null and octet_length(token_hash) = 32)),
  constraint ck_contact_emails_token_cleared check (status = 'pending' or token_hash is null),
  constraint ck_contact_emails_verified check (status <> 'verified' or (verified_at is not null and verified_via is not null)),
  constraint ck_contact_emails_via check (verified_via is null or verified_via in ('email_link', 'auth_email'))
);
comment on table app.contact_emails is
  'Optional personal contact email claims (separate from the Auth sign-in email). pending = a link was sent (reserves nothing); verified = confirmed by an explicit action on a single-use link, or the account''s own confirmed sign-in email. expired / released are terminal and keep no address. Only the SHA-256 of a token is stored. Private: RLS on, no policy, no API privilege.';
create unique index uq_contact_emails_verified_address on app.contact_emails (email) where status = 'verified';
create unique index uq_contact_emails_one_verified on app.contact_emails (user_id) where status = 'verified';
create unique index uq_contact_emails_one_pending on app.contact_emails (user_id) where status = 'pending';
create unique index uq_contact_emails_token on app.contact_emails (token_hash) where token_hash is not null;
create index ix_contact_emails_user on app.contact_emails (user_id, created_at desc);
alter table app.contact_emails enable row level security;
revoke all on app.contact_emails from public, anon, authenticated, service_role;

create table app.contact_claim_events (
  id         uuid        primary key default extensions.gen_random_uuid(),
  user_id    uuid        not null references public.users (id) on delete cascade,
  kind       text        not null,
  created_at timestamptz not null default now(),
  constraint ck_contact_claim_events_kind check (kind in ('email_start', 'email_confirm_fail'))
);
comment on table app.contact_claim_events is
  'Attempt counters for the contact-email abuse controls. One row per attempt; no address, token or hash is stored. Pruned per user after one day.';
create index ix_contact_claim_events_window on app.contact_claim_events (user_id, kind, created_at desc);
alter table app.contact_claim_events enable row level security;
revoke all on app.contact_claim_events from public, anon, authenticated, service_role;

create table app.contact_support_actions (
  id               uuid        primary key default extensions.gen_random_uuid(),
  operator_user_id uuid        references public.users (id) on delete set null,
  user_id          uuid        not null references public.users (id) on delete cascade,
  claim_id         uuid        references app.contact_emails (id) on delete set null,
  case_ref         text        not null,
  reason           text        not null,
  created_at       timestamptz not null default now(),
  constraint ck_contact_support_actions_case check (case_ref ~ '^[A-Za-z0-9._-]{3,64}$'),
  constraint ck_contact_support_actions_reason check (char_length(reason) between 10 and 500),
  constraint ck_contact_support_actions_not_self check (operator_user_id is distinct from user_id)
);
comment on table app.contact_support_actions is
  'Private record of an authorized support release: operator, owner, claim id, case reference and the written reason (the reason stays here, never in audit metadata).';
alter table app.contact_support_actions enable row level security;
revoke all on app.contact_support_actions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------
-- The one lock every writer of a personal email identity takes (contact claims and Auth sign-in emails).
create or replace function app.lock_email(p_email text)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.email:' || lower(btrim(p_email)), 0));
$$;
revoke all on function app.lock_email(text) from public, anon, authenticated, service_role;

create or replace function app.contact_user_lock(p_user_id uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.contact_user:' || p_user_id::text, 0));
$$;
revoke all on function app.contact_user_lock(uuid) from public, anon, authenticated, service_role;

-- Is this (normalized) address a sign-in email or a verified contact email of an account OTHER than p_except?
create or replace function app.email_identity_held_elsewhere(p_email text, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users au
                  where lower(btrim(au.email)) = p_email and au.id is distinct from p_except
                    and not coalesce(au.is_sso_user, false))
      or exists (select 1 from app.contact_emails c
                  where c.email = p_email and c.status = 'verified' and c.user_id is distinct from p_except);
$$;
revoke all on function app.email_identity_held_elsewhere(text, uuid) from public, anon, authenticated, service_role;

create or replace function app.contact_event_count(p_user_id uuid, p_kind text, p_window interval)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from app.contact_claim_events e
   where e.user_id = p_user_id and e.kind = p_kind and e.created_at > now() - p_window;
$$;
revoke all on function app.contact_event_count(uuid, text, interval) from public, anon, authenticated, service_role;

create or replace function app.contact_event_record(p_user_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from app.contact_claim_events e where e.user_id = p_user_id and e.created_at < now() - interval '1 day';
  insert into app.contact_claim_events (user_id, kind) values (p_user_id, p_kind);
end;
$$;
revoke all on function app.contact_event_record(uuid, text) from public, anon, authenticated, service_role;

-- Close a claim: the address and any token are dropped. Terminal.
create or replace function app.contact_email_close(p_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('expired', 'released') then
    raise exception 'invalid closing status' using errcode = '22023';
  end if;
  update app.contact_emails c
     set status = p_status, released_at = now(), release_reason = p_reason, email = null, token_hash = null
   where c.id = p_id and c.status in ('pending', 'verified');
end;
$$;
revoke all on function app.contact_email_close(uuid, text, text) from public, anon, authenticated, service_role;

-- Audit with an explicit actor (the server runs as service_role, where auth.uid() is NULL).
create or replace function app.contact_audit(p_actor uuid, p_action text, p_subject uuid, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('contact.email_claim_started', 'contact.email_verified', 'contact.email_removed',
                      'contact.support_lookup', 'contact.support_released') then
    raise exception 'unsupported audit action' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (p_actor, app.admin_legacy_tier(app.admin_rank_of(p_actor)), p_action, 'user', p_subject, null,
          coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function app.contact_audit(uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function app.contact_support_authorize(p_operator_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_operator_id is null or not ('contacts.support_release' = any(app.admin_permissions_of(p_operator_id))) then
    raise exception 'operator is not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.contact_support_authorize(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Sign-in emails can never take another account's verified contact email
-- ---------------------------------------------------------------------------
create or replace function app.auth_email_contact_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new text := lower(btrim(coalesce(new.email, '')));
begin
  if v_new = '' or coalesce(new.is_sso_user, false) or right(v_new, 32) = '@craftsman-login.aladdin.invalid' then
    return new;   -- no address, an SSO identity, or the Installer login alias: never a contact identity
  end if;
  if tg_op = 'UPDATE' and v_new = lower(btrim(coalesce(old.email, ''))) then
    return new;
  end if;
  perform app.lock_email(v_new);
  if exists (select 1 from app.contact_emails c where c.email = v_new and c.status = 'verified' and c.user_id <> new.id) then
    raise exception 'contact is unavailable' using errcode = '23505';   -- generic: never says who or why
  end if;
  return new;
end;
$$;
comment on function app.auth_email_contact_guard() is
  'BEFORE INSERT / UPDATE OF email ON auth.users. Refuses (generic 23505, the GoTrue write rolls back) a sign-in email equal to ANOTHER account''s verified contact email, under the per-address lock contact claims take. SSO identities and the Installer login alias are skipped; nothing is ever displaced.';
revoke all on function app.auth_email_contact_guard() from public, anon, authenticated, service_role;
create trigger auth_email_contact_guard
  before insert or update of email on auth.users
  for each row execute function app.auth_email_contact_guard();

-- ---------------------------------------------------------------------------
-- 5. Owner operations (service_role; the server passes the session user)
-- ---------------------------------------------------------------------------
create or replace function public.contact_email_claim_start(
  p_user_id     uuid,
  p_receipt_id  uuid,
  p_email       text,
  p_token_hash  bytea,
  p_ttl_seconds integer default 1800
)
returns table (outcome text, claim_id uuid, expires_at timestamptz, deliver boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_max_per_hour constant integer := 3;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
  v_exp   timestamptz;
begin
  if p_user_id is null or p_receipt_id is null or p_token_hash is null or octet_length(p_token_hash) <> 32
     or p_ttl_seconds is null or p_ttl_seconds not between 300 and 3600 then
    raise exception 'invalid email claim request' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or right(v_email, 32) = '@craftsman-login.aladdin.invalid' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;
  if not app.account_is_active(p_user_id) then
    raise exception 'account is not eligible' using errcode = '55000';
  end if;

  perform app.contact_user_lock(p_user_id);
  if not app.consume_reauth_receipt_for(p_user_id, p_receipt_id, 'contact_email.set', v_email) then
    raise exception 'password confirmation required' using errcode = '42501';
  end if;
  if app.contact_event_count(p_user_id, 'email_start', interval '1 hour') >= c_max_per_hour
     or exists (select 1 from app.contact_claim_events e
                 where e.user_id = p_user_id and e.kind = 'email_start' and e.created_at > now() - interval '60 seconds') then
    return query select 'limited'::text, null::uuid, null::timestamptz, false;
    return;
  end if;
  perform app.contact_event_record(p_user_id, 'email_start');

  perform app.lock_email(v_email);

  if exists (select 1 from app.contact_emails c where c.user_id = p_user_id and c.status = 'verified' and c.email = v_email) then
    return query select 'already_verified'::text, null::uuid, null::timestamptz, false;
    return;
  end if;

  -- The account's own CONFIRMED sign-in email is the same identity: verified at once, no message.
  if exists (select 1 from auth.users a
              where a.id = p_user_id and lower(btrim(a.email)) = v_email and a.email_confirmed_at is not null) then
    perform app.contact_email_close(c.id, 'released', 'replaced')
       from app.contact_emails c where c.user_id = p_user_id and c.status in ('verified', 'pending');
    insert into app.contact_emails (user_id, email, status, verified_at, verified_via)
    values (p_user_id, v_email, 'verified', now(), 'auth_email')
    returning id into v_id;
    perform app.contact_audit(p_user_id, 'contact.email_verified', p_user_id, jsonb_build_object('claim_id', v_id, 'via', 'auth_email'));
    return query select 'verified'::text, v_id, null::timestamptz, false;
    return;
  end if;

  if app.email_identity_held_elsewhere(v_email, p_user_id) then
    return query select 'suppressed'::text, null::uuid, null::timestamptz, false;   -- nothing is created or sent
    return;
  end if;

  perform app.contact_email_close(c.id, 'released', 'superseded')
     from app.contact_emails c where c.user_id = p_user_id and c.status = 'pending';
  insert into app.contact_emails (user_id, email, status, token_hash, token_expires_at, last_sent_at)
  values (p_user_id, v_email, 'pending', p_token_hash, now() + make_interval(secs => p_ttl_seconds), now())
  returning id, token_expires_at into v_id, v_exp;
  perform app.contact_audit(p_user_id, 'contact.email_claim_started', p_user_id, jsonb_build_object('claim_id', v_id));
  return query select 'sent'::text, v_id, v_exp, true;
end;
$$;
comment on function public.contact_email_claim_start(uuid, uuid, text, bytea, integer) is
  'Start a contact-email claim. Spends a contact_email.set reauth receipt bound to the address; stores ONLY the SHA-256 of the token (the server mails the plaintext link). A pending claim reserves nothing. Returns sent (deliver=true) | verified (own confirmed sign-in email; no mail) | suppressed (held by another account: nothing created, deliver=false - show the same text as sent) | already_verified | limited. service_role ONLY.';

-- READ-ONLY: what a link scanner that merely opens the link can learn. Never writes, never counts, never verifies.
create or replace function public.contact_email_token_peek(p_user_id uuid, p_token_hash bytea)
returns table (state text, masked_email text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.token_expires_at <= now() then 'expired' else 'valid' end,
         left(split_part(c.email, '@', 1), 1) || '***@' || split_part(c.email, '@', 2),
         c.token_expires_at
    from app.contact_emails c
   where c.token_hash = p_token_hash and c.user_id = p_user_id and c.status = 'pending'
  union all
  select 'invalid', null, null
   where not exists (select 1 from app.contact_emails c
                      where c.token_hash = p_token_hash and c.user_id = p_user_id and c.status = 'pending');
$$;
comment on function public.contact_email_token_peek(uuid, bytea) is
  'Scanner-safe inspection of a link: valid | expired | invalid (also for another user''s token) plus a masked address. Performs NO write - opening a link never verifies anything. service_role ONLY.';

create or replace function public.contact_email_claim_confirm(p_user_id uuid, p_token_hash bytea, p_explicit_action boolean)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_failures constant integer := 10;
  c app.contact_emails;
begin
  if p_explicit_action is distinct from true then
    raise exception 'explicit user confirmation is required' using errcode = '22023';
  end if;
  if p_user_id is null or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'invalid confirmation request' using errcode = '22023';
  end if;

  perform app.contact_user_lock(p_user_id);
  if app.contact_event_count(p_user_id, 'email_confirm_fail', interval '1 hour') >= c_max_failures then
    return query select 'limited'::text;
    return;
  end if;

  select * into c from app.contact_emails x where x.token_hash = p_token_hash for update;
  if not found or c.user_id <> p_user_id or c.status <> 'pending' then
    perform app.contact_event_record(p_user_id, 'email_confirm_fail');   -- unknown, foreign or spent token: one answer
    return query select 'invalid'::text;
    return;
  end if;
  if c.token_expires_at <= now() then
    perform app.contact_email_close(c.id, 'expired', 'token_expired');
    return query select 'expired'::text;
    return;
  end if;

  perform app.lock_email(c.email);
  if app.email_identity_held_elsewhere(c.email, p_user_id) then
    perform app.contact_email_close(c.id, 'released', 'address_unavailable');
    return query select 'unavailable'::text;   -- another account holds it now; nothing of theirs is touched
    return;
  end if;

  perform app.contact_email_close(x.id, 'released', 'replaced')
     from app.contact_emails x where x.user_id = p_user_id and x.status = 'verified' and x.id <> c.id;
  update app.contact_emails x
     set status = 'verified', verified_via = 'email_link', token_hash = null, token_consumed_at = now(), verified_at = now()
   where x.id = c.id;
  perform app.contact_audit(p_user_id, 'contact.email_verified', p_user_id, jsonb_build_object('claim_id', c.id, 'via', 'email_link'));
  return query select 'verified'::text;
end;
$$;
comment on function public.contact_email_claim_confirm(uuid, bytea, boolean) is
  'Complete a contact-email claim. REFUSES unless p_explicit_action is true (the server passes true only from a deliberate user action, never from opening a link). Only the claim''s own user; unexpired; single-use (the token hash is erased); the address must still be free (else unavailable, and the claim is closed). Returns verified | invalid | expired | unavailable | limited. service_role ONLY.';

create or replace function public.contact_email_release(p_user_id uuid, p_receipt_id uuid default null)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verified uuid;
begin
  if p_user_id is null then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  perform app.contact_user_lock(p_user_id);
  select c.id into v_verified from app.contact_emails c where c.user_id = p_user_id and c.status = 'verified' for update;
  if v_verified is not null then
    -- Removing a VERIFIED contact email needs a password receipt; cancelling a pending claim does not.
    if not app.consume_reauth_receipt_for(p_user_id, p_receipt_id, 'contact_email.remove', 'self') then
      raise exception 'password confirmation required' using errcode = '42501';
    end if;
    perform app.contact_email_close(v_verified, 'released', 'released_by_owner');
    perform app.contact_audit(p_user_id, 'contact.email_removed', p_user_id, jsonb_build_object('claim_id', v_verified));
  end if;
  perform app.contact_email_close(c.id, 'released', 'cancelled')
     from app.contact_emails c where c.user_id = p_user_id and c.status = 'pending';
  return query select case when v_verified is not null then 'removed' else 'cancelled' end::text;
end;
$$;
comment on function public.contact_email_release(uuid, uuid) is
  'Remove the account''s VERIFIED contact email (needs a contact_email.remove reauth receipt) or cancel a pending claim. service_role ONLY.';

-- What the OWNER may see: the live claim (with its address) or the latest closed one for 7 days (address cleared).
create or replace function public.contact_email_status(p_user_id uuid)
returns table (status text, email text, verified_via text, verified_at timestamptz, token_expires_at timestamptz, release_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select c.*, case when c.status = 'pending' and c.token_expires_at <= now() then 'expired' else c.status end as eff
      from app.contact_emails c
     where c.user_id = p_user_id
  )
  select m.eff,
         case when m.eff in ('pending', 'verified') then m.email end,
         m.verified_via, m.verified_at,
         case when m.eff = 'pending' then m.token_expires_at end,
         case when m.eff in ('expired', 'released') then coalesce(m.release_reason, 'expired') end
    from mine m
   where m.eff in ('pending', 'verified') or m.created_at > now() - interval '7 days'
   order by (m.eff = 'verified') desc, (m.eff = 'pending') desc, m.created_at desc
   limit 1;
$$;
comment on function public.contact_email_status(uuid) is
  'The account''s own contact-email state for Settings: verified / pending (address shown to the owner only) or the latest closed claim for 7 days. service_role ONLY - the server passes the session user.';

-- ---------------------------------------------------------------------------
-- 6. Support (Admin RBAC: contacts.support_release)
-- ---------------------------------------------------------------------------
create or replace function public.contact_email_support_find(p_operator_id uuid, p_email text)
returns table (claim_id uuid, owner_user_id uuid, status text, sign_in_owner uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_claim_owner uuid;
  v_login_owner uuid;
begin
  perform app.contact_support_authorize(p_operator_id);
  if v_email = '' or char_length(v_email) > 254 then
    raise exception 'invalid lookup' using errcode = '22023';
  end if;
  select c.user_id into v_claim_owner from app.contact_emails c where c.email = v_email and c.status = 'verified';
  select au.id into v_login_owner from auth.users au
   where lower(btrim(au.email)) = v_email and not coalesce(au.is_sso_user, false) limit 1;
  perform app.contact_audit(p_operator_id, 'contact.support_lookup', coalesce(v_claim_owner, v_login_owner, p_operator_id),
    jsonb_build_object('kind', 'email', 'found', (v_claim_owner is not null or v_login_owner is not null)));
  return query
    select c.id, c.user_id, c.status, v_login_owner
      from app.contact_emails c where c.email = v_email and c.status in ('pending', 'verified')
    union all
    select null::uuid, null::uuid, 'sign_in'::text, v_login_owner
     where v_login_owner is not null
       and not exists (select 1 from app.contact_emails c where c.email = v_email and c.status in ('pending', 'verified'));
end;
$$;
comment on function public.contact_email_support_find(uuid, text) is
  'Admin Staff with contacts.support_release: who holds a contact email (pending / verified claims) and which account signs in with it. A sign-in email is never releasable here. Audited with the operator as actor; the audit holds whether it was found, never the address. service_role ONLY.';

create or replace function public.contact_email_support_release(p_operator_id uuid, p_claim_id uuid, p_case_ref text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.contact_emails;
begin
  perform app.contact_support_authorize(p_operator_id);
  if p_claim_id is null or p_case_ref is null or p_case_ref !~ '^[A-Za-z0-9._-]{3,64}$'
     or p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'a case reference (3-64 characters) and a reason (10-500 characters) are required' using errcode = '22023';
  end if;
  select * into c from app.contact_emails x where x.id = p_claim_id for update;
  if not found then
    raise exception 'unknown claim' using errcode = 'P0002';
  end if;
  if c.user_id = p_operator_id then
    raise exception 'an operator cannot release their own contact' using errcode = '42501';
  end if;
  if c.status not in ('pending', 'verified') then
    raise exception 'this claim cannot be released' using errcode = '55000';
  end if;
  perform app.contact_email_close(c.id, 'released', 'support_released');
  insert into app.contact_support_actions (operator_user_id, user_id, claim_id, case_ref, reason)
  values (p_operator_id, c.user_id, c.id, p_case_ref, btrim(p_reason));
  perform app.contact_audit(p_operator_id, 'contact.support_released', c.user_id,
    jsonb_build_object('claim_id', c.id, 'case_ref', p_case_ref));
  return true;
end;
$$;
comment on function public.contact_email_support_release(uuid, uuid, text, text) is
  'Admin Staff with contacts.support_release (not the owner) releases ONE contact-email claim with a case reference and a written reason. Sign-in emails are never releasable. The reason stays in app.contact_support_actions; the audit carries ids and the case reference only. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 7. Privileges: service_role only (explicit, because Postgres grants EXECUTE to PUBLIC by default)
-- ---------------------------------------------------------------------------
revoke execute on function public.contact_email_claim_start(uuid, uuid, text, bytea, integer) from public, anon, authenticated;
revoke execute on function public.contact_email_token_peek(uuid, bytea)                       from public, anon, authenticated;
revoke execute on function public.contact_email_claim_confirm(uuid, bytea, boolean)           from public, anon, authenticated;
revoke execute on function public.contact_email_release(uuid, uuid)                           from public, anon, authenticated;
revoke execute on function public.contact_email_status(uuid)                                  from public, anon, authenticated;
revoke execute on function public.contact_email_support_find(uuid, text)                      from public, anon, authenticated;
revoke execute on function public.contact_email_support_release(uuid, uuid, text, text)       from public, anon, authenticated;
grant  execute on function public.contact_email_claim_start(uuid, uuid, text, bytea, integer) to service_role;
grant  execute on function public.contact_email_token_peek(uuid, bytea)                       to service_role;
grant  execute on function public.contact_email_claim_confirm(uuid, bytea, boolean)           to service_role;
grant  execute on function public.contact_email_release(uuid, uuid)                           to service_role;
grant  execute on function public.contact_email_status(uuid)                                  to service_role;
grant  execute on function public.contact_email_support_find(uuid, text)                      to service_role;
grant  execute on function public.contact_email_support_release(uuid, uuid, text, text)       to service_role;
