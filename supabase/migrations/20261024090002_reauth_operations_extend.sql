-- ===========================================================================
-- One current-password confirmation for every security-sensitive account change
--
-- WHY. PR #88 (20261018090001_secondary_phone_reservations) introduced the platform's current-password
-- confirmation: public.account_password_confirm checks the caller's password against their own Auth hash,
-- throttles 5 wrong passwords per 15 minutes PER ACCOUNT (app.password_confirm_attempts) and issues a
-- single-use, 60-second receipt bound to (user, operation, target) in app.reauth_receipts. The Installer
-- rehearsal (Settings Part 2B) had built a second, competing gate for the same purpose (M2,
-- app.sensitive_action_*), keyed per (user, action), which would have given each action its own budget.
--
-- DECISION (owner, 2026-10-21): keep PR #88's mechanism as the ONLY one. The rehearsal's Installer
-- operations (primary phone change, password change, contact email) are moved onto it here. There is one
-- attempt budget per account across every operation, one receipt table and one audit vocabulary.
--
-- WHAT CHANGES.
--   * account_password_confirm accepts four more operations. Every existing operation, its target rule, its
--     throttle, its receipt lifetime and its audit events are unchanged:
--       primary_phone.change   target = the NEW canonical E.164 number (a receipt for one number cannot move
--                              the phone to another)
--       password.change        target = 'self'
--       contact_email.set      target = the normalized (lower-case) address
--       contact_email.remove   target = 'self'
--   * app.consume_reauth_receipt_for(user, receipt, operation, target): the same single-use check as
--     app.consume_reauth_receipt, for the trusted server's service-role operations (where auth.uid() is
--     NULL). The receipt is still bound to the user who confirmed the password; the server passes the
--     session user and cannot substitute another one without that user's own receipt. Returns false instead
--     of raising, so a definer caller can roll back its whole transaction (and with it the spend).
--   * app.reauth_receipts.audited_at: lets a password change be audited at most once per spent receipt.
-- No API role gains any privilege on a table; the new helper is not callable by any API role.
-- ===========================================================================

alter table app.reauth_receipts add column audited_at timestamptz;
comment on column app.reauth_receipts.audited_at is
  'Set when the audit event of the operation this (spent) receipt authorized was written; guarantees at most one event per receipt.';

create or replace function app.reauth_target_normalize(p_operation text, p_target text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_operation in ('secondary_phone.reserve', 'secondary_phone.change', 'secondary_phone.convert', 'primary_phone.change') then
    return app.require_canonical_phone(p_target);
  elsif p_operation = 'contact_email.set' then
    if p_target is null or p_target <> lower(btrim(p_target)) or char_length(p_target) > 254
       or p_target !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or right(p_target, 32) = '@craftsman-login.aladdin.invalid' then
      raise exception 'invalid email address' using errcode = '22023';
    end if;
    return p_target;
  elsif p_operation in ('password.change', 'contact_email.remove') then
    if p_target is distinct from 'self' then
      raise exception 'this operation takes no target' using errcode = '22023';
    end if;
    return p_target;
  end if;
  raise exception 'unsupported operation' using errcode = '22023';
end;
$$;
revoke all on function app.reauth_target_normalize(text, text) from public, anon, authenticated, service_role;

create or replace function public.account_password_confirm(p_password text, p_operation text, p_target text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_now    timestamptz := clock_timestamp();
  v_hash   text;
  v_row    app.password_confirm_attempts%rowtype;
  v_id     uuid;
  v_target text := app.reauth_target_normalize(p_operation, p_target);
  v_meta   jsonb;
begin
  if p_password is null or char_length(p_password) = 0 or char_length(p_password) > 200 then
    raise exception 'password required' using errcode = '22023';
  end if;

  insert into app.password_confirm_attempts (user_id, window_start) values (v_uid, v_now)
  on conflict (user_id) do nothing;
  select * into v_row from app.password_confirm_attempts where user_id = v_uid for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_row.locked_until);
  end if;
  if v_row.locked_until is not null or v_row.window_start <= v_now - interval '15 minutes' then
    update app.password_confirm_attempts set window_start = v_now, failures = 0, locked_until = null where user_id = v_uid;
    v_row.failures := 0;
  end if;

  select au.encrypted_password into v_hash from auth.users au where au.id = v_uid;
  if v_hash is null or v_hash = '' then
    -- Social-only accounts have no password to confirm.
    return jsonb_build_object('ok', false, 'reason', 'no_password');
  end if;

  if extensions.crypt(p_password, v_hash) is distinct from v_hash then
    if v_row.failures + 1 >= 5 then
      update app.password_confirm_attempts set failures = 0, locked_until = v_now + interval '15 minutes' where user_id = v_uid;
      perform app.record_audit_event('account.password_confirm_locked', 'user', v_uid, null,
        jsonb_build_object('operation', p_operation));
      return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_now + interval '15 minutes');
    end if;
    update app.password_confirm_attempts set failures = v_row.failures + 1 where user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'wrong_password', 'remaining', 4 - v_row.failures);
  end if;

  update app.password_confirm_attempts set failures = 0, window_start = v_now, locked_until = null where user_id = v_uid;
  delete from app.reauth_receipts where created_at < v_now - interval '1 day';
  insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at)
  values (v_uid, p_operation, v_target, v_now, v_now + interval '60 seconds')
  returning id into v_id;
  -- Audit metadata never carries a whole number or an address.
  v_meta := case
    when p_operation like '%phone%' then jsonb_build_object('operation', p_operation, 'target', app.mask_phone(v_target))
    else jsonb_build_object('operation', p_operation) end;
  perform app.record_audit_event('account.password_confirmed', 'user', v_uid, null, v_meta);
  return jsonb_build_object('ok', true, 'receipt', v_id, 'expires_at', v_now + interval '60 seconds');
end;
$$;
comment on function public.account_password_confirm(text, text, text) is
  'Checks the caller''s CURRENT password against their own Auth hash and returns {ok, receipt} (single-use, 60 s, bound to user + operation + target) or {ok:false, reason: wrong_password|locked|no_password}. Operations: secondary_phone.reserve|change|convert and primary_phone.change (target = canonical E.164), contact_email.set (target = lower-case address), password.change and contact_email.remove (target = ''self''). ONE budget per account across every operation: 5 wrong passwords in 15 minutes lock confirmation for 15 minutes. Returns a status instead of raising so a failure is always counted.';
revoke all on function public.account_password_confirm(text, text, text) from public, anon;
grant execute on function public.account_password_confirm(text, text, text) to authenticated;

-- The service-role counterpart of app.consume_reauth_receipt (same rules; explicit user).
create or replace function app.consume_reauth_receipt_for(p_user_id uuid, p_receipt uuid, p_operation text, p_target text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_receipt is null or p_operation is null or p_target is null then
    return false;
  end if;
  update app.reauth_receipts
     set used_at = clock_timestamp()
   where id = p_receipt
     and user_id = p_user_id
     and operation = p_operation
     and target = p_target
     and used_at is null
     and expires_at > clock_timestamp();
  return found;
end;
$$;
comment on function app.consume_reauth_receipt_for(uuid, uuid, text, text) is
  'Internal. Spends a reauth receipt for an explicit user (the trusted server acts as service_role, where auth.uid() is NULL): single-use, unexpired, bound to that user, the operation and the target. Returns false instead of raising.';
revoke all on function app.consume_reauth_receipt_for(uuid, uuid, text, text) from public, anon, authenticated, service_role;
