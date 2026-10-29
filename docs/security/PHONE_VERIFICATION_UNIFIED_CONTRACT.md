# Unified phone-verification contract (design for owner review)

**Status:** proposal. Nothing here is implemented; this branch is tests-first. The executable evidence behind every statement is in
`supabase/tests/sec/phone_signup_security.test.mjs` (row ids in brackets) and `docs/security/phone-signup-security/`.

## 1. Two lifecycles, one authority

| | Signup proof (`signup_proof`) | Existing-account proof (`primary_proof`, B1) |
|---|---|---|
| Who is proving | A browser holding a *registration session* id. **No Auth user exists yet.** | A signed-in user. |
| Bound to | `registration_id` (random UUID kept in the sealed sign-up cookie) **and** the phone | `user_id` **and** the phone currently on the profile |
| What a success means | "This browser controls this number." It authorises **creating** one alias account for that number, once. | "This user controls the number on their profile." It sets `profiles.phone_verified_at`. |
| What must never happen | A code for number A creating/verifying number B; a code being usable without the registration it was issued to; the OTP being skippable by calling Auth directly. | Proof for number A marking number B verified; a proof surviving a number change. |
| Shared | HMAC keyring + `kid` rotation, MAC format, attempts, TTL, resend cooldown, per-IP buckets, retention/purge, audit vocabulary, delivery adapter, kill switch. | same |

Different binding, same engine. The engine must therefore take the **subject** (a user id or a registration id) as data, not assume a user.

## 2. Can the B1 schema be extended safely? Yes, in place, because B1 is not applied anywhere

`app.phone_verification_challenges` today: `user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE`, `purpose CHECK (purpose = 'primary_proof')`,
`uq_pvc_open (user_id, purpose) WHERE open`. B1's migration has not been applied to any hosted environment, so it can still be amended; once applied it can only be extended additively.

Smallest safe extension (one migration, no second table):

```sql
alter table app.phone_verification_challenges
  alter column user_id drop not null,
  add column registration_id uuid,
  drop constraint phone_verification_challenges_purpose_check,
  add constraint ck_pvc_purpose check (purpose in ('primary_proof', 'signup_proof')),
  add constraint ck_pvc_subject check (
       (purpose = 'primary_proof' and user_id is not null and registration_id is null)
    or (purpose = 'signup_proof'  and user_id is null     and registration_id is not null)),
  add column attached_user_id uuid;                       -- signup only: the Auth user the proof was spent on
create unique index uq_pvc_open_signup on app.phone_verification_challenges (registration_id)
  where purpose = 'signup_proof' and consumed_at is null and invalidated_at is null;
create unique index uq_pvc_attached on app.phone_verification_challenges (id) where attached_user_id is not null;
```

