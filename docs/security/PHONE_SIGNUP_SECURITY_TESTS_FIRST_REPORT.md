# Phone sign-up security remediation — tests-first report

**Branch:** `test/phone-signup-security-20261029`, stacked on #121 (B1) → #120 → #119. **No registration, migration or application code is changed.** Only a local test suite, its runner, and documents are added.
**Environment:** local isolated Supabase CLI stack only (`aladdin_sec`, loopback). GoTrue `v2.197.0`, Supabase CLI `2.122.0`. No hosted resource was read or changed, no WhatsApp/Meta/SMS call was made (the GoTrue phone provider and Send-SMS hook are off; e-mail goes to the local Inbucket), phone numbers are synthetic and masked in evidence, no OTP exists anywhere in these tests.

## 1. Result of the suite

`bash supabase/tests/sec/run_sec.sh` replays the suite against three **real local GoTrue configurations** (the runner rewrites the uncommitted local config and restarts the isolated stack).

| GoTrue mode | PASS | FAIL | XFAIL | XPASS | EVAL | N/A | Exit |
|---|---|---|---|---|---|---|---|
| `confirm-on` (e-mail confirmations ON, repo default) | 30 | **0** | 9 | 0 | 9 | 4 | 0 |
| `confirm-off` (confirmations OFF, what a hosted project may be running) | 29 | **0** | 12 | 0 | 10 | 2 | 0 |
| `hook` (confirmations ON + `before_user_created` probe hook) | 33 | **0** | 9 | 0 | 11 | 2 | 0 |

* **XFAIL** = the desired behaviour is *not* met today: a confirmed vulnerability or an unimplemented requirement. It is recorded with evidence and is never counted as a pass. When remediation lands the row flips to **XPASS** and the suite exits non-zero until it is promoted to a plain check, so a fix cannot go unnoticed and cannot silently regress.
* Evidence (masked): `docs/security/phone-signup-security/evidence-{confirm-on,confirm-off,hook}.json`, `run-summary.txt`. Raw logs stay in git-ignored `.sec-logs/`.
* Legacy preservation holds in every mode: after every attack and probe the legacy Installer, Showroom (with organization) and e-mail identities are **byte-identical** (auth row, password digest, identities, profile, verified flag, memberships), still sign in, and stay unverified [SEC-E1…E3].

## 2. Confirmed vulnerabilities (reproducible; ranked)

| # | Severity | Finding | Evidence ids | Modes |
|---|---|---|---|---|
| V1 | **High (Critical if hosted has confirmations OFF)** | **An anonymous caller can create the internal phone-alias Auth user for any number directly through GoTrue `/auth/v1/signup`, skipping the WhatsApp code.** With confirmations OFF the account is created **confirmed, with a session**, and the caller can finish registration on the victim's number (`record_consent` → account type → `profile_set_phone` → username); `my_registration_state` = **`access_ready`**, `phone_verified_at` = NULL. | A1, A2, A3, A3b | A1 in all modes; A2/A3/A3b only `confirm-off` |
| V2 | High | **Alias squatting:** a pre-existing anonymous alias row makes the *real owner's* server-side creation (what #113 does after a proven code) fail with `422 email_exists`, so the owner can never sign up by phone. Works with confirmations ON (the squatting row is just unconfirmed). | A4 | confirm-on, confirm-off |
| V3 | High (state integrity) | **A completed phone sign-up never records the number as verified.** Replaying #113's sequence (Admin `createUser` → sign-in → consent → account type → `profile_set_phone` → username) leaves `profiles.phone_verified_at = NULL`; nothing in #113/#116 writes it. | C2, C2b | all |
| V4 | Medium | **Phone-number existence oracle with confirmations OFF:** anonymous `/signup` returns `422 user_already_exists` for an existing alias and `200` for a free one. With confirmations ON GoTrue obfuscates (guard test passes). | A11 | confirm-off (XFAIL); confirm-on (PASS) |
| V5 | Gap | Signup proof binding is not implemented (see §4): the six `SEC-D*` requirements are specified and recorded as XFAIL. | D1–D6 | all |

Things that **hold today** (regression guards, all PASS): duplicate/uppercase/concurrent anonymous sign-ups on an existing or free alias never create a second identity or change the original password [A5, A6]; a public `/signup` body cannot set `raw_app_meta_data` [A7, B5]; direct GoTrue phone sign-up and anonymous sign-in are refused [A8, A9]; an e-mail user cannot swap their login e-mail for an alias directly [A10]; legitimate Admin creation of an alias account works, and Admin rollback (`deleteUser`) after a full initialisation leaves no auth user, identity, public user, profile or phone claim, and the alias is reusable [C1, C3, C4].

`ENV-2`/`ENV-3` assert on every run that no SMS provider, Send-SMS hook, Phone MFA, or anonymous sign-in is enabled on the stack, i.e. nothing here could deliver a message.

## 3. Can a database trigger distinguish Admin creation from public sign-up? (measured with real GoTrue)

No — not at INSERT time — and the way it *can* be done is not obvious. Probes recorded what a `BEFORE INSERT` trigger on `auth.users` sees:

