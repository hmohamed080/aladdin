-- ===========================================================================
-- DRAFT - NOT A MIGRATION. NOT APPLIED ANYWHERE. Lives under docs/ so it is never auto-applied.
-- P1 audit_log username redaction (owner approved the DESIGN on 2026-11-10; hosted EXECUTION is NOT approved).
-- Design and evidence: docs/operations/account-identity/P1-AUDIT-LOG-REDACTION-DESIGN.md
--
-- WHAT IT DOES. Removes the key 'username' from public.audit_log.metadata, ONLY for rows whose action is
-- 'profile.username_set'. Nothing else about those rows changes (id, actor, role, action, subject, organization,
-- created_at and every other metadata key stay byte-identical). No row is inserted or deleted.
--
-- HOW, WITHOUT WEAKENING THE PROTECTION.
--   * No ALTER TABLE ... DISABLE TRIGGER, no session_replication_role, no DROP TRIGGER: both triggers stay enabled.
--   * The update guard app.guard_audit_actor_deletion() is replaced IN THIS TRANSACTION by a version that, in addition
--     to its existing exception, permits exactly one transformation: metadata := metadata - 'username' on a
--     'profile.username_set' row with every other column identical, at trigger depth 1, from a superuser-class
--     login session, and only while a transaction-local token is set.
--   * Before the transaction ends the ORIGINAL guard is restored byte for byte and the token is cleared. The bypass
--     code therefore never exists outside this transaction: if the transaction aborts, nothing is left; if it
--     commits, the restored function is identical (md5 of its source is asserted before and after).
--   * The migration verifies its own result and aborts (the whole transaction rolls back) on any mismatch:
--     guard source fingerprint, aggregate checksum of everything except the username key, row count, zero remaining
--     username keys, restored guard fingerprint, unchanged ACL / owner / security-definer / search_path.
--
-- NO TRANSACTION CONTROL HERE: the Supabase migration runner (and the permission gate) own BEGIN/COMMIT. The test
-- harness wraps this file in its own transaction.
-- ===========================================================================

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $redact$
declare
  c_known_guard_md5 constant text := '74f342a538358489bf193ae0be832890';  -- app.guard_audit_actor_deletion() as of 20261014085731
  v_oid          oid := 'app.guard_audit_actor_deletion()'::regprocedure;
  v_md5          text;
  v_acl_before   text;
  v_owner_before text;
  v_cfg_before   text;
  v_total_before bigint;
  v_total_after  bigint;
  v_key_before   bigint;
  v_key_after    bigint;
  v_sum_before   text;
  v_sum_after    text;
  v_updated      bigint;
begin
  -- Guard rails: only the migration login may run this, and the live guard must be the known one.
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'audit redaction must run from the migration login (postgres/supabase_admin), not %', session_user;
  end if;
  select md5(p.prosrc), coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner),
         coalesce(p.proconfig::text, '') || p.prosecdef::text
    into v_md5, v_acl_before, v_owner_before, v_cfg_before
    from pg_proc p where p.oid = v_oid;
  if v_md5 is distinct from c_known_guard_md5 then
    raise exception 'unexpected audit guard source (md5 %); refusing to touch it', v_md5;
  end if;

  -- Pre-run aggregate over every column, metadata taken WITHOUT the username key.
  select count(*), count(*) filter (where action = 'profile.username_set' and metadata ? 'username'),
         md5(coalesce(string_agg(concat_ws('|', id, actor_user_id, actor_role, action, subject_type, subject_id,
                                  organization_id, created_at, (case when action = 'profile.username_set' then metadata - 'username' else metadata end)::text), E'\n' order by id), ''))
    into v_total_before, v_key_before, v_sum_before
    from public.audit_log;

  -- 1. Install the narrowly scoped guard (same name, owner and ACL: CREATE OR REPLACE keeps them).
  execute $f$
    create or replace function app.guard_audit_actor_deletion()
    returns trigger language plpgsql security definer set search_path = '' as $g$
    begin
      -- NEW, transaction-scoped: the one permitted redaction.
      if current_setting('app.audit_redaction', true) = 'profile.username_set:remove-username:v1'
         and session_user in ('postgres', 'supabase_admin')
         and pg_trigger_depth() = 1
         and old.action = 'profile.username_set'
         and old.metadata ? 'username'
         and new.metadata = old.metadata - 'username'
         and (to_jsonb(old) - 'metadata') = (to_jsonb(new) - 'metadata') then
        return new;
      end if;
      -- EXISTING behaviour, unchanged.
      if pg_trigger_depth() > 1
         and old.actor_user_id is not null and new.actor_user_id is null
         and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id')
         and not exists (select 1 from public.users where id = old.actor_user_id) then
        return new;
      end if;
      raise exception 'audit_log is append-only (UPDATE forbidden)';
    end;
    $g$
  $f$;

  -- 2. Transaction-local token (third argument true = LOCAL: cleared automatically at COMMIT or ROLLBACK).
  perform set_config('app.audit_redaction', 'profile.username_set:remove-username:v1', true);

  -- 3. The redaction itself.
  update public.audit_log
     set metadata = metadata - 'username'
   where action = 'profile.username_set' and metadata ? 'username';
  get diagnostics v_updated = row_count;

  -- 4. Clear the token and restore the original guard immediately, before any verification.
  perform set_config('app.audit_redaction', '', true);
  execute $f$
    create or replace function app.guard_audit_actor_deletion()
    returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1
     and old.actor_user_id is not null and new.actor_user_id is null
     and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id')
     and not exists (select 1 from public.users where id = old.actor_user_id) then
    return new;
  end if;
  raise exception 'audit_log is append-only (UPDATE forbidden)';
end;
$$
  $f$;

  -- 5. Self-verification: any failure aborts and rolls back everything above.
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_oid) is distinct from c_known_guard_md5 then
    raise exception 'restored guard differs from the original; aborting';
  end if;
  if (select coalesce(p.proacl::text, '') from pg_proc p where p.oid = v_oid) is distinct from v_acl_before
     or (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_oid) is distinct from v_owner_before
     or (select coalesce(p.proconfig::text, '') || p.prosecdef::text from pg_proc p where p.oid = v_oid) is distinct from v_cfg_before then
    raise exception 'guard ACL, owner or security settings changed; aborting';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.audit_log'::regclass
        and t.tgname in ('audit_log_no_update', 'audit_log_no_delete') and t.tgenabled = 'O') <> 2 then
    raise exception 'an audit_log immutability trigger is missing or not enabled; aborting';
  end if;
  select count(*), count(*) filter (where action = 'profile.username_set' and metadata ? 'username'),
         md5(coalesce(string_agg(concat_ws('|', id, actor_user_id, actor_role, action, subject_type, subject_id,
                                  organization_id, created_at, metadata::text), E'\n' order by id), ''))
    into v_total_after, v_key_after, v_sum_after
    from public.audit_log;
  if v_total_after <> v_total_before then
    raise exception 'row count changed (% -> %); aborting', v_total_before, v_total_after;
  end if;
  if v_key_after <> 0 or v_updated <> v_key_before then
    raise exception 'redaction incomplete (updated %, expected %, remaining %); aborting', v_updated, v_key_before, v_key_after;
  end if;
  if v_sum_after is distinct from v_sum_before then
    raise exception 'non-username content changed; aborting';
  end if;

  -- Counts only: never a value.
  raise notice 'audit_log username redaction: rows=% redacted=% remaining=% checksum_match=true',
    v_total_after, v_updated, v_key_after;
end;
$redact$;
