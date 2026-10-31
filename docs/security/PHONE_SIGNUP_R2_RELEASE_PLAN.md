# R2 release plan: phased, backward-compatible, expand/contract

**Status:** plan for review. Nothing in it is approved or executed. No hosted change, no real message, no merge.
**Owner decisions this plan implements (2026-10-31):** neutral sign-up message kept (+ "Already have an account? Sign in"); **no unplanned period without phone registration**; no new grant-less creation path to avoid downtime; hook = prepare and test only; leaked-password and redirect changes = prepare only; merge only after the final combined candidate passes every mandatory check.

## 1. Three things that must never be conflated

| Step | What it is | Changes what users experience? |
|---|---|---|
| **Merge** | commits land on `main` | **No.** Verified from the workflows: `ci.yml`, `supabase-rls.yml` run checks only; `cloudflare-production.yml` is **`workflow_dispatch` only** (default stage `check` = build and bundle, no upload); `cloudflare-frontend-preview.yml` triggers on a different branch or by hand. Nothing deploys because a PR merged |
| **Deploy** | a build is uploaded to Production (manual `cloudflare-production` run, owner-approved) | **Yes for code that changes live routes.** This is the step that changes sign-up |
| **Activate** | switches that make the new flow *work* (DB switches, `PHONE_*` env, secrets, a delivery adapter) | Yes |

