-- ===========================================================================
-- Invitations addressed by EMAIL or PHONE
-- ===========================================================================
-- An organization invitation could only ever be addressed to an email address.
-- That is wrong for this market before it is wrong for this product: the people
-- a showroom or a distributor needs to add to their workspace — a branch
-- salesperson, a fitter, a driver — are reachable on WhatsApp and frequently
-- have no work email at all. Forcing the inviter to invent one, or to fall back
-- to "ask them for an email first", is what makes team setup stall on day one.
--
-- WHAT CHANGES
--   * `email` becomes nullable and a `phone` column joins it. EXACTLY ONE of the
--     two is set per invitation — that is a table constraint, not a convention,
--     because "which contact is this addressed to" has to have one answer for
--     acceptance to be checkable at all.
--   * `invitation_create` takes either, normalizes it, and keeps the existing
--     "re-inviting the same open contact refreshes the token" behaviour on both.
--   * `invitation_lookup` reports the CHANNEL alongside a masked contact, so the
--     entry screen can say "this was sent to your phone" without ever revealing
--     the number to whoever is holding the link.
--   * `invitation_accept` gains the phone rule below. Everything else about it —
--     single use, expiry, revocation, the bridge into `memberships`, the audit
--     events — is unchanged.
--
-- THE PHONE ACCEPTANCE RULE, AND ITS HONEST LIMIT
-- An email invitation is bound to an identity: the acceptor must be signed in
-- with that verified address, so holding the link is not enough. Phone cannot be
-- bound the same way TODAY, because this deployment verifies email only — there
-- is no phone identity on `auth.users` to compare against yet (WhatsApp OTP is
-- the canonical intent, not the shipped state). Refusing every phone invitation
-- until it exists would ship a feature nobody can use.
--
-- So a phone invitation is bound as tightly as the deployment currently allows,
-- and no more:
--   1. If the acceptor HAS a confirmed phone, it must match. This is the real
--      binding, and it starts working the day phone sign-in is enabled, with no
--      further migration.
--   2. Otherwise the acceptor must still hold a verified contact of some kind —
--      an anonymous session cannot accept — and the unguessable single-use token
--      carries the rest.
-- Rule 2 is a bearer credential and is documented as one. It is why the inviter
-- is told to send the link over a private channel, and why phone invitations
-- expire on the same 14-day clock as every other one.
--
-- No delivery is performed here. The database mints the invitation and the
-- token; the product surfaces a copy/share action. Nothing in this migration
-- claims a message was sent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Masked phone display — the phone counterpart of app.mask_email
-- ---------------------------------------------------------------------------
-- Reveals the country code and the last two digits, e.g. +201002003040 ->
-- '+20•••40'. Enough for an invitee to recognize their own number, useless to a
-- stranger who merely holds the token.
create or replace function app.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or char_length(p_phone) < 6 then '•••'
    else left(p_phone, 3) || '•••' || right(p_phone, 2)
  end
