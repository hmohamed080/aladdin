-- Registration data stays reachable, editable and in step with what the Admin Dashboard reads.
--
-- Audit result (origin/main, Showroom registration -> Showroom settings -> Admin):
--   * BUSINESS CONTACT lived in two places that never talked to each other. Registration wrote
--     organizations.contact_phone / contact_email (what Admin and app.showroom_profile_complete read);
--     the owner-editable contact form (organization_contact_set) wrote organization_contacts only.
--     An edit therefore never reached Admin and a registered value was invisible to the editor.
--   * LEGAL NAME (organizations.legal_name) had a writer at registration only: no way to correct a typo.
--   * BRANCH LOCATION (branches.governorate_key / city_key / city_custom_name) likewise had a writer at
--     registration only; the branch edit RPC covers names, address and timezone.
--   * ADMIN could not tell a freshly registered INSTALLER from anyone else: sign-up records the account as the
--     DECLARED persona (individual_onboarding.prof_concrete_type, which app.effective_persona and
--     account_entry_allowed read), while public.users.primary_account_type is only set when an upgrade is approved.
--     admin_users_list / admin_user_detail read the latter, so a new Installer showed no type and the Installer
--     filter never found them. A SHOWROOM registrant has no personal persona at all (the type lives on the
--     organization), so until the business exists nothing said what they signed up as. Admin also had no read
--     access to organization_activities.
--
-- This migration:
--   1. makes organizations.contact_phone / contact_email the single value for the business phone and
--      e-mail: organization_contact_set now writes it too, and registration seeds organization_contacts, so
--      the editor, the directory visibility flags, the completeness rule and Admin always agree;
--   2. backfills both directions for rows that already exist;
--   3. adds organization_legal_name_set (org.manage; locked once the identity is verified/active, exactly
--      like the display name) and branch_location_set (branch.manage / org.manage, same normalisation and
--      validation as registration).
--
-- Every rewrite of a live function refuses to run unless the text to replace occurs exactly once (same
-- technique as 20261015090053), so a body that drifted can never be half-patched silently.

create or replace function pg_temp.patch(p_fn regprocedure, p_pattern text, p_replacement text, p_expect int default 1)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  select count(*) into v_n from regexp_matches(v_def, p_pattern, 'g');
  if v_n <> p_expect then
    raise exception 'patch %: expected % match(es) of %, found %', p_fn, p_expect, p_pattern, v_n;
  end if;
  execute regexp_replace(v_def, p_pattern, p_replacement, 'g');
end $$;

-- 1. audit vocabulary ----------------------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'ck_audit_action_known';
  alter table public.audit_log drop constraint ck_audit_action_known;
  execute 'alter table public.audit_log add constraint ck_audit_action_known '
    || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
         ', ''organization.legal_name_changed''::text, ''branch.location_changed''::text])))\1');
end $$;

