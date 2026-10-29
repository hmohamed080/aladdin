# R1 migration, activation and rollback plan

**Scope:** `supabase/migrations/20261030090002_phone_signup_authority.sql` (on top of B1's `20261030090001`) and the server code in `frontend/src/server/phone-verification/`.
**Nothing here is authorised.** No hosted database has been changed, no hosted setting read, no message sent. Every step below needs the owner's explicit go; each one names its own evidence gate and its own rollback.

## 0. The shape of the change

| Switch (all in `app.phone_verification_config`, no API role can read or write it) | Ships | Meaning |
|---|---|---|
| `enabled` | `false` | B1 master switch; also gates every signup function |
| `signup_enabled` | `false` | the `phone_signup_*` entry points answer `unavailable` |
| `alias_guard_mode` | `'off'` | the guard is installed but returns at once |

* DB invariant `ck_config_signup_needs_guard`: `signup_enabled` cannot be true while `alias_guard_mode = 'off'`. A grant is consumed only by the guard and `attach` requires that consumption, so a signup proof without a guard would be both useless and unprotected. The order *guard first, signup second* cannot be got wrong.
* Every change to a switch is written to `app.phone_verification_config_log` (who, when, from, to; no phone numbers).
* Application flags are separate and also default OFF: `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED` (needs the first), `PHONE_OTP_DELIVERY` (`off` unless exactly `outbox`/`worker`; `outbox` is refused in production; `worker` is **not wired** in R1).
* With the shipped defaults **no behaviour changes anywhere**: proven by the `shipped` posture of the suite (SEC-C5: the old no-grant Admin creation, which today's Installer/Showroom sign-up pages use, still works; SEC-S1: the signup functions answer `unavailable` and write nothing).

## 1. Stages, gates and rollback

Each stage can stop. Nothing needs to be rushed because the vulnerability's real-world severity depends on hosted settings that the read-only inspection (`scripts/hosted-db/inspect-auth-security.mjs`, **not yet run**: it needs the authorisation listed in §4) will establish.

| # | Stage | Action | Evidence gate before the next stage | Rollback |
|---|---|---|---|---|
| 0 | Review | Merge the code only (no hosted migration) | CI green on the merged tree, permission contract regenerated | revert the PR |
| 1 | **Inspect** (read-only) | Run the inspection against Acceptance, then Production | report archived; answers e-mail confirmation, CAPTCHA, phone provider, Send-SMS hook, Phone MFA, WhatsApp secret *presence*, the 13 functions' rights, alias census | none needed (reads only) |
| 2 | Apply the dormant migrations (Acceptance first) | `20261030090001` + `20261030090002`, owner-approved window | `select enabled, signup_enabled, alias_guard_mode` = `f,f,off`; trigger `phone_alias_guard` present; permission gate green; the existing sign-up paths still work (smoke: one Installer phone sign-up, one e-mail sign-up) | `down` script §3 (drops only R1 objects; B1 objects are separate) |
| 3 | Deploy the application (flags OFF) | the registration code that mints/uses grants, `PHONE_*` all OFF | no behaviour change in logs | redeploy previous build |
| 4 | **Observe** | `update app.phone_verification_config set alias_guard_mode = 'observe'` | see §2: for the agreed window every observation is attributable to a known, scheduled-for-retirement path; no unexplained alias-domain creation | `... set alias_guard_mode = 'off'` (instant, no deploy) |
| 5 | Provision | HMAC keyring in the secret store; purge scheduled; **edge rate limiting and Turnstile on the start/verify actions**; delivery adapter approved by the owner (Worker + Meta, separate approval) | owner sign-off; a rehearsal on Acceptance with the Worker in its allow-list mode | n/a |
| 6 | Enable signup verification | `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, then `update ... set enabled = true, signup_enabled = true` | a complete sign-up on Acceptance for an allow-listed number: `phone_verified_at` set for the exact number, guard observed the grant consumption | flags off + `signup_enabled = false` (instant) |
| 7 | **Enforce** | `update app.phone_verification_config set alias_guard_mode = 'enforce'` | stage 4 window clean **after** the retirement of every no-grant creation path; GoTrue sign-up error rate watched for 30 min | `... set alias_guard_mode = 'observe'` (instant) |

**Why enforce cannot come first.** Until the application mints grants, *every* alias creation is a "no-grant" creation, including the legitimate Installer/Showroom phone sign-up that `main` still ships (`createCraftsmanPasswordUser` / `createShowroomPasswordUser`, `email_confirm: true`, no OTP). `enforce` would refuse them (SEC-C5, enforce posture). PR #113 retires those pages, so enforce is tied to #113 + the integration in §5 being what is deployed. This also means **the vulnerability stays open on hosted until stage 7** (or until the owner decides to mitigate sooner: see §6).

## 2. What "observe" tells you, and the queries

`observe` records, per alias-domain Auth user that `enforce` would refuse, `(observed_at, user_id, had_grant)`. No alias, no number, no IP. Attribute them through the Auth row:

```sql
select coalesce(u.raw_app_meta_data ->> 'registration_source', '(none: public sign-up)') as source,
       count(*) as n, min(o.observed_at) as first, max(o.observed_at) as last
  from app.phone_alias_guard_observations o left join auth.users u on u.id = o.user_id
 where o.observed_at > now() - interval '7 days' and not o.had_grant
 group by 1 order by n desc;
```
* `temporary_craftsman_password_flow` / `temporary_showroom_password_flow` = the old Installer/Showroom pages (expected until #113's redirects are live everywhere).
* `(none: public sign-up)` = an anonymous GoTrue sign-up on an alias, i.e. the attack (or a bug). These are the cases enforce removes.
* `phone_whatsapp_sign_up` with `had_grant = false` = the new flow forgot the grant: **a blocker for stage 7**.

Gate for stage 7: the only sources left are `(none: public sign-up)` and retired ones with a zero trend.

## 3. Rollback

* **Behavioural rollback (all stages after 2): one UPDATE, no deploy, effective on the next statement.**
  `update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off';` (a single statement satisfies the invariant). An Auth transaction that is already running keeps the mode it read when its deferred trigger fires at COMMIT, which is milliseconds away: no half-applied state exists.
* **Admin cleanup is never blocked:** the guard is an INSERT trigger, so `deleteUser`, rollback of a half-created registration and support deletions behave exactly as before in every mode (SEC-C3).
* **Structural rollback of stage 2** (only if the migration itself must be removed; written as a script for review, not a migration):
  ```sql
  drop trigger if exists phone_alias_guard on auth.users;
  drop function if exists public.phone_signup_start(uuid, text, uuid, text, text, text), public.phone_signup_verify(uuid, uuid, jsonb, text),
                          public.phone_signup_attach(uuid, uuid), public.phone_signup_invalidate(uuid, uuid, text);
  drop function if exists app.phone_alias_guard(), app.phone_signup_registration_lock(uuid), app.phone_verification_config_audit();
  drop table if exists app.phone_signup_grants, app.phone_alias_guard_observations, app.phone_verification_config_log;
  delete from app.phone_verification_challenges where purpose = 'signup_proof';
  -- then restore B1's constraints/columns exactly as in 20261030090001 (user_id NOT NULL, purpose = 'primary_proof', the invalidated_why list)
  -- and drop columns signup_enabled, alias_guard_mode, grant_ttl, grant_attach_window, signup_phone_hourly from app.phone_verification_config
  ```
  Dropping the trigger first guarantees no account creation can be refused while the rest is removed. `phone_verification_purge` is `CREATE OR REPLACE`d by R1; restoring B1's body is part of the script.
* **A consumed-but-failed registration** (the server created the Auth user, then initialisation failed and it rolled the user back) needs a **fresh proof**: grants are single-use by design, so a rolled-back registration cannot be replayed from a leaked grant (SEC-C4). The user simply requests another code.

## 4. Safety properties that make the activation low-risk (all executable)

| Property | Evidence |
|---|---|
| Dormant by default; the migration changes no behaviour | `shipped` posture, both GoTrue modes; pgTAP 120 A5, B1–B5, F16–F17 |
| Guard only sees alias-domain e-mails (trigger `WHEN`), so e-mail, Google and Facebook sign-ups never reach it | pgTAP A7, F12–F13; suite SEC-X1…X5 (Facebook with no e-mail, Google, e-mail+password, Email OTP, recovery) |
| A public sign-up body cannot forge the marker | SEC-A7, A7b |
| Admin-API creation + rollback + cleanup keep working | SEC-C1…C4b, D5a |
| Grant is single-use, alias-bound, registration-bound, expiring, non-anonymous | pgTAP F2–F11; SEC-D2–D5 |
| Concurrency | SEC-D5a/b/c (3 parallel creations / attaches / verifications each admit exactly one) |
| Legacy Installer/Showroom/e-mail accounts byte-identical | SEC-E1–E4 in every cell |
| Works on both toolchains (GoTrue v2.197.0 / v2.193.0) | the two matrices in the report |

## 5. Required authorisations for stage 1 (the hosted inspection)

The script is ready and self-tested against a mocked API (12 tests); it was **not run** because this environment holds no hosted credential. It needs:

* `SUPABASE_ACCESS_TOKEN` — a Supabase personal access token with read access to the Acceptance and Production projects, plus `SUPABASE_REF_ACCEPTANCE` / `SUPABASE_REF_PRODUCTION` (project references are not stored in the repository);
* optionally, for "are the WhatsApp secrets configured (presence only)": `CLOUDFLARE_API_TOKEN` (Workers Scripts: Read), `CF_ACCOUNT_ID`, `CF_WORKER_ACCEPTANCE`, `CF_WORKER_PRODUCTION`.

It issues only `GET …/config/auth`, `POST …/database/query/read-only` (SELECT/WITH, single statement, checked in code) and `GET …/secrets` (names only); it refuses every other call before it leaves the process and prints no token or secret. The repository's own documents state that hosted CAPTCHA protection has been on for Acceptance and Production since 2026-10-28: that is a claim in a document, not a measurement, and is exactly what stage 1 verifies. The hosted GoTrue version (needed to confirm the guard on the same version) is shown in the Supabase dashboard (Auth → Settings) or by `GET <project-url>/auth/v1/health`.

## 6. Interim mitigations that need no code (owner decision)

Until stage 7, the exposure of V1 is limited by hosted configuration, which must be **measured, not assumed** (stage 1): e-mail confirmation ON stops a possession-less *session* (an unconfirmed alias row can still squat the number); hosted CAPTCHA protection raises the cost of scripted use of `/auth/v1/signup`; neither removes the squat. If stage 1 shows confirmations OFF or CAPTCHA OFF on a project that is publicly reachable, the owner may want to bring stage 4/7 forward for that project once #113's retirement of the no-grant pages is deployed there.
