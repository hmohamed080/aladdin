-- ===========================================================================
-- Verify the STAGING demo world. READ-ONLY: this script writes nothing.
--
--   psql "<connection string>" -f supabase/staging/verify-staging-seed.sql
--
-- Raises on the first failure and prints a per-account report on success. It is
-- safe to run as often as you like, against staging or a local rehearsal.
--
-- WHAT IT CHECKS, AND WHY EACH ONE EARNS ITS PLACE
-- ------------------------------------------------
--   A. Population    — 26 accounts, each with the user/profile rows the app reads.
--   B. Addresses     — unique, deliverable, and in lockstep with public.contacts.
--                      Sign-in is Email OTP only, so a duplicate or reserved
--                      address is an account nobody can open.
--   C. Linkage       — persona, membership, capability and branch rows all point
--                      at things that exist and belong together.
--   D. Consistency   — every quotation and order total equals the sum of its own
--                      lines, and every commerce record joins organizations that
--                      actually take part in it. A seeded total that disagrees
--                      with its items makes Reports contradict the detail screen.
--   E. Landing       — the route each account resolves to, computed the same way
--                      frontend/src/lib/workspace/model.ts computes it.
--   F. Non-emptiness — THE POINT OF THE FILE. Every account is impersonated under
--                      RLS and must have something to show. One account is
--                      exempt, by name and with a stated reason.
--
-- Deliberately keyed on UUIDs, never on email addresses: the addresses are
-- composed from a mailbox that must never enter the repository, so this file
-- checks their PROPERTIES and leaves their VALUES to the generated manifest.
-- ===========================================================================

\set ON_ERROR_STOP on
\timing off

-- Rehearsal escape hatch for check B2 ONLY. `scripts/rehearse_staging_seed.py`
-- builds its bundle with deliberately undeliverable `@example.test` addresses —
-- it needs no mailbox and must never be mistaken for a cloud load — so B2 would
-- fail there by design. Every other check still runs, and a real staging run
-- passes no variable and therefore gets the full check.
--
--   psql … -f verify-staging-seed.sql              → deliverability ENFORCED
--   psql … -v rehearsal=on -f verify-staging-seed.sql → B2 skipped
\if :{?rehearsal}
\else
  \set rehearsal off
\endif

-- Wrapped in a transaction that always ROLLS BACK. The checks below only read,
-- but wrapping makes that structural rather than a promise: this script cannot
-- modify staging even if it is edited carelessly later. It also keeps the
-- temporary result tables alive for the report at the end.
begin;

-- Carried into the block as a GUC, not as a psql variable: psql does not
-- interpolate `:vars` inside dollar-quoted bodies, so `:'rehearsal'` would reach
-- the server literally and fail to parse.
select set_config('aladdin.rehearsal', :'rehearsal', true) as rehearsal_mode \gset

