-- Admin Users directory: the Verified tab means VERIFIED, and the Pending tab is the real review queue.
--
-- app.admin_user_status_tab derived the tab from users.status alone for ordinary accounts: every ACTIVE account (an account
-- that finished onboarding) was listed under "Verified" even when its Verification was "Unverified", and an account with an
-- open verification request but an active status was not in the Pending tab. users.status is the ACCOUNT lifecycle, not trust;
-- this derives the tab from the verification decision instead. It changes ONLY how the Admin directory groups accounts:
-- no account is activated, users.status / is_verified / public_profile_status are untouched, and no authorization reads this
-- IMMUTABLE display helper (client grants stay revoked; same signature as before).
--
-- Rules, in order: Suspended wins; then a Rejected latest decision; then an Approved one (Verified); then an open request
-- (submitted / under_review / needs_more_info) or a not-yet-onboarded account (pending_verification) is Pending; any other
-- account (e.g. an active account that never asked for verification, or a deactivated one) appears under "All" only.

create or replace function app.admin_user_status_tab(p_status public.user_status, p_latest public.verification_status)
returns text
language sql
immutable
as $$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_latest = 'approved' then 'verified'
    when p_latest in ('submitted', 'under_review', 'needs_more_info') then 'pending'
    when p_status = 'pending_verification' then 'pending'
  end
$$;
