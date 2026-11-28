-- ===========================================================================
-- app.audit_actions_add: ADD actions to public.audit_log's action vocabulary, never remove one
--
-- WHY. public.audit_log carries CHECK constraint ck_audit_action_known, an allow-list of audit actions. Several migrations
-- have re-created it from a LITERAL list written at the time; applied after a branch that added more actions they silently
-- drop those (main hit exactly this in 20261015090050, which restored 22 Admin actions). The three installer / contact
-- migrations that follow this one add their own actions through this helper instead of a literal list, so the vocabulary
-- they leave behind is "whatever was allowed before, plus mine".
--
-- BEHAVIOUR.
--   * Reads the CURRENT definition, appends only the actions that are missing, and re-adds the constraint. Existing rows
--     already satisfy the old list, so they satisfy a superset: nothing can fail on existing data.
--   * The re-added constraint is created NOT VALID and then VALIDATEd, so the table is scanned under the weaker
--     SHARE UPDATE EXCLUSIVE lock, not the ACCESS EXCLUSIVE lock a plain ADD CONSTRAINT would hold for the scan.
--   * Idempotent: asking for actions that are all present changes nothing and returns 0.
--   * Fails loudly (and the migration rolls back) if the constraint is missing or has an unexpected shape, or if an action
--     is not a lower-case dotted identifier. It never guesses.
--   * Returns the number of actions actually added.
--
-- Not callable by any API role. It exists for migrations (run as the migration owner).
-- ===========================================================================
create function app.audit_actions_add(p_actions text[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_def     text;
  v_missing text[];
  v_bad     text[];
begin
  select coalesce(array_agg(a), '{}') into v_bad from unnest(p_actions) a where a is null or a !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$';
  if cardinality(v_bad) > 0 then
    raise exception 'audit_actions_add: action names must be lower-case dotted identifiers' using errcode = '22023';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'audit_actions_add: ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;

  select coalesce(array_agg(distinct a order by a), '{}') into v_missing
    from unnest(p_actions) a
   where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) = 0 then
    return 0;
  end if;

  alter table public.audit_log drop constraint ck_audit_action_known;
  execute 'alter table public.audit_log add constraint ck_audit_action_known '
    || regexp_replace(
         v_def,
         '\]\)\)\)( NOT VALID)?$',
         (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a)
       )
    || ' NOT VALID';
  alter table public.audit_log validate constraint ck_audit_action_known;
  return cardinality(v_missing);
end;
$$;
revoke all on function app.audit_actions_add(text[]) from public, anon, authenticated, service_role;
comment on function app.audit_actions_add(text[]) is
  'Migration helper: appends actions to ck_audit_action_known (never removes), NOT VALID then VALIDATE. Returns how many were added. No API role can execute it.';