Therefore the plan separates **dormant code** (safe to merge and even deploy) from **route-changing code** (#113's redirects and new sign-up UI, #116's routes, R2), and makes the route-changing build go live **in the same planned window in which the new flow is switched on**, so there is no gap in which phone registration is unavailable.

## 2. What is dormant-safe and what changes live routes

| PR | Effect if deployed | Class |
|---|---|---|
| #119 A2 tests, #120, #121 (B1 migration + server code), #122 security tests, #125 (R1 migration, authority, guard) | DB: dormant (`enabled=false`, `signup_enabled=false`, `alias_guard_mode='off'`). App: authority code exists but **nothing calls it** while the flags are off | **dormant** |
| #124 E2E helper | tests only | dormant |
| #113 one-field sign-in / sign-up, redirects of the Installer/Showroom pages to `/auth/*`; WhatsApp sign-up that needs secrets that are not set | the **Installer/Showroom phone sign-up pages stop being the sign-up** (permanent 308 redirects) | **route-changing** |
| #116 continuation + username lease | new routes and a migration | route-changing (depends on #113) |
| **R2 (#126)** | replaces #113's own code check with the authority; phone sign-up answers "unavailable" until activated | **route-changing** (completes #113) |

## 3. The phases

```
Phase 0  merge DORMANT code (R1 stack)              no user-visible change; Production keeps running its current build
Phase 1  hosted DB, dormant (owner approval each)   apply 20261030090001/2 to Acceptance, later Production; flags stay off
Phase 2  interim hook (independent, owner approval) closes the public alias-squatting door; Acceptance first
Phase 3  registration cutover  (route-changing)     merge #113 + #116 + R2; Acceptance rehearsal; ONE Production window
Phase 4  contract                                    drop the legacy table, later, by its own PR
```

### Phase 0 — merge the dormant stack
Order: #119 → #120 → #121 → #122 → #125 (and #124 with #113 later). Gate: the final combined candidate passes the mandatory checks (§7) **and** the hosted clearance is recorded (§8). Cloudflare Worker secret presence is **not** a Phase 0 blocker — it matters only when delivery is switched on (Phase 3/activation).
Production is **not redeployed** from `main` for registration reasons. **Standing rule until Phase 3:** any Production deploy must come from a ref that does not contain the route-changing PRs (a release ref cut from the last good build plus the dormant stack), or must wait. Merging route-changing PRs into `main` before Phase 3 is allowed only with that rule written into the release checklist; the safer alternative is to hold #113/#116/R2 out of `main` until Phase 3 (the merge order in `PHONE_SIGNUP_R2_INTEGRATION.md` §9 is then executed in two blocks).

### Phase 1 — hosted database, dormant
Apply `20261030090001` then `20261030090002` (permission contracts `20261030090001/2.json`, now reconciled). Preconditions, each recorded: **(a) the exact hosted migration history, read-only**: `node scripts/hosted-db/inspect-auth-security.mjs --env <env> --only migrations` (one SELECT; needs only the read token) must show no migration applied that the repo lacks and only the expected ones missing; **(b)** owner approval for that environment; **(c)** Acceptance first. Safe with any build: no application code calls the new functions while the flags are off, and the guard is inert (`off`). Rollback: nothing to undo (no behaviour changed); the structural rollback script is in `PHONE_SIGNUP_R1_MIGRATION_AND_ACTIVATION_PLAN.md` §3.

### Phase 2 — interim hook (independent of every PR)
See `PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md`. It touches only public creation of alias-domain e-mails; Admin creation (the current Installer/Showroom flow, the 570 existing accounts, R2's flow) is not consulted by it. So it does **not** disturb phone registration in either build. Acceptance first, then Production, each after separate approval. Test evidence: 4 cells + a **rollback drill** (disable hook ⇒ baseline restored, nothing else affected; re-enable ⇒ blocked again; dropping the function first ⇒ every public sign-up fails, so the order is fixed).

### Phase 3 — registration cutover (the only phase that changes live sign-up routes)
**Blocking dependencies, none of which exists yet:** an **approved delivery adapter** (`PHONE_OTP_DELIVERY=worker` is deliberately not wired; #114 needs reconciliation), the Meta template / country / language decisions, the HMAC keyring and `PHONE_SIGNUP_COOKIE_SECRET` provisioned in the secret store, edge rate limiting on the start/verify actions, and **Cloudflare Worker secret presence verified** (this is the point at which that finding becomes a hard gate). Until all of that is ready, **Production stays on the previous build and phone registration keeps working exactly as today.** That is how "no unplanned unavailability" is honoured: the new build does not go live before the new flow can work.

Sequence when ready (each step owner-approved, Acceptance fully rehearsed first):
1. **DB, still compatible with the old build:** `enabled=true, signup_enabled=true, alias_guard_mode='observe'`. The old build ignores `signup_enabled`; `observe` only records, it never blocks, so the old build's grant-less Admin creations keep succeeding.
2. **Secrets and env** provisioned and verified (names only) — keyring, cookie secret, delivery adapter, Worker secrets.
3. **Deploy the R2 build with `PHONE_*` ON** (one manual `cloudflare-production` run). From this instant phone sign-up works through the authority: no gap.
4. **Smoke with an allow-listed number** (Acceptance rehearsal repeated on Production with the owner's own number), watch `delivery_failed` share and Auth 5xx.
5. **Observe window**: every observation must be attributable to a retired path; **no** `phone_whatsapp_sign_up` with `had_grant=false` (that would be a bug and a blocker for step 6).
6. **Enforce** (`alias_guard_mode='enforce'`) only after step 3's build is the **only** build that can serve traffic.
**Rollback rule:** before `enforce` — redeploy the previous build (the old pages and creators return and still work because the guard is not enforcing) and `update … set signup_enabled=false`. After `enforce` — first `alias_guard_mode='observe'` (one UPDATE, effective on the next statement), then redeploy. **The guard may be `enforce` only while no build that creates aliases without grants can serve traffic.** No step introduces a grant-less path: the old creators exist only inside the *previous* build, which is retired at step 3.

### Phase 4 — contract (legacy table)
`public.phone_verification_challenges` stays until the R2 build is live everywhere and the previous build can no longer be rolled back to. The DROP is **not in `supabase/migrations`** (anything there is applied by the next `supabase db push`, in order, without knowing which build is deployed). It lives in `supabase/proposals/contract_20261031090001_…sql` with a runtime guard (refuses if codes were issued in the last hour) and three written promotion conditions: R2 live on every target environment, previous build unreachable, owner approval + a fresh read-only migration-history check. `inspect-auth-security.test.mjs` fails if it is ever added to `supabase/migrations` prematurely.

## 4. Expand / contract table

| Element | Expand (ships now, compatible with the old build) | Contract (later) |
|---|---|---|
| Authority tables/functions, guard | `20261030090001/2`, dormant | — |
| `public.phone_verification_challenges` | untouched (still created by `20261028090001`) | DROP, Phase 4, own PR |
| App phone sign-up | new code behind `PHONE_*`/DB switches; old build unaffected | — |
| Grant-less alias creators | removed from the R2 build; present only in the previous build | retired with that build at Phase 3 step 3; guard `enforce` at step 6 |
| `WHATSAPP_*` env / wrangler vars | removed from the R2 build's config; the previous build keeps its own | the Worker's own secrets are a separate (#114) concern |
| Permission contracts | `20261030090001/2.json` include the 6 functions of #113/#116 | regenerate once on the merged tree |

## 5. Separate GO / NO-GO decisions

| Decision | Verdict now | Becomes GO when |
|---|---|---|
| **A. Merge dormant code** (Phase 0) | **NO-GO today; technically ready** | the final combined candidate passes every mandatory check (§7) **and** the owner records the hosted clearance (§8). Worker secret presence is *not* required |
| **B. Acceptance rollout** (Phase 1 on Acceptance; later Phase 3 rehearsal) | **NO-GO** | exact Acceptance migration history confirmed read-only; owner approval in the owner's words; for the Phase 3 rehearsal additionally the delivery adapter and secrets |
| **C. Production rollout** (Phase 1 on Production; Phase 3 cutover) | **NO-GO** | Acceptance clean for the agreed period; exact Production migration history confirmed read-only; the Phase 3 prerequisites; a planned window; rollback rehearsed |
| **D. WhatsApp activation** (real messages) | **NO-GO** | an owner-approved delivery adapter is implemented and wired, Worker secrets verified, Meta template approved, rehearsal with an allow-listed number, the owner's explicit go |
| *(independent)* Interim hook on Acceptance / Production | prepared and tested locally; **not applied** | owner approval per environment (§6 of the hook document) |

## 6. Hosted audit findings reconciled with the R2 checklist

| Finding (owner-verified) | Effect on R2 | Status |
|---|---|---|
| E-mail confirmations and Turnstile ON in both | assumptions behind the local matrix (confirmations ON is the shipped state) hold | consistent; no action |
| Phone provider, Send-SMS hook, Phone MFA OFF | nothing in R2 uses them | consistent |
| **13 disputed function permissions match the contract in both** | **closed.** No corrective REVOKE migration; not reopened without new evidence. R2's reconciled contracts are about 6 *other* functions (#113/#116) missing from R1's contract files, a repository inconsistency found by GitHub's `supabase-rls`, unrelated to the hosted databases | closed |
| 570 existing confirmed phone-alias accounts in Production | preserved: R2 writes no existing account, role, membership, consent or point; the hook never consults existing users; legacy sign-in untouched; E2E proves a legacy account still signs in under `enforce` | preserved |
| R1 alias guard not installed / enforced | Phase 1 installs it dormant; Phase 3 step 6 enforces it | open until Phase 3 |
| Public alias squatting possible | Phase 2 (hook) is the interim mitigation; R1/R2 the real fix | open; mitigation prepared |
| Leaked-password protection OFF | UI handling prepared (§9); **not enabled** | open; approval needed |
| Stale Vercel redirect entries in Production | exact comparison prepared (§9); **nothing removed** | open; approval needed |
| Cloudflare Worker secret presence unverified | **activation dependency**, hard gate at Phase 3 / D; not a Phase 0 blocker | open |

## 7. Mandatory checks for the final combined candidate

Local (this machine, isolated stacks) and GitHub (runners) are both recorded in `PHONE_SIGNUP_R2_INTEGRATION.md` §6; GitHub results for the current head are in §6.2 there. The candidate is final only when **all** of these are green on the same commit: `CI` (typecheck, lint, tests, build, `frontend-cloudflare` Worker bundle), `supabase-rls` (clean replay, lint, permission gate, full pgTAP, concurrency scripts, **RC2 upgrade path**), `Auth CAPTCHA E2E`, `Showroom RC2 E2E`, and `Phone sign-up security (R2)` (phone E2E, R1 matrix, hook probe).

## 8. Hosted clearance — what is and is not required for each decision

| Item | A merge dormant | B/C hosted DB | D activation |
|---|---|---|---|
| Auth settings audit (done by the owner) | recorded | recorded | recorded |
| Exact migration history (`--only migrations`) | not needed | **required** | required |
| Worker secrets presence | **not required** | not required | **required** |
| Leaked-password / redirect decisions | owner's call, not a merge gate | not a gate | recommended before launch |

## 9. Password protection and redirect allow-list: prepared, not enabled

* **UI handling (done, tested):** GoTrue's `weak_password` (what a breached password produces when leaked-password protection is on) now yields the existing neutral "That password wasn't accepted. Try a different one." at **e-mail sign-up** (previously the misleading "could not send") and in the **phone path** (previously a generic verify failure after the code was spent; the Auth user was never created, so the grant is unspent). Recovery, change-password and the Installer security flow already mapped it. No breach wording is shown to the user.
* **Exact allow-list comparison (done, tested):** `inspect-auth-security.mjs --expected docs/security/hosted/redirect-allowlist.expected.json` compares the hosted list with an owner-confirmed list literally and reports `unexpected` (candidates for removal) and `missing` (would break a flow). The expected file is **PROPOSED and unconfirmed** (`confirmed:false`); the owner supplies the real domains.
* **Impact review still to do before any change:** run the comparison (read-only), review each `unexpected` entry with the owner, rehearse recovery + Google + Facebook on Acceptance. Rollback = re-add the removed entries (the "before" snapshot).

## 10. Interim hook — Acceptance-first rollout (prepared)
Runbook, monitoring and the tested rollback are in `PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md` §6–7 (+ drill: `supabase/tests/r2/hook_rollback_drill.sh`). **Request for separate approval is required before applying the migration or enabling the hook anywhere.**
