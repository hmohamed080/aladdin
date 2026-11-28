# Phone identity — Phase A2: local verification report

**Date:** 2026-10-29 · **Scope:** isolated local Supabase only (Postgres + GoTrue + PostgREST via the Supabase CLI) · **Stacked on:** PR #119 (legacy mocked tests), which implements the acceptance gates of PR #117 (Phase A architecture).
**Changes in this PR:** tests, a prototype that is **not a migration**, and documentation. No product code, migration, hosted setting or deployment is touched. PR #113 / #116 branches were not modified, merged, rebased or run against.

## 1. Result at a glance

| Suite | Result |
| --- | --- |
| A2 identity suite (real GoTrue + PostgREST + Postgres, fake OTP) | **61 PASS · 0 FAIL** · 10 GAP · 10 EVAL (81 rows) |
| Existing pgTAP regression — 12 files covering identity, reservations, alias guard, phone-change journal, reauth, registration sync | **606 tests PASS** |
| Existing real-session concurrency script (phone-change journal) | **PASS** |
| Same three, with PR #113 + #116 migrations overlaid (196 migrations; + their pgTAP files 116/117/118) | **A2 identical (61/0/10/10); pgTAP 689 tests PASS** |
| Frontend Vitest (PR #119 legacy projection + phone sign-up actions + auth + queries) | **647 passed · 13 skipped (pre-existing) · 0 failed** |

Vocabulary: **PASS/FAIL** = behaviour that exists today. **GAP** = a required scenario that is *not implemented*; it is recorded as a gap and never counted as passing. **EVAL** = an observation about a *candidate* design (the verdict is in §5), not a pass/fail of shipped behaviour.

Machine-readable evidence: `docs/security/phone-identity-a2/evidence.json` (redacted — see §9) · `…/evidence-with-pending-registration.json` · `…/regression-summary.txt` · `…/compat-pending-registration-summary.txt`.

## 2. What was built

| File | Purpose |
| --- | --- |
| `supabase/tests/a2/phone_identity_a2_local.test.mjs` | The suite. Zero dependencies (Node `fetch` + `docker exec psql`). |
| `supabase/tests/a2/lib.mjs` | Local-only guards, HTTP/DB helpers, PASS/FAIL/GAP/EVAL recorder with redaction. |
| `supabase/tests/a2/proposal/phone_verification_authority.proto.sql.txt` | Candidate verification authority, loaded into a **scratch schema** (`a2_proto`) and dropped at the end of each run. |
| `supabase/tests/a2/run_a2.sh` | Guard → reset the isolated stack → suite → existing pgTAP → existing concurrency script. |

Fixtures are created through **the real signup path** (Admin API `createUser` → password sign-in → `record_consent` → `onboarding_select_account_type` → `profile_set_phone` → `profile_set_username` → `business_draft_save_v2/submit_v2`), never by hand-writing identity rows:

| Fixture | Class |
| --- | --- |
| `LegacyInstaller` | phone/password alias account (`p<digits>@craftsman-login.aladdin.invalid`), unverified primary phone |
| `LegacyShowroom` | alias account + organization + owner membership/capabilities + org contact number |
| `EmailSignup` | email account with a profile phone |
| `OrgContactOnly` | email account that owns an org whose `contact_phone` is the *only* place the number exists |

## 3. Identity invariance report

Snapshot (before → after **every** flow in the suite: reservations, renewals, expiry, cancellation, concurrent claims, prototype challenge/verify on three of the four fixtures, repeated sign-ins). Compared fields: `auth.users` (id, email/alias, phone, confirmations, role, aud, anonymity, ban, **password digest**, registration source, providers), `auth.identities` (provider + id), `auth.mfa_factors`, `public.users`, `profiles` (username, phone, country, national, `phone_verified_at`, display name), memberships + status + org type + org contact phone + **capability keys**, platform role grants, admin role assignments, and `my_registration_state`.

| Fixture | Auth user id | Alias / email | Auth phone | Identities | MFA | Primary phone | `phone_verified_at` | Membership capabilities | Registration state | Drift |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LegacyInstaller | same | alias unchanged | NULL | 1 | 0 | unchanged | NULL | — | access_ready | **none** |
| LegacyShowroom | same | alias unchanged | NULL | 1 | 0 | unchanged | NULL | 31 keys unchanged | active_personal | **none** |
| EmailSignup | same | email unchanged | NULL | 1 | 0 | unchanged | NULL | — | access_ready | **none** |
| OrgContactOnly | same | email unchanged | NULL | 1 | 0 | none (org-only number) | NULL | 31 keys unchanged | active_personal | **none** |

* `A2-INV-1`: the before/after snapshots are **byte-identical**. `A2-INV-5`: all four still sign in with the same password and get the same user id.
* `A2-INV-3`: the global `auth.users` count grew only by accounts the run deliberately created (76 → 104, expected 104; the baseline depends on audited fixtures retained from earlier runs, the assertion is relative) — no hidden duplicate from any reservation or authority flow. `A2-INV-2`: the only users with `auth.users.phone` are the GoTrue-native probes (§5).
* No flow wrote `profiles.phone_verified_at`. The prototype ran against three legacy fixtures and wrote **only** to its own scratch schema.

## 4. Test coverage against the A2 mission

| # | Requirement | Where | Result |
| --- | --- | --- | --- |
| 3 | Legacy Installer / Showroom / email-signup / org-only fixtures | `A2-FX-1`, `A2-LEG-1…7` | PASS |
| 4 | Snapshot & compare IDs, roles, memberships, permissions, aliases, account data | `A2-SNAP-1`, `A2-INV-1…5` | PASS |
| 5 | Existing primary verification state + legacy access | `A2-LEG-*`, `A2-FORGE-1…4` (client cannot write or forge `phone_verified_at`; neither `authenticated` nor `anon` nor `service_role` holds UPDATE on the column) | PASS |
| 6 | Primary/secondary uniqueness, 7+7 expiry, renewal, 30-day cooldown, password reauth, concurrent claims | `A2-RES-1…12`, `A2-CON-1…3` (8 accounts race one number; primary-vs-secondary 4v4 race; one account racing 4 numbers) | PASS |
| 7 | Candidate authority: wrong account, wrong number, expiry, replay, concurrent verification | `A2-AUTH-0…14`, `A2-CON-4…6` (against the prototype, §6) | PASS |
| 8 | No duplicate Auth users / identity change / login-recovery-MFA grant | `A2-INV-2…4`, `A2-AUTH-5`, `A2-AUTH-12` for the prototype; **native GoTrue fails this** (§5) | PASS / EVAL |
| 9 | Unimplemented new-signup scenarios recorded as gaps | `A2-GAP-1…10` (§7) | GAP |
| 10 | Existing regression + pending-registration compatibility | §1, §8 | PASS |

Notable findings inside the reservation results: reservation rules held under concurrency (`A2-CON-1`: 8 racers → exactly 1 winner; `A2-CON-2`: exactly one claim of any kind survives a primary-vs-secondary race); a cooldown blocks *secondary* reservation only, never a primary claim (preserved); 7 + one 7-day renewal exactly, never extended by anything.

## 5. Candidate evaluation: who is the verification authority?

### C1 — GoTrue native phone OTP (`signInWithOtp({phone})`, `updateUser({phone})`) — **rejected**

Observed on isolated probe accounts (never on the legacy fixtures), with a fake provider and a fixed `test_otp` map (`A2-NAT-1…5`):

1. `signInWithOtp({phone})` for a number that is a legacy account's profile phone **creates a parallel Auth user** (new `user.id`; the legacy user's `auth.users.phone` stays NULL). This is exactly the duplicate-identity hazard Phase A warned about.
2. `updateUser({phone})` + `phone_change` verification on an alias account **does** preserve `user.id` and the email alias — but it does **not** touch `profiles.phone_verified_at` (the app's source of truth), and
3. the verified number then **silently becomes a login credential** for that user (OTP sign-in returned a session for the same user id). Possession proof granted a login permission with no explicit step.
4. GoTrue's phone uniqueness is **independent of the reservation rules**: a second account verified a number that another account held as an *active* secondary reservation.

Conclusion: native phone flows cannot be the proof authority without breaking identity invariance and the "possession ≠ permission" rule. Keep the hosted phone provider **off**.

### C2 — Database-native challenge authority — **recommended (prototype passes)**

`phone_verification_authority.proto.sql.txt` binds a challenge to *account + E.164 + purpose + claim* (the primary value, or a specific reservation id), stores only a salted hash, re-validates against the **live** claim at verification, returns one generic `invalid` for every failure, and consumes with a single atomic `UPDATE … WHERE consumed_at IS NULL`.

| Scenario | Result |
| --- | --- |
| Wrong account presents the right code + challenge id | `invalid`; owner's attempt counter **not** burned (`A2-AUTH-2`) |
| Start for another account's number / an unclaimed number | refused (`A2-AUTH-1`) |
| Wrong code → counted; 5 wrong → challenge dead, correct code refused | PASS (`A2-AUTH-3/7`) |
| Replay of a correct code | `invalid`, one evidence row (`A2-AUTH-4`) |
| Expiry | refused (`A2-AUTH-6`) |
| Resend < 60 s; new start supersedes the old challenge | rate-limited; old code dies (`A2-AUTH-8/9`) |
| Primary edited while a challenge is in flight | old-number code refused, `claim_changed` (`A2-AUTH-10`) |
| Secondary: proof capped by, and never extends, the reservation | PASS (`A2-AUTH-11`) |
| Secondary: cancelled / expired reservation cannot be proven or resurrected | PASS (`A2-AUTH-13/14`) |
| Proof grants no login / recovery / MFA / primary / contact opt-in | PASS (`A2-AUTH-5/12`) |
| 8 simultaneous verifications of one code | exactly 1 `verified` (`A2-CON-4`) |
| 6 simultaneous starts | exactly 1 challenge (`A2-CON-5`) |
| Edit racing verification | atomic: evidence iff `verified`, for the bound number (`A2-CON-6`) |
| Functions executable by `service_role` only | PASS (`A2-AUTH-0`) |

### C3 — Cloudflare Worker D1 as the authority — **not recommended**

Not evaluated locally by design: Phase A §3 already requires that the transport store not be the proof authority, and it cannot transactionally bind to `profiles` / `secondary_phone_reservations` or take the shared advisory lock. The Worker stays a **transport adapter**.

> **Consequence for the Send SMS Hook plan (#114):** the hook only fires for GoTrue-native phone flows, which C1 rejects. With C2 the server calls the Worker directly after `start()`. The hook's `user.phone` / `new_phone` payload question therefore becomes moot for identity verification and can stay unresolved without blocking Phase B.

## 6. Proposed verification authority and minimal schema changes (**not applied**)

Nothing below exists in `supabase/migrations`. It is a proposal for Phase B/C review.

1. **`public.phone_verification_challenges`** — the prototype's `a2_proto.challenge`, in a private schema (RLS on, no client policy, service-only). Columns: `id, user_id, purpose ('signup_primary'|'primary_proof'|'secondary_proof'), phone_e164, reservation_id, salt, code_hash, created_at, expires_at, attempts, max_attempts, consumed_at, invalidated_at, invalidated_why`; one open challenge per `(user_id, purpose)` (partial unique index).
2. **`app.phone_verification_start(...)` / `app.phone_verification_verify(...)`** — the prototype functions, `SECURITY DEFINER`, `search_path = ''`, `service_role` only, taking the number lock (`app.lock_phone`) exactly as every other claim does.
3. **Completion write** — one definer function that, in the same transaction as the consuming `UPDATE`, sets `profiles.phone_verified_at` for the exact current primary (for `primary_proof`/`signup_primary`). It must be owned by the table owner: `service_role` holds **no** UPDATE on the column (`A2-FORGE-4`), which is the right default. **A2 deliberately did not execute this write against any fixture** (it would simulate a successful verification on an existing identity); Phase B must test it.
4. **Secondary** (Phase C): either `verified_at` / `verified_channel` on `secondary_phone_reservations` (proof valid only while active), or a separate `verified_contact_phones` table for a *durable* verified contact-only claim. The second needs owner decisions on uniqueness and what happens to the number at release. Neither may extend the reservation or change `converted`.
5. **New-signup gate** (Phase B): a flag such as `profiles.phone_proof_required boolean not null default false`, set only by the new signup path, so existing accounts are grandfathered; `my_registration_state` returns a new `phone_pending` state while `phone_proof_required AND phone_verified_at IS NULL`. Must be enforced in the DB, not only in the form (`A2-GAP-2/3`).

**Hardening to add before Phase B (found while testing the prototype):**
* A bare salted SHA-256 of a 6-digit code is brute-forceable offline if the table leaks. Online guessing is bounded (5 attempts, 5-minute life) but use an **HMAC with a pepper that is not stored in the database** (e.g., a server secret) so a database read alone is insufficient.
* `start()` returns the raw code to its trusted caller; that caller must never log it.
* Resend limits are per account+number; add a per-IP/destination budget at the server edge (cost control, not identity).

## 7. Gap register — required scenarios that are **not** implemented

Recorded as `GAP` in the evidence; none is claimed as passing.

| ID | Missing capability |
| --- | --- |
| A2-GAP-1 | Server-side writer of `profiles.phone_verified_at` after possession proof (only journal-restore assigns the column) |
| A2-GAP-2 | New phone sign-up is blocked from app access until proof — **today a brand-new alias signup is `access_ready` immediately** |
| A2-GAP-3 | Unverified pending identity cannot use protected features (server + DB enforcement) |
| A2-GAP-4 | Mistyped signup number: edit invalidates stale challenge, no orphan/duplicate account (primitive proven; no wiring) |
| A2-GAP-5 | Abandoned/expired pending signup is cleaned up without orphan Auth users |
| A2-GAP-6 | Durable verified secondary contact without extending/resurrecting a reservation |
| A2-GAP-7 | Verify-before-switch for primary phone replacement |
| A2-GAP-8 | Challenge store, resend/attempt limits and anti-replay in the application database |
| A2-GAP-9 | Turnstile / direct-API bypass tests for a verification endpoint (no endpoint yet) |
| A2-GAP-10 | TOTP enrollment + AAL2 step-up (Phase D); no MFA factor was created by any flow here |

## 8. Compatibility with the pending registration architecture (#113 / #116)

* **No file overlap.** A2 adds only new files under `supabase/tests/a2/` and `docs/security/`. It does not touch `AGENT_WORK_LOG.md`, `supabase-rls.yml`, `phone-password.ts`, `admin-server.ts` or any file those PRs change.
* **Runtime check without touching those branches:** their three extra migrations (`20261028090001`, `…090003`, `20261029090001`) and pgTAP files 116/117/118 were copied as untracked temp files onto the isolated stack (196 migrations from scratch), the whole run repeated, and the files removed. Result: A2 suite unchanged (61/0/10/10); 15 pgTAP files / 689 tests pass.
* **Not covered:** #113/#116 frontend flows (continue-registration, username lease UI, phone sign-up form). A2 has no UI scope, and Phase B's signup wiring should be built on top of their *merged* result.
* **Observation:** #113 changes `frontend/src/server/auth/phone-sign-up.ts` and adds `20261028090001_sign_up_birthday_and_phone_codes.sql`; Phase B should build on that merged path rather than add another. (A2 did not review those changes beyond running their migrations and pgTAP.)

## 9. Security findings

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | **High (design)** | GoTrue native phone flows would create parallel users, turn a verified number into a login credential, bypass the reservation rules, and never update `phone_verified_at`. Phone provider must stay disabled in hosted projects; never use `signInWithOtp({phone})` / `updateUser({phone})` as the verification step. | `A2-NAT-1…5` |
| S2 | **Medium (product gap)** | New phone sign-ups reach app access with no possession proof. Required gate is not implemented. | `A2-GAP-2/3`, `A2-LEG-5` |
| S3 | Low (privacy, pre-existing) | A phone-login account's E.164 digits are embedded in its internal alias, and GoTrue prints the account email in `user_signedup` / `login` audit events, so those numbers are in GoTrue logs (5/5 alias numbers found). Numbers that are **not** aliases (secondary reservations, org contacts, email-account phones, prototype flows) are absent from GoTrue/PostgREST/gateway logs (0/54). Matters for any log drain / retention decision; Phase B must not add new leak paths. | `A2-LOG-1`, `A2-LOG-3` |
| S4 | Low | A *failed* renew/reserve rolls back the lazy "finalize to expired" write, so an expired row can remain `status='active'` past `expires_at` until a non-failing touch. Behaviour is still correct (expiry is derived; all checks use `expires_at`), but anything that later reads `status` alone would be wrong. | `A2-OBS-1`, `A2-RES-9` |
| S5 | Info (positive) | Clients cannot forge verification: direct PostgREST PATCH, forged `user_metadata`, and re-submitting the same number all leave `phone_verified_at` NULL; `authenticated`, `anon` and `service_role` hold no UPDATE on it. | `A2-FORGE-1…4` |
| S6 | Info (test hygiene) | `public.audit_log` is append-only, so fixtures that create orgs cannot be deleted. `run_a2.sh` therefore resets the **isolated** stack each run. | harness notes |

Evidence redaction: phone numbers masked to the last two digits, aliases masked, user ids shortened to 8 characters, **no** tokens, passwords, password hashes or raw OTPs recorded. The fake OTPs are constants for a local-only `test_otp` map (see Reproduce) and appear in the test source as such; they are never written to evidence, and the harness never prints a prototype-generated code.

## 10. Unresolved dependencies

1. **#113 / #116** must stabilise and merge before Phase B changes any signup action, the register/continue flow, username leases or the access gate. A2 deliberately did not.
2. **#117 / #119** are still Draft/open; #119's mocked tests and A2 are complementary (read-contract vs real database).
3. **Owner decisions:** adopt C2 as the authority; where the HMAC pepper lives; secondary-verified representation (column vs durable table); the `phone_pending` state name and grandfathering rule; whether verify-before-switch is required for primary replacement.
4. **Hosted state not verified here** (restricted by A2 scope): that the hosted phone provider and Send SMS Hook are actually off, and Phone MFA is off. A read-only check needs separate approval.
5. **Live items from #117** unchanged and untouched: Meta send limits/alerts, one allow-listed owner number, retention and consent language, first paid Acceptance message approval.
6. **Not proven by A2** (by design): the completion write to `profiles.phone_verified_at`, the real WhatsApp transport, UI behaviour, Turnstile/rate-limit behaviour on a real endpoint, hosted-vs-local GoTrue differences.

## 11. Recommendation — is Phase B ready to begin?

**Conditional GO, split in two:**

* **B1 — authority + primary proof for existing accounts: GO** once an owner approves C2. It is additive (new private tables/functions, fake transport), touches none of #113/#116's files, and grandfathers existing accounts. Start by turning the prototype into a reviewed migration with the hardening in §6 and adding the completion-write tests A2 intentionally skipped.
* **B2 — new-signup possession gate: HOLD** until #113 and #116 are merged and stable. Do not begin signup integration against the moving base; build on the merged `phone-sign-up.ts` path.
* **E (live Meta activation) is unaffected and still requires its own explicit approval.** Keep the Send SMS Hook off and the phone provider off; C2 does not need either.

## Reproduce

```bash
# 1. Isolated local stack: copy supabase/config.toml, then (UNCOMMITTED, local only) set a unique project_id and ports,
#    [auth.sms] enable_signup=true + enable_confirmations=true, [auth.sms.test_otp] 201009990001="000111", 201009990002="000222", 201009990003="000333" (the fake values the suite uses),
#    [auth.sms.twilio] enabled=true with all-zero SIDs and SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=<any fake>.
#    The Send SMS Hook and Phone MFA stay off; the fake provider cannot send.
supabase start -x studio,imgproxy,vector,logflare,edge-runtime
# 2. Run (resets that stack's DB first)
DB_CONTAINER=supabase_db_<your_project_id> bash supabase/tests/a2/run_a2.sh
```

`run_a2.sh` refuses a container that is not this worktree's stack, the shared default stack, or anything staging/prod-like.