do $verify$
declare
  v_rehearsal constant boolean :=
    lower(coalesce(current_setting('aladdin.rehearsal', true), 'off')) in ('on', 'true', '1', 'yes');
  v_role      text := coalesce(current_setting('role', true), 'none');
  v_claims    text := coalesce(current_setting('request.jwt.claims', true), '');
  v_n         int;
  v_txt       text;
  acct        record;   -- named, not `r`: a bare `r` shadows every `rfqs r` alias below
  v_landing   text;
  v_visible   int;
  v_workspaces text;
  v_persona   text;
  v_failures  text[] := array[]::text[];

  -- The 26 accounts, keyed by the deterministic UUIDs the seed files own.
  -- `expect_landing` mirrors landingFor(); `exempt_reason` is non-null for the
  -- one account that is SUPPOSED to be empty.
  c_accounts constant text := $acc$
    11111111-1111-4111-8111-111111111111|Amina Farouk|/b2b|
    22222222-2222-4222-8222-222222222222|Karim Adel|/home|
    33333333-3333-4333-8333-333333333333|Nadia Salem|/home|
    44444444-4444-4444-8444-444444444444|Omar Zaki|/home|
    55555555-5555-4555-8555-555555555555|Platform Admin|/admin|
    70000001-0000-4000-8000-000000000001|Hana Mansour|/b2b|
    70000002-0000-4000-8000-000000000002|Youssef Amin|/home|
    70000003-0000-4000-8000-000000000003|Tarek Halim|/b2b|
    70000004-0000-4000-8000-000000000004|Sara Nabil|/b2b|
    70000005-0000-4000-8000-000000000005|Khaled Roushdy|/b2b|
    70000006-0000-4000-8000-000000000006|Mostafa Bakr|/home|
    70000007-0000-4000-8000-000000000007|Laila Shafik|/home|
    70000008-0000-4000-8000-000000000008|Yasser Fouad|/home|
    70000009-0000-4000-8000-000000000009|Ahmed Sobhy|/home|
    70000010-0000-4000-8000-000000000010|Nour Hegazy|/onboarding|deliberate: the pending-invitation and new-user journey
    71000001-0000-4000-8000-000000000001|Mahmoud Ezzat|/b2b|
    71000002-0000-4000-8000-000000000002|Rania Gamal|/b2b|
    71000003-0000-4000-8000-000000000003|Fady Riad|/b2b|
    71000004-0000-4000-8000-000000000004|Dina Sherif|/b2b|
    71000005-0000-4000-8000-000000000005|Hazem Lotfy|/b2b|
    71000006-0000-4000-8000-000000000006|Sayed Abdel-Rahman|/home|
    71000007-0000-4000-8000-000000000007|Mahmoud Fathy|/home|
    71000008-0000-4000-8000-000000000008|Ibrahim Nasr|/home|
    71000009-0000-4000-8000-000000000009|Wael Sobhy|/home|
    71000010-0000-4000-8000-000000000010|Heba Kamal|/home|
    71000011-0000-4000-8000-000000000011|Amr Selim|/home|
  $acc$;
