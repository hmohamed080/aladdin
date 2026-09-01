-- ===========================================================================
-- Canonical trade taxonomy (D8) — the vocabulary leaves TypeScript and prose
-- ===========================================================================
-- WHAT THIS IS. §4 of `docs/database/installer-jobs.md`: one reference table of
-- trades, one relation from a person to the trades they work in, and one write
-- path that applies a whole selection at once. Nothing else.
--
-- WHY IT EXISTS. Today a professional's trade is TWO things and neither is
-- authority. `individual_onboarding.prof_specialization` is `text` with an
-- 80-char check — the onboarding chips write a stable key into it, and every
-- seeded and staging professional holds free prose ("Marble and granite
-- fixing"). `SPECIALIZATIONS` in `lib/onboarding/persona-fields.ts` is the
-- vocabulary, in the browser bundle. A job that must name ONE required trade
-- (D8) cannot reference either: you cannot foreign-key to a sentence, and you
-- cannot join a TypeScript literal.
--
-- WHAT IT IS NOT, and this is the load-bearing constraint (O5):
--
--   > An installer MAY apply to a job outside their declared trades.
--
-- Trade membership is a DISCOVERY AND DISPLAY SIGNAL. It is never an
-- authorization input. Concretely, and asserted by `41_`:
--   * no RLS policy anywhere may reference `public.user_trades`;
--   * no capability, grant or `app.can_*` predicate reads it;
--   * a future `job_application_submit` performs no trade check.
-- The UI may tell a tiler that a gypsum job is outside their declared trades.
-- It must not stop them applying. A locked filter is a gate wearing a filter's
-- clothes, and this table is the place that mistake would be easiest to make.
--
-- WHAT THIS INCREMENT DELIBERATELY DOES NOT BUILD: jobs, applications,
-- assignments, matching, recommendations, or any filter over trades. §4.4's
-- `jobs.trade_id` is prepared for only in the sense that `trades.id` is a stable
-- uuid primary key an Increment-6 foreign key can name.
--
-- Forward-only and additive. No column is dropped, no text is rewritten, and no
-- existing function body changes except the §4.6 projection, which is widened by
-- the established drop-and-recreate dance.

-- ---------------------------------------------------------------------------
-- 1. public.trades — the reference table
-- ---------------------------------------------------------------------------
-- NO DISPLAY NAME COLUMNS, and that is a decision rather than an omission (§4.2).
-- Labels live in `src/lib/i18n/messages/{en,ar}.ts` keyed by `key`, which is
-- where every other vocabulary in this product is translated. Adding `name_en`
-- and `name_ar` here would create a SECOND translation source competing with the
-- catalogs — two places to change one word, and no way for a reviewer to tell
-- which one the screen is reading.
--
-- Rows are REFERENCE DATA: inserted by migration, never by a client. The table
-- carries no insert/update/delete grant at all, so "who may rename a trade" has
-- exactly one answer — whoever writes the next migration.
create table public.trades (
  id         uuid primary key default gen_random_uuid(),
  key        text        not null unique,
  is_active  boolean     not null default true,
  sort_order smallint    not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lower snake case, <= 64 chars. The key is a machine identifier that becomes
  -- part of an i18n message path and, later, a URL filter value; a stray space
  -- or capital would be invisible here and broken at both.
  constraint trades_key_shape check (
    char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'
  )
);

comment on table public.trades is
  'Canonical trade vocabulary (D8, §4.2). Reference data: seeded by migration, with NO client write grant in any role. Display names are NOT columns — they live in the i18n catalogs keyed by `key`, so there is one translation source per string. is_active retires a trade without deleting the history of who held it. Trade membership is a discovery signal and never an authorization input (O5).';

comment on column public.trades.key is
  'Stable machine identifier (lower snake case). Also the i18n message key suffix and, later, the discovery filter value — so it is immutable in practice: renaming one would silently change a label lookup and every stored filter.';
comment on column public.trades.is_active is
  'False retires the trade: it stops being selectable and stops appearing in the public projection, while every existing user_trades row survives. Deactivation is a migration, not a client action.';
comment on column public.trades.sort_order is
  'Deterministic presentation order, so the editor, the hub and the public page list trades identically without each choosing its own sort.';

create trigger set_trades_updated_at
  before update on public.trades
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. public.user_trades — the person↔trade relation, and nothing more
-- ---------------------------------------------------------------------------
-- OWNERSHIP IS USER-LEVEL, NEVER ORGANIZATIONAL (§4.3). A trade is something a
-- PERSON does; an installer who joins a contracting company still fixes marble,
-- and one who leaves it does not stop. Hanging this off `memberships` would make
-- a professional's own practice disappear when an employment ended, which is the
-- same category error as putting `org_type` on `users`.
create table public.user_trades (
  user_id    uuid        not null references public.users(id)  on delete cascade,
  -- RESTRICT, not cascade: deleting a trade someone holds must fail loudly.
  -- Retirement is `is_active = false`, which keeps the history readable.
  trade_id   uuid        not null references public.trades(id) on delete restrict,
  is_primary boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, trade_id)
);

