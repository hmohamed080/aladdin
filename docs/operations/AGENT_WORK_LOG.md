# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

---

## Session — Business classification belongs to the Organization (account-model clarification)

**Date:** 2026-08-12 · **Branch:** `fix/pilot-uat-round-1` (same PR #20, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Resolve the last account-model ambiguity before PR #20 merges: whether a concrete business type is the *person's* identity or the *organization's* classification. **Documentation only — no code, schema, enum, migration, or test change.**

### Canonical rule now recorded
**Concrete business classifications** — Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · contractor company · design/engineering office · future classifications — are canonically **`organizations.org_type`**, never a person's long-term personal identity. **`users.primary_account_type` is personal identity / persona state**, not the type of every business the user owns or joins. This is structural: *Ahmed Hassan* (persona **Engineer**) owns *AH Showroom* (`showroom_dealer`) and *AH Import* (`importer`) on **one user ID**, and a single `primary_account_type` cannot be both. **Registration UX is unchanged** — *"I am a Showroom"* stays, and architecturally means *"I am creating a business whose `org_type` is X"*, with the backend creating Organization + Owner Membership + Primary Branch in one transactional, idempotent operation for the existing user.

### Contradictions corrected
1. **`AccountType` (`02_domain_model`)** — described business classifications as canonical *primary account types*; now states the target semantics (persona state) and flags the business-valued members as transitional.
2. **`07_permissions_matrix` audience map** — "Exhibition → business **account type**", "Company → business **account types**" → corrected to **organization types** (`org_type`), with a note that business-audience access derives from *membership in an org of that type* + capabilities, never a business-valued `primary_account_type`.
3. **`mvp-scope`** — *"Roles (kept separate, **one account can hold several**)"* directly contradicted one-primary-account-type; rewritten, with business classifications attributed to `org_type`.
4. **`PRODUCT_DIRECTION_GUIDE` taxonomy + "Businesses" actor bullet** — listed business classifications among a *person's* capacities; now split into personal personas vs organization classifications.
5. **`03_database_design`** — the `account_type` enum row and the `organizations.org_type` column (`org_type account_type`) read as "a business type is an account type"; annotated as a **shared physical enum**, not a claim about identity, with the target semantics and the unchanged-here scope stated.
6. **`system-context` actor list** and **PRODUCT.md** businesses bullet — same person/organization conflation, corrected.
7. **`12_validation_rules`** — `org_type` clarified as a property of the organization, never of the creating user.
8. **ADR-0007 (highest authority on `primary_account_type`)** — added **D22** recording the target semantics + explicit transitional status, since D10/D11's "six concepts kept distinct" list was the top-authority definition and did not cover this.

### Transitional debt (explicitly recorded, not fixed here)
`TECHNICAL_DEBT.md` §2 now carries **business-valued `account_type` / `primary_account_type`**: the enum still contains `showroom_dealer`/`supplier`/`manufacturer`/`importer`/`wholesaler` and onboarding paths may still set them. They stay as **implementation compatibility only**; the upcoming **Account & Workspace Model** feature must audit every read/write and migrate behind a reviewed migration rather than create a second source of truth. Until then no path may mirror `org_type` into `users`. **The enum and migration behaviour are deliberately unchanged in PR #20.**

### Files touched
`PRODUCT_DIRECTION_GUIDE.md` (new *Business Classification Belongs to the Organization* section + taxonomy/actor fixes + NEVER rule + change history), `ADR-0007` (D22), `02_domain_model.md`, `03_database_design.md`, `07_permissions_matrix.md`, `12_validation_rules.md`, `TECHNICAL_DEBT.md`, `mvp-scope.md`, `ARCHITECTURE_GUIDE.md`, `system-context.md`, `PRODUCT.md`, `CLAUDE.md`, `RUNTIME_STATE.md`, this log.

### Validation
Documentation-consistency search across the canonical docs; `git diff` inspected. **No** schema, enum, migration, frontend, backend, or test change; no `.pen` file touched; no tests re-run (nothing executable changed).

---

## Session — Pilot UAT product-direction alignment (account / organization / workspace model)

**Date:** 2026-08-12 · **Branch:** `fix/pilot-uat-round-1` (same PR #20, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Align the canonical product documentation with the account/workspace model approved during the Pilot UAT discussion. **Documentation-only patch** — the workspace switcher and the account lifecycle are recorded as direction and are deliberately **not implemented**.

### What is now canonical (PRODUCT_DIRECTION_GUIDE)
**One person = one user ID** (another business never creates another user) · **personal identity is not a business**, and a personal professional may hold **zero** organizations · **a business is an Organization**, created **once** in the UX (backend transactionally creates organization + owner membership + primary branch) · **Membership** is the only user↔organization link and owns relationship, capabilities, branch scope, lifecycle · **zero/one/many organizations on one login** · **workspace is a derived UX concept** (Personal = User+Profile · Business = Organization+active Membership), **no `workspaces` table** · an **existing user can add a business later** with no second sign-up · **single-source-of-truth ownership table** (auth user · users/profiles · organizations · memberships · branches · org-owned business records) forbidding identity duplication in either direction · **duplicate-business protection** (transactional + idempotent; name alone is never the permanent identity) · **membership history survives leaving** (revoked stops access, retains attribution) · **approved future account lifecycle** (deactivate reversible; delete request → grace period → identity released, business/audit history retained; a reused email/phone gets a NEW user id inheriting nothing; muted non-clickable historical attribution; leaving an org ≠ deleting an account).

### Contradictions corrected
1. **"No profile switcher" read as banning all context switching** (PRODUCT_DIRECTION_GUIDE, ARCHITECTURE_GUIDE, `02_domain_model`, `07_permissions_matrix`, `14_future_extensions`, `mvp-scope`, BACKLOG, PRODUCT.md, DESIGN.md, UI_UX_SYSTEM_GUIDE, CLAUDE.md, `12_ai_agent_rules`) — split into **persona/account-identity switching (forbidden)** vs **active work-context switching across the user's own active memberships (allowed, not built)**.
2. **Owner/manager framed only as "not a business type"** — restated as **not an account type either**, a pure user↔organization relationship; the target *personal persona OR concrete business type* registration UX was recorded, and the generic entry demoted to **transitional backward-compatibility** (also noted in `sprint-8-business-readiness.md`).
3. **"Create an account, then create an organization" framing** — replaced with *create the business once* (transactional organization + owner membership + primary branch); added as a UI anti-pattern.
4. **`User` 0–\* `Membership` was ambiguous about zero** — `02_domain_model` now states an organization-less personal account is valid and fully usable.
5. **No stated rule against a second identity per business** — added to the identity model, the NEVER list, `12_ai_agent_rules`, `14_future_extensions`, and BACKLOG.
6. **No stated single-source-of-truth ownership rule** — added the ownership table plus the draft-until-commit exception; `Organization` is now explicitly the canonical business identity.
7. **Nothing forbade a generic `workspaces` table** — now explicitly forbidden; workspaces are derived.
8. **Membership lifecycle was not distinguished from account lifecycle** — separated, with history retained on revoke.
9. **No duplicate-business protection recorded** — transactional + idempotent creation documented for the upcoming implementation.
10. **No account-deletion rule existed anywhere** — recorded as approved future direction in PRODUCT_DIRECTION_GUIDE + `14_future_extensions`, explicitly not implemented.

### Files touched
`PRODUCT_DIRECTION_GUIDE.md` (anchor + change history), `ARCHITECTURE_GUIDE.md`, `02_domain_model.md`, `07_permissions_matrix.md`, `14_future_extensions.md`, `mvp-scope.md`, `BACKLOG.md`, `PRODUCT.md`, `DESIGN.md`, `UI_UX_SYSTEM_GUIDE.md`, `CLAUDE.md`, `12_ai_agent_rules.md`, `sprint-8-business-readiness.md`, `RUNTIME_STATE.md`, this log.

### Validation
Documentation-consistency search across the canonical docs; `git diff` inspected. **No** schema, frontend, backend, or test change — the PR-20 migration comments (`20260813090001`) were checked and are compatible with the new rules, so no code assertion needed correcting. No `.pen` file touched. No tests re-run (nothing executable changed).

### Notes / unfinished
- `frontend/src/lib/onboarding/account-types.ts` calls `BUSINESS_ORG_TYPES` "the BUSINESS account types" in a comment; the values are `org_type`s, not account types. Left unchanged — outside PR #20's diff and not factually load-bearing — but it should be reworded when that file is next edited.
- The target registration UX (*personal persona OR concrete business type* → business info → creator becomes Owner), the work-context switcher, "add a business" for an existing user, and the account lifecycle all remain **unimplemented, approved direction**.

---

## Session — Pilot UAT fix round 1

**Date:** 2026-08-11 · **Branch:** `fix/pilot-uat-round-1` (PR to `main`, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Fix the product defects found during manual Pilot testing before the full persona UAT continues. Not the final integration gate: only the affected flows were audited, then fixed.

### Product decisions taken (these change behaviour — see the notes added to `PRODUCT_DIRECTION_GUIDE.md`)
1. **Completing onboarding activates a personal account. Verification is an independent trust state.** Previously nothing ever set `public.users.status = 'active'` for an organization-less account, so `active_personal` was reachable only through an ACTIVE ORG MEMBERSHIP. A consumer who finished consumer onboarding, and a professional who submitted their profile, were stuck on a terminal screen forever — an Admin approval was the de-facto activation mechanism. `individual_complete_consumer` and `individual_submit_professional` now activate the account (new internal `app.activate_personal_account`, promotes `pending_verification` only, so a suspended identity is never revived). The professional submission still files the SAME `verifications` request; `users.primary_account_type` and `profiles.public_profile_status` are still written only by the approved+applied upgrade workflow, so an unapproved professional is usable but not publicly discoverable.
2. **"Organization owner / manager" is a relationship, not a business type.** `onboarding_select_account_type` demanded a concrete `account_type` for every non-consumer track, so the generic owner/manager entry — which deliberately carries none — always raised and surfaced as "We couldn't save that. Try again." The business track now accepts a null concrete type (exactly as the `onboarding_progress` table comment already documented) and still refuses a consumer or non-business type; the real organization type is chosen and validated during business onboarding.

### What shipped
- **DB** — `20260813090001_pilot_personal_account_activation.sql` (the two decisions above + a one-time backfill releasing accounts already trapped) and `20260813090002_organization_verification_apply.sql` (`apply_organization_verification`, the organization-subject counterpart of `apply_account_upgrade`, plus the `organization.verified` audit action).
- **Persona-aware `/home`** — ONE personal surface with a consumer variant (setup recap, interests, honest coming-soon discovery placeholders) and a professional variant (persona, professional profile, services, service location, next actions, no consumer copy). Guarded on the derived registration state and the derived landing, so a consumer never reaches `/b2b` and an unfinished account resumes at `/onboarding`. Both persona flows stay re-openable, so an active personal account can keep its profile current.
- **Derived profile completeness** — `lib/profile/completeness.ts`: computed on every read from the APPLICABLE fields for that persona (the travel radius drops out of the denominator for a remote-only professional). Never stored, and verification is deliberately not an item; the two are shown side by side and neither blocks usage.
- **Admin fixes found by real-browser QA** — approving an organization always requested a public professional listing, which `ck_verifications_listing_only_professional` rejects, so approving ANY organization failed; `review_approve` records the decision only and the apply step was never called (and did not exist for an organization); 19 audit actions had no translation so `/admin/audit` printed raw enum keys; audit entries showed only the subject discriminator, not the target; the pilot world seeded no audit rows so the surface opened empty; organization detail only showed a badge when verified; and the organization detail page overflowed horizontally on a narrow viewport (grid items default to `min-width:auto`).

### Validation
Frontend typecheck ✓ · lint ✓ (0) · unit **186/186** ✓. Supabase: `db reset` ✓ · `db lint` ✓ (only the pre-existing `set_customer_ownership` warning) · pgTAP **614/614** ✓ (two new files: `25_pilot_account_activation`, `26_organization_verification_apply`; `11_individual_persona_onboarding` updated where it pinned the superseded "completion never activates" behaviour; `07_audit` scoped its admin-read count to its own row now that the pilot world seeds an audit trail). Targeted production Playwright **57 passed / 1 skipped** across desktop + mobile (`pilot-uat-round-1`, `individual-onboarding`, `business-onboarding`, `pilot-landing`, `shared-onboarding`) — the skip is the destructive Admin-approval acceptance, pinned to one project because the seeded review queue is a one-shot resource. Repository-wide E2E deliberately not run. No `.pen` modified.

### Notes / unfinished
- `e2e/global-setup.ts` now restores the two pending pilot organization reviews, because an APPLIED verification is immutable by design and cannot be reset in place.
- `e2e/business-onboarding.spec.ts` carried a latent strict-mode selector failure (the workspace shell renders the organization name in more than one slot); fixed in passing, unrelated to this round.
- The `consumer_onboarding_complete` / `persona_review_pending` terminals remain in `my_registration_state` and still have their screens, but are now only reachable by a legacy row written before this migration.

---

## Session — Sprint 11 Pilot post-login landing hotfix

**Date:** 2026-08-11 · **Branch:** `hotfix/pilot-landing-routing` · **Base:** `main` @ `1b07cf5`

### Objective
Fix the manual-Pilot-UAT regression where successful Email-OTP sign-in sent every active account to `/b2b`, bypassing Sprint 11's canonical derived landing resolver.

### Root cause and fix
`verifyEmailOtp()` sanitized an absent/unsafe `next` to `/b2b`, checked only `my_registration_state`, and redirected that value directly. The Sprint 11 resolver was wired into root/onboarding routes but not the real post-OTP action. The action now preserves explicit onboarding/invitation continuations, sends every other non-active state to `/onboarding`, resolves active accounts through `resolveActiveLanding()`, and retains a deep link only inside the resolved `/admin`, `/b2b`, or `/home` surface. Platform authority remains exclusively `platform_role_grants`; organization membership remains the B2B boundary.

### Validation
Frontend typecheck ✓ · lint ✓ · targeted auth/landing Vitest **17/17** ✓ · targeted production Playwright Chromium **8/8** ✓ (`admin`, `consumer`, `a-owner`, `youssef` across EN/LTR + AR/RTL; consumer and ordinary B2B direct `/admin` denial included). No DB/schema change, so no reset/lint/pgTAP rerun. No `.pen` modified.

---

## Session — Sprint 11 (Pilot Personas, Admin Operations & Connected Demo World)

**Date:** 2026-08-10 · **Branch:** `feature/mvp-pilot-readiness` (PR to `main`, unmerged) · **Base:** `main` @ `2ef6205`

### Objective
Make the B2B Pilot usable as a CONNECTED multi-role product: every persona → account → correct landing → correct UI → correct capabilities → realistic data → interaction with other personas. Replace the developer-only Admin with a real in-product Admin console. Feature sprint; the repo-wide integration audit is deferred.

### What shipped
1. **Persona-aware landing** — `resolveActiveLanding()` (server): platform staff → `/admin`, active org member → `/b2b`, consumer/org-less individual → new non-B2B `/home`. Replaced every hardcoded `active_personal → /b2b` in the onboarding funnel + root page. Fixes a consumer landing in the B2B shell.
2. **Capability-aware nav** — `allowedNavKeys()` filters the workspace rail by membership capabilities (`org.manage` = blanket in-org unlock, matching the RPCs); people-ops gated on `org.members.manage`. Pinned by `src/lib/nav/modules.test.ts`.
3. **Organization people ops** — `/b2b/organization`: manager-gated roster via new trusted `org_members_list` read-model (masked identity — profiles/users aren't co-member readable), invite-by-email through the existing token `invitation_create`, capability-preset roles, branch assignment, suspend/reactivate/revoke.
4. **Admin console** — platform-staff-gated `/admin` (dashboard, users + detail, organizations + detail, verifications queue wired to `review_*`, audit log). Guard reads `platform_role_grants`; every query stays RLS-scoped by `is_platform()` (defense in depth). Dense Aladdin-branded shell.
5. **Connected Pilot world** — `supabase/seed-pilot.sql` (loaded by `db reset` after the pgTAP base seed): 10 identities across every persona, 5 business orgs + branches, capability-scoped memberships, a PENDING token invitation, one end-to-end commercial story (Cairo Ceramics products → Horizon Contracting RFQ → accepted quotation → in-progress order → active project), and two orgs queued for Admin verification.
6. **DB** — migration `20260812090001_pilot_people_ops.sql`: `org_members_list` + refreshed `membership_set_capabilities` allow-list (adds live `sales.*`/`order.*` keys that had drifted behind Sprints 3/10).

### Seed vs. pgTAP
Pilot data lives in a SEPARATE seed file so the pgTAP-pinned base (`seed.sql`) is untouched. Design keeps the suite green: nothing added to Org A/B, all new orgs `is_verified=false`, new profiles `hidden` — so only the two admin-context global counts move (reconciled in `06_admin_boundary`), and `14`'s org-verification lookup was made deterministic (it assumed exactly one org verification).

### Validation
Frontend typecheck ✓ · lint ✓ (0) · unit **163** ✓ · production build ✓ (all `/admin/*`, `/home`, `/b2b/organization` compile). Supabase: `db reset` (base + pilot) ✓ · `db lint` ✓ (only pre-existing `set_customer_ownership` warning) · pgTAP **579/579** ✓. Per sprint rules: targeted unit + DB validation only; no repeated full Playwright loops; no unrelated flakes touched. Browser persona-landing E2E left for the pre-audit gate.

### Docs
`docs/frontend/sprint-11-pilot-readiness.md` — full Pilot Account Matrix + connected story + validation.

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited or in the branch diff.

---

## Session — Phase 2: Sprint 6.2 (Final Realtime & QA Merge Gate)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (PR #9, continued) · **Base:** `main` @ `5a47011`

### Objective
Close the last confirmed Sprint 6.1 items on PR #9. No schema change.

### What changed
1. **Realtime timer teardown** — `SalesRealtime` clears the flash timer (not only the debounce) on unmount / org / branch change / sign-out, and guards all `setState` behind a mount ref (no post-unmount work). Component-tested.
2. **Dirty-form protection** — replaced focus-only detection with a persistent dirty-form guard (document-capture listener marks a modified B2B edit form; stays dirty after focus leaves; navigation resets; search/filter forms opt out via `data-no-dirty`). Realtime defers while any form is dirty. No global state, no new lib, no PII in the adapter.
3. **ConfirmDialog focus fix** — excluded hidden inputs from the focusables query (ownership dialogs lead with hidden inputs, so focus never entered the dialog / the trap broke).
4. **State coverage** — rep visual matrix now asserts the theme exactly like the manager matrix + an out-of-scope direct-URL check per cell; reconnecting status (deterministic hook), permission-denied panel (DB harness), and dialog focus-trap/Escape/restore are browser-asserted; stale-conflict rendering is a component test (React controls the token in-page).
5. **Exact perf console gate** — `perf.spec` asserts failed=0, page-errors=0, non-favicon 4xx/5xx=0, and only the documented `/favicon.ico` 404 is tolerated (no approved brand asset exists outside the encrypted `.pen`; kept as debt).
6. **Flake fully fixed** — the sign-in change-email flake (resurfaced by the new test files) is deterministic via `requestSubmit()` in `act`; 0 failures across 50+ full-suite runs.

### Validation
Frontend typecheck/lint/**130 tests** (0 flaky over 50+ runs)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **one** clean cycle (no SQL): reset + lint + **416 pgTAP** ✓ · **6** race scripts ✓ · Playwright: realtime-scope **9/9** (incl. reconnecting/permission/dirty-focus-off/terminal-dialog), visual-QA **4/4** (both roles full matrix + dialogs/states), perf + Lighthouse re-run ✓. No new dependency; no migration; no `.pen`.

### Commits
`fix: protect dirty forms and clean realtime teardown` · `test: complete visual and performance console gates` · `test: eliminate residual React-19 form-action flake in the suite` · `docs: finalize Sprint 6 merge evidence`

---

## Session — Phase 2: Sprint 6.1 (Realtime Scope & Performance Merge-Gate Closeout)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (PR #9, continued) · **Base:** `main` @ `5a47011`

### Objective
Close confirmed Realtime-scope, E2E, visual-QA, performance-gate, and CI-flake gaps on PR #9. Ownership RPCs accepted in principle; no schema change this sub-sprint.

### What changed
1. **Active-branch Realtime scope (fix)** — the subscription filtered only by `organization_id`, so an org-wide manager with one branch selected still refreshed on every branch. Now it matches the visible data: All Branches → `organization_id=eq.<orgId>`; a selected branch → `branch_id=eq.<branchId>` (excludes org-wide NULL-branch rows). Channel keyed by scope, rebuilt on branch change.
2. **Test-safe instrumentation** — `realtime-debug.ts` mirrors channel scope/count + refresh/deferred counts to `window.__salesRealtime` only when `NEXT_PUBLIC_REALTIME_DEBUG=1` (dev/E2E flag; production build never sets it; no secrets, not app state).
3. **Realtime E2E** — `realtime-scope.spec.ts` (6 scenarios, two real contexts): branch-scope narrowing + teardown + out-of-scope-no-refresh + single channel; follow-up cross-context; sign-out channel removal; revoked-membership no-leak; open-form deferral/focus safety; duplicate → one row.
4. **Visual QA** — both roles now run the **full** 4×{en,ar}×{light,dark} matrix + a dialogs/states pass (ownership dialogs, follow-up edit, validation/not-found/empty). **Fixed** a 42px customer-detail overflow at 360px (long email couldn't wrap → `[&>*]:min-w-0` + `break-words`). 64 screenshots.
5. **Lighthouse (actually run** via `pnpm dlx`, no permanent dep) — sign-in Desktop **100** / Mobile **98**; authenticated /b2b **98**, /b2b/leads **96** (session captured via `_lh-cookies.spec`). All targets met (LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms).
6. **Extended perf.spec** — cold + median-of-3 warm, slowest **actual** request (not TTFB), failed/console/page-error counts, request count/size, **Realtime channels = 1, duplicates = 0**. One benign `/favicon.ico` 404 console error (pre-existing).
7. **CI flake (fixed)** — `sign-in-form` test failed ~2/8 full-suite runs (React 19 form-action native-submit guard racing `preventDefault`); switched to `fireEvent.submit(form)` → **0/14** full-suite runs fail.

### Validation
Frontend typecheck/lint/**125 tests** (0/14 flaky)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **one** clean cycle (no SQL change): reset + lint + **416 pgTAP** ✓ · **6** race scripts ✓ · Playwright: full suite 20 passed / 28 skipped (project/env-gated) / 0 failed, realtime-scope 6/6, visual-QA 4/4, perf + Lighthouse executed ✓. No new dependency; no migration; no `.pen`.

### Commits
`fix: narrow realtime subscriptions to active branch scope` · `fix: remove confirmed sign-in test flake` · `test: prove realtime teardown, branch switching and form safety` · `test: complete visual QA matrix; fix customer-detail 360px overflow` · `test: add Lighthouse gate and extended production perf metrics` · `docs: correct Sprint 6 merge-gate evidence`

---

## Session — Phase 2: Sprint 6 (Sales Ownership, Realtime & Performance Hardening)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (from `main` @ `5a47011`, PR #8 merged) · **Base:** `main`

### Objective
Close the remaining post-create **ownership** gaps, add **scoped Realtime**, and establish **executed** E2E / visual-QA / production-performance merge gates. RLS stays the boundary; trusted RPCs only; no service-role browser path.

### What shipped
1. **Ownership RPCs** (migration `20260806090001_sales_ownership_and_realtime.sql`, forward-only): `set_customer_ownership` (branch + assignee; `sales.assign`; `p_expected_updated_at`→40001; audit `customer.reassigned`) and `set_lead_source_branch` (source + branch + optional compatible reassignment; `sales.write`/`sales.assign`; `p_expected_version`→40001; audit `lead.details_changed`). Both derive the caller from `auth.uid()`, enforce active-org/branch scope, keep the assignee branch-compatible (a stranding move is rejected — never a silent unassign), reject cross-tenant branches, and audit old/new transactionally. **Lead lifecycle is structurally out of bounds** for the lead RPC. **`customer_type` kept IMMUTABLE** — no domain doc approves mutation.
2. **Scoped Realtime** — **Postgres Changes** chosen over Broadcast (RLS-native, zero extra schema for pilot volume). Publication = exactly `leads` + `follow_up_tasks`. Client boundary (`sales-realtime.tsx`, mounted once in the shell): anon browser client with `realtime.setAuth`, filtered to the server-derived active org, **refresh-only** (never renders a payload; RLS-scoped refetch is the source of truth → no leak, no duplicate/out-of-order corruption), rebuilds on org/branch change, tears down on unmount/SIGNED_OUT, and **defers refresh while a form is focused** (manual "Updated ↻" affordance).
3. **Ownership UI** — capability-gated cards on the customer/lead edit pages; controls inside the accessible `ConfirmDialog` with the branch-move visibility warning; controlled selects so values survive an expected error; actions send only changed axes.
4. **Perf** — de-duplicated the member lookup on the edit pages; bundle unchanged (~103 kB shared).

### Executed gates
- **E2E** (`playwright test`): 14 passed / 14 skipped (project-gated) / 0 failed. New `sales-ownership-realtime.spec.ts`: ownership edits, incompatible-assignment rejection, and **two real browser contexts** (a UI-created lead appears in another context — exactly one row; a Cairo rep never receives a Sheikh-Zayed lead).
- **Visual QA** (`VQA=1`): 4 viewports × {en,ar} × {light,dark} × {manager, branch rep} + sign-in — no horizontal overflow, correct dir/dark, screenshots. **Found & fixed** a ~64px cockpit overflow at 360px (`[&>*]:min-w-0`).
- **Production perf** (`PERF=1`, `next start`, median of 3): all routes LCP ≤ 2.5 s, CLS = 0; slowest `/b2b/leads` (LCP 1128 ms). Lighthouse score/TBT need the runner (not installable in-sandbox) — documented follow-up.

### Validation
Frontend typecheck/lint/**125 tests** (114→125)/build ✓ · backend ruff + pytest ✓ · Supabase **two** clean cycles (reset+lint+**416 pgTAP**, +34 in `19_sales_ownership_test`) ✓ · **6** race scripts (added `lead_ownership_concurrency_test.sh`) ✓ · dev + prod runtime smoke ✓. Note: `supabase db reset` was intermittently flaky on Windows (transient container bootstrap exit 1) and needed a retry twice — not a schema issue; the clean cycles complete on retry.

### Commits
`feat: add trusted customer and lead ownership update paths` · `test: prove ownership scope, concurrency and audit behavior` · `feat: add scoped sales realtime subscriptions` · `test: add realtime multi-context + ownership E2E; authenticate realtime socket` · `perf: de-duplicate member lookups on the sales edit pages` · `fix: eliminate 360px cockpit horizontal overflow` · `test: add executed visual-QA matrix and production perf gates` · `docs: record Sprint 6 ownership, realtime and performance`

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited or tracked; none in the branch diff.

---

## Session — Phase 2: Sprint 5.1 (Independent Sales UI Merge-Gate Hardening)

**Date:** 2026-08-04 · **Branch:** `feature/sales-ui-depth` (PR #8, unmerged) · **Base:** `main` @ `e949f2b`

### Objective
Independently harden the committed Sprint 5 UI for merge. Confirmed gaps addressed:

1. **Customer stale-write** — `update_customer` gained `p_expected_updated_at` (compared under `FOR UPDATE`, 40001 before any write/audit); customers have no `version`, so the trigger-maintained `updated_at` is the precondition. New migration `20260805110000`.
2. **Follow-up stale-write** — `update_follow_up` gained `p_expected_version`; `reassign_follow_up` gained an optional `p_expected_version`.
3. **Optional-field clearing** — explicit PATCH: absent=unchanged, blank=clear-to-NULL, value=update. Added `p_clear_phone/email/location` (customer) and `p_clear_description` (follow-up).
4. **Follow-up reassignment UI** — authorized reassign form on the edit route (capability-gated, version-guarded, RPC-enforced branch/active/same-org).
5. **Lead terminal confirmations** — Mark Won / Mark Lost / Archive behind the extended `ConfirmDialog`; the lost reason is controlled and survives validation/concurrency errors.
6. **Deterministic OTP** — the E2E helper snapshots existing Mailpit IDs and reads only a genuinely-new message (no bypass).
7. **Honest E2E** — the suite now asserts persisted results for every step; unique values via `randomUUID`.

### Migration + tests
`20260805110000_sales_edit_concurrency.sql` (forward-only; drops+recreates `update_customer`/`update_follow_up`/`reassign_follow_up` with the new trailing params + re-grants). Regenerated the three RPC arg types surgically. New pgTAP `18_sales_edit_concurrency_test.sql` (+16) and two new two-session race scripts (`customer_update_concurrency_test.sh`, `follow_up_update_concurrency_test.sh`).

### Validation
Frontend typecheck/lint/**114 tests** (104→114)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **two** clean cycles (reset+lint+**382 pgTAP**) ✓ · **5** race scripts ✓ · **Playwright E2E executed and green** (9 scenarios; `PW_CHROMIUM` full-build launch) ✓ · dev-runtime smoke ✓.

### Commits
`fix: add customer and follow-up optimistic concurrency` · `fix: support explicit optional-field clearing` · `feat: add follow-up reassignment and lead terminal confirmations` · `test: make local OTP and sales E2E deterministic` · `docs: record Sprint 5.1 merge-gate hardening`

---

## Session — Phase 2: Sprint 5 (Sales UI Depth & Product QA)

**Date:** 2026-08-04 · **Branch:** `feature/sales-ui-depth` (from `main` @ `e949f2b`, PR #7 merged) · **Base:** `main`

### Objective
Deepen the Sprint-4 B2B sales UI so a salesperson can run the daily workflow end to end: real edit flows, richer detail, explicit confirmations, and a local E2E foundation. Real Supabase data + trusted RPCs only; RLS the boundary.

### Pre-edit review (trusted RPC contracts)
`update_customer` supports name/phone/email/preferred-language/location/source/archive (no type/branch/assignee, no version). `update_lead_details` supports title/priority/customer/next-follow-up with optimistic `expected_version` (source/branch not supported; assignment is the separate versioned `assign_lead`). `update_follow_up` supports title/description/due/priority under a `status='open'` guard (reassign/lifecycle are separate RPCs). → **No new migration required**; edit fields limited to what each RPC supports (no invented fields).

### Implemented
- **Routes:** `/b2b/customers/[id]/edit`, `/b2b/leads/[id]/edit`, `/b2b/follow-ups/[id]/edit` (each guards `canWrite`, localized not-found/permission).
- **Server actions:** `updateCustomerAction`, `updateLeadDetailsAction` (optimistic version → `leads.conflict` refresh), `updateFollowUpAction` (open-guard → `states.followUpNotOpen`); robust idempotent archive with flash.
- **Detail depth:** customer detail gains edit/add-activity/add-follow-up/follow-up lists + per-row actions + created/updated/archived flashes; lead detail gains an Edit-details link and per-follow-up row actions; follow-ups board gains Edit + a confirmed Cancel.
- **Accessibility:** shared `ConfirmDialog` (role=dialog, aria-modal, focus-in/trap/Escape/restore) for terminal actions (archive, cancel).
- **Query helpers:** `getFollowUp`, `listFollowUpsForCustomer`. Generalized the activity + inline-follow-up forms to accept a `customerId`.
- **Local E2E:** Playwright foundation (`frontend/playwright.config.ts`, `frontend/e2e/`), real Email-OTP via Mailpit (no bypass), seeded identities (`a-owner` manager / `a-cairo` branch-limited), 12 smoke scenarios; `pnpm e2e` script; artifacts gitignored.

### Validation
Frontend typecheck/lint/**104 tests** (92→104)/build ✓ · backend ruff + 10 pytest ✓ · Supabase db reset + lint + **366 pgTAP** (unchanged; no SQL change) ✓ · doc links 0 broken · dev-runtime smoke (fresh `.next`, routes 200/307, no module error) ✓ · structural QA (AR rtl / EN ltr / dark class / guarded edit routes) ✓.

### Not done in this sandbox (environmental)
- **Live 4-viewport × light/dark × ar/en visual QA** and **Playwright suite execution** could not run: the sandbox blocks launching a browser process (`spawn UNKNOWN`), the Playwright headless-shell download 400s, and the Chrome automation extension was disconnected. The E2E suite is authored and type-checks; a maintainer runs `pnpm e2e` + the visual pass. No schema/`.pen`/`main` change.

### Commits
`feat: add customer edit and detail improvements` · `feat: add lead edit and pipeline interaction improvements` · `feat: add follow-up edit and lifecycle feedback` · `test: add local sales E2E foundation and product QA coverage` · `docs: record Sprint 5 sales UI depth and QA`

---

## Session — Phase 2: Sprint 4.2 (Public Directory View Security Hardening)

**Date:** 2026-08-04 · **Branch:** `bugfix/public-directory-view-hardening` (from `main` @ `2b19fa7`, PR #6 merged) · **Base:** `main`

### Objective
Resolve two Supabase Security Advisor "Security Definer View" findings on `public.organization_public_directory` and `public.profile_public_directory` without weakening the public-discovery boundary.

### Pre-edit security report (live catalog)
Both views: `reloptions = {security_invoker=false}` (owner-rights → Advisor rule 0010), owner `postgres`. `anon` holds **zero** grant on the base `organizations`/`profiles`/`users` tables (only `authenticated`/`service_role` have RLS-restricted SELECT); RLS enabled, `force_rls` off (owner-exempt, so the definer view applies its own WHERE). Directory objects also carried stale default `TRUNCATE`/`REFERENCES`/`TRIGGER` grants. → A blind `security_invoker=true` would break discovery (no anon base-table access) and "fixing" it via anon base-table grants would broaden the sensitive-table surface (the documented trap).

### Design (evaluated A→B→C)
- **A (projection tables)** rejected — duplicates identity data/authority, maintenance/staleness burden.
- **B (invoker view over existing tables)** rejected — profiles needs the `users` join (would expose `users` to anon); organizations would require anon direct base-table SELECT + an anon RLS policy, broadening the anon surface.
- **C selected** — the privileged read moved into constrained `security definer` readers `app._organization_public_directory()` / `app._profile_public_directory()` (`search_path=''`, schema-qualified, non-exposed `app` schema, `PUBLIC` execute revoked, EXECUTE to anon/authenticated/service_role); the `public.*` relations stay VIEWS, now `security_invoker=true`, whose body only calls the reader. Advisor cleared; `anon` still needs no base-table grant; exact columns, eligibility, and the Data-API relation path preserved. Directory grants tightened to SELECT-only.

### Migration
`supabase/migrations/20260805100000_public_directory_invoker_hardening.sql` (forward-only; deterministic under clean reset).

### Public columns (unchanged)
Org: `id, name, slug, org_type, is_verified, primary_locale, locality_id, logo_media_id` (active + verified + not-deleted). Profile: `id, display_name, headline, bio, avatar_media_id, locality_id, languages` (listed + professional + active + not-deleted).

### Tests / validation
New `supabase/tests/17_public_directory_hardening_test.sql` (+29): both views are `security_invoker` (not definer), backing readers are `security definer` with pinned search_path in `app`, `PUBLIC` cannot execute them, directory grants are SELECT-only (no TRUNCATE/REFERENCES/TRIGGER), anon still cannot read base tables, and anon discovery still returns the right rows. pgTAP **337 → 366**. Two clean reset→lint→test cycles (lint clean), all three two-session concurrency scripts pass, frontend (typecheck/lint/92 tests/build) + backend (ruff/10 pytest) green. Advisor rule-0010 catalog query returns **0 flagged**.

### Advisor verification note
`supabase db lint` runs `plpgsql_check`, not the Security Advisor rules; the Studio Advisor UI was not exercised headlessly. Verified instead via the exact rule-0010 catalog query (0 rows) and per-object `reloptions` (both `security_invoker=true`) after a clean reset. A maintainer can confirm visually in Studio.

### Commits
`security: harden public directory read boundaries` · `test: prove public directory visibility and privilege isolation` · `docs: record public directory Advisor hardening`

---

## Session — Phase 2: Sprint 4.1 (Independent Frontend, Auth & UX Review)

**Date:** 2026-08-04 · **Branch:** `feature/b2b-sales-ui` (PR #6, unmerged) · **Base:** `main` @ `f9596a3`

### Objective
Independently review the committed Sprint 4 UI (not the prior completion report) and harden it: auth/registration boundary, nested forms, org/branch context consistency, branch-selection honesty, silent data loss, search injection, route-level error states, SSR cookie/cache accuracy, design-system/Arabic/accessibility, and responsive coverage.

### Confirmed findings & fixes (no schema change; 337 pgTAP unchanged; frontend tests 51 → 92)
1. **Nested `<form>`** at the OTP verify step → rewrote as sibling forms + `type="button"` change-email reset (refocuses email) + Resend-with-cooldown; DOM test asserts no `form form`.
2. **Sign In implicitly registered** unknown emails (`shouldCreateUser: true`) → `false`; unknown-identity rejection returns the same "code sent" result (no enumeration, no implicit sign-up). Tests prove the boundary.
3. **Cockpit widgets ignored active org/branch** → `myOpenLeads/overdueFollowUps/followUpsDueToday/recentActivities/stageCounts` now take `(orgId, branchId?)`; query tests cover org isolation + branch narrowing; `stageCounts` tallies the RLS-scoped base table so branch narrows honestly.
4. **Dishonest branch selector** → `resolveActiveOrg`/`resolveActiveBranch` pure resolvers (single→auto-select, in-scope-cookie-only, "All / All my branches" labels); single branch renders read-only. Pure-function tests (one/many/forged/removed).
5. **Silent lead-intent loss** (swallowed `try/catch`) → removed the field; intent is a real note from Lead details; test asserts no activity write on create.
6. **Customer search** raw-interpolated into `.or()` → `sanitizeSearchTerm` whitelist + metacharacter matrix test (incl. Arabic/phone).
7. **No route-level error/not-found** → `b2b/error.tsx` (self-contained bilingual, retry, no PII/raw-DB logging) + `b2b/not-found.tsx`.
8. **Inaccurate SSR cookie docs** (claimed HttpOnly) → corrected (shared, non-HttpOnly, per-request client, force-dynamic, no token logging).
9. **Awkward Arabic** (`تحديد كمكسوبة`) → `رابحة/كرابحة`.

### Validation
Frontend typecheck/lint/**92 tests**/build ✓ · backend ruff + 10 pytest ✓ · Supabase `db reset` + lint + **337 pgTAP** + all three two-session race scripts ✓ · 824 doc links/0 broken · workflow-YAML/secret/tracked-artifact/`.pen` audits clean.

### Not done this session
- **Live-browser responsive re-validation** — the Chrome automation extension was disconnected (after `/login`). Verified server-rendered structure via HTTP (Arabic `dir="rtl"`, single sign-in form, responsive classes, no inline hex) and the no-nested-form invariant via a real-DOM test; a maintainer should confirm the four breakpoints × light/dark × ar/en visually. No schema, `.pen`, or `main` changes.

### Commits
`fix: correct Email OTP form and pilot sign-in boundaries` · `fix: enforce organization and branch context across the sales UI` · `fix: remove silent lead-intent loss and harden customer search` · `feat: add localized route error and not-found states` · `test: expand frontend auth, context, and query coverage` · `docs: record the independent Sprint 4.1 review`

---

## Session — Phase 2: Sprint 4 (Authenticated B2B Sales Vertical Slice — first product UI)
**Date/time:** 2026-08-04
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-ui` (cut from `main` @ `f9596a3`, PR #5 merged; **not merged**)

### Objective
Ship the first usable end-to-end B2B Sales UI wired to the **real** Sprint-3 Supabase schema, RLS, RPCs, and server-only helpers (ADR-0008) — no mock data in core flows. Arabic-first (RTL), English switch, light/dark, responsive. Auth stays passwordless (Email OTP); authorization stays in the database.

### What shipped
- **Auth:** passwordless **Email-OTP** (`@supabase/ssr` cookie session) — `/auth/sign-in` (email → 6-digit code), `middleware.ts` refreshes the session and guards `/b2b/*` (redirect with `?next=`, open-redirect-guarded), sign-out. No passwords/SMS/WhatsApp.
- **Shell + context:** top bar (brand, org/branch selectors, language/theme, account), sprint-only nav (Home/Customers/Leads/Follow-ups) with a mobile bottom bar; org/branch context **derived from real memberships/capabilities/branch-access** (no role switcher; cookie is a preference only, RLS re-checks).
- **Routes (9):** `/b2b` cockpit (my open leads, leads-by-stage, overdue + due-today follow-ups, recent activity, quick actions); customers list/new/detail; leads list + **pipeline (kanban)**/new/detail (stage/won/lost/reopen/archive, assign/reassign, timeline note/call/meeting, inline follow-ups, **optimistic `version` concurrency** with a conflict-refresh); follow-ups (overdue/due-today/upcoming/completed + complete/reopen/cancel).
- **Data access:** Server Components read via a caller-scoped client (RLS-scoped); Server Actions wrap the `server-only` sales helpers; RPC errors map to translation **keys** (never raw DB text); dashboard uses the `security_invoker` views. No service-role in browser code.
- **i18n/theme:** custom cookie-based Arabic-first i18n (ar/en catalogs, key-parity-tested, `<html dir>` server-set) — locale not in the URL, preserving the flat routes; cookie light/dark via `.dark` on `<html>` (no flash), consuming design-system tokens.

### Dependencies added (justified)
`@supabase/ssr` (official cookie-session auth SDK — hard to get right; auth SDKs are on the AGENTS.md allow-list). Dev-only: `@testing-library/react`/`dom`/`jest-dom` + `happy-dom` for component tests.

### Bugs found & fixed during live validation
- **Org duplication / wrong capabilities:** `loadWorkspaceContext` queried `memberships` without a `user_id` filter; a manager sees other members' rows via RLS, so the org list duplicated and capability resolution could pick another member's row. Now scoped to `auth.getUser().id`.
- **Ambiguous embed (PGRST201):** `listOrgMembers` embedded `users` while `memberships` has two FKs to `users` (`user_id`, `invited_by`). Disambiguated to `users!memberships_user_id_fkey`.
- **Local auth "Database error finding user":** seeded `auth.users` rows had NULL GoTrue token columns (first sprint to use Auth). Normalized to `''` in `seed.sql` (auth-only; pgTAP stays 337/337).

### Local test setup (product owner)
Manual **demo seed** (`supabase/demo-seed.sql`, NOT part of `db reset` so the Phase-1 snapshot tests stay green): grants sales caps to the seeded members and adds 3 customers / 4 leads / 2 activities / 3 follow-ups. Sign in with `a-owner@example.test` (org manager) or `a-cairo@example.test` (Cairo branch-limited salesperson); read the 6-digit code from **Mailpit** (`:54324`). A local `magic_link.html` template shows `{{ .Token }}`. Full steps + identities in `docs/frontend/sprint-4-b2b-sales-ui.md`.

### Validation
Frontend typecheck · lint · **51 tests** (i18n parity, error-mapping, capability gates, auth + sales-forms actions, sign-in + customers-table component tests) · production build — all GREEN. Supabase `db reset`/lint/`test db` → **337/337** (unchanged; UI touches no schema). Backend unchanged. **Live browser validation:** real Email-OTP sign-in → Arabic RTL cockpit with RLS-scoped demo data (manager); English + dark leads pipeline; middleware redirect (307) for the unauthenticated `/b2b`; Arabic error state on a failed send. Repo: doc links, `git diff --check`, secret scan, `.pen` audit.

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited; `.pen` files gitignored, none tracked, none in the branch diff.

### Remaining / deferred
WhatsApp OTP; notifications/reminders; products/inventory/RFQ/quotes/projects/ads/payments/OCR/AI/native mobile; bulk import/export UI; advanced team-permission UI. Session-refresh relies on middleware `getUser()` (adequate for the slice).

### Commits created (this sprint)
1. `feat: add passwordless auth and protected B2B shell`
2. `feat: add customer list, create, and detail flows`
3. `feat: add lead pipeline, create, and detail flows`
4. `feat: add activities and follow-up flows`
5. `test: cover the authenticated B2B sales vertical slice`
6. `docs: record Sprint 4 frontend implementation`

### Remaining (next)
Open PR `feature/b2b-sales-ui → main`; require `frontend`/`backend`/`docs`/`supabase-rls`. Do not merge from this task.

---

## Session — Phase 2: Sprint 3.1 (Independent B2B Sales Security & Correctness Review)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-workflow` (continued; **not merged** — PR #5)

### Objective
Independently review the committed Sprint 3 sales implementation against the live catalog and real behavior (not the prior completion report): tenant/branch isolation, capability boundaries, direct-DML boundaries, the customer/phone model, lead lifecycle + concurrency, activities/follow-ups, dashboard read-models, the server-only helper, and test quality.

### Independently verified (no defect)
- **Direct-DML boundary:** live catalog shows `anon` = no privilege; `authenticated`/`service_role` = SELECT only on `customers`/`leads`/`sales_activities`/`follow_up_tasks`; no column INSERT/UPDATE/DELETE grants; no TRUNCATE/REFERENCES/TRIGGER; RLS enabled on all four; only SELECT policies exist (writes are RPC-only).
- **Functions:** all 13 sales RPCs are postgres-owned, `security definer`, `search_path=""`, execute = `authenticated` only (PUBLIC/anon/`service_role` = none). Helpers pinned likewise; `normalize_phone` is INVOKER+immutable.
- **Structural tenancy:** every child link (`branch`/`customer`/`assignee`/`lead`) is a composite FK `(organization_id, child) → parent(organization_id, id)` — cross-tenant linkage impossible by construction. Empirically re-confirmed cross-tenant read = 0 and cross-tenant customer link on `create_lead` = `23503`.
- **Capabilities:** no sales RPC grants capabilities (no self-escalation path); assignment requires `sales.assign`/`sales.manage`; branch-compatible assignment blocks cross-branch escalation; inactive membership → denied; org-wide (null-branch) create requires `sales.manage`.
- **Phone normalization:** deterministic; Egyptian local/international/`00`/country-code forms all collapse to one `+20…` E.164 (correct dedup); empty/garbage → NULL (no false dedup).

### Findings

- **F1 (correctness, non-blocking — FIXED).** The RLS assignment-visibility subquery used `m.organization_id = organization_id`; the unqualified `organization_id` resolves to the subquery's `memberships` table, making the org predicate a **tautology** (dead code) in all four `*_select_scope` policies. Not exploitable — each policy is gated by `app.is_org_member(organization_id)` and membership ids are org-unique, so no cross-tenant/cross-branch leak occurs (re-proven empirically) — but the org-filter was a no-op relying on a second mechanism. **Fixed** by correlating to the row's org (`customers.organization_id`, `leads.organization_id`, `sales_activities.organization_id`, `follow_up_tasks.organization_id`). All 337 assertions still pass.
- **F2 (test coverage — ADDED).** Optimistic-version pgTAP alone proves the version comparison but not that `transition_lead`'s `FOR UPDATE` **serializes** genuinely concurrent transitions. Added a real two-session script `lead_transition_concurrency_test.sh` (wired into `supabase-rls`): T1 holds the row lock via the RPC's internal `UPDATE` then sleeps; T2's concurrent transition **blocks ≥2 s**, re-reads the committed version, and is rejected with `40001` — final state is only T1's change (no lost update). Self-contained (sets up its own active actor) so it is order-independent of the other concurrency scripts. Observed second-session waits: 2.80 s / 2.73 s across the two clean cycles.
- **F3 (data quality, non-blocking — documented).** `normalize_phone` on an extension-bearing / non-standard-length number (e.g. `0111-222-3333 x99`) yields a non-E.164 `+0111…` string. Deterministic, so intra-org dedup stays consistent and no isolation is affected; it is a documented pragmatic-MVP limitation, not a defect. A full libphonenumber normalizer remains deferred.

### Test-quality note
The sales pgTAP files use `reset role` (postgres) **only** for fixture setup (granting caps in-transaction, building temp-table id registries, reading `audit_log` counts) — never to make an unsafe production path look safe. Every security assertion (`throws_ok` on `42501`/`23503`/`23505`/`22023`/`40001`, cross-tenant counts, append-only denial) runs under the real `anon`/`authenticated`/`service_role` roles.

### Validation
Two clean cycles: `db reset` → `db lint public,app` (clean) → `supabase test db` (**337/337**) → all three concurrency scripts PASS (last-owner, approval, lead-transition). Frontend typecheck/lint/**12 tests**/build GREEN. Backend unchanged; `backend` check is **green on CI (Linux)** — the local Windows `cryptography` `_rust` DLL block is environmental. Repo: 822 doc links / 0 broken; `git diff --check` clean; YAML valid; no secrets/artifacts.

### `.pen` integrity (accurate)
No Pencil tool invoked; no `.pen` edited by this review; `.pen` files are gitignored, none tracked, none in the branch diff. Current on-disk `design.pen` SHA-256 = `965DB8D0434C0305E2C12C5E56DDB7F8629C0048B931E3C98648477C0B18D6EB`, **unchanged during this review** but **different from the Sprint 2.1 baseline `F1756CD3…`** — an external editor autosave that predates this task; not attributable to this review. Integrity is **not** claimed against the old baseline.

### Commits created (this review)
1. `fix: correlate sales RLS assignment-visibility to the row's organization`
2. `test: prove lead-transition serialization with a real two-session race`
3. `docs: record the independent Sprint 3.1 sales review`

### Remaining
PR #5 updates automatically; require `frontend`/`backend`/`docs`/`supabase-rls`; do not merge from this task.

---

## Session — Phase 2: Sprint 3 (B2B Sales Domain Foundation)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-workflow` (cut from `main` @ `54792a4`, PR #4 merged; **not merged**)

### Objective
Build the secure B2B sales operating foundation (the Sales beachhead) on the Phase 1 identity/tenancy spine: tenant-owned customers, leads, sales activities, and follow-up tasks with scope-based RLS, constrained auditable write paths, and dashboard read-models. No orders/quotes/RFQ/products/inventory/projects/payments/OCR/WhatsApp/AI; no UI screens.

### Pre-implementation review (key decisions → ADR-0008)
Reviewed the existing spec rather than implementing it blindly. The spec's pipeline unit is `Opportunity` (stages incl. `matching`/`quoted`); Sprint 3 implements **`leads`** with in-scope stages only (`new→contacted→qualified→proposal_pending→decision_pending`) — the Match/RFQ/Quote-dependent stages stay deferred. Reconciled `leads`/`customers` as the concrete MVP entities; the richer Opportunity/Need/Match chain remains spec. Deliberate decisions: minimal caps `sales.read/write/assign/manage`; **no** platform cross-tenant read on customer PII (Customer Data Never Leaves the Platform); composite-FK structural tenant safety; denormalized `branch_id` on activities/follow-ups for scope-consistent RLS; phone normalization for intra-org dedup.

### Migrations added (schema source of truth)
- `20260805090001_sales_customers_leads.sql` — enums (`customer_type`, `customer_status`, `sales_source`, `sales_priority`, `lead_status`, `lead_stage`); `customers` + `leads`; capability-catalog + audit-action-allow-list extensions; `unique (organization_id, id)` on `branches`/`memberships` for composite FKs; `app.normalize_phone`/`can_manage_sales`/`membership_can_access_branch`; scope RLS; SELECT-only grants.
- `20260805090002_sales_activities_followups.sql` — enums (`sales_activity_type`, `follow_up_status`); append-only `sales_activities`; `follow_up_tasks`; scope RLS; SELECT-only grants.
- `20260805090003_sales_write_paths.sql` — `app.active_membership_id`/`can_act_on_follow_up`; 13 `security definer` workflow RPCs (create/update customer; create/update-details/assign/transition lead; add activity; create/update/complete/reopen/cancel/reassign follow-up); execute granted to `authenticated` only; 5 `security_invoker` dashboard views.

### Security model (reuses ADR-0007 pattern)
Base tables SELECT-only for `authenticated`/`service_role`; `anon` none; no write policies/grants — every mutation is a `public` `security definer` RPC (`search_path=''`) deriving the caller from `auth.uid()`, resolving active membership, enforcing org + branch scope + capability, rejecting cross-tenant ids, and emitting audit in the same transaction. Cross-tenant linkage is structurally impossible (composite FKs). Lead transitions are optimistic-locked (`version` + `FOR UPDATE`; stale → `40001`). Direct DML cannot bypass lifecycle/assignment/tenant/audit invariants.

### Tests / validation
New pgTAP `15_sales_customers_leads` (49) + `16_sales_activities_followups` (34); all existing **254** preserved → suite **337/337 PASS** across **two clean `db reset` cycles** (reset → `db lint public,app` clean → `test db`). Sales caps are granted in-transaction inside the sales tests (the shared seed and Phase-1 snapshot assertions are unchanged). Proven: tenant ownership, cross-tenant read/link denial, branch isolation, revoked-member denial, duplicate detection (same phone across tenants allowed), assignment rules, optimistic-concurrency rejection, won/lost/reopen audit, append-only tenant-private activities with unspoofable actors, follow-up lifecycle, scoped overdue/due-today read-models, and the direct-DML write boundary. Frontend: types regenerated; `server-only` `sales.ts` helper + 5 unit tests; typecheck/lint/**12 tests**/build GREEN. Optimistic concurrency is deterministic (expected-version), so no shell race script was needed.

### Backend note
No backend change (sales write paths are Next.js server actions, ADR-0001). `uv sync --frozen` + `ruff` pass; local `pytest` was blocked by a Windows Application Control policy denying the `cryptography` `_rust` DLL — an environment issue, not a code regression (backend unchanged; CI `backend` runs on Linux).

### `.pen` integrity
No Pencil tool was invoked and no `.pen` file was edited by this task; `.pen` files are gitignored and absent from the branch/PR. (Observed: the on-disk `design.pen` SHA differs from the Sprint 2.1 baseline with an mtime around session start — an external editor autosave outside this task's scope; not attributable to any action here.)

### Remaining technical debt
Sales UI (05C); RFQ/quotes/projects link from `leads`; notifications/reminders on `follow_up_tasks` (schema is reminder-ready); Excel import/export execution (schema is import-ready); org-customizable pipeline stages; platform governance path over sales data; scheduled overdue materialization; multi-contact-point table if needed.

### Rollback notes
Additive and branch-confined. The three sales migrations and the capability/audit-allow-list extensions can be reverted together (the `unique (organization_id, id)` additions on `branches`/`memberships` are harmless if retained). `main` is untouched.

### Commits created (this sprint)
1. `db: add tenant-scoped customer and lead schema`
2. `db: add sales activity and follow-up tables`
3. `db: add trusted sales workflow RPCs and read models`
4. `test: cover sales tenant isolation and lifecycle rules`
5. `feat: add server-only B2B sales workflow helpers`
6. `docs: record Sprint 3 B2B sales foundation`

### Remaining (next)
Open PR `feature/b2b-sales-workflow → main`; require `frontend`/`backend`/`docs`/`supabase-rls`; do not merge from this task. Recommend an independent security review of the sales tenancy/visibility model before merge.

---

## Session — Phase 1: Sprint 2.1 (Independent Trusted Write-Path Security Review)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/account-upgrade-verification` (continued; **not merged** — PR #4)

### Objective
Independently review the committed Sprint 2 write paths against the live catalog and real behavior (not the prior completion report), close any merge-blocking bypass, and prove the final state with clean resets and real two-session concurrency tests. No new feature; no `.pen` edit; nothing pushed to `main`.

### Original bypasses discovered (confirmed empirically, then fixed)
1. **Direct `service_role` privileged-identity bypass** — `service_role` held full DML on the identity/verification tables (a Sprint 1 "trusted-writer" grant), so `update public.users set primary_account_type=…` (and verification/audit writes) succeeded with **no** verification, approval, `applied_at`, listing check, concurrency lock, or audit — bypassing the entire account-upgrade workflow.
2. **Direct membership/capability/branch bypass** — `authenticated` and `service_role` could DML `memberships`/`membership_capabilities`/`membership_branch_access` directly, bypassing no-escalation, last-owner, lifecycle, tenant-match, and audit.
3. **Last-owner race** — protection locked only the changing membership/capability rows, so two transactions removing *different* owners could each pass its check and leave zero owners.
4. **Stale/concurrent verification decisions** — reviewer ownership was not sticky and only sequential behavior was tested; terminal decisions were not provably immutable.
5. **Unbounded decision reason** — reject/changes-requested reasons were unbounded and not preserved in audit across a resubmission.

### Exact fixes (migration `20260804090001_write_path_security_hardening.sql`)
- **Direct-DML boundary (D17).** `revoke insert,update,delete` from `service_role` on the ten reviewed tables and from `authenticated` on `memberships`/`membership_capabilities`/`membership_branch_access`/`branches`/`contacts`; dropped obsolete membership/branch write policies. Re-granted the minimum: `authenticated` self-service columns; the single non-privileged `users.locale` UPDATE for `authenticated` **and** `service_role` (asserted by test 14 as service_role's only column write — documented, not accidental). `anon` retains no privilege on any reviewed table.
- **Verification lifecycle hardening (D18).** `app.guard_verification_update` trigger makes subject/type/target/submission metadata and terminal/applied rows immutable; reviewer assignment is sticky; only the assigned reviewer may decide/confirm; listing eligibility changes only during approval. `request_account_upgrade` resubmits a `needs_more_info` target, clears the prior claim/reason, emits audit, and requires a fresh `review_start`. `apply_account_upgrade` gates on unexpired + approved + professional **user** subject, takes the target from the immutable row, and is idempotent (`applied_at`). Reasons bounded to 1–2000 chars, trimmed, and preserved in audit metadata.
- **Membership/capability hardening (D19).** The seven membership/branch RPCs are mandatory; each rechecks caller authority **after** taking the org lock, rejects invalid/duplicate capability keys, enforces no-escalation + last-owner + tenant match (a structural `enforce_membership_branch_tenant` trigger), rejects inactive membership/branch, and audits only real changes.
- **Stable-lock design.** Every protected membership/capability mutation `SELECT … FOR UPDATE`s the stable `organizations` row before rechecking authority/status and mutating the owner set; verification decisions/apply lock the `verifications` row. Two transactions can no longer each remove a different last owner.
- **Audit rollback.** `app.record_audit_event` stays internal-only (no role can execute; no direct `audit_log` INSERT for any app role); every allowed sensitive path emits its audit row **inside** the same transaction, so an audit failure rolls the business change back.

### Verified final state (live catalog + empirical)
- **Table privileges:** `anon` = none; `authenticated` = SELECT (+ self-service columns, + `contacts` delete); `service_role` = SELECT only, **plus `users.locale` UPDATE and nothing else**. No `TRUNCATE`/`REFERENCES`/`TRIGGER` for any app role. RLS enabled on all 12 tables.
- **Empirical service-role DML:** `update primary_account_type` / `update public_profile_status` / `insert audit_log` / `insert platform_role_grants` / `insert membership_capabilities` / `execute apply_account_upgrade` → **all denied**; `update users.locale` → allowed (the one grant).
- **Functions:** 14 `public` workflow RPCs — postgres-owned, `security definer`, `search_path=""`, volatile, **execute = `authenticated` only** (PUBLIC/anon/`service_role` = none), so `service_role` cannot invoke a caller-attributed workflow. Internal `app.record_audit_event`/`assert_not_last_owner` = executable by no role. App roles are not members of `postgres` and are not superusers → postgres ownership cannot be assumed. (`app.set_updated_at` is a Sprint 1 SECURITY INVOKER trigger without a pinned `search_path`; benign — INVOKER, references only `pg_catalog.now()` — noted, not changed.)

### Concurrency proof (real two-session `docker exec` scripts, in CI)
- `last_owner_concurrency_test.sh`: T1 holds the org row lock and revokes owner A; T2's revoke of owner B **blocks ≥2 s**, rechecks committed state, fails with `cannot remove the last active org.manage owner`, and exactly **one** active `org.manage` owner remains. Observed second-session waits: **2795 ms** and **2738 ms** across the two final cycles.
- `account_approval_concurrency_test.sh`: two conflicting listing flags through the same assigned reviewer serialize on the verification row; the second call is an idempotent no-op — final `approved | grants_public_listing=t | reviewer preserved | one `verification.approved` audit row`. Observed second-session waits: **2700 ms** and **2708 ms**.

### Tests / validation
- pgTAP reconciled to the authoritative **254** assertions across 14 files (suite 14 grew 83→85 for the bounded-reason + resubmission-audit fixes; earlier records of 246/252 were an intermediate run and the pre-fix plan sum, now superseded). **Two fully completed clean cycles** — `db reset` → `db lint --schema public,app` (no findings) → `supabase test db` (**254/254 PASS**) → both concurrency scripts (PASS) — plus a third confirming reset of the exact committed tree (254/254). An early Sprint 2.1 reset had timed out during container restart (246 assertions at that point); the required clean cycles now complete normally.
- Frontend: frozen install · typecheck · lint · **7 tests** · production build — GREEN. `account-upgrade.ts`/`membership.ts` import `server-only` (pinned `server-only@0.0.1`), take a caller-scoped client (no service-role client), reject malformed RPC UUID results, propagate errors, and hold no authorization logic. No client component imports them.
- Backend: `uv sync --frozen` · ruff (clean) · **pytest 10** — GREEN. No backend write path added (ADR-0001).
- Repo: `check_doc_links.py` → 805 links, 0 broken; `git diff --check` clean; no secrets/temp/test-output/Docker artifacts; workflow YAML valid; `supabase-rls` runs reset/lint/pgTAP + both races + repeat.

### `.pen` integrity
`UI-UX/design.pen` SHA-256 unchanged: `F1756CD38005F42C7A37EFE6E8ADB5FF4D92414F71D99AAF07B072C1168B7402`. No `.pen` file modified.

### Remaining technical debt
Platform-role grant/revoke remains a reviewed-migration/DBA owner transaction (constrained attributed RPC deferred — do **not** restore table DML); verification `expires_at` enforced at apply time but no scheduler materializes `expired`; verification document storage + OCR (placeholder table only); org-subject verification review UX; subscription/package gate before `apply_account_upgrade`; org-visible audit scope; JWT custom-claim optimization for RLS helpers; live backend RLS integration test; repo-wide default-privileges lint. `app.set_updated_at` pinned-`search_path` tidy-up (benign).

### Rollback notes
All Sprint 2.1 changes are additive and confined to this branch. Reverting migration `20260804090001` (and the two commits below) restores the Sprint 2 (pre-review) grants and behavior; no data migration is required — the reviewed tables carry no privileged rows written by the removed direct paths, and the RPCs are unchanged by rollback except for the reason bounds. `main` is untouched; PR #4 is the only integration path.

### Commits created (this review; prior Sprint 2 commits not squashed)
- `8e782e3` security: enforce constrained Phase 1 write boundaries (migration hardening: revokes, RPC-only, verification immutability, org-row locking)
- `abea371` test: gate adversarial and concurrent write paths (suite 14 + both concurrency scripts + CI wiring)
- `354cddd` security: harden trusted server action boundaries (`server-only`, caller-scoped clients, UUID guards)
- `7168a3f` security: bound verification decision reasons and document the service-role locale grant
- `0761f5f` test: assert bounded decision reasons and resubmission audit preservation
- `docs: record the independent Sprint 2.1 security review` (this entry + ADR-0007 D17–D20, DECISION_LOG, review §9, specs 02/03/06/07/10/11/12, TECHNICAL_DEBT, DOCUMENTATION_STATUS, RUNTIME_STATE)

### Remaining (next)
Await explicit merge authorization on PR #4 (do not merge from this task); require `frontend`/`backend`/`docs`/`supabase-rls` green. Do not begin another sprint from this review.

---

## Session — Phase 1: Sprint 2 (Account Upgrade, Verification & Membership Write Paths)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/account-upgrade-verification` (cut from merged `main` @ `a3d7526`; not merged)

### Objective
Implement the trusted write paths on top of the validated Sprint 1 identity/RLS foundation: account upgrade, professional verification, membership lifecycle, branch assignment, and constrained audit emission. No UI/OTP/products/sales; server-controlled fields stay server-controlled.

### Migrations added
- `20260803090001_verification_and_upgrade.sql` — `verification_subject`/`verification_type`/`verification_status` enums; `verifications` (+ minimal `verification_documents`); internal `app.record_audit_event()` (Sprint 1.1 H2 deferral resolved); widened audit action allow-list; account-upgrade RPCs: `request_account_upgrade` (self-service), `review_start`/`review_request_changes`/`review_reject`/`review_approve`, `apply_account_upgrade`, `set_profile_hidden`; RLS (RPC-only writes) + grants.
- `20260803090002_membership_branch_write_paths.sql` — `membership_invite`/`activate`/`set_capabilities`/`suspend`/`revoke` (+ `app.assert_not_last_owner`); `branch_assign`/`unassign`.

### Design (ADR-0007 §Amendments — Sprint 2, D12–D16)
Workflow split so submission ≠ approval; all state changes are `security definer` RPCs (`search_path=''`, schema-qualified) deriving authority from `auth.uid()` (no spoofable params). `apply_account_upgrade` is the only path that changes `primary_account_type`/`public_profile_status` (idempotent via `applied_at`+`FOR UPDATE`). Verification decisions platform-only (`app.is_platform`), no self-approval. Membership: no-escalation (grant only held caps) + last-owner protection (row-locked). Branch: cross-tenant impossible. `record_audit_event` internal-only, actor = `auth.uid()`. RPC placement in `public` (PostgREST-exposed) with internal gating.

### Data-access helpers
Frontend server-action wrappers only: `server/actions/account-upgrade.ts` + `membership.ts` (thin `.rpc()` calls over the caller-scoped server client; no privileged logic; no service-role). No backend helper — these are Next.js write paths, not the FastAPI AI service (ADR-0001). Regenerated `database.types.ts`.

### Tests / validation
pgTAP **112 → 169** (new `11_account_upgrade`, `12_membership_write_paths`, `13_audit_emission`). Two clean `db reset` + `test db` cycles → **169/169 PASS**; `db lint --schema public,app` clean. Catalog audit: 16 functions `security definer`+`search_path=""`; internal writers not client-executable; `verifications` SELECT-only for clients. Frontend typecheck/lint/test(6)/build GREEN; backend ruff + pytest(10). **No `.pen` modified.**

### Docs
ADR-0007 (Sprint 2 amendments D12–D16), DECISION_LOG, phase1 review §8, domain model §C, specs 03/06/10/11/12, TECHNICAL_DEBT (record_audit_event / account-upgrade / last-owner resolved), DOCUMENTATION_STATUS, RUNTIME_STATE, this log.

### Remaining (Sprint 3+)
Verification document storage upload + OCR (placeholder table only); org-subject verification UX; subscription/package gate before `apply_account_upgrade`; notification/Realtime fan-out; transactional outbox.

---

## Session — Phase 1: Sprint 1.2 (Account-Type & Public-Profile Authorization Fix)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (continued; not merged)

### Objective
Narrow merge-blocking correction to the identity model: make `primary_account_type` and public-profile eligibility server-controlled. No new feature; no auth UI; no upgrade workflow build.

### Vulnerability (confirmed empirically, then fixed)
The committed migration granted `authenticated` a column UPDATE on `users.primary_account_type`, and `profile_public_directory` treated any `primary_account_type <> 'end_consumer'` as public. Verified: the seeded consumer ran `update users set primary_account_type='engineer'` (succeeded) and then appeared in the public directory — bypassing the upgrade workflow, verification, and future subscription gates.

### Fix
- **`primary_account_type` server-controlled:** removed from the `authenticated` update grant (only `locale` self-editable now); `is_verified`/`status` were already withheld. `service_role` keeps full `users` DML for the future upgrade/admin RPC. No client write path exists (verified: none in `frontend/`/`backend/` app code).
- **Public eligibility field:** added `profiles.public_profile_status` enum (`hidden` default / `listed`), **not** in the `authenticated` update grant (server-controlled). `profile_public_directory` now requires `public_profile_status='listed'` AND professional account type AND active AND not deleted.
- **Six concepts kept distinct** (ADR-0007 D10/D11): identity · account type (server-controlled) · membership · platform role · professional verification (future `Verification` entity, drives `listed`) · public visibility (`public_profile_status`). `users.is_verified` (identity) not reused.
- Seed lists the two org owners (trusted path) and leaves the sales staff `hidden` as a negative fixture.

### Catalog verification
`role_column_grants`: `authenticated` UPDATE on `users` = `locale` only; on `profiles` = display columns only (no `public_profile_status`). `service_role` retains `users` UPDATE. Empirical consumer self-promote → **denied (42501)**.

### Tests / validation
New `10_account_type_eligibility` (12 assertions: self-promote denied, self-verify denied, self-list denied, locale still editable, hidden professional invisible, listed professional visible, service_role transition works); expanded `08` (listed-only discovery, hidden-professional negative, suspended-user exclusion). pgTAP **98 → 112**; two clean `db reset` + `test db` cycles → **112/112 PASS**; `db lint` clean. Frontend typecheck/lint/test(3)/build GREEN (types regenerated with `public_profile_status`); backend ruff + **pytest 10**. CI: existing `supabase-rls` runs the expanded suite (no duplicate workflow). **No `.pen` modified.**

### Docs
ADR-0007 Sprint 1.2 amendments (D10/D11); DECISION_LOG; phase1 review §7; domain model (User/Profile), 03/06/11/12 specs; TECHNICAL_DEBT (account-upgrade write path); DOCUMENTATION_STATUS; RUNTIME_STATE; this log.

### Remaining (Sprint 2)
Transactional, auditable account-upgrade write path (account-type transition + set `listed` on approval) driven by the professional `Verification` feature.

---

## Session — Phase 1: Sprint 1.1 (Independent Identity & RLS Security Review)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (continued; not merged)

### Objective
Independent security/correctness/schema audit of the unmerged Sprint 1 migrations, grants, policies, functions, triggers, clients, tests, and seeds — fixing findings in the still-unmerged migration set (no history rewrite). No new product feature.

### Two CRITICAL findings (fixed + verified)
- **CRIT-1 (data destruction):** Supabase's default privileges grant `anon`/`authenticated` **`TRUNCATE`** (+ REFERENCES/TRIGGER/MAINTAIN) on every new table; `TRUNCATE` bypasses RLS **and** the row-level immutability trigger, so a client could wipe any table incl. `audit_log`. Confirmed empirically (`anon TRUNCATE audit_log` → succeeded). Fixed: every migration now `revoke all … from anon, authenticated, service_role` then grants back only intended access. Re-verified: `anon TRUNCATE` → denied (42501).
- **CRIT-2 (broken trusted path):** `service_role` had **no DML** on the tables (this CLI version doesn't auto-grant it), so audit inserts / worker outputs would fail in production; local tests passed only as `postgres`. Confirmed (`service_role INSERT audit_log` → denied). Fixed: explicit `service_role` grants (`audit_log`: select+insert; others: full DML, never truncate). Re-verified: `service_role INSERT` → ok.

### Other findings fixed
- **B1** public discovery exposed whole tenant rows → curated `organization_public_directory` / `profile_public_directory` views (approved columns only); base tables private.
- **B2** all-column insert allowed self-verification → column-scoped inserts (status/is_verified/accepted_at withheld → safe defaults).
- **B3** `memberships.branch_id` silently granted access → renamed `primary_branch_id` (descriptive); branch authority solely from `membership_branch_access` + org-wide capability.
- **B4** `administrator` removed from `account_type`; platform authority only via `platform_role_grants`.
- **H1** `PUBLIC` execute revoked on all `app.*` helpers. **H2** audit metadata (object, ≤8KB) + subject_type bounds + trigger `search_path`; `record_audit_event()` RPC deferred. **H3** org-slug format CHECK. **H4** `SUPABASE_ANON_KEY` documented in `backend/.env.example`.

### Verified PASS (unchanged)
`handle_new_user` ignores hostile `raw_user_meta_data` (adversarial test: injected account_type/platform role/verification all ignored; locale validated; name truncated). Clients: fresh instance per call, user client uses anon key (asserted), **RLS proven end-to-end via signed-JWT REST round-trip**.

### CI
Added `.github/workflows/supabase-rls.yml` (stable check `supabase-rls`): start → `db reset` → `db lint --schema public,app` → `supabase test db` → repeat → always `stop`. Runs on PRs to `main`.

### Tests / validation
pgTAP **58 → 98** (added `08_public_discovery`, `09_privilege_hardening`; expanded `05`, `07`). Two clean `db reset` + `test db` cycles → **98/98 PASS**; `db lint` clean. Backend `ruff` clean + **pytest 10 passed**. Frontend typecheck/lint/test(3)/build GREEN; DB types regenerated. Catalog inspection (pg_class/pg_policy/role_table_grants/routine_privileges/pg_proc) confirms RLS on all tables, PUBLIC execute absent, definer search_path pinned. **No `.pen` modified.**

### Docs
ADR-0007 amendments (+ platform-admin provisioning procedure), DECISION_LOG, phase1 review §6, specs 03/06 banners + grant convention, TECHNICAL_DEBT, DOCUMENTATION_STATUS, RUNTIME_STATE, this log.

### Remaining (Sprint 2 / debt)
`record_audit_event()` RPC + automated audit emission; membership write-path invariants (last-owner, invitation flow, no-escalation); org-orphaning; live RLS backend integration test; repo-wide default-privilege CI check.

---

## Session — Phase 1: Identity & Multi-Tenancy (Sprint 1 — Tenant Isolation Foundation)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (created from merged `main` @ `64e68d6`, tagged `v0.1.0-foundation`)

### Objectives
Implement the Phase 1 identity & multi-tenancy foundation only: canonical single identity, organizations/branches, memberships/capabilities/branch-access, platform-admin boundary, RLS spine + helpers, append-only audit, seed fixtures, tenant-isolation tests, and minimal tenant-aware data-access foundations. **No other product feature; no `.pen` edit; no direct push to `main`.**

### Repository state verified
- `main` @ `64e68d6` = merged PR #2 (foundation closeout); tag `v0.1.0-foundation` peels to that same commit. Working tree clean; no prior product feature. Cut `feature/identity-multitenancy` from `main`.

### Pre-implementation spec review
- Independent review of the Phase 0.7 spec (docs/technical/02–07, 11, 12) → [`../database/phase1-identity-tenancy-review.md`](../database/phase1-identity-tenancy-review.md). Findings resolved: table name `memberships` (not the charter's descriptive `organization_memberships`); branch access needs a set (added `membership_branch_access`, not a single `branch_id`); helper strategy (`security definer`, avoids RLS recursion); server-side profile bootstrap; platform-admin isolation; `org_type <> end_consumer`. **No blocking product decision.** Genuine architecture choices recorded in **[ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)**.

### Migrations added (schema is the only source of truth — ADR-0002)
- `20260802090001_identity_core.sql` — `app` schema + `set_updated_at`; enums; `users`/`profiles`/`contacts`; `app.handle_new_user()` bootstrap trigger on `auth.users`; identity RLS + column-scoped grants.
- `20260802090002_organizations_tenancy.sql` — `organizations`/`branches`/`memberships`/`membership_capabilities`/`membership_branch_access`/`platform_role_grants`; tenancy helpers `current_org_ids`/`is_org_member`/`has_capability`/`current_branch_ids`/`is_platform`; RLS + grants.
- `20260802090003_audit_foundation.sql` — append-only `audit_log` (immutability trigger; service-role insert; admin-only read).

### Data-access & types
- Frontend: `lib/supabase/server.ts` (caller-scoped client preserving JWT → RLS), typed `client.ts`, `server/queries/tenancy.ts` (org access derived from active memberships). Generated `types/database.types.ts`.
- Backend: `app/database` — `create_user_client` (preserves caller JWT) + `create_service_client` (trusted-path, bypasses RLS); added `supabase_anon_key` to config. New `tests/test_database_clients.py`.

### Seed & tests
- `supabase/seed.sql` — synthetic fixtures (Org A + 2 branches, Org B + 1 branch, 5 users incl. branch-limited member + platform admin). Clearly marked synthetic.
- `supabase/tests/01–07_*.sql` — **58 pgTAP tests**: profile uniqueness/bootstrap, cross-tenant isolation (all verbs), membership lifecycle, branch isolation, unauthorized (anon/non-member), platform-admin boundary, audit immutability.

### Validation
- Supabase: `db reset` (4 migrations + seed) clean; **repeated** (reset → tests → reset → tests); `db lint --schema public,app` → **No schema errors**; `supabase test db` → **58/58 pass** on both resets.
- Frontend **GREEN** (`install --frozen-lockfile`/`typecheck`/`lint`/`test` 3/`build`); Backend **GREEN** (`uv sync --frozen`/`ruff`/`pytest` **8 passed**).
- **No `.pen` modified.** No service-role in client code.

### Docs updated
- `RUNTIME_STATE.md` (Phase 1/Sprint 1 state), this log, `DECISION_LOG.md` (+ADR-0007), `DOCUMENTATION_STATUS.md`, `TECHNICAL_DEBT.md`; new `docs/database/phase1-identity-tenancy-review.md` + `docs/decisions/ADR-0007-…`.

### Known remaining work (Phase 1 follow-ups)
Membership/org **write-path** feature (creation, invites, capability no-escalation, last-owner protection) with authz tests; wire Docker/Supabase RLS CI jobs; JWT custom-claim helper optimization (ADR-0007 D1); org-visible audit scope; org-creation cap; storage buckets when a feature uploads.

---

## Session — Phase 0: Foundation Closeout
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/foundation-closeout` (created from merged `main` @ `68bb0a5`)

> **Supersession note (branch & version):** earlier entries below (Phase 0.8/0.9) reference `feat/identity-multitenancy` and `v0.7.0-foundation`. Those are **superseded**: the canonical branch prefix is `feature/` (so the next branch is **`feature/identity-multitenancy`**), and the first foundation tag is **`v0.1.0-foundation`** (repo `0.1.0`; the Design System stays independently at `1.0.0`). See ADR-0006's 2026-08-01 amendment + `DECISION_LOG.md`. Historical entries are preserved verbatim.

### Objectives
Resolve the remaining foundation-review items before Phase-1 implementation. **Documentation/governance + repo-hygiene only — no product feature/code/migration/table/UI; no `.pen` edit; no direct push to `main`; no premature tag.**

### Repository state verified
- `origin/main` @ `68bb0a5` = merged PR #1 (docs finalization through Phase 0.9); local `main` fast-forwarded to match; created `chore/foundation-closeout` from `main`. Working tree clean at start.

### Documents added
- `backend/.dockerignore` — shrinks the Docker build context (excludes `.venv`/caches/`.env`/tests/`.git`); image rebuild verified.
- `.github/CODEOWNERS` — default `* @hmohamed080` + per-area map; enforcement depends on branch-protection.
- `.github/workflows/ci.yml` — minimum PR-validation CI (`frontend`, `backend`, `docs` jobs; official actions + corepack/pipx only).
- `scripts/check_doc_links.py` — repo-owned internal-markdown-link checker (used by CI + humans).

### Files updated
- **Ignore hygiene:** `.gitignore` (added `.cache/`, `.eslintcache`, `/tmp/exports/`). Audit found **0** tracked dependency/build/secret/`.pen` files — nothing needed untracking.
- **Branch naming:** reconciled to canonical prefixes `feature/bugfix/hotfix/chore/docs/release` (dropped `feat/` as a branch prefix; it stays a commit-message type) in `git-workflow.md`, `ADR-0006` (transparent amendment), `DECISION_LOG.md`, `02_coding_standards.md`, `07_feature_workflow.md`, `ROADMAP.md` (7 branch names), `RUNTIME_STATE.md`.
- **Versioning:** foundation release clarified to `v0.1.0-foundation` (repo `0.1.0`, pre-MVP; phase numbers ≠ release versions; Design System independently `1.0.0`; tag created only on merged `main` after this PR) in `release-strategy.md`, `git-workflow.md`, `github-workflow.md`, `ADR-0006`, `README.md`, `RUNTIME_STATE.md`.
- **Trackers:** `TECHNICAL_DEBT.md` (`.dockerignore` + `CODEOWNERS` marked resolved; minimum CI added, Docker/Supabase CI + SHA-pinning deferred); `DOCUMENTATION_STATUS.md` (Development/Operations rows).
- **Runtime state:** Current Phase = *Phase 0 — Foundation Closeout*; Current Branch = `chore/foundation-closeout`; Next Phase = *Phase 1*; Recommended Next Branch = `feature/identity-multitenancy`; Implementation Status = *Not started*; Foundation Release = *pending tag v0.1.0-foundation after merge*.

### Validation
- Frontend: `install --frozen-lockfile` / `typecheck` / `lint` / `test` (3) / `build` — **GREEN**.
- Backend: `uv sync --frozen --python 3.12` / `ruff` / `pytest` (3) — **GREEN**.
- Docker: `docker build --no-cache ./backend` (with `.dockerignore`) — **succeeds**.
- Repo: `git diff --check` clean; **0** tracked deps/build/secret/`.pen`; internal doc links **755/0-broken**; `ci.yml` valid YAML; CODEOWNERS paths reviewed. Canonical `design.pen` untouched (gitignored).

### Known remaining work
Select `frontend`/`backend`/`docs` as required checks in `main` branch protection after CI's first run; add CD + Docker/Supabase CI jobs + SHA-pin actions (deferred, `TECHNICAL_DEBT.md`); create tag `v0.1.0-foundation` on merged `main`; apply GitHub labels/milestones/board; resolve `⚑ OPEN` product decisions.

### Next recommended phase
**Phase 1 — Identity & Multi-tenancy** on **`feature/identity-multitenancy`** (cut from `main` after the closeout PR merges).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction/UI change; **no `.pen` edit**; no direct push/force-push to `main`; **no tag created** (documented only); no GitHub settings changed.

---

## Session — Phase 0.9: Repository Governance & Planning
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (continued; no new branch)

### Objectives
Extend repository governance to production-grade and implementation-ready: add the missing governance/planning documents and connect them to the existing hierarchy, without duplicating or rewriting existing docs. **Documentation only — no product feature, code, migration, API, table, UI, architecture, product-direction, or `.pen` change.**

### Documents added
- [`decisions/ADR-0006-repository-governance.md`](../decisions/ADR-0006-repository-governance.md) — branch strategy/naming, protected branches, merge strategy, PR policy, SemVer, release workflow, GitHub flow, commit conventions, code & documentation ownership (cross-references the development docs).
- [`roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) — Phase 0 → 5 + future, each with objective/deliverables/dependencies/success-criteria/estimate; mapped to the Sales-first design roadmap and reconciled with MVP scope (no "marketplace/commerce" contradiction).
- [`product/BACKLOG.md`](../product/BACKLOG.md) — MoSCoW backlog (priority/phase/dependencies/status/owner/notes) sourced from MVP scope.
- [`technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) — deferred features, known compromises, performance/security/infra improvements, future refactoring, and consolidated `⚑ OPEN` decisions.
- [`DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md) — coverage by area (%/status/owner/last-updated/missing).
- [`decisions/DECISION_LOG.md`](../decisions/DECISION_LOG.md) — one-screen index of ADR-0001…0006 (title/status/date/summary/current-state).

### Files updated
- [`README.md`](../README.md) (docs index) — new **Planning & governance** section; ADR-0006 + DECISION_LOG added to Decisions; BACKLOG in Product; TECHNICAL_DEBT in Technical. No orphan documents.
- [`RUNTIME_STATE.md`](RUNTIME_STATE.md) — Current/Next Phase, Current/Recommended-Next Branch, Repository Status, Documentation Status, Implementation Status; live-state Epic + Documentation Version updated to Phase 0.9.
- This log.

### Validation
- Internal markdown links re-checked (see final report); no duplicated documentation (new docs cross-reference existing ones); no conflicts with ADRs, Product Direction, or MVP Scope (roadmap/backlog explicitly reconciled and preserve the "never build" list and Sales-first order); metadata blocks consistent; work log chronological (newest first).

### Known remaining work
`⚑ OPEN` product decisions (subscription tiers, verification doc sets, email/OCR/PDF providers, retention windows, product attribute schemas, media/OTP caps) — tracked in [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) §7; `CODEOWNERS` + CI branch-protection recommended (ADR-0006); tag `v0.7.0-foundation`; apply GitHub labels/milestones/board.

### Next recommended phase
**Phase 1 — Identity & Multi-tenancy** on `feat/identity-multitenancy` (cut from `main` after this branch merges).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction/UI change; no `.pen` edit; no GitHub resources auto-created (documented only); no history rewrite; existing documentation not rewritten (only extended/indexed).

---

## Session — Architecture-Review Resolution + Phase 0.8 Engineering Setup
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (continued; no new branch)

### Objective
Resolve the architecture-review comments on the documentation-finalization work, then create the Phase 0.8 engineering standards. **Documentation only — no feature implementation, no code/migration/API/table, no `.pen` edit, no GitHub resources auto-created.**

### Part 1 — Review comments resolved
- **Runtime State:** added a *Live engineering state* block — Current Sprint, Epic, Feature, UI Status, Backend Status, Database Status, Design System Version, Documentation Version, Deployment Status.
- **Repository standards:** [`docs/development/git-workflow.md`](../development/git-workflow.md) (branch/commit/merge/release/tagging conventions).
- **GitHub standards:** `.github/PULL_REQUEST_TEMPLATE.md` + `.github/ISSUE_TEMPLATE/{bug_report,feature_request,task}.md`.
- **Project management:** [`docs/development/github-workflow.md`](../development/github-workflow.md) — recommended labels, milestones, and project board (**documented, not created**).
- **Release strategy:** [`docs/development/release-strategy.md`](../development/release-strategy.md) — process + the `v0.7.0-foundation` first release (purpose/scope/contents/criteria; tag command documented, not executed).
- **Docs synchronized:** RUNTIME_STATE, this log, the documentation index, and the Architecture Guide (pointer to engineering standards). Previous history preserved.

### Part 2 — Phase 0.8 engineering standards
- Added [`docs/engineering/`](../engineering/README.md): a README index (topic→doc map for all 25 brief items) + 12 grouped standards docs: project structure & layers & DI · coding & naming · API + shared response/error models · error/logging/observability · validation + shared rules · testing · feature workflow (checklist + Definition of Done) · migration workflow · PR + code-review checklist · environment + CI/CD · performance + security · AI-agent rules.
- Standards **reuse and cross-reference** existing docs (ADRs, technical spec, scoped `AGENTS.md`, design GOVERNANCE, security/ops docs) — no duplication; every rule links its authoritative source.

### Validation
- All 25 brief topics covered (mapped in the engineering README). Internal markdown links re-checked (see final report); no duplicated or contradictory standards introduced; documentation hierarchy: `docs/development` (process), `docs/engineering` (how to build), `docs/technical` (what to build), `docs/decisions` (why).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction change; no `.pen` edit; no GitHub labels/milestones/board/releases auto-created (documented only); no history rewrite.

---

## Session — Documentation & Repository Finalization
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (created from `chore/repository-architecture-foundation` @ `7499ab1`; architecture branch left untouched)

### Objective
Finalize documentation before implementation and make this the canonical Git repository. **Documentation & repository finalization only — no feature implementation, no code/migration/API/table, no `.pen` edit.**

### Repository
- Created isolated branch `docs/technical-finalization` from the architecture branch; the previous branch is untouched.
- Added remote `origin` = `https://github.com/hmohamed080/aladdin.git`; verified.
- Pushed `main`, `chore/repository-architecture-foundation`, and `docs/technical-finalization` preserving full history — **no squash, no force, no history rewrite**. (See final report for the exact push result / any auth step required.)

### Documentation improvements
- Defined and applied a standard metadata block (**Status · Version · Owner · Last Updated · Depends On · Related**): full block on all 15 `docs/technical/*` docs; added `Version`/`Owner` to the three canonical guides (`PRODUCT_DIRECTION_GUIDE`, `ARCHITECTURE_GUIDE`, `UI_UX_SYSTEM_GUIDE`); documented the per-family convention (memory / technical / design / ADR) in the index.
- Improved [`docs/README.md`](../README.md) into the master, discoverable index with a **Documentation standard** section and the cross-family **sync rule**.

### Runtime state
- Added the required fields to `RUNTIME_STATE.md`: **Current Phase, Current Branch, Current Milestone, Current Remote Repository, Last Stable Commit, Last Stable Tag, Next Planned Phase, Next Planned Branch**.

### Validation
- Internal markdown links re-checked (see final report); working tree clean before/after commits; branch isolation and remote configuration verified.

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction change (metadata-only additions to the guides); no `.pen` edit; no squash/force/history rewrite.

---

## Session — Phase 0.7: MVP Technical Specification & System Blueprint
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Produce the complete engineering blueprint for the MVP under `docs/technical/` — detailed enough for a senior engineer to build the MVP without further questions. **Specification only: no product feature, code, migration, API, table, UI, or architecture change; no `.pen` edit.**

### Deliverables (15 files under `docs/technical/`)
`README.md` (index + authority) · `01_system_overview` · `02_domain_model` · `03_database_design` · `04_relationships` (ERD) · `05_storage_design` · `06_rls_strategy` · `07_permissions_matrix` · `08_api_contracts` · `09_background_jobs` · `10_events` · `11_state_machines` · `12_validation_rules` · `13_integrations` · `14_future_extensions`. Linked from `docs/README.md`.

### Key reconciliations (authority hierarchy applied)
- **Integrations:** documented the **approved stack only** (Supabase Storage, OpenAI, Azure Document Intelligence [OCR candidate], WhatsApp Business API, Email provider [⚑ OPEN], Sentry, Excel/PDF libraries). The task's examples **Cloudinary / Firebase-push / Google Maps-Places / payments** are **not approved** → substitutes documented (Supabase Storage; Realtime+email+WhatsApp; internal localities + PostGIS; deferred) and flagged.
- **Roles:** used the canonical account-type + capability + platform-role model (no profile switcher); mapped the task's generic role names (Guest/Company/Exhibition/Support/Moderator/Super Admin) onto it.
- **Undecided items** (pricing/tiers, OCR provider finalization, email provider, retention windows, verification doc sets, product attribute schemas, media/OTP caps) recorded as `⚑ OPEN` inline, not invented.

### Validation
- 123 internal markdown links across `docs/technical/` checked, **0 broken**. Working tree otherwise clean before commit.

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture or UI change; no `.pen` edit. Specification documents only.

---

## Session — Final Network-Dependent Foundation Gate (Docker + Supabase)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Run the network-dependent pre-merge gate that prior sessions had to defer: Docker image build/inspection/run and the Supabase local stack (start / db reset ×2 / db lint / extension inspection). **No product feature, no product table, no `.pen` edit, no merge/push.**

### Baseline (re-run, GREEN)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen --python 3.12` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ (1 benign `StarletteDeprecationWarning`).

### Docker validation — PASSED
- `docker version` server **29.6.2**. Pulls: `python:3.12-slim` ✅ (Docker Hub); `ghcr.io/astral-sh/uv:latest` ✅ (after retries — intermittent `ghcr.io` TLS-handshake timeouts).
- `docker build --no-cache -t aladdin-backend-foundation ./backend` ✅ (multi-stage; `uv sync --frozen --no-dev` resolved 53 packages from PyPI).
- Inspect: runtime **Python 3.12.13**; user **appuser (uid 10001)** — non-root; **HEALTHCHECK** configured; `Cmd=uvicorn app.main:app`.
- No `.env`/`.pen`/PDF/customer-data/`.git`/app-logs in image (only base-image `apt/dpkg` logs). **No Alembic, no SQLAlchemy** (`find_spec` False; no site-packages).
- `docker run` + `curl --fail /health` → **HTTP 200 `{"status":"ok","service":"backend","env":"local"}`**; running process **uid 10001**; container **health=healthy**. Test container stopped and removed.
- Hygiene note (not a defect): no `.dockerignore` → the whole `backend/` context (incl. `.venv/`) is sent to the daemon, and 3 local `app/**/__pycache__` dirs are copied in. Selective `COPY` keeps the image itself clean.

### Supabase local stack — PASSED
- `supabase --version` 2.110.0. `supabase start` ✅ (exit 0) after several retries — Docker Hub and `public.ecr.aws` reachable; `ghcr.io` TLS-handshake timeouts repeatedly slowed the multi-image pull (Docker Desktop also flapped once and recovered). Migration `20260729000000_extensions.sql` applied; `seed.sql` applied.
- Services healthy: **db, kong (API), auth, storage, realtime, studio** (+ rest, analytics, inbucket, pg_meta, edge_runtime). `imgproxy` + `pooler` intentionally disabled in `config.toml`. `vector` (log router) flaps on restart — benign, unrelated to Postgres/schema.
- **First `db reset`** ✅ (exit 0). **First `db lint`** ✅ (exit 0) — all findings are inside bundled `extensions.*` PostGIS/pgcrypto functions; **zero** in our migration or `public`.
- Extensions (name | schema | version): **pgcrypto | extensions | 1.3**, **pg_trgm | extensions | 1.6**, **vector | extensions | 0.8.2**, **postgis | extensions | 3.3.7**. `extensions` schema present. **0 product tables in `public`.** Migration recorded: `20260729000000`.
- **Second `db reset`** ✅ (repeatable, no manual intervention) — identical extensions/versions, still 0 public tables, no drift, seed repeatable. **Second `db lint`** ✅ — 16 finding-groups, all in `extensions`, none in our code.
- Cleanup: `supabase stop` ✅.

### `.pen` integrity
- **This session modified no `.pen` file.** All 16 backup snapshots are byte-identical before/after. The canonical `UI-UX/design.pen` **changed on disk during this window** (`ca54598…d581c` → `f1756cd…b7402`, mtime 14:51) because a **concurrent design agent ("Pi")** flushed its "missing-variant completion" Pencil edits and wrote one new gitignored backup. `.pen` files are **gitignored**, so this is outside the git tree and does not affect the commit or merge — and it was not caused by this task.

### Result
**Full architecture and infrastructure foundation validation complete.** No product feature/table/screen; no `.pen` modified; no live cloud/production service used; Docker + Supabase ran locally only.

---

## Session — Design System Finalization & Hardening (v1.0.0)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8) with Impeccable
**Branch:** `chore/repository-architecture-foundation`

### Objective
Finalize and harden the Aladdin Design System before any product-feature work: audit, source-of-truth reconciliation, machine-readable token architecture, component governance, and implementation validation. **No product feature, no new screen, no journey redesign, no `.pen` edit.**

### Pre-edit audit — key findings
- **Defect (theme):** `frontend/src/styles/tokens.css` `.dark { --primary: var(--lime) }` referenced an **undefined** variable (primitive is `--on-dark`) — dark-theme primary action color broken at runtime; production build did not catch it.
- **Missing:** no canonical machine-readable tokens; no design-system versioning/changelog; no component inventory; no icon policy; no motion-duration/z-index tokens; no canonical named breakpoints; no `prefers-reduced-motion`.
- **Source-of-truth ambiguity:** color hex duplicated across `DESIGN.md` frontmatter, `tokens.css`, and the *gitignored* `.impeccable/design.json` with no documented canonical source or edit-order.
- **Accessibility:** measured 22 semantic pairs — one sub-AA pairing (`fg-muted` on Sand = 4.27:1); all others pass.
- **Breakpoint conflict:** UI guide (1440/768/390) vs sidecar (1080/1360) — reconciled to the guide.

### Changes
- **Fixed** the dark-theme `--primary` (`--lime` → `--on-dark`).
- **Added canonical machine tokens** `design/tokens/{colors,typography,spacing,radii,shadows,motion,breakpoints,z-index}.json` + README (manually maintained; documented sync edit-order).
- **Added** `design/GOVERNANCE.md` (source-of-truth hierarchy, semantic versioning, synchronization, new-component governance, component-state matrix, motion, measured-AA accessibility, responsive, RTL, light/dark, enforceable AI-agent rules), `design/COMPONENT_INVENTORY.md` (28 families, all `Proposed`/`Draft`), `design/icons/README.md` (Lucide default; custom-icon process), `design/CHANGELOG.md`, `design/README.md`.
- **DESIGN.md:** added versioning metadata, source-of-truth hierarchy, compatibility notes, honest font-license/PDF-strategy record, measured-contrast + Muted-On-Sand rule.
- **Frontend:** added motion (duration/easing) + z-index tokens to `tokens.css`; canonical `tablet/desktop/wide` screens, `transitionDuration`, `zIndex`, and CSS-var easings to `tailwind.config.ts`; `prefers-reduced-motion` to `globals.css`.
- **Memory reconciled:** `UI_UX_SYSTEM_GUIDE.md`, `ARCHITECTURE_GUIDE.md`, root/`frontend`/`UI-UX` `AGENTS.md`, `docs/README.md`, `RUNTIME_STATE.md`. **`PRODUCT_DIRECTION_GUIDE.md` untouched** (no product-direction change).

### Validation (commands + results)
- Frontend: `typecheck` ✅ · `lint` ✅ · `test` **3 passed** ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Tokens: all 9 JSON files parse ✅; 33/33 color primitive names unique ✅; **no dangling `var(--x)`** references in `tokens.css` ✅.
- Docs: **192 internal relative links, 0 broken** ✅; no duplicate H1/H2 headings in new design docs ✅.
- **`.pen` unchanged:** `UI-UX/design.pen` sha256 `ca54598…d581c` identical before/after ✅.

### Unverified / open items
- Formal OFL license-file audit of the four self-hosted fonts (marked pending, not claimed verified).
- PDF/Arabic document-font strategy (FastAPI quote/RFQ PDFs) — recorded as an open item.
- Component-level a11y (keyboard, focus-trap, SR labels, tab order, touch targets) — cannot be verified before components exist; gated in the inventory `Ready` criteria.
- Lucide icon library decided but **not installed** (deferred to first real need).

### Out of scope (confirmed not done)
No product feature, no product screen, no journey redesign, no `.pen` edit, no unapproved brand asset created, no auth/Sales/Catalog/RFQ/Projects/Admin/AI flow started.

---

## Session — Approved Aperture Brand Token Extraction
**Date/time:** 2026-08-01
**Agent/tool:** Codex with Impeccable (`extract` playbook)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Turn the founder-approved Brand Toolkit v1 plate into a durable root design record and a production-ready frontend token foundation, while keeping the canonical UI/product memory consistent and without starting product workflows.

### Changes
- Added root `DESIGN.md` as the approved token/rule record for **The Aperture** identity: exact palette, bilingual typography, spacing, radii, component defaults, elevation, mark rules, and do/don't constraints.
- Added `frontend/src/styles/tokens.css` with fixed brand primitives and light/dark semantic aliases; components can consume semantic values without hardcoding hex.
- Mapped the complete approved foundation into `frontend/tailwind.config.ts`: semantic and brand colors, bilingual font families, typography roles, spacing, radii, shadows, and easing.
- Loaded Archivo, Reem Kufi, Readex Pro, and JetBrains Mono through `next/font/google` in the root layout; established Readex Pro and semantic canvas/foreground/focus defaults globally.
- Added accessible light-theme semantic tones from the approved tonal ramps. Brand primitives remain unchanged; normal-size text/focus/status tokens now clear WCAG AA rather than incorrectly treating every display primitive as text-safe.
- Reconciled `PRODUCT.md` and `UI_UX_SYSTEM_GUIDE.md`: removed the obsolete “brand not approved” state and documented the authority chain (`UI_UX_SYSTEM_GUIDE.md` policy → `DESIGN.md` approved token/rule record → `design.pen` visual source → frontend token mirror).
- Kept `.impeccable/design.json` as the existing ignored local tooling sidecar and synchronized its accessible semantic metadata; the committed durable record is `DESIGN.md`.

### Validation
- Impeccable detector on all changed frontend targets: `[]` (0 findings).
- Contrast calculation for semantic normal-size text: minimum light-theme ratio **4.76:1**; dark-theme semantic text/status ratios remain **≥5.40:1**. Primary action contrast is **15.64:1**.
- Frontend TypeScript: `tsc --noEmit` ✅.
- Frontend lint: `eslint .` ✅.
- Frontend tests: Vitest **3 passed** ✅.
- Frontend production build: Next.js **15.5.22** build ✅; `/`, `/_not-found`, and `/api/health` generated successfully.
- Repository checks: `git diff --check` ✅; **154** internal Markdown links checked, **0 broken** ✅.

### Environment note
The Codex pnpm wrapper repeatedly attempted a non-interactive dependency reinstall after its bundled runtime changed. A single approved `pnpm install --frozen-lockfile --ignore-scripts --child-concurrency=1` restored the locked workspace from cache (402 packages reused, 0 downloaded); validation then ran through the same local package binaries. No dependency or lockfile changed.

### Unfinished / intentionally out of scope
- Theme-selection UI/persistence is not wired yet; the token contract and `.dark` override are ready for it.
- Runtime logo/app-icon exports and reusable Aperture React components have not been created yet.
- No auth, database table, RLS policy, or B2B/B2C/Admin workflow was implemented. This session is frontend design-system foundation, not product-feature implementation.

---

## Session — Approved Missing Variant Completion Pass
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Complete faithfully derivable missing device/theme variants in the live `design.pen` using copied canonical screens and locked reusable components only; replace ambiguous missing placeholders with validated screens or precise decision blockers.

### Completed
- Added 87 product-screen variants, increasing the live product-screen count from 120 to 207.
- Completed Sign In Tablet Dark and the OTP main flow across Desktop Light/Dark, Tablet Light/Dark, and Mobile Dark.
- Completed Mobile Dark registration, Desktop Dark Basic Profile, Mobile Light Consent, Mobile Dark Basic Profile, Desktop/Mobile Dark Account Type, Mobile Dark Consumer Onboarding, Desktop/Mobile Dark Professional Onboarding, Mobile Dark Business Onboarding, Mobile Dark Verification, and faithful Dark mirrors of existing Subscription screens.
- Added workspace-only traceability notes recording source, reused hierarchy/components, target, content changes, and unresolved items.
- Replaced every generic `MISSING —` placeholder: current count is 0. Forty-eight remaining gaps are explicitly labelled Partial, Blocked, Responsive Decision, Unresolved Product Requirement, or Not Required.
- Updated `00I — Current Design Status Report` with actual per-device/theme completion, partial, blocked, needs-review, and not-required status.

### Validation
- 207 product screens; 8 top-level groups; 0 top-level overlaps; 0 organizational sibling overlaps.
- Representative new screens visually compared with their sources after each family pass.
- Existing source screens and component masters were not modified.
- Newly copied screens retain canonical dimensions, token bindings, RTL behavior, hierarchy, and component instances.
- Known layout warnings reproduced from locked source screens are documented as inherited and were not repaired inside product UI.

### Backup
`UI-UX/design.BACKUP-BEFORE-MISSING-VARIANT-COMPLETION-20260801-143042.pen`

### Remaining decisions
- Consumer Experience and Business Operations require approved workflow behavior before screen production.
- Admin Tablet/Mobile needs an approved responsive shell; Admin Light is not required in current scope.
- Tablet onboarding/profile variants require responsive composition approval despite the general responsive specification.
- Several Desktop onboarding sequences remain partial; Subscription pricing/payment and omitted product-step scope remain unresolved.

---

## Session — Permanent Device/Theme Canvas Governance
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Reorganize the live private `UI-UX/design.pen` workspace into a permanent Product Surface → Flow → Device → Theme → Sequence hierarchy without changing any existing product-screen internals, document missing coverage explicitly, add a device/theme status matrix, and make the rule durable in project policy.

### Changes
- Reparented 120 existing product-screen frames intact into eight top-level areas: Authentication, Consumer, Professional/Talent, B2B/Business, Admin, Shared/System, Foundation/Components/Documentation, and Archive.
- Added explicit Desktop → Tablet → Mobile and Light → Dark lanes, with separate Main Flow, Supporting States, Error States, Responsive Test Variants, and Specifications/Annotations lanes.
- Kept 360px/430px responsive tests separate from canonical Mobile 390px.
- Added 56 workspace-only missing-coverage placeholders; no missing UI was fabricated.
- Added `00I — Current Design Status Report` with per-flow Desktop Light/Desktop Dark/Tablet Light/Tablet Dark/Mobile Light/Mobile Dark status.
- Added the permanent policy to root `PRODUCT.md` and mirrored the operational UI rule into `UI-UX/UI_UX_SYSTEM_GUIDE.md`.

### Validation
- Live tree: 8 top-level groups, 120 product-screen frames, 56 missing-coverage placeholders.
- Variant ancestry audit: 0 device/theme/responsive-lane mismatches.
- Canvas audit: 0 top-level overlaps and 0 organizational sibling overlaps.
- Product screen internals, dimensions, names, content, components, and styling were not edited; only complete frames were repositioned/reparented.
- Existing inherited product-screen layout warnings remain intentionally untouched because those screens are locked.

### Backup
`UI-UX/design.BACKUP-BEFORE-PERMANENT-VARIANT-ORGANIZATION-20260801-104124.pen`

### Unfinished / blocked
None for workspace organization. Missing variants remain explicit placeholders and require separately approved screen-design tasks.

---

## Session — Foundation Review, Hardening & Pre-Merge Validation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Independently verify the architecture foundation is correct, clean, executable, internally consistent, and merge-ready — review generated docs, run full local validation (frontend/backend/Supabase), security + repo-quality review, and confirm the canonical memory system. **No product feature.**

### Starting state
HEAD `18dc7f5`, 14 commits ahead of `main`, working tree carried one pre-existing generated diff (`frontend/next-env.d.ts`).

### Findings & fixes
- **3 stale SQLAlchemy references (genuine defect):** `docs/database/migration-strategy.md`, `docs/database/naming-conventions.md`, `docs/guides/backend-setup.md` still described SQLAlchemy as the current data-access mechanism — contradicting ADR-0005. **Fixed** to `supabase-py` + PostgreSQL RPC (RLS/JWT preserved).
- **gitignore gap:** no generic `logs/`, `*.log`, `*.transcript`. **Added.**
- **Generated file drift:** committed the Next-regenerated `next-env.d.ts` (typed-routes reference) so the tree is clean.
- **CI readiness:** added a documented recommended CI command sequence to `README.md`.
- **No other defects:** no duplicate headings/paragraphs, no truncation/garble, no broken links (152 checked, 0 broken), no competing lockfiles, empty files are only legitimate `__init__.py`/`.gitkeep`.

### Stale-term classification (section 11)
- `active profile` / `Use As` / `Profile Switcher`: all remaining hits are **valid current rules** (the "no profile switcher" rule) or **intentional historical** (verbatim founder brief `design-idea.md`, covered by a supersession note). No stale conflicts.
- `SQLAlchemy` / `Alembic`: after the 3 fixes, remaining hits are **ADR/deferred/historical** (ADR-0005 defining the decision, "deferred" statements, append-only log, the non-authoritative `agents/commands/db-migrate.md` marked superseded). No stale current-tense claims.
- `WCAG 2.1`: only **supersession/log records** ("2.1 → 2.2"); active target is **WCAG 2.2 AA**.
- `product-direction.md` / `agent-work-log.md`: only in **historical log + change-history** entries (the `git mv` records). Valid.

### Tests & validation (commands + results)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` ✅ (production build; `/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ · fail-fast (staging+missing secrets → `ValidationError`) ✅ · `/health` → `200 {"status":"ok","service":"backend","env":"local"}` ✅.
- Backend **Docker build BLOCKED** — `ghcr.io` TLS handshake timeout / `tls: bad record MAC` (reproduced 3× incl. `docker pull`). Dockerfile statically correct (non-root uid 10001, healthcheck, minimal COPY).
- Supabase: `--version` 2.110.0 ✅ · `config.toml` valid TOML ✅ · **full stack BLOCKED** — required images (Postgres 17 etc.) uncached and unpullable in this environment. Partial state cleaned via `supabase stop`.
- Extensions migration reviewed ✅ (pgcrypto/pg_trgm/vector/postgis into `extensions` schema); seed empty; **no `CREATE TABLE` anywhere** ✅.
- Security: no `.env`/secrets tracked ✅ · `.env.example` placeholders only ✅ · no service-role in `frontend/src` ✅ · browser client uses anon key only ✅ · `.pen` untracked + hashes unchanged ✅ · tracked-file secret scan clean ✅.

### Commits
- `7d3c280` docs: correct three stale SQLAlchemy data-access references to supabase-py
- `f6ad9d6` chore: harden ignore rules for logs/transcripts; sync generated next-env.d.ts
- `adbea03` docs: add recommended CI command sequence to README
- (this entry) docs: refresh runtime state and record foundation-review session

### Unfinished / blocked
- **Environment-only:** backend Docker image build and Supabase local stack (`start`/`db reset`/`db lint`) not executable here (registry unreachable). Run in CI / stable network. No code change required.
- Git remote + push — none configured (branch stays local; not pushed).
- CI/CD pipeline — commands documented; not wired.
- First product migration + RLS + isolation tests — the next authorized step (not started).

### Blockers
Container registry unreachable in this sandbox (`ghcr.io` TLS timeout; `public.ecr.aws` Supabase images uncached). Not a foundation defect.

### Rollback notes
All on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` untouched. Revert a slice with `git revert <sha>`. No `.pen` modified; no live DB touched.

### Next recommended action
Foundation is verified merge-ready (with the two registry-dependent checks to be run in CI). Await explicit direction to merge or to begin the implementation roadmap (identity & multi-tenancy → orgs/memberships/branches → RLS + isolation tests → 05C Sales).

---

## Session — Core Project-Memory Consolidation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish four canonical persistent project-memory files + a live runtime-state file, reconcile all documentation/ADRs with them, defer the unused SQLAlchemy dependency, and add session-hygiene rules — **without** implementing any product feature, editing any `.pen` file, merging, or pushing.

### Starting state
10 commits ahead of `main`, working tree clean, HEAD `6f63867`. Existing memory docs: `product-direction.md`, `agent-work-log.md`. Contradictions present: profile-switching model in 6 files; WCAG 2.1; hardcoded component count; SQLAlchemy listed as a dependency but unused.

### Files moved (history preserved via `git mv`)
- `docs/product/product-direction.md` → `docs/product/PRODUCT_DIRECTION_GUIDE.md`
- `docs/operations/agent-work-log.md` → `docs/operations/AGENT_WORK_LOG.md`

### Files created
- `docs/architecture/ARCHITECTURE_GUIDE.md` (core memory — current-state architecture)
- `UI-UX/UI_UX_SYSTEM_GUIDE.md` (core memory — design system moved out of `UI-UX/AGENTS.md`)
- `docs/operations/RUNTIME_STATE.md` (core memory — mutable live snapshot)
- `docs/README.md` (documentation index)
- `docs/decisions/ADR-0005-python-data-access.md`

### Files modified
- Rewritten: `docs/product/PRODUCT_DIRECTION_GUIDE.md` (metadata, dual roadmap, decision process, change history, account-model correction); `UI-UX/AGENTS.md` (slimmed to operational).
- Reconciled: root `AGENTS.md` (reading order + persistent-memory policy + dependency policy), `CLAUDE.md`, `README.md`, `docs/AGENTS.md` (layout + end-of-session checklist), `docs/architecture/system-context.md`, `docs/product/mvp-scope.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/decisions/ADR-0002` (cross-ref) and `ADR-0003` (reading order).
- Backend (SQLAlchemy defer): `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/database/__init__.py`, `backend/.env.example`.

### Decisions made
- **Account/navigation model corrected** from "active-profile switching" to canonical **one current primary account type / no Profile Switcher / derived navigation** across all product, architecture, and UI docs. This is a wording/consistency correction of the identity model, **not** a product-strategy change.
- **ADR-0005:** Python data access uses **`supabase-py`**; **SQLAlchemy deferred** (was an unused scaffold dependency), **Alembic** stays excluded, complex ops via **PostgreSQL RPC**, user-facing ops preserve the caller JWT so **RLS applies**, service-role limited to trusted workers.
- **Accessibility target** raised WCAG 2.1 AA → **WCAG 2.2 AA**; removed the hardcoded "~127 components" count (design.pen is the source of truth).
- **Reading order** now mandates the four core-memory files + `RUNTIME_STATE.md` before scoped AGENTS/ADRs.

### Tests & validation
- `uv sync --python 3.12` → `sqlalchemy` removed, `supabase` 2.31.0 added, `uv.lock` regenerated. ✅
- `uv run ruff check .` → All checks passed. ✅
- `uv run pytest` → 3 passed, 1 benign warning. ✅
- Residual `sqlalchemy` in source: only the intentional "deferred" note in `app/database/__init__.py`. ✅
- Documentation-link validation and `.pen` hash re-check: run at session end (see final report). 
- Frontend suite **not** re-run — no frontend source changed (Markdown docs only).

### Commits
- `cf1e0cc` docs: establish canonical project-memory files
- `d4a52dc` docs: reconcile product, architecture, and UI guidance with core memory
- `da6c69a` refactor: defer unused SQLAlchemy; adopt supabase-py for Python data access
- (this entry) docs: add runtime state and session hygiene

### Unfinished work
- Supabase local stack + `db reset` + RLS/organization-isolation tests (needs Docker) — still pending.
- Git remote + push — none configured (branch is local-only; not pushed per task).
- CI/CD pipeline — deferred.
- design.pen → Tailwind token bridge — deferred to first UI feature.

### Blockers
None for documentation/memory work. Docker required for the full Supabase RLS test pass.

### Known warnings (benign)
Frontend pnpm peer-dep warning (`unrs-resolver`/`@emnapi`); backend `StarletteDeprecationWarning` under pytest. No functional impact.

### Rollback notes
All changes are on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is untouched. Revert a slice with `git revert <sha>` (commits are focused: memory files / reconciliation / SQLAlchemy / runtime+hygiene). `git mv` renames are reversible via `git mv` back. No `.pen` file was modified. No live DB/migration was applied.

### Next recommended action
Await explicit authorization to begin the implementation roadmap: **architecture hardening → identity & multi-tenancy → organizations/memberships/branches/permissions → RLS + tenant-isolation tests → 05C B2B Sales**. Do not start product implementation autonomously.

---

## Session — Repository Architecture Foundation
**Date:** 2026-07-29 → 2026-07-30
**Agent:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish the repository architecture foundation only — audit the repo, consolidate agent instructions, build the AGENTS hierarchy + ADRs + docs, and scaffold the approved stack (Next.js + Supabase + specialized FastAPI) — **without** implementing product features, connecting production services, or touching any `.pen` file. Two follow-on requests were completed in the same session: the UI-UX design-system guidelines and the product-direction guide.

### Changes Made
- **Git:** initialized the repo (`git init -b main`), committed the as-found baseline, branched. 10 commits, WHAT/WHY messages. Working tree clean.
- **Ignore/config:** authored `.gitignore` (secrets, `.claude/`, `*.pen`, node/python/supabase artifacts), `.gitattributes` (`*.pen binary`, LF normalization), `.editorconfig`.
- **Agent instructions:** rewrote root `AGENTS.md` (filled empty Stack section, added reading-order + composition rules, migrated the git-discipline rule in); added scoped `AGENTS.md` for `frontend`, `backend`, `supabase`, `docs`, `data`, `UI-UX`; added `agents/README.md` marking `agents/` as non-authoritative source material; recorded the source→destination map in `docs/decisions/agent-instruction-migration.md`.
- **Docs/ADRs:** ADR-0001..0004; architecture (×6), security (×3), database (×2), operations (×2), product (mvp-scope + moved design-idea/client-brief); rewrote the 3 setup guides. Later added `product-direction.md`.
- **Frontend:** Next.js 15 App Router scaffold (strict TS, Tailwind, ESLint flat config, Zod env module, Supabase browser factory, EN/AR i18n constants, `/api/health`, domain-oriented `features/lib/server` structure, one vitest test).
- **Backend:** specialized FastAPI scaffold (`aladdin-backend`) — app factory, Pydantic-Settings config (fail-fast in staging/prod), `/health`, capability-module boundaries, Dockerfile (non-root + healthcheck), health/config tests; removed stale Alembic/Vite-referencing artifacts.
- **Supabase:** kept `config.toml` (`project_id=aladdin`); added extensions migration (pgcrypto/pg_trgm/vector/postgis), `seed.sql`, functions/tests conventions.
- **Cleanup:** rewrote root `README.md`, `data/README.md`, `assets/brand/README.md` (canonical-source vs runtime-export rule); corrected `CLAUDE.md` stack (React+Vite → Next.js).
- **UI-UX:** appended a 24-section Design System & UX guideline to `UI-UX/AGENTS.md` (token-driven; consultation-first, passwordless, RTL, light/dark, anti-patterns).
- **Product:** added `docs/product/product-direction.md` (vision, positioning, philosophy, priority rules, "agents must never" guardrails).

### Files Modified
124 files changed vs baseline (`git diff --stat main..HEAD` → +8439 / −62). By area:
- Root: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `agents/README.md` (+ existing personas/commands retained)
- `frontend/**` (~49 files: configs, `src/app`, `src/lib`, `src/features/*`, `.env.example`)
- `backend/**` (~26 files: `app/*`, `tests/*`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `.env.example`)
- `supabase/**` (migrations, seed, functions, tests, `AGENTS.md`)
- `docs/**` (~26 files: AGENTS, ADRs, architecture, security, database, operations, product, guides) — incl. this file
- `assets/brand/README.md`, `data/**`, `UI-UX/AGENTS.md`
- Moved (history preserved): `docs/architecture.md`→`architecture/overview.md`; `docs/design_idea.txt`→`product/design-idea.md`; `docs/client-brief.md`→`product/client-brief.md`

### Architectural Decisions
- **ADR-0001** Approved architecture: modular monolith — Next.js App Router (no Vite/SPA) + Supabase + specialized FastAPI + workers.
- **ADR-0002** Supabase SQL migrations are the only schema source of truth; no Alembic; no `create_all()` in staging/prod; SQLAlchemy read-side only.
- **ADR-0003** Agent-instruction hierarchy + mandatory reading order.
- **ADR-0004** Deployment: Vercel (web) · Railway (FastAPI/workers, Docker) · Supabase (data) · Sentry.

### Remaining Work
- Stand up the local Supabase Docker stack; run `supabase db reset` + first RLS/organization-isolation tests (pending — needs Docker image pull).
- Add a git **remote** and push (currently local-only).
- Build CI/CD pipeline (deferred).
- Extract `design.pen` design tokens into `frontend/src/styles` + Tailwind theme (token bridge).
- Optional: `docs/README.md` index; persist a `runtime-state.md`.
- **Next feature phase:** 05C — B2B Sales operating workflow (start with the first authenticated tenant table migration + its RLS + isolation tests).

### Risks / Warnings
- **Toolchain:** `uv` installed via pip (at `…/pythoncore-3.14-64/Scripts/uv`; add to PATH). System Python is **3.14**; backend deliberately uses a uv-managed **3.12** (`uv sync --python 3.12`) to avoid missing 3.14 wheels.
- **No remote/push** yet; if this becomes a public repo, verify ignore rules still hold before first push (`.claude/`, `.env*`, `*.pen` are covered).
- **`.pen` files are gitignored** — ensure they are versioned in **private** storage (they are not in git).
- Benign only: pnpm peer-dep warning (`unrs-resolver`/`@emnapi`), pytest `StarletteDeprecationWarning`. No functional bugs.

### Testing Status
- Frontend: `tsc --noEmit` ✅ · `eslint .` ✅ · `vitest run` ✅ (3 passed)
- Backend: `uv run pytest` ✅ (3 passed) · `uv run ruff check .` ✅
- Supabase: `supabase --version` ✅ (2.110.0) · `config.toml` valid TOML ✅ (full `db reset`/RLS tests pending Docker)
- Repo: internal markdown links ✅ (0 broken) · secret scan ✅ (clean) · `.pen` sha256 ✅ (all 5 identical to baseline; none tracked)

### Rollback Notes
- All foundation work is on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is the repo **as-found**.
- Revert everything: `git checkout main` (or delete the branch). Revert a slice: `git revert <sha>` — commits are logically grouped (baseline / AGENTS / docs+ADRs / frontend / supabase / backend / cleanup / UI-UX / product).
- No `.pen` file was modified, so there is nothing to restore there; backups remain on disk.
- Deleting the whole scaffold is safe (nothing external was connected; no migrations were applied to any live DB).

---

## 2026-08-09 — Sprint 10: Orders → Projects → Completion (branch `feature/mvp-orders-projects`)

Completed the B2B execution workflow: **accepted quotation → order → start → project → activate → complete → PROJECT COMPLETED** (no invoice/payment — out of scope). Built on the Sprint 9 commerce spine reusing the ADR-0008 trusted-write-path architecture unchanged.

- **DB** (`20260811090001_orders_projects.sql`): `orders` (immutable commercial snapshot of an accepted quotation, one per quotation), `order_items` (frozen lines, no write path), `projects` (one per order). Enums `order_status` (confirmed→in_progress→completed/cancelled), `project_status` (planned→active→completed). New caps `order.create`/`order.manage` (project.* pre-existed). 6 security-definer RPCs (actor from `auth.uid()`, capability + scope + version + in-txn audit). `order_list`/`project_list` invoker views. Actor model: requester creates order; supplier starts + runs the project; completing the project completes its order.
- **Proof**: pgTAP `24_orders_projects_test.sql` (30 assertions) — full journey, RPC-only boundary, duplicate-order/duplicate-project denied, cross-tenant denial, invalid-quotation→no-order, lifecycle gates, audit. Test 23 updated (accept still creates no order). Full suite **25 files / 579 tests pass**. `supabase db lint`: no Sprint 10 findings.
- **Frontend**: routes `/b2b/orders`, `/b2b/orders/[orderId]`, `/b2b/projects`, `/b2b/projects/[projectId]`; Orders+Projects in nav; `server/{queries,actions}/execution*.ts`, `mapExecutionError`; `features/execution/*` (badges, lists, order detail w/ snapshot table + timeline + inline create-project, project detail w/ activity trail + PROJECT COMPLETED). Accepted-quotation view now has a live **Create order / View order** handoff. Full EN/AR, responsive, no overflow.
- **Validation**: typecheck ✅ · lint ✅ (0 errors) · vitest ✅ (157, +`execution.test.ts`) · build ✅ · pgTAP ✅ · targeted E2E `orders-projects.spec.ts` (pages/nav/bilingual/overflow/not-found).
- Docs: `docs/frontend/sprint-10-orders-projects.md`. PR to `main`, not merged.
