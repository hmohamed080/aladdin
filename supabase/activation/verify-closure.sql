-- CI proof (run as: begin; <closure> <this> rollback). Raises on any failure.
do $$
declare n int; b text; u constant uuid := '70000009-0000-4000-8000-000000000009'; ok boolean;
begin
  select count(*) into n from app.storage_write_closure_saved;
  if n = 0 then raise exception 'closure saved no policy: nothing was closed'; end if;
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT','UPDATE','ALL')
    and coalesce(qual,'') || ' ' || coalesce(with_check,'') ~ $re$bucket_id\s*=\s*'(avatars|professional-portfolio|professional-certificates|product-images|organization-images|purchase-request-images|business-verification-documents)'$re$;
  if n <> 0 then raise exception 'application-bucket write policies remain: %', n; end if;
  -- An authenticated user can no longer write any application bucket.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach b in array array['avatars','professional-portfolio','professional-certificates','product-images','organization-images','purchase-request-images','business-verification-documents'] loop
    ok := false;
    begin
      insert into storage.objects(bucket_id, name, owner) values (b, u || '/closure-probe.png', u);
    exception when others then ok := true; end;
    if not ok then raise exception 'authenticated could still insert into %', b; end if;
  end loop;
  reset role;
end $$;
