# Auth hardening recommendations from the hosted audit (leaked passwords, redirect allow-list)

**Nothing here was applied.** No hosted setting was read or changed by this work; the facts about Production/Acceptance come from the owner's summary of the completed read-only audit. Each item needs separate owner approval, Acceptance first. The interim alias-squatting hook has its own document: `PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md`.

## A. Leaked-password protection (disabled in both environments)

**What it is.** Supabase Auth can reject a new password that appears in the Have I Been Pwned corpus (k-anonymity: only a hash prefix leaves GoTrue). Config key `password_hibp_enabled`; the extended read-only inspection now reports it as `auth_interpretation.leaked_password_protection_on` (`unknown` is never shown as ON).
**Plan requirement — unverified.** Supabase documents this as a paid-plan feature; the project plan was not checked here. If the plan does not include it, the app-side alternative below is the only option.

**Where it bites** (every place a password is *set*; existing passwords are not re-checked and nobody is forced to reset):

| Path | GoTrue call | What the app does today with `weak_password` |
|---|---|---|
| Email sign-up | `signUp()` | no dedicated mapping → generic error. The person cannot learn *why* |
| Password recovery / change | `updateUser({password})` | change-password maps to a "weak" answer in `installer-security.ts`; the recovery reset has no dedicated copy |
| **Phone sign-up (R2)** | Admin `createUser` after the code is verified | `createPhoneSignUpUser` maps it to `rejected`, which `verifyPhoneSignUp` reports as the generic "verification failed". The WhatsApp code has been spent. The grant is **not** consumed (the Auth user was never created, so the guard never fired) and stays valid for 10 minutes, but the sealed cookie is cleared and the UI has no "choose another password" step |
| Installer/Showroom Admin creation | Admin `createUser` | legacy path, `rejected` |

**Recommendation.**
1. **Before enabling anywhere:** map `weak_password` (reasons contain `pwned`) to one clear message ("This password appeared in a data breach. Choose another.") on sign-up, recovery reset and change-password, in en and ar. For the phone path also validate the password with the same k-anonymity range check **at step 1**, before a code is requested, so a breached password never burns a WhatsApp message or a code (a server-side `fetch` to the HIBP range API; fail-open on its outage, since GoTrue is the authority).
2. **Acceptance first.** Turn it on, then verify with a *known-breached* synthetic password (never a real one): e-mail sign-up, recovery reset, change-password and the local-equivalent phone path each return the new message; a strong password still works; the existing hosted-acceptance E2E accounts still sign in (they are not re-checked) and any E2E that **sets** a password uses a high-entropy value (the shared `E2E_PASSWORD` is; confirm it is not in the corpus before the run).
3. **Production** after Acceptance has been clean for a few days. Rollback is the same single setting, effective immediately; nothing is stored.
4. **Behaviour on an HIBP outage is not verified here** (whether GoTrue then accepts or rejects). Test it on Acceptance before relying on either assumption.
**Risk:** low data risk, moderate UX risk until step 1 is done. **Not a substitute** for the existing application-level weak-password rejection and 10-character minimum; it adds the breach corpus.

## B. Redirect allow-list cleanup (stale Vercel entries in Production)

**Why it matters.** The redirect allow-list decides where GoTrue may send a person with a token (password recovery link, OAuth return). Vercel was retired (ADR-0024). If a `*.vercel.app` entry points at a project that no longer exists, that subdomain can be claimed by someone else; a recovery or OAuth redirect to it would deliver the session/recovery token to them. That is a takeover path, not a cosmetic issue.

**What the app actually needs** (from the code): `redirectTo` is built from the configured public origin only — the recovery reset page `${origin}/auth/forgot-password/reset` and the OAuth return `entryCallbackUrl(origin, …)`. Email OTP sign-up needs no redirect. Hence:

| Environment | Keep | Remove |
|---|---|---|
| Production | `site_url` = `https://aladdindecore.com`; `https://aladdindecore.com/**`; `https://www.aladdindecore.com/**` only if `www` really serves the app (it is in the Turnstile hostnames) | every `*.vercel.app` entry; `localhost` / `127.0.0.1`; plain-`http` entries; bare or host-wildcard patterns (`*`, `https://*`, `https://*.workers.dev/**`); the preview `workers.dev` host; duplicates |
| Acceptance | its own exact origin (the preview Worker, `https://aladdin-frontend-preview.bstalent9.workers.dev/**`) | same classes as above, plus `localhost` unless a developer needs it (prefer a separate non-hosted stack) |

**Method (evidence first, then one change).**
1. Run the extended read-only inspection (`scripts/hosted-db/inspect-auth-security.mjs --env both`). It now prints `auth_interpretation.redirect_allowlist` — the entries classified as `stale_vercel`, `local`, `insecure`, `broad`, `workers_dev`, `duplicates` — plus `site_url`. Archive that output as the "before" snapshot.
2. Owner confirms the keep-list above against the real domains.
3. One settings change per environment (dashboard or Management API `uri_allow_list`), Acceptance first. Keep the "before" snapshot: **rollback = put the removed entries back** (one change, immediate).
4. After the change, test on that environment with a synthetic account: password recovery email link, and Google and Facebook sign-in return. An old, already-sent email that points at a removed host will fail — recovery links are short-lived, so this resolves itself.
**Risk:** low if the keep-list is right; the failure mode is a broken recovery/OAuth return that is fixed by re-adding one entry. **Not done / unknown:** the actual current list (read-only audit values were summarised to me, not provided); whether any partner integration relies on an entry marked for removal.