| Signal | Public `/signup` | Admin `createUser` | Usable? |
|---|---|---|---|
| `current_user` / `session_user` | `supabase_auth_admin` | `supabase_auth_admin` | no [B1–B4] |
| JWT claims / request headers / `application_name` | NULL / NULL / empty | NULL / NULL / empty | no [B4] |
| `email_confirmed_at` at INSERT | NULL | NULL (set later) | no [B7] |
| `raw_user_meta_data` | attacker-controlled | caller-controlled | no (forgeable) [B5] |
| `raw_app_meta_data` at INSERT | provider only | **provider only — Admin's `app_metadata` is applied by a later UPDATE** | **not at INSERT** [B6] |
| `raw_app_meta_data` on the committed row | never contains attacker keys | contains the Admin-set marker | yes, after GoTrue finishes [B6b] |
| Same transaction? | – | **INSERT and the metadata UPDATE are one transaction** | enables a deferred check [B6c] |
| `before_user_created` Auth hook | fires | **does not fire** | public-only filter [B8] |

Candidates evaluated against real GoTrue:

| Candidate | Result |
|---|---|
| **V1 — `BEFORE INSERT` trigger reading a grant marker in `app_metadata`** | **Not viable.** It refuses *legitimate* Admin creation that carries a valid grant, because the marker is not yet on the row [G0]. |
| **V2 — `AFTER INSERT … DEFERRABLE INITIALLY DEFERRED` constraint trigger that re-reads the committed row and consumes a single-use grant bound to the exact alias** | **Viable.** Refuses anonymous alias sign-up, forged markers (in `app_metadata` *and* `user_metadata`, even with a real grant id), and Admin creation without a grant [G1–G3]; allows exactly one creation per grant, blocks replay and cross-alias use [G4, G5], keeps sign-in and rollback working [G6], leaves e-mail sign-up and legacy aliases untouched [G7, G8], and survives 3 concurrent creations on one grant [G10]. |
| **V3 — rejecting `before_user_created` hook** | Refuses public alias sign-up cleanly [H1], leaves Admin creation alone [H2] and e-mail sign-up unaffected [H3]; but it is an Auth **configuration** change per hosted project, fails open/closed depending on hook health, and **cannot bind creation to a proven code** (any Admin call still succeeds without a grant) [H4]. |
| Making the alias non-guessable (HMAC of the number) | Would orphan every existing alias account; rejected for legacy accounts. |
| Disabling public e-mail sign-up | Breaks the e-mail registration path (Architecture B). Rejected. |

**Choice (for owner approval):** V2 as the primary control — it is a migration, so it protects every environment regardless of the hosted Auth e-mail-confirmation mode, CAPTCHA mode or hook state — with V3 optionally layered on later for a cleaner early refusal. Details, schema and functions: `PHONE_VERIFICATION_UNIFIED_CONTRACT.md`. One cost to accept: GoTrue maps the trigger's refusal to a generic `500 unexpected_failure`, so the server action must translate it into a neutral message (it must not turn a refusal into a different answer for existing vs free aliases beyond what GoTrue itself already does).

## 4. What is specified but not yet testable

`SEC-D1…D6` (verified challenge bound to the new Auth user and setting `phone_verified_at` for exactly that number; replay; expired proof; wrong account/number; concurrent attach; alias creation impossible without an attached proof) are recorded as XFAIL against the **proposed** `phone_signup_*` contract. Their executable bodies cannot be validated until an implementation exists, so this PR deliberately does not pretend to; the grant-level properties that *can* be proven now (replay, concurrency, cross-alias use, forged marker) are proven by G1–G10. The implementation PR turns D1–D6 into executable tests.

## 5. WhatsApp delivery safety (Priority 2)

Audit of the sign-up sender (`#113 server/auth/whatsapp-otp.ts`, `phone-sign-up.ts`) and #114:

| Finding | Detail | Minimum remediation |
|---|---|---|
| Plaintext code **and** number logged | `console.info("[local only] WhatsApp sign-up code for ${e164}: ${code}")` — the only log site in #113/#116/#114 that carries a code or number (all other log lines carry an error code only); a unit test asserts the code is logged. | Remove; replace by the dev outbox below. |
| Gate is a **public build-time variable** | The print path is gated by `NEXT_PUBLIC_APP_ENV === "local"` and a missing token. The same variable also selects Turnstile's always-pass secret and cookie `secure`. A mis-set value in any deployed environment would open all three. | Dedicated server-only switch; never gate safety on `NEXT_PUBLIC_*`. |
| **No delivery kill switch** | Sending is enabled merely because `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` exist; staging and production wrangler configs already carry the template name. #113 is ready for review and mergeable. | `PHONE_OTP_DELIVERY=off` default (see contract §5), independent of token presence. |
| Two senders for one Meta payload | #113 calls Graph directly from the Next server (`v21.0`, template `aladdin_login_code`, en/ar); #114's Worker builds the same payload (template `aladdin_otp`, `ar` only, Egyptian-mobile regex) but only on the Supabase Send-SMS-hook route. | One adapter contract; Worker as the real transport; remove the direct Graph call. |
| #114's own safety | `WHATSAPP_DELIVERY_ENABLED="false"`, mandatory recipient allow-list, signed requests, D1 replay claims, no logging. Good. | Keep; add an app route and a per-request language. |

