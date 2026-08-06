-- Migration: account registration — consent receipts + token invitations (Phase 2 — Sprint 7.2).
--
-- Adds the smallest coherent persistence for the shared Email-OTP registration
-- journey:
--   1. consent_receipts — an auditable record that a user accepted Terms/Privacy/
--      Pilot at a SERVER-CONTROLLED version (never client-supplied), written only
--      through the security-definer record_consent() RPC.
--   2. organization_invitations — a token-addressable, pre-account invitation that
--      bridges a not-yet-registered invitee into the EXISTING membership model
--      (memberships + membership.* audit). This is not a second invitation system:
--      invitation_accept() creates/activates a normal membership row.
--   3. my_registration_state() — derives the registration/resume state from EXISTING
--      tables (auth.users + consent_receipts + users.status + memberships). No new
--      state column is added; state is computed, not duplicated.
--
-- Every state change goes through a security-definer RPC that derives the actor
-- from auth.uid() (never a spoofable parameter), pins search_path, and
-- schema-qualifies every reference (ADR-0007). users.status and
-- primary_account_type stay server-controlled — this migration never grants a
-- client the ability to flip them. Design: docs/frontend/sprint-7-account-registration.md.

-- ---------------------------------------------------------------------------
-- 1. Enum + consent version constants (server-controlled, not client input)
-- ---------------------------------------------------------------------------
create type public.consent_type as enum ('terms', 'privacy', 'pilot');