$$;
comment on function app.mask_phone(text) is 'Non-reversible masked display of an E.164 phone for the invitation entry screen. Country code + last two digits only.';
revoke execute on function app.mask_phone(text) from public;
grant execute on function app.mask_phone(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Table — email OR phone, exactly one
-- ---------------------------------------------------------------------------
alter table public.organization_invitations
  add column if not exists phone text;

alter table public.organization_invitations
  alter column email drop not null;

-- The original constraint asserted shape AND presence in one expression. Split
-- them: shape still applies when a value is there, presence is now the job of
-- the exactly-one rule below.
alter table public.organization_invitations
  drop constraint if exists ck_invitation_email;

alter table public.organization_invitations
  add constraint ck_invitation_email
    check (email is null or (email = lower(btrim(email)) and position('@' in email) > 1));

-- Normalized by the writer RPC (app.normalize_phone); enforce the shape here so
-- no other path can insert a raw local-format number that acceptance would then
-- fail to match.
alter table public.organization_invitations
  drop constraint if exists ck_invitation_phone;
alter table public.organization_invitations
  add constraint ck_invitation_phone
    check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');

-- Exactly one target. Neither means an invitation nobody can accept; both would
-- mean two acceptance rules for one row, and a choice about which wins that no
-- reader of this table should have to make.
alter table public.organization_invitations
  drop constraint if exists ck_invitation_contact;
alter table public.organization_invitations
  add constraint ck_invitation_contact
    check ((email is not null) <> (phone is not null));

comment on column public.organization_invitations.phone is 'E.164 phone this invitation is addressed to, normalized by app.normalize_phone. Mutually exclusive with email (ck_invitation_contact).';

-- At most one OPEN invitation per (org, phone), mirroring the email rule. NULLs
-- are distinct in a Postgres unique index, so email-addressed rows (phone null)
-- do not collide with each other here, and vice versa.
create unique index if not exists uq_invitation_open_per_phone
  on public.organization_invitations (organization_id, phone) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. invitation_create — either channel
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: the argument list changes, and leaving the old
-- 3-argument function in place would make every named-argument call from
-- PostgREST ambiguous.
drop function if exists public.invitation_create(uuid, text, uuid);
-- Also dropped: the (org, email, phone, branch) ordering this migration briefly
-- carried before the positional-compatibility fix below. Any database that ran
-- the earlier version would otherwise keep BOTH overloads, and every subsequent
-- named-argument call would fail as ambiguous rather than pick one.
drop function if exists public.invitation_create(uuid, text, text, uuid);

-- Argument ORDER matters and is not cosmetic. `p_phone` goes LAST rather than
-- beside `p_email` where it reads better, because `p_primary_branch_id` was
-- already the third positional parameter and existing callers pass it that way.
-- Slotting the new parameter in ahead of it silently rebinds every positional
-- call — a branch uuid arriving where a phone number is expected — and the
-- failure surfaces as a type error far from the change that caused it.
create or replace function public.invitation_create(
  p_org_id uuid,
  p_email  text default null,
  p_primary_branch_id uuid default null,
  p_phone  text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := app.normalize_phone(nullif(btrim(coalesce(p_phone, '')), ''));
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  if (v_email is not null) = (v_phone is not null) then
    raise exception 'exactly one of email or phone is required';
  end if;
  if v_email is not null and position('@' in v_email) <= 1 then
    raise exception 'a valid email is required';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'a valid phone number is required';
  end if;
  if p_primary_branch_id is not null and not exists (
      select 1 from public.branches b where b.id = p_primary_branch_id and b.organization_id = p_org_id) then
    raise exception 'primary branch belongs to a different organization' using errcode = '42501';
  end if;

  -- Two inserts rather than one, because the two open-invitation indexes are
  -- separate partial indexes and `on conflict` names exactly one of them. A
  -- single statement cannot express "refresh whichever of these two collides".
  if v_email is not null then
    insert into public.organization_invitations
      (organization_id, email, phone, primary_branch_id, token, status, invited_by, expires_at)
    values (p_org_id, v_email, null, p_primary_branch_id, v_token, 'pending', (select auth.uid()), now() + interval '14 days')
    on conflict (organization_id, email) where status = 'pending'
    do update set token = excluded.token,
                  primary_branch_id = excluded.primary_branch_id,
                  expires_at = excluded.expires_at,
                  invited_by = excluded.invited_by
    returning token into v_token;
  else
    insert into public.organization_invitations
      (organization_id, email, phone, primary_branch_id, token, status, invited_by, expires_at)
    values (p_org_id, null, v_phone, p_primary_branch_id, v_token, 'pending', (select auth.uid()), now() + interval '14 days')
    on conflict (organization_id, phone) where status = 'pending'
    do update set token = excluded.token,
                  primary_branch_id = excluded.primary_branch_id,
                  expires_at = excluded.expires_at,
                  invited_by = excluded.invited_by
    returning token into v_token;
  end if;

  return v_token;
end;
$$;
comment on function public.invitation_create(uuid, text, uuid, text) is 'Create/refresh a pending org invitation addressed to EXACTLY ONE of email or phone. Requires org.members.manage. Returns the token; performs no delivery.';

revoke execute on function public.invitation_create(uuid, text, uuid, text) from public;
grant execute on function public.invitation_create(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. invitation_lookup — channel-aware, still anti-enumeration
-- ---------------------------------------------------------------------------
-- Return type changes, so the old function must go first.
drop function if exists public.invitation_lookup(text);

create or replace function public.invitation_lookup(p_token text)
returns table (
  status            text,
  organization_name text,
  channel           text,
  contact_masked    text,
  matches_caller    boolean
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
  v_phone text;
begin
  select * into v_inv from public.organization_invitations where token = p_token;
  if not found then
    return query select 'invalid'::text, null::text, null::text, null::text, false;
    return;
  end if;

  if v_uid is not null then
    select au.email, au.phone into v_email, v_phone from auth.users au where au.id = v_uid;
  end if;

  return query
    select
      case
        when v_inv.status = 'pending' and v_inv.expires_at < now() then 'expired'
        else v_inv.status::text
      end,
      (select o.name from public.organizations o where o.id = v_inv.organization_id),
      case when v_inv.email is not null then 'email' else 'phone' end,
      case when v_inv.email is not null
        then app.mask_email(v_inv.email)
        else app.mask_phone(v_inv.phone)
      end,
      -- "This is addressed to you" — only ever true on a verified identity the
      -- caller already holds. A phone invitation the caller cannot prove is
      -- theirs reports false, and the entry screen shows the softer copy.
      case
        when v_inv.email is not null then (v_email is not null and lower(v_email) = v_inv.email)
        else (v_phone is not null and app.normalize_phone(v_phone) = v_inv.phone)
      end;
end;
$$;
comment on function public.invitation_lookup(text) is 'Anti-enumeration invitation projection for the entry screen: state, org display name, contact CHANNEL and a masked contact. Never returns a raw email/phone or the organization id.';

revoke execute on function public.invitation_lookup(text) from public;
grant execute on function public.invitation_lookup(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. invitation_accept — email binding unchanged, phone rule added
-- ---------------------------------------------------------------------------
create or replace function public.invitation_accept(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_email      text;
  v_email_ok   boolean;
  v_phone      text;
  v_phone_ok   boolean;
  v_inv        public.organization_invitations;
  v_mid        uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select au.email, (au.email_confirmed_at is not null),
         au.phone, (au.phone_confirmed_at is not null)
    into v_email, v_email_ok, v_phone, v_phone_ok
  from auth.users au where au.id = v_uid;

  -- A verified contact of SOME kind is the floor for accepting anything. It is
  -- what stops an unverified or anonymous session from joining an organization.
  if not (coalesce(v_email_ok, false) or coalesce(v_phone_ok, false)) then
    raise exception 'a verified contact is required to accept an invitation' using errcode = '42501';
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

  if v_inv.email is not null then
    -- Unchanged: an email invitation is bound to that verified address, and no
    -- other identity may accept it however it obtained the link.
    if not coalesce(v_email_ok, false) then
      raise exception 'a verified email is required to accept an invitation' using errcode = '42501';
    end if;
    if lower(v_email) <> v_inv.email then
      raise exception 'this invitation was issued to a different email address' using errcode = '42501';
    end if;
  else
    -- Phone. Bind to the number when the acceptor has a confirmed one; otherwise
    -- the single-use token is the credential (see the header of this migration).
    if coalesce(v_phone_ok, false) and app.normalize_phone(v_phone) <> v_inv.phone then
      raise exception 'this invitation was issued to a different phone number' using errcode = '42501';
    end if;
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
comment on function public.invitation_accept(text) is 'Accept an org invitation as the signed-in invitee. Email invitations are bound to the verified address; phone invitations are bound to a confirmed phone when the acceptor has one, and otherwise rest on the single-use token. Single-use, expiring, and bridged into the existing memberships model.';

revoke execute on function public.invitation_accept(text) from public;
grant execute on function public.invitation_accept(text) to authenticated;
