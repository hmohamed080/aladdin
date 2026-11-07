-- ===========================================================================
-- Instagram-style sign-up: birthday + WhatsApp verification codes.
--
-- 1. public.users.birth_date — the registrant's birthday. Private account
--    data: it lives on the self-only `users` row (RLS users_select_self), never
--    on `profiles` and never in profile_public_directory. Written only by the
--    server right after the account proves its email or mobile number; the
--    18+ rule is enforced there (parseBirthDate) and the column only bounds
--    the value to a sane range. Authenticated callers get no UPDATE grant.
--
-- 2. public.phone_verification_challenges — one row per WhatsApp code sent for
--    a mobile-number sign-up. Holds only an HMAC of the code (never the code),
--    a bounded attempt counter and an expiry. service_role only: RLS on, no
--    policies, no grants to anon/authenticated. Nothing here is an identity;
--    the account is created only after a code is verified.
-- ===========================================================================

alter table public.users
  add column birth_date date,
  add constraint ck_users_birth_date_range check (birth_date is null or birth_date >= date '1900-01-01');

comment on column public.users.birth_date is
  'Birthday collected at sign-up. Private (self-only users row, never public). Server-written after verification; 18+ enforced by the application.';

-- The server writes it with the service role, whose write grants on users are
-- column-scoped (20260804090001); add this one column only.
grant update (birth_date) on public.users to service_role;

create table public.phone_verification_challenges (
  id           uuid primary key default extensions.gen_random_uuid(),
  purpose      text        not null,
  phone_e164   text        not null,
  code_hash    text        not null,
  attempts     smallint    not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint ck_phone_verification_challenges_purpose check (purpose in ('sign_up')),
  constraint ck_phone_verification_challenges_phone check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint ck_phone_verification_challenges_hash check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_phone_verification_challenges_attempts check (attempts between 0 and 10),
  constraint ck_phone_verification_challenges_expiry check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);

comment on table public.phone_verification_challenges is
  'WhatsApp verification codes for mobile-number sign-up. HMAC of the code only, bounded attempts, short expiry. service_role only.';

-- Send-rate checks read the recent challenges for one number.
create index ix_phone_verification_challenges_phone_created
  on public.phone_verification_challenges (phone_e164, created_at desc);

alter table public.phone_verification_challenges enable row level security;

revoke all on public.phone_verification_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.phone_verification_challenges to service_role;
