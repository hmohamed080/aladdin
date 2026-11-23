-- Craftsman profile completion -> professional verification request.
--
-- /home/profile is the single place a Craftsman (installer_technician) completes the professional profile. When the
-- AUTHORITATIVE profile completion (app.profile_completion, the same figure the page and the dashboard show) reaches
-- 100%, exactly one professional verification request is filed through the EXISTING verification system, so it
-- appears in Admin > Verifications for a real Approve / Reject. The account is never approved here.
--
-- Why not request_account_upgrade: it refuses a caller whose account type is ALREADY the requested type ("account is
-- already of the requested type"), and individual_submit_professional skips it in that case and files nothing. An
-- existing Craftsman therefore could never reach review. This function files the same row request_account_upgrade
-- files (subject_type user, verification_type professional, requested_account_type installer_technician), without
-- that guard. apply_account_upgrade already handles requested = current (no type change, nothing else touched).
--
-- States (decided on the latest professional request of the caller, under a per-user advisory lock):
--   none yet           -> insert 'submitted'                              => 'submitted'
--   draft              -> 'submitted'                                     => 'submitted'
--   submitted / under_review -> nothing changes (no duplicate)            => 'already_open'
--   needs_more_info    -> back to 'submitted' (reviewer + reason cleared) => 'resubmitted'   (the user just saved)
--   approved           -> nothing changes, approval is never reset        => 'approved'
--   rejected           -> nothing changes, never auto-resubmitted         => 'rejected'
--                         (p_after_rejection => true: ONE new request)       => 'resubmitted_after_rejection'
--   completion < 100   -> nothing                                         => 'incomplete'
-- Only the Craftsman persona may call it. It is idempotent: calling it any number of times files at most one request.
--
-- Manual resubmission after a rejection: p_after_rejection => true (the user pressing Resubmit; never the automatic
-- path) files ONE new 'submitted' request when the latest request was rejected and the profile is 100% complete. A
-- rejected request itself is never reopened or edited. Repeated presses find the new open request ('already_open').
--
-- Approval recheck: a BEFORE UPDATE trigger (craftsman_review_complete) refuses to move a Craftsman's professional
-- request to 'approved' unless the profile is STILL 100% complete at that moment. It sits on the table, so it holds
-- for review_approve and any other path, and it does not redefine review_approve.

create or replace function public.craftsman_profile_verification_submit(p_after_rejection boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_verified_caller();
  v_persona public.persona_type := app.effective_persona(v_uid);
  v_percent integer;
  v_v       public.verifications;
  v_id      uuid;
begin
  if v_persona is distinct from 'installer_technician' then
    raise exception 'only a craftsman profile can request verification here' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('craftsman-verification:' || v_uid::text, 0));

  v_percent := coalesce((app.profile_completion(v_uid) ->> 'percent')::integer, 0);
  if v_percent < 100 then
    return jsonb_build_object('state', 'incomplete', 'percent', v_percent, 'verification_id', null);
  end if;

  select * into v_v from public.verifications
   where subject_type = 'user' and user_id = v_uid and verification_type = 'professional'
   order by submitted_at desc nulls last, created_at desc
   limit 1
   for update;

  if found then
    if v_v.status in ('submitted', 'under_review') then
      return jsonb_build_object('state', 'already_open', 'percent', v_percent, 'verification_id', v_v.id);
    elsif v_v.status = 'approved' then
      return jsonb_build_object('state', 'approved', 'percent', v_percent, 'verification_id', v_v.id);
    elsif v_v.status = 'rejected' then
      if not coalesce(p_after_rejection, false) then
        return jsonb_build_object('state', 'rejected', 'percent', v_percent, 'verification_id', v_v.id);
      end if;
      -- Manual resubmission: the rejected row stays as decided; a NEW request is filed.
      insert into public.verifications
        (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
      values ('user', v_uid, 'professional', 'installer_technician', 'submitted', now())
      on conflict do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from public.verifications
         where subject_type = 'user' and user_id = v_uid and status in ('draft', 'submitted', 'under_review', 'needs_more_info')
         order by submitted_at desc nulls last limit 1;
        return jsonb_build_object('state', 'already_open', 'percent', v_percent, 'verification_id', v_id);
      end if;
      perform app.record_audit_event('account.upgrade_requested', 'verification', v_id, null,
        jsonb_build_object('requested_account_type', 'installer_technician', 'resubmission_after_rejection', true, 'source', 'profile_completion'));
      return jsonb_build_object('state', 'resubmitted_after_rejection', 'percent', v_percent, 'verification_id', v_id);
    elsif v_v.status = 'needs_more_info' then
      update public.verifications
         set status = 'submitted', reviewer_id = null, reason = null
       where id = v_v.id;
      perform app.record_audit_event('account.upgrade_requested', 'verification', v_v.id, null,
        jsonb_build_object('requested_account_type', 'installer_technician', 'resubmission', true, 'source', 'profile_completion'));
      return jsonb_build_object('state', 'resubmitted', 'percent', v_percent, 'verification_id', v_v.id);
    elsif v_v.status = 'draft' then
      update public.verifications set status = 'submitted', submitted_at = now() where id = v_v.id;
      perform app.record_audit_event('account.upgrade_requested', 'verification', v_v.id, null,
        jsonb_build_object('requested_account_type', 'installer_technician', 'source', 'profile_completion'));
      return jsonb_build_object('state', 'submitted', 'percent', v_percent, 'verification_id', v_v.id);
    end if;
    -- Any other (terminal) status: do not touch it, do not file a second request.
    return jsonb_build_object('state', v_v.status::text, 'percent', v_percent, 'verification_id', v_v.id);
  end if;

  insert into public.verifications
    (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
  values ('user', v_uid, 'professional', 'installer_technician', 'submitted', now())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a race with another open request (the open-request unique index): report it, file nothing.
    select id into v_id from public.verifications
     where subject_type = 'user' and user_id = v_uid and status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     order by submitted_at desc nulls last limit 1;
    return jsonb_build_object('state', 'already_open', 'percent', v_percent, 'verification_id', v_id);
  end if;

  perform app.record_audit_event('account.upgrade_requested', 'verification', v_id, null,
    jsonb_build_object('requested_account_type', 'installer_technician', 'source', 'profile_completion'));
  return jsonb_build_object('state', 'submitted', 'percent', v_percent, 'verification_id', v_id);
end;
$$;

revoke all on function public.craftsman_profile_verification_submit(boolean) from public, anon, service_role;
grant execute on function public.craftsman_profile_verification_submit(boolean) to authenticated;
comment on function public.craftsman_profile_verification_submit(boolean) is 'Craftsman only. When app.profile_completion reaches 100, files exactly one professional verification request through the existing verifications table (works when the account type is already installer_technician). Never approves; never resets an approved request; a rejected request is only followed by a NEW one when p_after_rejection is true (manual Resubmit); needs_more_info is resubmitted. Idempotent.';

-- Approval recheck. Eligibility is evaluated at the moment of approval, on the authoritative completion.
create or replace function app.craftsman_review_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and new.status is distinct from old.status
     and new.subject_type = 'user' and new.verification_type = 'professional'
     and new.requested_account_type = 'installer_technician'
     and app.effective_persona(new.user_id) = 'installer_technician'
     and coalesce((app.profile_completion(new.user_id) ->> 'percent')::integer, 0) < 100 then
    raise exception 'complete the craftsman profile before approval' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.craftsman_review_guard() from public, anon, authenticated, service_role;

drop trigger if exists craftsman_review_complete on public.verifications;
create trigger craftsman_review_complete
  before update on public.verifications
  for each row execute function app.craftsman_review_guard();
