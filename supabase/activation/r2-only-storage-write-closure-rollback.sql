-- HELD ACTIVATION ROLLBACK: recreates exactly the policies the closure saved, then forgets them.
do $$
declare p record;
begin
  for p in select * from app.storage_write_closure_saved loop
    execute format('create policy %I on storage.objects as %s for %s to %s %s %s',
      p.policyname, p.permissive, p.cmd, array_to_string(p.roles, ', '),
      case when p.qual is not null then 'using (' || p.qual || ')' else '' end,
      case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end);
  end loop;
  delete from app.storage_write_closure_saved;
end $$;
