-- HELD ACTIVATION (not a migration). See supabase/activation/README.md for preconditions and approval rules.
-- Drops every INSERT / UPDATE / ALL policy on storage.objects that targets one of the seven application buckets,
-- after saving its exact definition so the rollback can recreate it. No other policy is touched.
create table if not exists app.storage_write_closure_saved (
  policyname text primary key, cmd text not null, roles text[] not null, qual text, with_check text, permissive text not null,
  closed_at timestamptz not null default now());
revoke all on app.storage_write_closure_saved from public, anon, authenticated;

do $$
declare p record;
begin
  for p in
    select policyname, cmd, roles, qual, with_check, permissive from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'ALL')
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~
           $re$bucket_id\s*=\s*'(avatars|professional-portfolio|professional-certificates|product-images|organization-images|purchase-request-images|business-verification-documents)'$re$
  loop
    insert into app.storage_write_closure_saved(policyname, cmd, roles, qual, with_check, permissive)
      values (p.policyname, p.cmd, p.roles::text[], p.qual, p.with_check, p.permissive) on conflict (policyname) do nothing;
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
