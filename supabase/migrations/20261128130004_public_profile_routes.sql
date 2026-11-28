-- Readable public URLs reuse the existing publication boundary for every
-- supported professional persona. Never expose an unlisted username here.
create function app._public_profile_routes()
returns table(id uuid, persona text, username text)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.persona::text, p.username_normalized
  from app._profile_public_directory() d
  join public.profiles p on p.id = d.id
  where p.username_normalized is not null;
$$;
revoke all on function app._public_profile_routes() from public;
grant execute on function app._public_profile_routes() to anon, authenticated, service_role;
create view public.profile_public_routes with (security_invoker = true) as
select id, persona, username from app._public_profile_routes();
revoke all on public.profile_public_routes from public, anon, authenticated, service_role;
grant select on public.profile_public_routes to anon, authenticated, service_role;
comment on view public.profile_public_routes is 'Canonical public handles; constrained by the same listed, active, non-deleted professional projection as public portfolios. No contact or authentication fields.';
