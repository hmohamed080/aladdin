-- Admin Users directory: list an account whose latest verification is APPROVED under the Verified tab.
--
-- Professional approval (review_approve + apply_account_upgrade) records the verification and sets the account type; it has
-- never changed users.status, and no ordinary user is ever 'active' (only staff are). The directory therefore showed an approved
-- user as Verification = Verified but left it in the Pending tab (and in the "needing verification review" count), which was
-- inconsistent. This changes ONLY how the Admin directory derives its status tab. It does NOT activate any account, does not
-- touch users.status, is_verified or any authorization rule: app.admin_user_status_tab is an IMMUTABLE display helper that
-- nothing else reads (it is used only by the Admin directory functions and has every client grant revoked).
--
-- Order of the rules: suspended wins, then rejected (the latest decision), then an approved verification, then the account status.

create or replace function app.admin_user_status_tab(p_status public.user_status, p_latest public.verification_status)
returns text
language sql
immutable
as $$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_status = 'pending_verification' and p_latest = 'approved' then 'verified'
    when p_status = 'active' then 'verified'
    when p_status = 'pending_verification' then 'pending'
  end
$$;