begin
  create temporary table if not exists _expect (
    user_id       uuid primary key,
    name          text not null,
    landing       text not null,
    exempt_reason text
  ) on commit drop;
  delete from _expect;

  -- Parsed defensively: the literal is indented for readability, and this file
  -- may be checked out with CRLF endings on Windows. Both would otherwise ride
  -- along into a uuid cast or a route comparison.
  insert into _expect (user_id, name, landing, exempt_reason)
  select btrim(split_part(line, '|', 1), E' \t\r')::uuid,
         btrim(split_part(line, '|', 2), E' \t\r'),
         btrim(split_part(line, '|', 3), E' \t\r'),
         nullif(btrim(split_part(line, '|', 4), E' \t\r'), '')
  from unnest(string_to_array(replace(c_accounts, E'\r', ''), E'\n')) as line
  where btrim(line) <> '';

  select count(*) into v_n from _expect;
  if v_n <> 26 then
    raise exception 'verify: expected 26 accounts in the check list, parsed %', v_n;
  end if;

  -- =========================================================================
  -- A. Population
  -- =========================================================================
  select count(*) into v_n from auth.users;
  if v_n <> 26 then
    raise exception 'A1 population: auth.users holds % rows, expected 26', v_n;
  end if;

  select count(*) into v_n
    from _expect e left join auth.users u on u.id = e.user_id
   where u.id is null;
  if v_n > 0 then
    raise exception 'A2 population: % expected account(s) are missing from auth.users', v_n;
  end if;

  select count(*) into v_n
    from auth.users u left join public.users pu on pu.id = u.id
   where pu.id is null;
  if v_n > 0 then
    raise exception 'A3 population: % auth user(s) have no public.users row', v_n;
  end if;

  select count(*) into v_n
    from auth.users u
    left join public.profiles p on p.user_id = u.id and p.deleted_at is null
   where p.user_id is null;
  if v_n > 0 then
    raise exception 'A4 population: % user(s) have no live profile row', v_n;
  end if;

  select count(*) into v_n
    from public.profiles
   where deleted_at is null and coalesce(btrim(display_name), '') = '';
  if v_n > 0 then
    raise exception 'A5 population: % profile(s) have a blank display name', v_n;
  end if;

  -- =========================================================================
  -- B. Addresses — the credential path, since sign-in is Email OTP only
  -- =========================================================================
  select count(*) into v_n from (
    select lower(email) from auth.users group by 1 having count(*) > 1
  ) d;
  if v_n > 0 then
    raise exception 'B1 email: % duplicate address(es) in auth.users', v_n;
  end if;

  select string_agg(u.id::text, ', ') into v_txt
    from auth.users u
   where split_part(lower(u.email), '@', 2) ~ '\.(test|example|invalid|localhost|local)$'
      or split_part(lower(u.email), '@', 2) ~ '(^|\.)example\.(com|net|org)$'
      or coalesce(btrim(u.email), '') = '';
  if v_txt is not null and not v_rehearsal then
    raise exception
      'B2 email: account(s) on a RESERVED, undeliverable domain: %', v_txt
      using hint = 'Rebuild the seed with a configured demo mailbox; these accounts can never receive an OTP.';
  elsif v_txt is not null then
    raise notice 'B2 email: SKIPPED (rehearsal) — addresses are intentionally undeliverable.';
  end if;

  select count(*) into v_n from auth.users where email_confirmed_at is null;
  if v_n > 0 then
    raise exception 'B3 email: % account(s) are not email-confirmed and cannot sign in', v_n;
  end if;

  -- GoTrue scans these as text; a NULL breaks the lookup with "Database error
  -- finding user", which presents as a working address that never sends a code.
  select count(*) into v_n
    from auth.users
   where confirmation_token is null or recovery_token is null or email_change is null
      or email_change_token_new is null or email_change_token_current is null
      or reauthentication_token is null or phone_change is null or phone_change_token is null;
  if v_n > 0 then
    raise exception 'B4 email: % account(s) have NULL GoTrue token columns (OTP lookup would fail)', v_n;
  end if;

  select count(*) into v_n
    from _expect e
    left join public.contacts c
           on c.user_id = e.user_id and c.channel = 'email' and c.is_primary
   where c.id is null;
  if v_n > 0 then
    raise exception 'B5 email: % account(s) have no primary email contact row', v_n;
  end if;

  select count(*) into v_n
    from public.contacts c
    join auth.users u on u.id = c.user_id
   where c.channel = 'email' and c.is_primary and lower(c.value) <> lower(u.email);
  if v_n > 0 then
    raise exception 'B6 email: % primary contact row(s) disagree with auth.users.email', v_n;
  end if;

  select count(*) into v_n
    from public.contacts where is_primary and not is_verified;
  if v_n > 0 then
    raise exception 'B7 email: % primary contact(s) are unverified', v_n;
  end if;

  -- =========================================================================
  -- C. Linkage — persona, membership, capability, branch
  -- =========================================================================
  -- A persona is PERSONAL state. A business classification belongs to
  -- organizations.org_type and must never be mirrored onto a person; since
  -- Sprint 13 the two are different enums, so this is a type-level guarantee —
  -- checked anyway because it is the model's load-bearing rule.
  select count(*) into v_n
    from public.users
   where primary_account_type is not null
     and primary_account_type::text not in
         ('end_consumer','engineer','interior_designer','installer_technician','contractor','sales','trainer','trainee');
  if v_n > 0 then
    raise exception 'C1 linkage: % user(s) carry a non-persona account type', v_n;
  end if;

  select count(*) into v_n
    from public.memberships m
    left join public.organizations o on o.id = m.organization_id and o.deleted_at is null
   where o.id is null;
  if v_n > 0 then
    raise exception 'C2 linkage: % membership(s) point at a missing or deleted organization', v_n;
  end if;

  select count(*) into v_n
    from public.memberships m left join public.users u on u.id = m.user_id
   where u.id is null;
  if v_n > 0 then
    raise exception 'C3 linkage: % membership(s) point at a missing user', v_n;
  end if;

  select count(*) into v_n
    from public.membership_capabilities c
    left join public.memberships m on m.id = c.membership_id
   where m.id is null;
  if v_n > 0 then
    raise exception 'C4 linkage: % capability row(s) are orphaned', v_n;
  end if;

  -- A branch grant must name a branch of the SAME organization as the
  -- membership, or the grant silently widens scope across tenants.
  select count(*) into v_n
    from public.membership_branch_access a
    join public.memberships m on m.id = a.membership_id
    join public.branches b on b.id = a.branch_id
   where b.organization_id <> m.organization_id;
  if v_n > 0 then
    raise exception 'C5 linkage: % branch grant(s) cross an organization boundary', v_n;
  end if;

  select count(*) into v_n
    from public.memberships m
    join public.branches b on b.id = m.primary_branch_id
   where b.organization_id <> m.organization_id;
  if v_n > 0 then
    raise exception 'C6 linkage: % membership(s) have a primary branch in another organization', v_n;
  end if;

  -- Every active organization needs at least one branch and at least one owner,
  -- or its workspace opens on a broken shell.
  select string_agg(o.name, ', ') into v_txt
    from public.organizations o
   where o.deleted_at is null
     and not exists (select 1 from public.branches b where b.organization_id = o.id);
  if v_txt is not null then
    raise exception 'C7 linkage: organization(s) with no branch: %', v_txt;
  end if;

  select string_agg(o.name, ', ') into v_txt
    from public.organizations o
   where o.deleted_at is null
     and not exists (
       select 1 from public.memberships m
       join public.membership_capabilities c on c.membership_id = m.id
       where m.organization_id = o.id and m.status = 'active' and c.capability_key = 'org.manage'
     );
  if v_txt is not null then
    raise exception 'C8 linkage: organization(s) with no active owner: %', v_txt;
  end if;

  -- Sales records must stay inside their own organization.
  select count(*) into v_n
    from public.leads l join public.memberships m on m.id = l.assigned_membership_id
   where m.organization_id <> l.organization_id;
  if v_n > 0 then
    raise exception 'C9 linkage: % lead(s) assigned to a membership in another organization', v_n;
  end if;

  select count(*) into v_n
    from public.customers c join public.branches b on b.id = c.branch_id
   where b.organization_id <> c.organization_id;
  if v_n > 0 then
    raise exception 'C10 linkage: % customer(s) sit on a branch of another organization', v_n;
  end if;

  select count(*) into v_n
    from public.leads l join public.customers c on c.id = l.customer_id
   where c.organization_id <> l.organization_id;
  if v_n > 0 then
    raise exception 'C11 linkage: % lead(s) reference a customer of another organization', v_n;
  end if;

  -- =========================================================================
  -- D. Commerce consistency
  -- =========================================================================
  select string_agg(q.id::text, ', ') into v_txt
    from public.quotations q
    join (
      select quotation_id, sum(quantity * unit_price) as line_total
        from public.quotation_items group by quotation_id
    ) s on s.quotation_id = q.id
   where q.total <> s.line_total;
  if v_txt is not null then
    raise exception
      'D1 commerce: quotation total disagrees with its own line items: %', v_txt
      using hint = 'Reports aggregates the header; the detail screen sums the lines. They must agree.';
  end if;

  select string_agg(o.id::text, ', ') into v_txt
    from public.orders o
    join (
      select order_id, sum(quantity * unit_price) as line_total
        from public.order_items group by order_id
    ) s on s.order_id = o.id
   where o.total <> s.line_total;
  if v_txt is not null then
    raise exception 'D2 commerce: order total disagrees with its own line items: %', v_txt;
  end if;

  select count(*) into v_n from public.quotations where total is null or total <= 0;
  if v_n > 0 then
    raise exception 'D3 commerce: % quotation(s) have a null or non-positive total', v_n;
  end if;

  -- A quotation answers an RFQ; both sides must be the same two organizations.
  select count(*) into v_n
    from public.quotations q join public.rfqs r on r.id = q.rfq_id
   where q.supplier_org_id <> r.supplier_org_id
      or q.requester_org_id <> r.requester_org_id;
  if v_n > 0 then
    raise exception 'D4 commerce: % quotation(s) name different parties than their RFQ', v_n;
  end if;

  select count(*) into v_n
    from public.orders o join public.quotations q on q.id = o.quotation_id
   where o.supplier_org_id <> q.supplier_org_id
      or o.requester_org_id <> q.requester_org_id;
  if v_n > 0 then
    raise exception 'D5 commerce: % order(s) name different parties than their quotation', v_n;
  end if;

  select count(*) into v_n
    from public.projects p join public.orders o on o.id = p.order_id
   where p.requester_org_id <> o.requester_org_id
      or p.executing_org_id <> o.supplier_org_id;
  if v_n > 0 then
    raise exception 'D6 commerce: % project(s) name different parties than their order', v_n;
  end if;

  -- An accepted quotation with no order is a chain that stops halfway, which is
  -- exactly what a demo must not show on a screen labelled "accepted".
  select count(*) into v_n
    from public.quotations q
   where q.status = 'accepted'
     and not exists (select 1 from public.orders o where o.quotation_id = q.id);
  if v_n > 0 then
    raise exception 'D7 commerce: % accepted quotation(s) produced no order', v_n;
  end if;

  select count(*) into v_n
    from public.rfq_items i left join public.rfqs r on r.id = i.rfq_id where r.id is null;
  if v_n > 0 then
    raise exception 'D8 commerce: % orphaned RFQ item(s)', v_n;
  end if;

  select count(*) into v_n
    from public.rfqs r
   where r.status <> 'draft'
     and not exists (select 1 from public.rfq_items i where i.rfq_id = r.id);
  if v_n > 0 then
    raise exception 'D9 commerce: % submitted RFQ(s) have no line items', v_n;
  end if;

  select count(*) into v_n
    from public.products where status = 'published' and published_at is null;
  if v_n > 0 then
    raise exception 'D10 commerce: % published product(s) have no published_at', v_n;
  end if;

  raise notice 'A-D structural checks passed.';

  -- =========================================================================
  -- E + F. Per-account landing and non-emptiness, under real RLS
  -- =========================================================================
  -- Each account is impersonated as `authenticated` with its own JWT claim, so
  -- every count below is filtered by the same policies that will filter it in
  -- the browser. Anything asserted here is asserted about what the user will
  -- actually see, not about what the table happens to contain.
  create temporary table if not exists _seen (
    user_id     uuid primary key,
    name        text,
    landing     text,
    workspaces  text,
    persona     text,
    visible     int,
    detail      text,
    exempt      boolean
  ) on commit drop;
  delete from _seen;

  for acct in select * from _expect order by user_id loop
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', acct.user_id::text, 'role', 'authenticated')::text,
      true
    );

    -- Landing, computed exactly as frontend/src/lib/workspace/model.ts does:
    -- platform authority wins outright; otherwise the selected work context, and
    -- with no cookie a Personal context (which exists only when a personal
    -- persona was claimed) is preferred over a business one.
    if public.my_registration_state() <> 'active_personal' then
      v_landing := '/onboarding';
    elsif exists (select 1 from public.platform_role_grants g where g.user_id = acct.user_id) then
      v_landing := '/admin';
    elsif exists (select 1 from public.my_workspaces() w where w.kind = 'personal') then
      v_landing := '/home';
    elsif exists (select 1 from public.my_workspaces() w where w.kind = 'business') then
      v_landing := '/b2b';
    else
      v_landing := '/home';
    end if;

    -- "Has something to show", measured per surface the account actually lands on.
    if v_landing = '/admin' then
      select count(*) into v_visible from public.verifications where status in ('submitted','under_review','needs_more_info');
      v_txt := format('%s verification(s) awaiting review', v_visible);
    elsif v_landing = '/b2b' then
      select (select count(*) from public.rfqs)
           + (select count(*) from public.quotations)
           + (select count(*) from public.orders)
           + (select count(*) from public.projects)
           + (select count(*) from public.customers)
           + (select count(*) from public.leads)
           + (select count(*) from public.saved_products)
           + (select count(*) from public.products p
                where exists (select 1 from public.my_workspaces() w
                               where w.kind = 'business' and w.organization_id = p.organization_id))
        into v_visible;
      v_txt := format('rfq=%s quo=%s ord=%s prj=%s cust=%s lead=%s',
                      (select count(*) from public.rfqs),
                      (select count(*) from public.quotations),
                      (select count(*) from public.orders),
                      (select count(*) from public.projects),
                      (select count(*) from public.customers),
                      (select count(*) from public.leads));
    elsif v_landing = '/home' then
      -- The personal home is rendered almost entirely from these two rows. An
      -- account without them shows a blank profile at single-digit completeness,
      -- which is the failure this whole exercise exists to remove.
      select (case when exists (select 1 from public.onboarding_progress where user_id = acct.user_id and phone is not null) then 1 else 0 end)
           + (case when exists (
                select 1 from public.individual_onboarding io
                 where io.user_id = acct.user_id
                   and (io.consumer_completed_at is not null or io.professional_completed_at is not null)
              ) then 1 else 0 end)
        into v_visible;
      v_txt := format('onboarding_progress=%s individual_onboarding=%s',
                      (select count(*) from public.onboarding_progress where user_id = acct.user_id),
                      (select count(*) from public.individual_onboarding where user_id = acct.user_id));
      if v_visible = 2 then v_visible := 1; else v_visible := 0; end if;
    else
      v_visible := 0;
      v_txt := 'onboarding flow';
    end if;

    select coalesce(string_agg(w.kind || ':' || coalesce(w.name, ''), ' | ' order by w.kind desc, w.name), '(none)')
      from public.my_workspaces() w into v_workspaces;
    select coalesce((select pu.primary_account_type::text from public.users pu where pu.id = acct.user_id), '—')
      into v_persona;

    -- Drop back to the invoking role BEFORE writing anything: `authenticated`
    -- has no rights on this temporary table, and it should not — the report is
    -- the verifier's own bookkeeping, not something a demo user can touch.
    perform set_config('role', v_role, true);
    perform set_config('request.jwt.claims', v_claims, true);

    insert into _seen (user_id, name, landing, workspaces, persona, visible, detail, exempt)
    values (acct.user_id, acct.name, v_landing, v_workspaces, v_persona,
            v_visible, v_txt, acct.exempt_reason is not null);

    if v_landing <> acct.landing then
      v_failures := v_failures || format('%s: lands on %s, manifest says %s', acct.name, v_landing, acct.landing);
    end if;
    if v_visible = 0 and acct.exempt_reason is null then
      v_failures := v_failures || format('%s: EMPTY experience at %s (%s)', acct.name, v_landing, v_txt);
    end if;
    if v_visible > 0 and acct.exempt_reason is not null then
      v_failures := v_failures || format('%s: expected to be empty (%s) but has data', acct.name, acct.exempt_reason);
    end if;
  end loop;

  perform set_config('role', v_role, true);
  perform set_config('request.jwt.claims', v_claims, true);

  if cardinality(v_failures) > 0 then
    raise exception E'E-F per-account checks FAILED:\n  - %', array_to_string(v_failures, E'\n  - ');
  end if;

  raise notice 'E-F per-account checks passed for all 26 accounts.';
end
$verify$;

-- The report. Emails are shown MASKED: this script is safe to paste into a issue
-- or a chat log, and the real addresses live only in the generated manifest.
select
  row_number() over (order by s.user_id)                       as "#",
  s.name                                                       as "display name",
  regexp_replace(u.email, '^(.{2}).*@', '\1•••@')              as "email (masked)",
  s.persona                                                    as "persona",
  s.workspaces                                                 as "workspaces",
  s.landing                                                    as "lands on",
  case when s.exempt then 'exempt — new-user journey' else s.detail end as "visible demo data"
from _seen s
join auth.users u on u.id = s.user_id
order by s.user_id;

rollback;
