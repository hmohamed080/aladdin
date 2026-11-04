-- Admin Staff invitations: the dedicated FIRST-ASSIGNMENT path for pure platform staff.
--
-- Why: admin_staff_assign_role (20260929100001) manages only people who ALREADY hold an Admin assignment; app.admin_require_manageable_target
-- refuses everyone else ("onboarding a brand-new staff member is the Invitation sub-phase"). That guard is NOT touched here. This migration adds
-- a separate path: an authorized inviter creates a single-use, expiring invitation bound to a verified e-mail; the invited person registers or
-- signs in, and ACCEPTS; acceptance re-validates everything in ONE transaction and only then writes the assignment.
--
--   1. Vocabulary      three audit actions appended to ck_audit_action_known (read from the live constraint, never rewritten wholesale).
--   2. Table           app.admin_staff_invitations: closed to every client role, reachable only through the functions below.
--   3. Functions       admin_staff_invite / _invitation_revoke / _invitations_list (staff), staff_invitation_lookup /
--                      staff_invitation_registration_check (token holder, anon-safe, masked) and staff_invitation_accept (authenticated).
--
-- Authority stays in public.admin_role_assignments. Possession of a token never grants anything: acceptance needs a session whose CONFIRMED
-- auth.users e-mail equals the invitation e-mail, a still-authorized inviter, and a dedicated platform-staff account (no persona, no active
-- membership; app.admin_prepare_platform_account is reused unchanged and stays database-owner-only). Only the SHA-256 of a token is stored.
-- Isolated from WhatsApp OTP, D1 and the Worker: nothing here reads or writes any of them.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary: append to the existing allow-list (never rewrite it)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['admin_staff.invited', 'admin_staff.invitation_revoked', 'admin_staff.invitation_accepted'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.audit_log drop constraint ck_audit_action_known;
    execute 'alter table public.audit_log add constraint ck_audit_action_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.audit_log validate constraint ck_audit_action_known;

-- ---------------------------------------------------------------------------
-- 2. The invitation ledger (closed table)
-- ---------------------------------------------------------------------------
create table app.admin_staff_invitations (
  id            uuid primary key default extensions.gen_random_uuid(),
  -- SHA-256 (hex) of the one-time token. The token itself is returned once to the inviter and never stored.
  token_hash    text not null,
  -- The invited address, lower-cased and trimmed. Compared against the CONFIRMED auth.users e-mail at acceptance.
  email         text not null,
  role_id       uuid not null references public.admin_roles (id) on delete restrict,
  invited_by    uuid not null references public.users (id) on delete restrict,
  reason        text not null,
  status        text not null default 'pending',
  expires_at    timestamptz not null,
  accepted_by   uuid references public.users (id) on delete set null,
  accepted_at   timestamptz,
  assignment_id uuid references public.admin_role_assignments (id) on delete set null,
  revoked_by    uuid references public.users (id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint uq_admin_staff_invitations_token unique (token_hash),
  constraint ck_asi_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_asi_email check (email = lower(btrim(email)) and char_length(email) between 5 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint ck_asi_reason check (char_length(btrim(reason)) between 10 and 500),
  constraint ck_asi_status check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint ck_asi_lifetime check (expires_at > created_at and expires_at <= created_at + interval '15 days'),
  constraint ck_asi_shape check (
    (status in ('pending', 'expired') and accepted_at is null and revoked_at is null)
    or (status = 'accepted' and accepted_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null and accepted_at is null)
  )
);
-- One live invitation per (address, role): a duplicate is refused by the database itself, not only by the function.
create unique index uq_asi_pending on app.admin_staff_invitations (email, role_id) where status = 'pending';
create index ix_asi_inviter_pending on app.admin_staff_invitations (invited_by) where status = 'pending';
create index ix_asi_created on app.admin_staff_invitations (created_at desc);
alter table app.admin_staff_invitations enable row level security;
revoke all on app.admin_staff_invitations from public, anon, authenticated, service_role;
comment on table app.admin_staff_invitations is
  'Admin Staff invitations (first-assignment path). Closed table: no policy, no client grant; read and written only by the admin_staff_invite* / staff_invitation_* functions. Stores the SHA-256 of the token, never the token. Rows are never deleted.';

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- A pending invitation whose time has passed is "expired" everywhere it is shown or used.
create function app.admin_staff_invitation_state(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'pending' and p_expires_at <= now() then 'expired' else p_status end;
$$;
revoke all on function app.admin_staff_invitation_state(text, timestamptz) from public, anon, authenticated, service_role;

create function app.admin_staff_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function app.admin_staff_token_hash(text) from public, anon, authenticated, service_role;

-- Creates an invitation and returns the one-time token. The caller must hold admin_staff.manage and be able to hand out the role.
create function public.admin_staff_invite(p_email text, p_role_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  r        public.admin_roles%rowtype;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_reason text := app.admin_clean_reason(p_reason);
  v_token  text;
  v_id     uuid;
  v_exp    timestamptz := clock_timestamp() + interval '7 days';
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  if a.user_id is null then
    raise exception 'staff_invitation: not authenticated' using errcode = '42501';
  end if;
  if char_length(v_email) not between 5 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'staff_invitation: invalid_email' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'staff_invitation: reason_required' using errcode = '22023';
  end if;

  select * into r from public.admin_roles where id = p_role_id;
  if not found or r.status <> 'active' or r.scope_type <> 'platform' then
    raise exception 'staff_invitation: role_not_assignable' using errcode = '42501';
  end if;
  -- v1: the highest authority is never granted by invitation (the database-owner bootstrap and the last-Super-Admin protections stay the only path).
  if r.key = 'super_admin' then
    raise exception 'staff_invitation: role_not_invitable' using errcode = '42501';
  end if;
  if not app.admin_can_wield_role(r.id, a.rank, a.permissions, a.is_super) then
    raise exception 'staff_invitation: you cannot invite to a role at or above your own authority' using errcode = '42501';
  end if;

  -- Nobody invites themselves.
  if exists (select 1 from auth.users u where u.id = a.user_id and lower(btrim(u.email)) = v_email) then
    raise exception 'staff_invitation: you cannot invite yourself' using errcode = '42501';
  end if;
  -- A person who already holds this role needs no invitation.
  if exists (
    select 1 from auth.users u
    join public.admin_role_assignments x on x.user_id = u.id and x.role_id = r.id and x.is_active and x.scope_type = 'platform'
    where lower(btrim(u.email)) = v_email
  ) then
    raise exception 'staff_invitation: already_holds_role' using errcode = '22023';
  end if;

  -- Time-lapsed invitations for this pair no longer block a fresh one.
  update app.admin_staff_invitations
     set status = 'expired'
   where email = v_email and role_id = r.id and status = 'pending' and expires_at <= clock_timestamp();
  if (select count(*) from app.admin_staff_invitations i
       where i.invited_by = a.user_id and i.status = 'pending' and i.expires_at > clock_timestamp()) >= 20 then
    raise exception 'staff_invitation: too_many_pending' using errcode = '54000';
  end if;
  if exists (select 1 from app.admin_staff_invitations i where i.email = v_email and i.role_id = r.id and i.status = 'pending') then
    raise exception 'staff_invitation: already_pending' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, expires_at)
  values (app.admin_staff_token_hash(v_token), v_email, r.id, a.user_id, v_reason, v_exp)
  returning id into v_id;

  perform app.record_audit_event('admin_staff.invited', 'admin_staff_invitation', v_id, null,
    jsonb_build_object('role_key', r.key, 'email_masked', app.mask_email(v_email), 'expires_at', v_exp, 'reason', v_reason));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end;
$$;

-- Withdraws a pending invitation. The inviter may always withdraw their own; otherwise the caller must outrank the role.
create function public.admin_staff_invitation_revoke(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  i        app.admin_staff_invitations%rowtype;
  v_reason text := app.admin_clean_reason(p_reason);
  v_key    text;
begin
  perform app.admin_require('admin_staff.manage');
  select * into a from app.admin_actor();
  select * into i from app.admin_staff_invitations where id = p_id for update;
  if not found then
    raise exception 'staff_invitation: not_found' using errcode = '42501';
  end if;
  if i.status <> 'pending' then
    raise exception 'staff_invitation: not_pending' using errcode = '22023';
  end if;
  if i.invited_by <> a.user_id and not app.admin_can_wield_role(i.role_id, a.rank, a.permissions, a.is_super) then
    raise exception 'staff_invitation: you cannot withdraw this invitation' using errcode = '42501';
  end if;
  update app.admin_staff_invitations
     set status = 'revoked', revoked_by = a.user_id, revoked_at = clock_timestamp()
   where id = i.id;
  select r.key into v_key from public.admin_roles r where r.id = i.role_id;
  perform app.record_audit_event('admin_staff.invitation_revoked', 'admin_staff_invitation', i.id, null,
    jsonb_build_object('role_key', v_key, 'email_masked', app.mask_email(i.email), 'reason', v_reason));
end;
$$;

-- The roster of invitations, masked. `inviter_authorized` is false when the inviter could no longer hand the role out (it would be refused at acceptance).
create function public.admin_staff_invitations_list()
returns table (id uuid, email_masked text, role_key text, role_name text, status text, expires_at timestamptz, created_at timestamptz,
               invited_by uuid, invited_by_name text, inviter_authorized boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require('admin_staff.read');
  return query
    select i.id, app.mask_email(i.email), r.key, r.name, app.admin_staff_invitation_state(i.status, i.expires_at),
           i.expires_at, i.created_at, i.invited_by, coalesce(p.display_name, ''),
           (i.status <> 'pending'
            or (r.status = 'active' and r.key <> 'super_admin'
                and 'admin_staff.manage' = any (app.admin_permissions_of(i.invited_by))
                and app.admin_can_wield_role(r.id, app.admin_rank_of(i.invited_by), app.admin_permissions_of(i.invited_by), app.admin_rank_of(i.invited_by) >= 100)))
      from app.admin_staff_invitations i
      join public.admin_roles r on r.id = i.role_id
      left join public.profiles p on p.user_id = i.invited_by
     order by i.created_at desc
     limit 200;
end;
$$;

-- Token holder's view: a state and, for a live invitation, the role name and a MASKED address. Unknown tokens look exactly like invalid ones.
create function public.staff_invitation_lookup(p_token text)
returns table (status text, role_name text, email_masked text, matches_caller boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i      app.admin_staff_invitations%rowtype;
  v_st   text;
  v_name text;
begin
  select * into i from app.admin_staff_invitations where token_hash = app.admin_staff_token_hash(p_token);
  if not found then
    return query select 'invalid'::text, null::text, null::text, false;
    return;
  end if;
  v_st := app.admin_staff_invitation_state(i.status, i.expires_at);
  if v_st <> 'pending' then
    return query select v_st, null::text, null::text, false;
    return;
  end if;
  select r.name into v_name from public.admin_roles r where r.id = i.role_id;
  return query select 'pending'::text, v_name, app.mask_email(i.email),
    coalesce((select u.email_confirmed_at is not null and lower(btrim(u.email)) = i.email from auth.users u where u.id = (select auth.uid())), false);
end;
$$;

-- Registration gate for the invited person (called before any Auth account exists): true only for a live invitation addressed to exactly this e-mail.
create function public.staff_invitation_registration_check(p_token text, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.admin_staff_invitations i
     where i.token_hash = app.admin_staff_token_hash(p_token)
       and app.admin_staff_invitation_state(i.status, i.expires_at) = 'pending'
       and i.email = lower(btrim(coalesce(p_email, ''))));
$$;

-- Explicit acceptance. Everything is re-validated under a row lock; assignment, activation, consumption and audit commit together or not at all.
create function public.staff_invitation_accept(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  i        app.admin_staff_invitations%rowtype;
  au       record;
  r        public.admin_roles%rowtype;
  v_rank   int;
  v_perms  text[];
  v_active boolean;
  v_assign uuid;
begin
  if v_uid is null then
    raise exception 'staff_invitation: not authenticated' using errcode = '42501';
  end if;
  select * into i from app.admin_staff_invitations where token_hash = app.admin_staff_token_hash(p_token) for update;
  if not found then
    raise exception 'staff_invitation: invalid' using errcode = '22023';
  end if;
  -- Replay by the same person is idempotent; by anyone else it fails closed.
  if i.status = 'accepted' then
    if i.accepted_by = v_uid then
      return jsonb_build_object('status', 'already_accepted', 'assignment_id', i.assignment_id);
    end if;
    raise exception 'staff_invitation: invalid' using errcode = '22023';
  end if;
  if i.status <> 'pending' then
    raise exception 'staff_invitation: invalid' using errcode = '22023';
  end if;
  if i.expires_at <= clock_timestamp() then
    raise exception 'staff_invitation: expired' using errcode = '22023';
  end if;

  -- Recipient identity: the CONFIRMED Supabase Auth address, nothing editable.
  select u.email, u.email_confirmed_at, u.banned_until into au from auth.users u where u.id = v_uid;
  if not found or au.email_confirmed_at is null or lower(btrim(coalesce(au.email, ''))) <> i.email then
    raise exception 'staff_invitation: recipient_mismatch' using errcode = '42501';
  end if;
  if au.banned_until is not null and au.banned_until > clock_timestamp() then
    raise exception 'staff_invitation: recipient_mismatch' using errcode = '42501';
  end if;
  if v_uid = i.invited_by then
    raise exception 'staff_invitation: you cannot accept your own invitation' using errcode = '42501';
  end if;

  -- The inviter's CURRENT authority (a demoted, disabled or suspended inviter yields rank 0 and no permissions).
  v_rank := app.admin_rank_of(i.invited_by);
  v_perms := app.admin_permissions_of(i.invited_by);
  select * into r from public.admin_roles where id = i.role_id;
  if not found or r.status <> 'active' or r.scope_type <> 'platform' or r.key = 'super_admin'
     or not ('admin_staff.manage' = any (v_perms))
     or not app.admin_can_wield_role(r.id, v_rank, v_perms, v_rank >= 100) then
    raise exception 'staff_invitation: inviter_not_authorized' using errcode = '42501';
  end if;

  if exists (select 1 from public.admin_role_assignments x
              where x.user_id = v_uid and x.role_id = r.id and x.is_active and x.scope_type = 'platform') then
    raise exception 'staff_invitation: already_holds_role' using errcode = '22023';
  end if;

  -- Dedicated platform staff only: the existing strict helper (confirmed e-mail, not banned/suspended, no persona, no active membership)
  -- is reused unchanged; a pending account is promoted to active, an active one is left as it is.
  begin
    v_active := app.admin_prepare_platform_account(v_uid, 'admin staff invitation ' || i.id::text);
  exception when sqlstate '22023' then
    raise exception 'staff_invitation: account_not_eligible' using errcode = '42501';
  end;

  insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
  values (v_uid, r.id, 'platform', i.invited_by)
  returning id into v_assign;

  update app.admin_staff_invitations
     set status = 'accepted', accepted_by = v_uid, accepted_at = clock_timestamp(), assignment_id = v_assign
   where id = i.id;

  perform app.record_audit_event('admin_role.assigned', 'admin_role_assignment', v_assign, null,
    jsonb_build_object('target_user_id', v_uid, 'role_key', r.key, 'scope_type', 'platform', 'scope_id', null,
                       'source', 'staff_invitation', 'invitation_id', i.id, 'invited_by', i.invited_by));
  perform app.record_audit_event('admin_staff.invitation_accepted', 'admin_staff_invitation', i.id, null,
    jsonb_build_object('role_key', r.key, 'email_masked', app.mask_email(i.email), 'invited_by', i.invited_by, 'account_activated', v_active));
  return jsonb_build_object('status', 'accepted', 'assignment_id', v_assign, 'account_activated', v_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants: nothing is public; each function names exactly who may call it
-- ---------------------------------------------------------------------------
revoke all on function public.admin_staff_invite(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_staff_invitation_revoke(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_staff_invitations_list() from public, anon, authenticated, service_role;
revoke all on function public.staff_invitation_lookup(text) from public, anon, authenticated, service_role;
revoke all on function public.staff_invitation_registration_check(text, text) from public, anon, authenticated, service_role;
revoke all on function public.staff_invitation_accept(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_staff_invite(text, uuid, text) to authenticated;
grant execute on function public.admin_staff_invitation_revoke(uuid, text) to authenticated;
grant execute on function public.admin_staff_invitations_list() to authenticated;
grant execute on function public.staff_invitation_lookup(text) to anon, authenticated;
grant execute on function public.staff_invitation_registration_check(text, text) to anon, authenticated;
grant execute on function public.staff_invitation_accept(text) to authenticated;

comment on function public.admin_staff_invite(text, uuid, text) is 'Creates a single-use, 7-day Admin Staff invitation bound to an e-mail. Needs admin_staff.manage and the right to hand out the role; never super_admin. Returns the one-time token once.';
comment on function public.staff_invitation_accept(text) is 'Accepts an Admin Staff invitation for the signed-in person. Revalidates identity (confirmed Auth e-mail), the inviter''s current authority and dedicated-staff eligibility; assignment, activation, consumption and audit are one transaction.';
