-- ===========================================================================
-- Installer My Work — the WORK CONTACT of an assignment
--
-- `my_job_assignments` deliberately carries no contact detail, so an installer
-- holding live or finished work had no way to reach the organization behind it.
-- This adds a dedicated, assignment-keyed contact and ONE caller-scoped read model
-- over it.
--
-- WHAT A CONTACT IS. A work/assignment contact is contact data an organization
-- INTENTIONALLY shares for one work relationship — a business line, a project
-- coordinator. It is NOT the personal identity contact of whichever employee
-- clicked "accept": nothing here reads `profiles`, `contacts` or any membership.
--
-- A SNAPSHOT, NOT A LOOKUP. A row is written once, when the assignment becomes
-- real, and then stays as it was. It therefore cannot change under the installer,
-- and it does not disappear when the person who accepted later leaves, is
-- suspended or is removed — READ authority belongs to the ASSIGNMENT (the assigned
-- installer, while the work is in progress or completed), never to the current
-- membership of whoever created the row. No user id is stored or exposed.
--
-- THE SOURCE IS NOT INVENTED HERE. At the time of writing the platform holds no
-- explicit job/work contact and no organization business contact (the only
-- phone/e-mail columns belong to personal profiles, sales customers, invitations
-- and referrals), so nothing populates this table yet and an assignment simply has
-- no contact — shown as such, never as a placeholder. The one write path is
-- `app.assignment_contact_snapshot`, which an accept-time hook will call once a
-- real source exists (see the report that accompanies this migration). It is
-- callable only by the owner/service role: never by `authenticated` or `anon`.
--
-- THE READ RULE, ALL OF IT:
--   * only the ASSIGNED installer (`installer_user_id = auth.uid()`) — no other
--     caller, signed in or not, can read a row for somebody else's assignment;
--   * only while the assignment is `in_progress` or `completed`;
--   * only these columns: organization name, contact name, phone, e-mail — never a
--     user id, role, or any profile / identity / verification field.
-- ===========================================================================

create table public.assignment_contacts (
  assignment_id   uuid        primary key references public.job_assignments (id) on delete cascade,
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  contact_name    text,
  phone_e164      text,
  email           text,
  -- Where the values came from. Only explicit, intentionally shared sources.
  source          text        not null,
  created_at      timestamptz not null default now(),
  constraint ck_assignment_contacts_name  check (contact_name is null or (contact_name = btrim(contact_name) and char_length(contact_name) between 1 and 120)),
  constraint ck_assignment_contacts_phone check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint ck_assignment_contacts_email check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint ck_assignment_contacts_source check (source in ('job_contact', 'organization_contact', 'assignment_selected')),
  -- A contact with nothing to reach them by is not a contact.
  constraint ck_assignment_contacts_reachable check (phone_e164 is not null or email is not null)
);

comment on table public.assignment_contacts is
  'The work contact an organization intentionally shares for ONE assignment, snapshotted when the assignment becomes real. Not a personal profile contact; no user id. Read only through my_assignment_contacts (assigned installer, in_progress/completed). Written only by app.assignment_contact_snapshot.';

create index ix_assignment_contacts_org on public.assignment_contacts (organization_id);

-- RLS on, and no client policy or grant at all: the definer reader below is the
-- only door.
alter table public.assignment_contacts enable row level security;
revoke all on public.assignment_contacts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The one write path (owner / service role only)
-- ---------------------------------------------------------------------------
create function app.assignment_contact_snapshot(
  p_assignment_id uuid,
  p_contact_name  text,
  p_phone_e164    text,
  p_email         text,
  p_source        text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Snapshotted ONCE: a second call never rewrites what the installer was shown.
  insert into public.assignment_contacts (assignment_id, organization_id, contact_name, phone_e164, email, source)
  select a.id, a.poster_org_id,
         nullif(btrim(coalesce(p_contact_name, '')), ''),
         nullif(btrim(coalesce(p_phone_e164, '')), ''),
         nullif(btrim(coalesce(p_email, '')), ''),
         p_source
  from public.job_assignments a
  where a.id = p_assignment_id
  on conflict (assignment_id) do nothing;
end;
$$;

comment on function app.assignment_contact_snapshot(uuid, text, text, text, text) is
  'Records the work contact for an assignment, once. The caller supplies values from an EXPLICIT shared source (job contact, organization contact, or a contact chosen for the assignment); this never reads a member profile. Not granted to authenticated or anon.';

revoke execute on function app.assignment_contact_snapshot(uuid, text, text, text, text) from public, anon, authenticated;
grant  execute on function app.assignment_contact_snapshot(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The caller-scoped read model
-- ---------------------------------------------------------------------------
create function app._my_assignment_contacts()
returns table (
  assignment_id uuid,
  org_name      text,
  contact_name  text,
  phone         text,
  email         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, o.name, c.contact_name, c.phone_e164, c.email
  from public.assignment_contacts c
  join public.job_assignments a on a.id = c.assignment_id
  join public.organizations   o on o.id = a.poster_org_id
  -- The whole authority, and it is the ASSIGNMENT's: the caller IS the assigned
  -- installer and the work has begun. No parameter, so it cannot be pointed at
  -- anyone else's assignment, and nothing about any member's current status is
  -- consulted.
  where a.installer_user_id = (select auth.uid())
    and (select auth.uid()) is not null
    and a.status in ('in_progress'::public.job_assignment_status, 'completed'::public.job_assignment_status);
$$;

comment on function app._my_assignment_contacts() is
  'Internal SECURITY DEFINER reader backing public.my_assignment_contacts. The snapshotted work contact of the caller''s OWN in_progress / completed assignments plus the organization name. Columns: organization name, contact name, phone, e-mail — nothing else. No parameter.';

revoke execute on function app._my_assignment_contacts() from public, anon;
grant  execute on function app._my_assignment_contacts() to authenticated, service_role;

create view public.my_assignment_contacts with (security_invoker = true) as
  select assignment_id, org_name, contact_name, phone, email
  from app._my_assignment_contacts();

comment on view public.my_assignment_contacts is
  'The work contact for the caller''s own in_progress / completed assignments (a snapshot taken when the assignment became real). security_invoker=true over app._my_assignment_contacts(); a row exists only when a contact was recorded.';

revoke all on public.my_assignment_contacts from anon, authenticated, service_role;
grant select on public.my_assignment_contacts to authenticated, service_role;