-- AT MOST ONE PRIMARY PER PERSON, enforced by the index rather than by the
-- writer. `user_trades_set` is careful, but "the RPC is careful" is a property of
-- today's code; a partial unique index is a property of the data. If a future
-- writer, a fixture or a psql session ever tries to leave two primaries behind,
-- it fails at the index instead of quietly publishing an ambiguous profile.
create unique index ux_user_trades_one_primary
  on public.user_trades (user_id) where is_primary;

-- The projection joins on user_id for every listed profile; the primary key's
-- leading column already serves that. No further index is justified at Pilot size.

comment on table public.user_trades is
  'The trades one PERSON works in (D8, §4.3). Many rows per user, at most one is_primary (ux_user_trades_one_primary). User-level, never organization-level: a trade is a person''s practice, not a job title. Written ONLY through public.user_trades_set — there is no client insert/update/delete grant — so a browser cannot race itself into an invalid selection. NO RLS POLICY ANYWHERE MAY REFERENCE THIS TABLE (O5): trade is a discovery signal, never an authorization input.';

comment on column public.user_trades.is_primary is
  'The one trade this person leads with — what a future job''s required trade is matched against first, and what the profile shows as their category. Exactly one row is true whenever the person holds any trade at all, and none when they hold none; see public.user_trades_set for how that invariant is maintained.';

-- ---------------------------------------------------------------------------
-- 3. RLS — read is open, write does not exist
-- ---------------------------------------------------------------------------
alter table public.trades      enable row level security;
alter table public.user_trades enable row level security;

-- The vocabulary is public knowledge: there is nothing to isolate, and every
-- professional needs the same list to choose from. INACTIVE ROWS ARE WITHHELD
-- from ordinary callers so a retired trade cannot be re-selected simply because
-- a client still knows its key — the RPC refuses it too, but a list nobody can
-- see is a mistake nobody can make.
create policy trades_select_active on public.trades
  for select to authenticated
  using (is_active);

-- Support staff read the WHOLE vocabulary, retired rows included, because a
-- support conversation about "why does my old trade not show" is unanswerable
-- against a filtered list. Read only: no staff write path is invented here.
create policy trades_select_platform on public.trades
  for select to authenticated
  using (app.is_platform('support'));

create policy user_trades_select_self on public.user_trades
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_trades_select_platform on public.user_trades
  for select to authenticated
  using (app.is_platform('support'));

-- NO INSERT/UPDATE/DELETE POLICY, in any role. That is not an oversight and the
-- grants below match it: the only writer is `user_trades_set`, which is SECURITY
-- DEFINER and therefore bypasses RLS by design. A policy here would be dead
-- code that reads like a second, looser write path.
--
-- Another person's trades are reached through the public projection (§4.6), not
-- through this table — the same boundary `profiles` draws.
revoke all    on public.trades      from anon, authenticated, service_role;
revoke all    on public.user_trades from anon, authenticated, service_role;
grant  select on public.trades      to   authenticated, service_role;
grant  select on public.user_trades to   authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The seeded Pilot vocabulary
-- ---------------------------------------------------------------------------
-- SMALL ON PURPOSE. §4.6 says seed from `SPECIALIZATIONS.installer_technician`
-- "plus the trades the references imply". That is the five installer chips the
-- product already ships, plus the two the demo world already contains and the
-- five cannot express: Ahmed Sobhy fixes ceramic and porcelain, Sayed
-- Abdel-Rahman fixes marble and granite, and neither is `kitchens_doors`,
-- `plumbing`, `electrical`, `hvac` or `gypsum_paint`. Adding exactly those two
-- is what lets the seeded installers map deterministically instead of being
-- guessed at or left blank.
--
-- Nothing else. This is not an attempt to model Egyptian construction — no
-- categories, no sub-trades, no skill levels, no certifications. A trade earns a
-- row when a real Pilot persona works in it.
--
-- `on conflict (key) do nothing` so a re-run is a no-op: this statement is the
-- one part of the migration a future fixture or repair script might legitimately
-- replay.
insert into public.trades (key, sort_order) values
  ('kitchens_doors', 10),
  ('plumbing',       20),
  ('electrical',     30),
  ('hvac',           40),
  ('gypsum_paint',   50),
  ('tiling',         60),
  ('marble_granite', 70)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. public.user_trades_set — the single, atomic write path
