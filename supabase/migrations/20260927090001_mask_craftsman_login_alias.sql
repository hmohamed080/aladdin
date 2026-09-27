-- ===========================================================================
-- Temporary craftsman phone + password flow — never render its login alias.
--
-- Accounts created by /temporary/craftsman/sign-up sign in with an INTERNAL,
-- undeliverable login alias derived from their phone
-- (`p<digits>@craftsman-login.aladdin.invalid`,
-- frontend/src/lib/auth/craftsman-login-alias.ts). It is a login key, not a
-- contact, and must never be shown — not even masked. The application filters
-- it wherever it renders the auth email; this closes the database-rendered
-- surfaces, which all go through app.mask_email (org people lists, showroom
-- affiliation queues, invitation previews).
--
-- The ONLY behavioral change: an alias now masks to '•••', exactly what a
-- missing email already masks to. Every other input returns what it returned
-- before (same expression, unchanged). No table, column, policy, or grant is
-- touched; removable together with the temporary flow.
-- ===========================================================================

create or replace function app.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then '•••'
    when lower(split_part(p_email, '@', 2)) = 'craftsman-login.aladdin.invalid' then '•••'
    else left(split_part(p_email, '@', 1), 1) || '•••@•••.'
         || reverse(split_part(reverse(split_part(p_email, '@', 2)), '.', 1))
  end
$$;
revoke execute on function app.mask_email(text) from public;
grant execute on function app.mask_email(text) to anon, authenticated, service_role;

comment on function app.mask_email(text) is
  'Masks an email for display (first local character + TLD). Returns ''•••'' for NULL/non-email input and for the temporary craftsman flow''s internal login alias domain (craftsman-login.aladdin.invalid), which is a login key and never a contact.';