-- 2. one business contact: the editor writes the value Admin and the completeness rule read ----------------
select pg_temp.patch('public.organization_contact_set(uuid,text,text,text,boolean,boolean,boolean)'::regprocedure,
  '  perform app\.record_audit_event\(''organization\.contact_set''',
  $r$  if exists (select 1 from public.organizations o where o.id = p_org_id and o.org_type = 'showroom_dealer') and v_phone is null then
    raise exception 'a showroom needs a business phone' using errcode = '22023';
  end if;
  update public.organizations
     set contact_phone = v_phone, contact_email = v_mail
   where id = p_org_id
     and (contact_phone is distinct from v_phone or contact_email is distinct from v_mail);
  perform app.record_audit_event('organization.contact_set'$r$);

-- Registration seeds the editable contact row, hidden by default, so the owner finds exactly what they entered.
select pg_temp.patch('public.business_draft_submit_v2(uuid)'::regprocedure,
  '  update public\.organizations set contact_phone=v_d\.contact_phone, contact_email=v_d\.contact_email where id=v_org_id;',
  $r$  update public.organizations set contact_phone=v_d.contact_phone, contact_email=v_d.contact_email where id=v_org_id;
  if v_d.contact_phone is not null or v_d.contact_email is not null then
    insert into public.organization_contacts (organization_id, phone_e164, contact_email, updated_by)
    values (v_org_id, v_d.contact_phone,
            case when v_d.contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then v_d.contact_email end,
            v_uid)
    on conflict (organization_id) do nothing;
  end if;$r$);

-- 3. backfill ------------------------------------------------------------------------------------------------
-- A contact row that already exists is the later, owner-made value: bring the organization up to it.
update public.organizations o
   set contact_phone = c.phone_e164, contact_email = c.contact_email
  from public.organization_contacts c
 where c.organization_id = o.id
   and o.deleted_at is null
   and (o.contact_phone is distinct from c.phone_e164 or o.contact_email is distinct from c.contact_email)
   and (c.phone_e164 is null or app.business_contact_phone_valid(c.phone_e164));

-- An organization registered before the contact row existed: seed it from what registration stored.
insert into public.organization_contacts (organization_id, phone_e164, contact_email)
select o.id,
       case when o.contact_phone ~ '^\+[1-9]\d{1,14}$' then o.contact_phone end,
       case when o.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then o.contact_email end
  from public.organizations o
 where o.deleted_at is null
   and (o.contact_phone is not null or o.contact_email is not null)
   and not exists (select 1 from public.organization_contacts c where c.organization_id = o.id);

-- 4. legal name ----------------------------------------------------------------------------------------------
create or replace function public.organization_legal_name_set(p_org_id uuid, p_legal_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_new    text := nullif(btrim(coalesce(p_legal_name, '')), '');
  v_old    text;
  v_locked boolean;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  select o.legal_name into v_old from public.organizations o where o.id = p_org_id and o.deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = '22023';
  end if;
  if v_new is null or char_length(v_new) < 2 or char_length(v_new) > 120 then
    raise exception 'the legal business name must be 2..120 characters' using errcode = '22023';
  end if;
  if v_new is not distinct from v_old then
    return v_new;
  end if;
  -- The legal identity of an approved organization is what Admin verified: it changes only through review.
  v_locked := app.org_identity_locked(p_org_id);
  if v_locked then
    raise exception 'a verified organization identity changes only through Admin review'
      using errcode = '42501', hint = 'identity_change_requires_review';
  end if;
  update public.organizations set legal_name = v_new where id = p_org_id;
  perform app.record_audit_event('organization.legal_name_changed', 'organization', p_org_id, p_org_id,
    jsonb_build_object('length', char_length(v_new)));
  return v_new;
end;
$$;
revoke execute on function public.organization_legal_name_set(uuid, text) from public, anon;
grant  execute on function public.organization_legal_name_set(uuid, text) to authenticated;

-- 5. branch location -----------------------------------------------------------------------------------------
create or replace function public.branch_location_set(
  p_branch_id   uuid,
  p_governorate text,
  p_city        text,
  p_city_custom text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_org_id uuid;
  v_gov    text;
  v_city   text;
  v_custom text;
begin
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22023';
  end if;
  select b.organization_id into v_org_id from public.branches b where b.id = p_branch_id and b.deleted_at is null;
  -- The same answer whether the branch is missing or belongs to someone else's organization.
  if v_org_id is null or not app.is_org_member(v_org_id) then
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not (app.has_capability(v_org_id, 'branch.manage') or app.has_capability(v_org_id, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  -- The location of a branch is not optional once it has been given: a governorate and a city (or a typed one).
  select n.o_governorate, n.o_city, n.o_custom into v_gov, v_city, v_custom
    from app.normalize_business_location(p_governorate, p_city, p_city_custom, true) n;
  if v_gov is null or (v_city is null and v_custom is null) then
    raise exception 'a governorate and a city are required' using errcode = '22023';
  end if;
  update public.branches
     set governorate_key = v_gov, city_key = v_city, city_custom_name = v_custom
   where id = p_branch_id;
  perform app.record_audit_event('branch.location_changed', 'branch', p_branch_id, v_org_id,
    jsonb_build_object('governorate', v_gov, 'city', v_city, 'custom_city', v_custom is not null));
end;
$$;
revoke execute on function public.branch_location_set(uuid, text, text, text) from public, anon;
grant  execute on function public.branch_location_set(uuid, text, text, text) to authenticated;

-- 6. Admin reads --------------------------------------------------------------------------------------------
-- What a person registered as: their personal persona if they have one (declared at Installer sign-up or
-- earned by an approved upgrade), else the business type they chose at sign-up, else the type of the business
-- they belong to. Presentation data for Admin only; it grants nothing.
create or replace function app.registered_account(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.effective_persona(p_user_id)::text,
    (select op.selected_org_type::text from public.onboarding_progress op
      where op.user_id = p_user_id and op.selected_track = 'business'),
    (select o.org_type::text from public.memberships m
       join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = p_user_id and m.status = 'active'
      order by m.created_at, m.id limit 1));
$$;
revoke execute on function app.registered_account(uuid) from public, anon, authenticated;

-- The Installer filter and the type shown in Admin follow the persona the app itself uses.
select pg_temp.patch('public.admin_users_list(text,text,public.persona_type,text,text,text,integer,integer)'::regprocedure,
  'u\.primary_account_type = p_account_type',
  'app.effective_persona(u.id) = p_account_type');
select pg_temp.patch('public.admin_users_list(text,text,public.persona_type,text,text,text,integer,integer)'::regprocedure,
  '''account_type'', u\.primary_account_type,',
  '''account_type'', app.effective_persona(u.id), ''registered_account'', app.registered_account(u.id),');
select pg_temp.patch('public.admin_user_detail(uuid)'::regprocedure,
  '''account_type'', u\.primary_account_type,',
  '''account_type'', app.effective_persona(u.id), ''registered_account'', app.registered_account(u.id),');

-- The organizations directory shows each business's registered phone and primary-branch location.
select pg_temp.patch('public.admin_organizations_list(text,text,public.organization_type,text,integer,integer)'::regprocedure,
  '''owner'', \(',
  $r$'contact_phone', o.contact_phone,
      'governorate', (select b.governorate_key from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'city', (select b.city_key from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'city_custom_name', (select b.city_custom_name from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'owner', ($r$);

-- Admin reads a business's activities the way it already reads the organization and its branches.
create policy organization_activities_select_platform on public.organization_activities
  for select to authenticated
  using ((select app.has_admin_permission('organizations.read')));

notify pgrst, 'reload schema';
