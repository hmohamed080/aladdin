-- Deny every caller SELECT-shaped Storage operation for revocable buckets.
-- Restrictive AND prevents future permissive grants from reopening direct signing/reads.
-- INSERT is unchanged. Upsert was already unsupported. Backend verification/cleanup
-- first checks caller media_storage_resolve, then uses server-only Storage authority.
do $$ begin
  if (select count(*) from storage.buckets where id in
    ('avatars','professional-portfolio','professional-certificates','product-images','organization-images') and not public) <> 5 then
    raise exception 'Expected five private revocable media buckets';
  end if;
end $$;
create policy revocable_media_backend_reads on storage.objects
  as restrictive for select to anon, authenticated
  using (bucket_id not in ('avatars','professional-portfolio','professional-certificates','product-images','organization-images'));
-- No function, table grant, creator default, managed ownership or existing object changes.