* **MAC context** `otp1|challenge_id|subject|purpose|code` where `subject` is the user id (primary) or the registration id (signup). `computeMac` already rejects non-UUID subjects, so the encoding stays injective.
* **One open challenge per registration, not per phone.** Per-phone uniqueness would let an attacker restart a challenge for a victim's number and kill the victim's code. Abuse of a victim's number is bounded by the existing per-phone hourly cap, the per-IP buckets and Turnstile.
* **No change** to config, buckets, purge, key handling, the number-change trigger (it only touches `primary_proof` rows because it joins on `user_id`).
* **Why not a separate table?** It would duplicate limits, purge, keyring handling and audit. Two stores with different policy is exactly the inconsistency the reconciliation review found (#113 vs B1: TTL 10 vs 5 min, 5 sends/h vs 60 s + 6/h + 10/day + IP, no purge vs purge, single derived secret vs keyring).
* **Cost / risk:** the primary functions stay user-only; signup gets its own three functions, so no existing B1 test changes meaning. Only a second `purpose` value, a nullable column and two constraints are new.

## 3. Proposed signup functions (all `SECURITY DEFINER`, `search_path = ''`, `service_role` only, disabled while `enabled = false`)

| Function | Purpose | Key rules |
|---|---|---|
| `phone_signup_start(p_registration_id, p_phone, p_challenge_id, p_kid, p_code_mac, p_ip_key)` | Issue a challenge. | Number must be canonical E.164. Supersedes this registration's previous open challenge. Per-phone and per-IP caps. **No existence check** (see enumeration note below). |
| `phone_signup_verify(p_registration_id, p_challenge_id, p_candidates, p_ip_key)` | Check the code. | Same generic `invalid` for every failure, attempts counted first, constant-time MAC compare. On success consumes the challenge **and** inserts a single-use **grant** `(alias, challenge_id, expires_at ≤ 10 min)`; returns the grant id. |
| `phone_signup_attach(p_user_id, p_grant_id)` | Called by the server **after** it created the Auth user. | One transaction: lock the profile row, require grant unused/unexpired, `profiles.phone_e164` = the grant's phone, then `phone_verified_at = now()` **only** `WHERE phone_verified_at IS NULL` and mark the grant attached to *this* user. Replays and wrong users get the generic result. |

### The database guard that makes the OTP un-skippable

Measured with real GoTrue (rows SEC-B1…B8, SEC-G0…G10, SEC-H1…H4):

* A BEFORE INSERT trigger on `auth.users` **cannot tell Admin creation from public sign-up**: same `current_user`/`session_user` (`supabase_auth_admin`), no JWT claims, no request headers, same `application_name`, `email_confirmed_at` is `NULL` at insert for both. [B1–B4, B7]
* The only trusted channel is `raw_app_meta_data` (a public `/signup` body cannot set it [B5, A7]) but GoTrue applies an Admin caller's `app_metadata` **by a later UPDATE**, so it is **not in NEW at BEFORE INSERT** [B6]. A BEFORE INSERT marker guard therefore refuses legitimate Admin creations too [G0].
* The Admin INSERT and that UPDATE run in **one database transaction** [B6c]. A **DEFERRED constraint trigger** (`AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED`) re-reads the committed row at COMMIT and sees the marker. With a single-use grant row keyed to the exact alias this: refuses anonymous alias sign-up [G1], refuses a forged marker in `app_metadata` *or* `user_metadata` [G2], refuses an Admin create without a grant [G3], allows the one with a valid grant and consumes it [G4], blocks replay and cross-alias use [G5], keeps rollback (`deleteUser`) working [G6], leaves e-mail sign-up and legacy alias accounts untouched [G7, G8], and survives three concurrent creations racing on one grant [G10].
* The Auth `before_user_created` hook **fires for public sign-up only, never for Admin creation** [B8]. A rejecting hook refuses public alias sign-up cleanly [H1] and leaves Admin creation alone [H2], but it needs an Auth **configuration** change per hosted project (not a migration) and cannot bind creation to a proven code [H2, H4].

**Recommendation:** primary control = the deferred constraint trigger + grant (a migration, independent of hosted Auth settings, e-mail confirmation mode, or CAPTCHA mode). Optional second layer = the hook, enabled by the owner only after review, for an early clean refusal. The trigger must be the version that re-reads the row; a plain BEFORE INSERT trigger is not viable.

Open points the trigger design must settle before implementation: the exact failure the user sees when it refuses (GoTrue returns 500 `unexpected_failure` [G9]; the server action must map it to a neutral message); a bounded-time cleanup of unused grants (reuse B1's purge); and a test that the guard cannot be defeated by the Admin API being called with a *different* user's grant.

## 4. Enumeration

GoTrue's own answer for an **existing** alias differs by mode: with e-mail confirmations ON it returns an obfuscated 200 (indistinguishable) [A11, PASS]; with them OFF it returns `422 user_already_exists` — a phone-number existence oracle for anyone who can reach `/auth/v1/signup` [A11, XFAIL in confirm-off]. The app-level `phoneExists` message in #113 is a second oracle by design. Mitigations belong at the edge (Turnstile at Auth, once the owner enables hosted CAPTCHA protection; per-IP limits) and in a product decision about the `phoneExists` copy; a database change cannot remove GoTrue's own response.

## 5. Delivery-adapter contract (one, reusable) and kill switch

```ts
type DeliveryRequest = { purpose: "signup_proof" | "primary_proof"; to: string /* E.164 */; code: string; locale: "en" | "ar"; challengeId: string };
type DeliveryResult  = { outcome: "accepted" | "rejected_number" | "disabled" | "unavailable" | "failed" };
interface PhoneOtpTransport { send(req: DeliveryRequest): Promise<DeliveryResult> }   // never throws a message containing `to` or `code`
```

* Implementations: `disabledTransport` (default; returns `disabled`), `devOutboxTransport` (tests/local only), `workerTransport` (real, later).
* **Kill switch:** `PHONE_OTP_DELIVERY` ∈ {`off` (default), `outbox`, `worker`}; any other value or a missing value ⇒ `off`. It is independent of `PHONE_VERIFICATION_ENABLED` and of the existence of any token. `worker` additionally requires the Worker URL and its signing secret; the Worker itself keeps its own `WHATSAPP_DELIVERY_ENABLED=false` and recipient allow-list, so two independent switches must both be on.
* **Dev outbox:** an in-process store (tests) or a file under a git-ignored `.local/` directory, selected only when `NODE_ENV !== "production"` **and** `PHONE_OTP_DELIVERY=outbox`. Records `{masked_to, purpose, code_hash?, ts}`; tests obtain the code through a test-only accessor, **never from logs**. E2E reads the outbox instead of overwriting `code_hash` in the database.
* **Logging rule:** no log line may contain the code or an unmasked number. Masked form: `+20••••••••12`. A unit test asserts that `console.*` is never called with the code or the full number in any delivery path.
* **Do not use `NEXT_PUBLIC_APP_ENV` as a safety gate.** It is a public build-time variable and already also relaxes Turnstile (always-pass test secret) and cookie `secure`; a mis-set value in a deployed environment would open all three.
* **Worker as the preferred real transport:** the Next server signs a request to the Worker (reuse #114's Standard-Webhooks-style `verifySignature`, D1 replay claims, allow-list, `WHATSAPP_DELIVERY_ENABLED`). The Meta token then lives only in the Worker's Secrets Store; the direct Graph call in `server/auth/whatsapp-otp.ts` is removed. The Worker needs a second route for the app (it only has the Supabase Send-SMS-hook route today), per-request language instead of the hard-coded `ar`, and a configurable country allow-list instead of the Egyptian-mobile regex. Delivery stays disabled in every environment until the owner approves.