-- ---------------------------------------------------------------------------
-- IT TAKES THE WHOLE SELECTION, NOT A DELTA (§3 of the increment brief). An
-- add/remove API is three round trips for one user gesture, and between any two
-- of them the row set is a state the person never asked for: zero primaries mid
-- swap, or two if the client ordered the calls badly. A caller here states the
-- set it wants and the primary it wants; one transaction makes that true or
-- nothing changes.
--
-- THE CLIENT CANNOT RACE ITSELF. Two submissions in flight converge on whichever
-- arrives last, because each one is a complete description rather than an
-- increment. `ux_user_trades_one_primary` is the backstop underneath that.
--
-- THE PRIMARY IS NOT OPTIONAL WHEN THE SET IS NON-EMPTY, and defining it that
-- way is what makes every listed case deterministic. `p_primary_key` null means
-- "you choose", and the choice is the FIRST key the caller submitted — an order
-- the caller controls and can therefore predict. So:
--
--   first trade selected      → it is primary
--   primary changed           → named key becomes primary, the old one stays selected
--   primary removed           → the first REMAINING submitted key becomes primary
--   non-primary removed       → the primary is untouched
--   duplicates submitted      → deduplicated; converges, never errors
--   empty/null set            → every row deleted, no primary, and that is legal
--   unknown key               → 22023, whole call refused
--   inactive key not held     → 22023, whole call refused
--   inactive key already held → accepted, so a retired trade can still be kept
--                               or dropped rather than trapping the profile
create or replace function public.user_trades_set(
  p_trade_keys  text[],
  p_primary_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_keys text[];
  v_primary_id uuid;
begin
  -- THE GATE IS THE IDENTITY, and it is Increment 2's predicate unchanged:
  -- canonical `users.primary_account_type`, or the declared
  -- `individual_onboarding.prof_concrete_type` for an identity whose upgrade is
  -- still under review. A consumer, a trainer/trainee, a business-only identity
  -- and an anonymous caller satisfy neither.
  --
  -- DELIBERATELY NARROWER THAN `individual_save_professional`, which also admits
  -- a caller mid-professional-onboarding on the strength of their selected
  -- TRACK. A track is "I intend to be a professional"; it carries no concrete
  -- type, so there is no answer yet to which trades are even applicable. This
  -- increment builds no onboarding step, so nothing needs that third door.
  --
  -- AND TRADE MEMBERSHIP IS NOT ITSELF EVIDENCE (O5, inverted): this reads
  -- `users` and `individual_onboarding`, never `user_trades`. Holding a trade
  -- can never be what proves you were allowed to hold it.
  if not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to declare trades'
      using errcode = '42501';
  end if;

  -- Normalise before anything reads the input: trim, drop blanks, deduplicate,
  -- and PRESERVE ORDER, because the order is what decides the default primary.
  select coalesce(array_agg(k order by ord), '{}'::text[])
    into v_keys
  from (
    select distinct on (btrim(k)) btrim(k) as k, ord
    from unnest(coalesce(p_trade_keys, '{}'::text[])) with ordinality as u(k, ord)
    where btrim(coalesce(k, '')) <> ''
    order by btrim(k), ord
  ) d;

  if cardinality(v_keys) > 0 then
    -- UNKNOWN KEYS ARE REFUSED WHOLESALE rather than silently skipped. Dropping
    -- one would leave the caller believing they had saved a trade they had not,
    -- and the profile would disagree with the form with nothing to explain it.
    if exists (
      select 1 from unnest(v_keys) as k
      where not exists (select 1 from public.trades t where t.key = k)
    ) then
      raise exception 'unknown trade' using errcode = '22023';
    end if;

    -- AN INACTIVE TRADE MAY BE KEPT BUT NEVER NEWLY ADDED. Refusing it outright
    -- would trap anyone holding a trade the platform later retired: their next
    -- save of any kind would fail, and the only way out would be a support
    -- ticket. Refusing only the NEW ones is the rule the brief actually asks
    -- for — "inactive trade cannot be newly selected" — and it leaves the
    -- retired row removable.
    if exists (
      select 1
      from unnest(v_keys) as k
      join public.trades t on t.key = k
      where not t.is_active
        and not exists (
          select 1 from public.user_trades ut
          where ut.user_id = v_uid and ut.trade_id = t.id
        )
    ) then
      raise exception 'trade is not available' using errcode = '22023';
    end if;

    -- The primary, resolved against the submitted set. Naming a primary that is
    -- not in the set is a contradiction, not a hint, so it is refused rather
    -- than reinterpreted.
    if p_primary_key is not null and btrim(p_primary_key) <> '' then
      if not (btrim(p_primary_key) = any (v_keys)) then
        raise exception 'the primary trade must be one of the selected trades'
          using errcode = '22023';
      end if;
      select t.id into v_primary_id from public.trades t where t.key = btrim(p_primary_key);
    else
      select t.id into v_primary_id from public.trades t where t.key = v_keys[1];
    end if;
  end if;

  -- CLEAR FIRST, and it is the partial unique index that requires it. The upsert
  -- below sets one row true and the rest false in a single statement, which is
  -- safe on its own — but a row that is ALREADY primary and is not in the new
  -- set is deleted by the next statement, and one that stays selected while
  -- losing primary is only corrected by the upsert. Clearing up front means no
  -- ordering of those three statements can transiently hold two true rows.
  update public.user_trades
     set is_primary = false
   where user_id = v_uid and is_primary;

  delete from public.user_trades
   where user_id = v_uid
     and trade_id not in (select t.id from public.trades t where t.key = any (v_keys));

  insert into public.user_trades as ut (user_id, trade_id, is_primary)
  select v_uid, t.id, t.id = v_primary_id
    from public.trades t
   where t.key = any (v_keys)
  on conflict (user_id, trade_id) do update
    set is_primary = excluded.is_primary;
end;
$$;

comment on function public.user_trades_set(text[], text) is
  'The ONLY writer for public.user_trades. Applies a caller''s COMPLETE trade selection atomically: the submitted set replaces whatever they held, and exactly one row is is_primary whenever the set is non-empty (the named key, or the first submitted key when none is named). Authority is the professional IDENTITY via app.is_professional_persona — canonical or declared, never a caller-supplied id and never the caller''s existing trades. Refuses unknown keys and newly-selected inactive trades with 22023; an inactive trade already held may be kept or removed. Duplicates converge rather than erroring. Grants nothing: trade membership is a discovery signal, not an authorization input (O5).';

revoke execute on function public.user_trades_set(text[], text) from public, anon;
grant  execute on function public.user_trades_set(text[], text) to   authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill — deterministic only, and therefore small
-- ---------------------------------------------------------------------------
-- §4.6 says backfill `user_trades` from `individual_onboarding.prof_specialization`.
-- That column holds TWO different kinds of value: a stable vocabulary key when
-- the onboarding chips wrote it, and free prose everywhere else — every account
-- in `supabase/staging/demo-enrichment.sql` carries a sentence like "Marble and
-- granite fixing".
--
-- Only the first kind is migrated, by EXACT key equality against the seeded
-- vocabulary. Nothing here parses, matches or infers from prose. Mapping
-- "Plumbing and sanitary fitting" onto `plumbing` looks obvious and is a guess;
-- the next sentence is "Plumbing and gypsum", and a guess that is right four
-- times and wrong once has published a false claim on somebody's public profile.
-- The demo world's prose is mapped EXPLICITLY, by user id, in
-- `supabase/seed-pilot.sql`, where a human wrote each pair down.
--
-- `on conflict do nothing` keeps this replayable, and the `not exists` guard
-- means it never overwrites a selection someone has already made.
insert into public.user_trades (user_id, trade_id, is_primary)
select io.user_id, t.id, true
  from public.individual_onboarding io
  join public.trades t on t.key = io.prof_specialization
 where io.prof_specialization is not null
   and t.is_active
   and app.is_professional_persona(io.user_id)
   and not exists (select 1 from public.user_trades ut where ut.user_id = io.user_id)
on conflict (user_id, trade_id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. §4.6 — the public projection
-- ---------------------------------------------------------------------------
-- A visitor to a public profile, and a poster browsing the technicians
-- directory, both need the professional's CATEGORY. Until now the projection
-- carried only `specialization`, which is the free-text column — so the public
-- page renders a sentence in one profile and a vocabulary key in the next.
--
-- Two columns are added, and they are KEYS rather than ids or labels:
--   * `trade_keys`       — every ACTIVE selected trade, primary first, then the
--                          vocabulary's own `sort_order`, so two profiles list
--                          the same two trades in the same order.
--   * `primary_trade_key`— the one they lead with, so a caller does not have to
--                          re-derive it from the array.
-- Keys, because the label is an i18n lookup on the client and a uuid would be an
-- internal identifier published for no reader's benefit.
--
-- INACTIVE TRADES DO NOT APPEAR. That is what retiring one means: the row stays
-- in `user_trades` (history is not rewritten) and stops being displayed
-- everywhere at once, rather than lingering in public on old profiles.
--
-- The listing predicate does NOT move, exactly as in `20260831090004`. Trades
-- filter nothing here: a professional with no declared trade is still listed and
-- still found. Filtering by trade is a QUERY the caller may write, never a
-- condition this view applies on their behalf (O5).
--
-- The RETURNS TABLE signature changes, so the dependent view and the function
-- are dropped and recreated; DROP destroys the ACL, so the full grant set is
-- reasserted below.
drop view public.profile_public_directory;
drop function app._profile_public_directory();

create function app._profile_public_directory()
returns table (
  id                      uuid,
  display_name            text,
  headline                text,
  bio                     text,
  avatar_media_id         uuid,
  locality_id             uuid,
  languages               text[],
  persona                 public.persona_type,
  specialization          text,
  services                text[],
  years_experience        smallint,
  service_areas           text[],
  available_for_work      boolean,
  availability_updated_at timestamptz,
  trade_keys              text[],
  primary_trade_key       text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages,
         u.primary_account_type,
         io.prof_specialization,
         io.prof_services,
         io.prof_years_experience,
         io.prof_service_areas,
         p.available_for_work,
         p.availability_updated_at,
         coalesce(tr.keys, '{}'::text[]),
         tr.primary_key
  from public.profiles p
  join public.users u on u.id = p.user_id
  -- LEFT: a listed professional with no onboarding row must not disappear.
  -- (`20260831090002` — the seeded Pilot professionals are exactly that case.)
  left join public.individual_onboarding io on io.user_id = p.user_id
  -- LEFT for the same reason, and it is the COMMON case: declaring trades is
  -- optional, and a profile without them is complete, listed and findable.
  left join lateral (
    select array_agg(t.key order by ut.is_primary desc, t.sort_order, t.key) as keys,
           max(t.key) filter (where ut.is_primary)                           as primary_key
      from public.user_trades ut
      join public.trades t on t.id = ut.trade_id
     where ut.user_id = p.user_id
       and t.is_active
  ) tr on true
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer'::public.persona_type;
$$;

comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted PERSONAL professional profiles: identity (name/headline/bio/languages), the persona that gates listing, the four self-declared practice columns LEFT JOINed from individual_onboarding, self-declared availability with the timestamp of its last change, and the caller''s ACTIVE canonical trades as keys (primary first, then sort_order) plus the primary key on its own. Never user_id, contacts, created_at/updated_at, deleted_at, travel radius, base address, prof_availability (the private lead-time preference), inactive trades, or any consumer_* column. A business-only identity (null persona) is never listed. Trades are projected for DISPLAY and never filter the listing (O5). Not in an exposed schema; PUBLIC execute revoked.';

revoke execute on function app._profile_public_directory() from public;
grant  execute on function app._profile_public_directory() to anon, authenticated, service_role;

create view public.profile_public_directory
  with (security_invoker = true) as
  select id, display_name, headline, bio, avatar_media_id, locality_id, languages,
         persona, specialization, services, years_experience, service_areas,
         available_for_work, availability_updated_at, trade_keys, primary_trade_key
  from app._profile_public_directory();

comment on view public.profile_public_directory is
  'Approved PUBLIC projection of professional profiles for discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._profile_public_directory(). Requires listed + active + not-deleted + a professional persona. Exposes the persona so callers can filter, the self-declared practice fields the public profile page renders, availability + when it last changed, and the canonical ACTIVE trades (keys only, primary first) that are now the structured specialty signal. Never user_id/contacts/timestamps/deleted_at/address, and never an inactive trade.';

revoke all on public.profile_public_directory from anon, authenticated, service_role;
grant select on public.profile_public_directory to anon, authenticated, service_role;