Design (adapter interface, `off/outbox/worker` switch, outbox rules, logging rule): `PHONE_VERIFICATION_UNIFIED_CONTRACT.md` §5. Nothing was sent and no Meta API was contacted.

## 6. Priority 3 — unified verification contract

Extend B1's table **in place** (it is unapplied everywhere): `user_id` nullable, `registration_id`, `purpose in ('primary_proof','signup_proof')`, a disjoint-subject check, one open signup challenge per registration, plus three signup functions (`start` / `verify` → single-use grant / `attach`). Reuses B1's HMAC keyring + `kid`, MAC format, attempts, TTL, resend cooldown, per-IP buckets, purge and audit; differs only in the bound subject. Full schema and rationale: `PHONE_VERIFICATION_UNIFIED_CONTRACT.md` §§1–3.

## 7. Priority 4 — the 13 permission discrepancies

Kept **open**; nothing revoked, regenerated or whitelisted. See `PHONE_PERMISSION_DISCREPANCY_RECONCILIATION.md`.

## 8. Priority 5 — #113 E2E failures and the CI plan

Both failing workflows share one root cause: the E2E harness was not updated for #113's new "Complete your account" step (landing is `/onboarding/basics`; the specialty control became a combobox). See `PHONE_E2E_AND_RELEASE_GATES.md`.

## 9. Implementation plan by PR (no changes made to any of them)

| PR | Required change |
|---|---|
| **#113** | (a) Fix the two E2E workflows (helper + spec). (b) Add `PHONE_OTP_DELIVERY` (default `off`) and the dev outbox; delete the `console.info` line and its test; stop using `NEXT_PUBLIC_APP_ENV` as a safety gate. (c) Replace the app-owned `public.phone_verification_challenges` with the unified authority (its migration is unmerged, so this is a replacement, not a second migration). (d) After a proven code: create the Auth user **with the grant**, then call `phone_signup_attach` so `phone_verified_at` is set. (e) Remove the direct Graph call once the Worker route exists. (f) Dedicated keys instead of `SHA-256(label:AUTH_PASSWORD_PREVIEW_GRANT_SECRET)`. |
| **#116** | Retarget to `main` after #113; regenerate its permission contract; optionally take its username lease in the phone path (today a code can be spent and the sign-up then fail on "username taken"). |
| **#114** | Renumber its ADR (two different "ADR-0025" exist, #113 and #114); add an app-to-Worker route and per-request language/country config; keep delivery disabled. Resolve the `RUNTIME_STATE.md` doc conflict. |
| **#121 (B1)** | Rebase last; extend the schema as in §6; regenerate the contract once on the merged tree; add the deferred alias guard migration and flip `SEC-A1/A2/A3b/A4/C2b/D*` from XFAIL to checks. |
| **New, separate** | A minimal migration for the 13 permission differences, only after the reconciliation decisions. |

## 10. Safe order and GO / NO-GO

**Order:** (1) fix #113's E2E and delivery safety → merge #113 → (2) #116 retargeted → (3) #119/#120 → (4) #114 reconciled (disabled) → (5) the unified-authority + alias-guard PR on top of the merged tree (this includes #121) → (6) only then B2 (sign-up wiring). Nothing is enabled anywhere at any step.

**NO-GO to merge registration (#113) until all of these are true:**
1. Hosted `enable_confirmations` is confirmed ON **and** the alias guard (V2) is merged, **or** V2 is merged regardless. (Today a hosted project with confirmations OFF would be exposed to V1 in full.)
2. #113 has a delivery kill switch defaulting OFF and no code or number can reach a log.
3. A completed phone sign-up sets `phone_verified_at` for the exact number (D1) and the six D-checks are executable and passing.
4. Both #113 E2E workflows are green; every stacked PR has its required checks run (manual dispatch).
5. The permission contract is regenerated on the merged tree and the 13 discrepancies have an approved disposition.
6. A read-only check of hosted Auth settings (e-mail confirmations, SMS provider, Send-SMS hook, Phone MFA, CAPTCHA protection) confirms they are what this plan assumes. **Not performed here.**

## 11. What was not verified

Hosted behaviour (nothing hosted was read); the two #113 E2E suites locally (read from CI logs); the `phone_signup_*` functions (do not exist); the hook's behaviour under hook errors or timeouts; GoTrue versions other than `v2.197.0` (CI uses an older stack; see the permission document for the versions involved); a real WhatsApp delivery (none attempted).

## 12. Reproduce

```
# stack: supabase start (this worktree's uncommitted config uses project_id aladdin_sec, ports 515xx)
bash supabase/tests/sec/run_sec.sh                      # all three modes, restarts the isolated stack between modes
SEC_MODES=confirm-off bash supabase/tests/sec/run_sec.sh
```
The runner refuses any `project_id` other than `aladdin_sec`, restores the original local config on exit, and fails on any FAIL, any XPASS, a missing summary line, or a mode that does not start.