-- The CURRENT accepted version of each consent document. A constant function (not
-- a client parameter) so a receipt always records the authoritative version. Bump
-- the returned value when a document changes; historic receipts keep their version.
create or replace function app.current_consent_version(p_type public.consent_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'terms'   then '2026-08-06'
    when 'privacy' then '2026-08-06'
    when 'pilot'   then '2026-08-06'
  end
$$;
revoke execute on function app.current_consent_version(public.consent_type) from public;
grant execute on function app.current_consent_version(public.consent_type) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. consent_receipts — minimal auditable acceptance record
-- ---------------------------------------------------------------------------
create table public.consent_receipts (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  consent_type public.consent_type not null,
  version      text not null,
  locale       text not null,
  accepted_at  timestamptz not null default now(),
  constraint ck_consent_locale check (locale in ('en', 'ar')),
  constraint ck_consent_version_len check (char_length(version) between 1 and 40),
  -- One receipt per user per document version (re-accepting the same version is a no-op).
  constraint uq_consent_user_type_version unique (user_id, consent_type, version)
);
comment on table public.consent_receipts is 'Auditable consent acceptance. Minimal by design: user, consent type, server-controlled version, locale, timestamp. Written ONLY via record_consent(); no user-agent or tracking data.';
create index ix_consent_receipts_user on public.consent_receipts (user_id);

-- ---------------------------------------------------------------------------
-- 3. organization_invitations — token-addressable pre-account invitation
-- ---------------------------------------------------------------------------
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.organization_invitations (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  email             text not null,
  primary_branch_id uuid references public.branches (id) on delete set null,
  -- Unguessable secret used as the /auth/invite/[token] path segment.
  token             text not null,
  status            public.invitation_status not null default 'pending',
  invited_by        uuid references public.users (id) on delete set null,
  accepted_user_id  uuid references public.users (id) on delete set null,
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Email is normalized (lower/trim) by the writer RPC; enforce non-empty + shape.
  constraint ck_invitation_email check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint ck_invitation_token_len check (char_length(token) between 24 and 128)
);
comment on table public.organization_invitations is 'Pre-account org invitation addressed by an unguessable token. Acceptance bridges into the EXISTING membership model (invitation_accept -> memberships). Not a parallel membership system.';

create unique index uq_invitation_token on public.organization_invitations (token);
-- At most one OPEN invitation per (org, email); a resend must reuse/refresh it.
create unique index uq_invitation_open_per_email
  on public.organization_invitations (organization_id, email) where status = 'pending';
create index ix_invitation_org on public.organization_invitations (organization_id);

create trigger set_organization_invitations_updated_at
  before update on public.organization_invitations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. app.mask_email — safe, non-reversible display for the invitation entry
-- ---------------------------------------------------------------------------
-- Reveals only the first local character and the TLD, e.g. karim@example.test ->
-- 'k•••@•••.test'. Enough for an invitee to recognize their own address without
-- exposing it to a stranger who merely holds the token.
create or replace function app.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then '•••'
    else left(split_part(p_email, '@', 1), 1) || '•••@•••.'
         || reverse(split_part(reverse(split_part(p_email, '@', 2)), '.', 1))
  end
$$;
revoke execute on function app.mask_email(text) from public;
grant execute on function app.mask_email(text) to anon, authenticated, service_role;

-- ===========================================================================
-- 5. record_consent — persist consent receipts at server-controlled versions
-- ===========================================================================
create or replace function public.record_consent(
  p_types  public.consent_type[],
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_locale text;
  v_type   public.consent_type;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Only a user whose email is actually verified may record consent (the
  -- registration flow records consent immediately after OTP verification).
  if not exists (
    select 1 from auth.users au where au.id = v_uid and au.email_confirmed_at is not null
  ) then
    raise exception 'a verified email is required before recording consent' using errcode = '42501';
  end if;
  if p_types is null or array_length(p_types, 1) is null then
    raise exception 'at least one consent type is required';
  end if;
  v_locale := case when p_locale in ('en', 'ar') then p_locale else 'en' end;

  foreach v_type in array p_types loop
    insert into public.consent_receipts (user_id, consent_type, version, locale)
    values (v_uid, v_type, app.current_consent_version(v_type), v_locale)
    on conflict (user_id, consent_type, version) do nothing;
  end loop;
end;
$$;

-- ===========================================================================
-- 6. my_registration_state — derived resume state (no new state column)
-- ===========================================================================
-- Returns one of: unverified | consent_pending | onboarding_pending |
-- invitation_pending | organization_setup_pending | active_personal |
-- manually_blocked. Derived purely from existing tables for the CALLER only.
create or replace function public.my_registration_state()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_confirmed    boolean;
  v_status       public.user_status;
  v_has_consent  boolean;
  v_active_mem   boolean;
  v_pending_mem  boolean;
  v_setup_org    boolean;
begin
  if v_uid is null then
    return 'unverified';
  end if;
  select (au.email_confirmed_at is not null) into v_confirmed from auth.users au where au.id = v_uid;
  if not coalesce(v_confirmed, false) then
    return 'unverified';
  end if;

  select u.status into v_status from public.users u where u.id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    return 'manually_blocked';
  end if;

  -- Already-operational identities go straight to the workspace: an active member
  -- (e.g. an invited salesperson) or an activated account is never re-gated on the
  -- registration consent step (that step is for NEW registrants still provisioning).
  select exists (
    select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
  ) into v_active_mem;
  if v_active_mem or v_status = 'active' then
    return 'active_personal';
  end if;

  -- Not yet active: all three required consents must be present at CURRENT versions.
  select count(distinct cr.consent_type) = 3 into v_has_consent
  from public.consent_receipts cr
  where cr.user_id = v_uid
    and cr.consent_type in ('terms', 'privacy', 'pilot')
    and cr.version = app.current_consent_version(cr.consent_type);
  if not coalesce(v_has_consent, false) then
    return 'consent_pending';
  end if;

  select exists (
    select 1 from public.memberships m where m.user_id = v_uid and m.status = 'invited'
  ) into v_pending_mem;
  if v_pending_mem then
    return 'invitation_pending';
  end if;

  select exists (
    select 1 from public.organizations o
    where o.created_by = v_uid and o.status in ('draft', 'pending_verification') and o.deleted_at is null
  ) into v_setup_org;
  if v_setup_org then
    return 'organization_setup_pending';
  end if;

  return 'onboarding_pending';
end;
$$;

-- ===========================================================================
-- 7. Invitation workflow RPCs
-- ===========================================================================

-- 7a. Create/refresh a pending invitation. Requires org.members.manage. Returns
-- the token. Re-inviting the same open email refreshes the token + expiry.
create or replace function public.invitation_create(
  p_org_id uuid,
  p_email  text,
  p_primary_branch_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'a valid email is required';
  end if;
  if p_primary_branch_id is not null and not exists (
      select 1 from public.branches b where b.id = p_primary_branch_id and b.organization_id = p_org_id) then
    raise exception 'primary branch belongs to a different organization' using errcode = '42501';
  end if;

  insert into public.organization_invitations
    (organization_id, email, primary_branch_id, token, status, invited_by, expires_at)
  values (p_org_id, v_email, p_primary_branch_id, v_token, 'pending', (select auth.uid()), now() + interval '14 days')
  on conflict (organization_id, email) where status = 'pending'
  do update set token = excluded.token,
                primary_branch_id = excluded.primary_branch_id,
                expires_at = excluded.expires_at,
                invited_by = excluded.invited_by
  returning token into v_token;
  return v_token;
end;
$$;

-- 7b. Safe, anti-enumeration lookup for the invitation entry screen. Callable by
-- anon (the invitee may not be signed in yet). Never returns the raw email or the
-- organization_id; only a masked email, the org display name, and a resolved state.
create or replace function public.invitation_lookup(p_token text)
returns table (
  status           text,
  organization_name text,
  email_masked     text,
  matches_caller   boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_inv   public.organization_invitations;
  v_uid   uuid := (select auth.uid());
  v_email text;
begin
  select * into v_inv from public.organization_invitations where token = p_token;
  if not found then
    return query select 'invalid'::text, null::text, null::text, false;
    return;
  end if;

  if v_uid is not null then
    select au.email into v_email from auth.users au where au.id = v_uid;
  end if;

  return query
    select
      case
        when v_inv.status = 'pending' and v_inv.expires_at < now() then 'expired'
        else v_inv.status::text
      end,
      (select o.name from public.organizations o where o.id = v_inv.organization_id),
      app.mask_email(v_inv.email),
      (v_email is not null and lower(v_email) = v_inv.email);
end;
$$;

-- 7c. Accept an invitation as the signed-in, email-verified invitee whose email
-- matches. Bridges into the EXISTING membership model (creates/activates a normal
-- membership + emits membership.* audit). Cannot be accepted by another email.
create or replace function public.invitation_accept(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_conf  boolean;
  v_inv   public.organization_invitations;
  v_mid   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select au.email, (au.email_confirmed_at is not null) into v_email, v_conf
  from auth.users au where au.id = v_uid;
  if not coalesce(v_conf, false) then
    raise exception 'a verified email is required to accept an invitation' using errcode = '42501';
  end if;

  select * into v_inv from public.organization_invitations where token = p_token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.status = 'revoked' then
    raise exception 'this invitation is no longer valid' using errcode = '22023';
  end if;
  if v_inv.status = 'accepted' then
    if v_inv.accepted_user_id = v_uid then
      return v_inv.organization_id;  -- idempotent: already accepted by this user
    end if;
    raise exception 'this invitation has already been used' using errcode = '22023';
  end if;
  if v_inv.expires_at < now() then
    update public.organization_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'this invitation has expired' using errcode = '22023';
  end if;
  -- The invitation is bound to a specific email; no other identity may accept it.
  if lower(v_email) <> v_inv.email then
    raise exception 'this invitation was issued to a different email address' using errcode = '42501';
  end if;

  -- Create the membership (or reactivate an existing invited/suspended one). This
  -- is the same memberships table the manager-driven path uses.
  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_inv.organization_id, v_inv.primary_branch_id, 'active', v_inv.invited_by, now())
  on conflict (user_id, organization_id)
  do update set status = 'active', accepted_at = now()
  returning id into v_mid;

  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_inv.organization_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'invitation'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_inv.organization_id,
    jsonb_build_object('via', 'invitation'));

  update public.organization_invitations
    set status = 'accepted', accepted_user_id = v_uid, accepted_at = now()
    where id = v_inv.id;

  return v_inv.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS — receipts are self-read; invitations are manager-read; writes via RPC
-- ---------------------------------------------------------------------------
alter table public.consent_receipts          enable row level security;
alter table public.organization_invitations  enable row level security;

create policy consent_receipts_select_self on public.consent_receipts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Managers of the org may read its invitations (to manage them). Invitees read a
-- safe projection via the invitation_lookup RPC, not this table.
create policy organization_invitations_select_manager on public.organization_invitations
  for select to authenticated
  using (app.has_capability(organization_id, 'org.members.manage'));

-- ---------------------------------------------------------------------------
-- 9. Grants (deny-by-default; strip Supabase default privileges first)
-- ---------------------------------------------------------------------------
revoke all on public.consent_receipts, public.organization_invitations
  from anon, authenticated, service_role;

grant select on public.consent_receipts to authenticated;
grant select, insert on public.consent_receipts to service_role;

grant select on public.organization_invitations to authenticated;
grant select, insert, update on public.organization_invitations to service_role;

-- RPC grants: derive authority internally from auth.uid(); no spoofable params.
revoke execute on function public.record_consent(public.consent_type[], text) from public;
grant execute on function public.record_consent(public.consent_type[], text) to authenticated;

revoke execute on function public.my_registration_state() from public;
grant execute on function public.my_registration_state() to authenticated;

revoke execute on function public.invitation_create(uuid, text, uuid) from public;
grant execute on function public.invitation_create(uuid, text, uuid) to authenticated;

revoke execute on function public.invitation_accept(text) from public;
grant execute on function public.invitation_accept(text) to authenticated;

-- Lookup is safe for anon (returns only masked, non-enumerable data).
revoke execute on function public.invitation_lookup(text) from public;
grant execute on function public.invitation_lookup(text) to anon, authenticated;
