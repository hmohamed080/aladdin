import { randomUUID } from "node:crypto";
import { psql } from "../global-setup";
import { E2E_PASSWORD } from "./auth";

/**
 * Direct LOCAL-DB fixtures for specs whose subject is NOT registration itself
 * (the legacy onboarding steps, the passwordless → password migration). The
 * canonical `/auth/sign-up` is password + Turnstile and applies the account
 * type and username at sign-up, so it can no longer produce these
 * intermediate states. Seeding them directly — the same way the product
 * seeds and pgTAP fixtures create identities — keeps those specs about their
 * own subject. LOCAL TEST DB ONLY (docker exec psql); never production.
 */

type FixtureOptions = {
  /** Stamp the known E2E password (default). `false` → a genuinely passwordless account. */
  password?: boolean;
  /** Record the three required consents the way `record_consent` does after sign-up (default true). */
  consented?: boolean;
  locale?: "en" | "ar";
};

/** A confirmed account with NO account type and NO username yet. Returns its user id. */
export function createConfirmedAccount(
  email: string,
  { password = true, consented = true, locale = "en" }: FixtureOptions = {},
): string {
  const id = randomUUID();
  const passwordSql = password ? `extensions.crypt('${E2E_PASSWORD}', extensions.gen_salt('bf'))` : "null";
  psql(`
begin;
-- GoTrue scans its token columns as non-null strings: they must be '' (as
-- GoTrue itself writes them), never NULL, or every login for the row fails.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, reauthentication_token, phone_change, phone_change_token)
values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}',
        ${passwordSql}, '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"E2E Fixture","locale":"${locale}"}'::jsonb, now(), now(), now(),
        '', '', '', '', '', '', '', '');
${
  consented
    ? `set local role authenticated;
set local request.jwt.claims = '{"sub":"${id}","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], '${locale}');`
    : ""
}
commit;
`);
  return id;
}
