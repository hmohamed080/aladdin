# Installer / Technician Pilot — Implementation Map

<!-- AUDIT + SEQUENCE. No production code or SQL has been written for this milestone. -->

| | |
|---|---|
| **Branch** | `feature/installer-pilot` (cut from `main` @ `7e45e28`) |
| **Persona** | `public.persona_type = 'installer_technician'` |
| **Reconciled** | 2026-08-31 |
| **Status** | **All product decisions CLOSED (D1–D10, O1–O7). Specification complete. No product blockers remain. Implementation NOT started.** |
| **Specification** | [`docs/database/installer-jobs.md`](../database/installer-jobs.md) — the canonical authority model every increment builds against |
| **Reference pack** | [`UI-UX/references/Installer-Technician/`](../../UI-UX/references/Installer-Technician/) (UI/IA reference only, never product authority) |

## Scope

Targeted to `installer_technician`. Supply-side, Sales, Notifications, Transactional Chat and Points
Core are **shipped, frozen contracts** that Installer surfaces fit inside rather than modify.

---

## 0. The three structural facts

Verified in schema, not inferred. Each is now resolved by an approved decision.

**0.1 — The commerce model is organization-to-organization by constraint, not convention.**

| Record | Party columns | Constraint |
|---|---|---|
| `public.rfqs` | `requester_org_id` + `supplier_org_id`, both **not null** | `ck_rfqs_distinct_orgs` |
| `public.orders` | requester org + supplier org | same shape |
| `public.projects` | `requester_org_id` + `executing_org_id`, both **not null**, **no assignee column** | `ck_projects_distinct_orgs`; RLS reads `app.is_org_member(executing_org_id)` |
| `public.conversations` | two org columns, **not null** | `ck_conversations_subject_type in ('rfq','quotation','order')` |

An installer is a personal persona who may hold **zero** organizations, so they cannot be a party to
any of it.

> **RESOLVED (D2).** A **new** personal-work domain: organization posts, individual
> `installer_technician` user applies. The commerce spine is untouched — no nullable party columns,
> no weakened RLS or distinct-party constraints, no shadow one-person organizations.

**0.2 — Jobs and work lifecycle were deferred post-MVP.**

> **RESOLVED (D1).** Pulled into the Pilot for `installer_technician`. Both authority documents and
> the Change History are reconciled. Still deferred: organization↔organization project execution,
> AI matching / match scoring, learning & training, payments/milestones/disputes.

**0.3 — There is no media/storage capability anywhere.** `avatar_media_id` / `logo_media_id` are bare
`uuid` placeholders; `verification_documents.storage_object_path` is a documented placeholder; no
bucket is declared and no code calls `.storage.from(...)`.

> **RESOLVED (D5) — storage first.** Portfolio and certificates require a **real** Media/Storage
> foundation, specified and implemented **before** any upload UI. No temporary public-URL fields, no
> fake media records. Jobs/applications/assignments do **not** depend on it and ship earlier.

---

## 1. Existing and reusable

| Area | What exists | Where |
|---|---|---|
| **Canonical taxonomy** | `persona_type` enum incl. `installer_technician` | `20260815090001` |
| **Registration / account-type selection** | Passwordless OTP; the account-type step already offers Installer/Technician | `/auth/sign-up`, `/onboarding/account-type` |
| **Persona onboarding engine** | Shared wizard + professional track; `installer_technician` is a **fixed** concrete type | `src/features/onboarding/professional-flow.tsx` |
| **Onboarding persistence** | `individual_onboarding` stores experience, specialization, services, availability band, service areas, remote flag, location, travel km | `20260808100000` |
| **Write paths** | `individual_save_professional` / `individual_submit_professional` (track-guarded, re-entrant) | same migration |
| **Verification model** | `verifications` + `request_account_upgrade` → `review_*` → `apply_account_upgrade`; approval is the **only** writer of `primary_account_type` and `public_profile_status='listed'` | `20260803090001` |
| **Activation ≠ verification** | Onboarding activates; an installer is never held in a review screen | `PRODUCT_DIRECTION_GUIDE.md` |
| **Personal home + shell** | `/home` is persona-aware and routes an installer to `ProfessionalHome`; personal chrome is deliberately not the B2B cockpit | `src/app/home/` |
| **Public directory projection** | `profile_public_directory` (invoker-hardened) | `20260816090001` |
| **Discovery *of* installers** | `/b2b/technicians` — trades-first directory | `src/app/b2b/technicians/page.tsx` |
| **Points contract** | `points_ledger`, `points_balance()`, `+100` on `referral.organization_approved` | `20260830090001/2` |
| **Points UI** | `/b2b/points` — balance + history, no tier/level/redeem | `src/app/b2b/points/page.tsx` |
| **i18n / RTL / theming** | Full ar/en catalogs, RTL, light+dark tokens, shared shell | `src/lib/i18n/`, `src/components/layout/` |

## 2. Existing but incomplete

| # | Area | Gap |
|---|---|---|
| 2.1 | **Profile editing** | The only editor is the onboarding wizard (`professional-home.tsx:120` links back to `/onboarding/professional`). `individual_save_professional` is re-entrant and can back a real editor **without new schema**. |
| 2.2 | **Skills / specialties** | Single `prof_specialization`; vocabulary lives in TypeScript. **Closed by D8** — see Increment 5. |
| 2.3 | **Service areas** | `prof_service_areas text[]` + travel km. No `localities` table, no geo → the reference's radius filter and km distances stay unbacked. |
| 2.4 | **Experience** | A single integer. No work history. |
| 2.5 | **Public profile** | No route exists; `ProfessionalDirectoryTable` rows link nowhere. |
| 2.6 | **Points reachability** | `/b2b/points` is the only Points UI, and `/b2b/layout.tsx:35` redirects org-less users to `/home`. **An org-less installer cannot reach their own Points today.** |
| 2.7 | **Home dashboard** | `ProfessionalHome` is one structure for all five professional personas — correct until this domain gives it real content. |
| 2.8 | **Personal navigation** | `src/lib/nav/modules.ts` is the **B2B org** nav only. No personal nav model exists. |
| 2.9 | **Settings** | No personal `/home/settings`. **Closed by D7** — a composition route, no new domain. |
| 2.10 | **Nav comment drift** | `modules.ts:105-108` still calls Points *"a UI shell in this sprint"* — stale since `b25e249`. Comment-only; **not touched by this documentation reconciliation.** |

## 3. Missing and required for Pilot

| # | Capability | State |
|---|---|---|
| 3.1–3.4 | Jobs · applications · assignments · progress | **Specified** (`installer-jobs.md` §3) — build |
| 3.5 | **Ratings & reviews** | **Specified in full** (§6): one review per completed assignment, poster-org authored, score 1–5, derived aggregates |
| 3.6–3.7 | Portfolio · certificates | Blocked on the storage foundation (D5) |
| 3.8 | **Media / file storage** | **Required prerequisite.** Needs its own spec, `docs/database/media-storage.md` |
| 3.9 | **Availability** | **Specified** (§8): two columns on `profiles`, user-controlled |
| 3.10 | Messaging for an org-less person | **Next milestone.** Installer surfaces ship with **no** messaging entry point |
| 3.11 | Installer↔business relationship | **Resolved:** derived from completed work (§13). Sales path hardened separately (§7) |
| 3.12–3.14 | Personal Points route · personal nav · public profile route | No decision needed |
| 3.15 | Notification events | `ck_notifications_event_type_known` is closed; **out of scope by instruction** |

## 4. Reference-only / NOT product-approved

| Reference element | Where | Status |
|---|---|---|
| **Points level / tier**, redeemable rewards / coupons, "+200 per friend", the +10/+50/+100 earning table, person→person referral | 01, 04, 06 | **Not approved.** Points are not money; `referral.organization_approved = +100` is the only earning rule and existing-organization linking earns 0. |
| **"96% match to your skills"** | 01, 02 | **Not approved.** No matching engine; AI match scoring stays deferred. Discovery is filter-based. |
| **Rating category dimensions, satisfaction %, quality/cleanliness/value scores, recommendation badges, rating trend chart** | 03, 04, 05 | **Not approved (D4).** Visual inspiration only. Approved: average · total · 1–5 distribution · reviews list. |
| **Organization / showroom star ratings** | 06 | **Not approved.** D4 covers rating an installer's work; no organization rating model exists. |
| **Individual reviewer names** | 05 | **Not approved** — the public projection names the posting *organization*, never the acting person (O6). |
| **Distance in km / radius filter / map** | 01, 02 | **Not approved.** No geo/locality data (2.3). |
| **Learning & training**, brand/manufacturer feed | 01, 02, 04 | **Not approved.** Explicitly deferred; advertising is a separate unbuilt area. |
| **Documents & files counters** | 03 | **Not before storage** (D5). |
| **"Export report"**, hotline number, help-centre articles | 03, 04, 05 | **Not approved.** `/auth/support` is the shipped entry. |
| **"Request materials" / "request date extension"** | 03 | **Not approved.** Person→org commerce actions the authority model does not support. |
| **Call / message buttons on network cards** | 06 | **Not approved.** Contact details are not in `organization_public_directory`; chat is org↔org. |
| **Notification & unread-message counts** | all | **Not approved.** Frozen modules with no installer events. |
| **Job budget in EGP** | 01, 02 | ✅ **NOW APPROVED (D9)** — as *offered compensation*, disclosure only. Never labelled paid/earned/due, and never aggregated into a balance. |

## 5. Product decisions — all closed 2026-08-31

| # | Decision | Outcome |
|---|---|---|
| **D1** | Jobs + work lifecycle in Pilot? | **Yes**, for `installer_technician`. Deferral superseded. |
| **D2** | Job authority model? | **Organization posts → individual user applies**, new domain. Commerce spine unchanged. |
| **D3** | Installer↔business relationship? | **Not a Sales membership.** Derived from completed work; grants nothing. |
| **D3-res** | Persona-gate the Sales affiliation flow? | **Yes** — minimal `create or replace` hardening, no redesign (§7). |
| **D4** | Ratings? | **One review per completed assignment**, poster-org authored, installer targeted, score 1–5, optional text, immutable, aggregates derived. |
| **D5** | Portfolio/certificates + storage? | **Storage first.** Real foundation before any upload UI. No temporary URL fields or fake media. |
| **D6** | Availability? | **Persisted user-controlled profile state.** Not presence, realtime, calendar or shifts. |
| **D7** | Personal settings? | **Composition of existing capabilities.** No new domain. Notification preferences deferred. |
| **D8** | Trade taxonomy? | **Database-backed and canonical.** Installers hold many specialties; a job has one required primary trade. |
| **D9** | Job compensation? | **Carried and displayed** — positive amount, explicit currency, EGP for the Pilot. Disclosure only. |
| **D10** | Who may post? | **Any active organization** with `job.post` (or `org.manage`). No `org_type` restriction. An installer personal account never becomes a poster. |

### Follow-up items O1–O7 — closed 2026-08-31

| # | Decision | Outcome |
|---|---|---|
| **O1** | Does posting require organization verification? | **Verification gates publishing, not drafting.** Any capable member drafts; publishing into discovery requires a **verified** org. Losing verification **suppresses** discovery + new applications while **preserving** existing applications and assignments — derived, never a stored transition. |
| **O2** | Review correction / dispute? | Reviews stay **immutable**; no reviewer edit, delete or correction. A **separate append-only moderation record** lets Platform Support suppress an abusive review **without altering the evidence**. Full dispute workflow deferred. |
| **O3** | Availability staleness? | **No automatic expiry.** User-controlled; the timestamp is persisted and displayable. No 7/14/30-day policy may be invented. |
| **O4** | Job expiry? | **No automatic expiry.** A manual **`closed`** state closes an unawarded job; terminal, accepts no applications, reposting needs a new job. `awarded → open` on assignment cancellation preserved. |
| **O5** | Trade mismatch? | An installer **may apply outside their declared specialties.** Trade is a discovery/profile **signal, never authorization** — no RLS policy and no write path may reference `user_trades`. |
| **O6** | Public reviewer identity? | The **posting organization**, never the acting member. `reviewer_user_id` is audit/authority only. |
| **O7** | Counter-offers? | **Out of the Pilot.** An application is submitted against the disclosed offer, and the compensation fields become **immutable once the first application exists**. Changing the offer means closing the job and creating a new one. |

**Confirmed:** the organization-side Jobs flow is **required** Pilot scope. The end-to-end flow is
recorded in [`installer-jobs.md` §1](../database/installer-jobs.md).

> **There are no remaining product blockers to the 14-increment sequence below.** Deferred,
> non-blocking work is listed in [`installer-jobs.md` → Deferred, non-blocking](../database/installer-jobs.md).

---

## 6. FINAL implementation sequence

Fourteen independently reviewable increments. Each is a separate PR with its own tests.
**Nothing after Increment 1 may start before its prerequisites are merged.**

Increments **1, 2 and 10** have no dependency on the Jobs domain and may run in parallel with
2→5 if capacity allows. Everything from 6 onward is strictly ordered.

---

### Increment 1 — Sales-affiliation persona hardening
*Security. Independent of everything else. First because it protects every later surface.*

| | |
|---|---|
| **Database** | One migration. `app.is_sales_persona(uuid)` helper. `create or replace` (forward-only, identical signatures) on `showroom_join_request_create`, `showroom_referral_save`, `showroom_referral_submit` to gate on it, plus a defence-in-depth check in `org_join_request_approve`. **No table, column, policy, index or enum change.** |
| **Backend** | None. |
| **Frontend** | None. |
| **Tests** | pgTAP: an `installer_technician` calling each gated RPC gets `42501`; a `sales` persona is unaffected; a **declared-but-not-yet-approved** salesperson (`prof_concrete_type = 'sales'`, canonical persona still null) is unaffected — the regression this helper exists to prevent; a pre-existing request from a non-sales persona cannot be approved into `sales.*`. |
| **Prerequisites** | None. |

### Increment 2 — Personal shell, nav and profile
*The foundation every Installer surface renders inside. No schema at all.*

| | |
|---|---|
| **Database** | **None.** |
| **Backend** | `src/lib/nav/personal-modules.ts` — a persona-derived personal nav model, sibling to `modules.ts`. Profile hub loader reusing `loadPersonalHome` inputs. Public-profile loader over `profile_public_directory`. |
| **Frontend** | `/home` rail; `/home/profile`; `/home/profile/edit` (over the re-entrant `individual_save_professional`); `/p/[profileId]`; wire `ProfessionalDirectoryTable` rows to it, closing the 2.5 dead-end. Reuse `features/home/parts.tsx`. ar/en, RTL, light/dark. |
| **Tests** | Vitest: personal nav derivation per persona; completeness. Playwright: register → Installer → onboarding → `/home` with **no** review-waiting screen; profile edit round-trips; public profile 404s while `public_profile_status='hidden'`; **the Sales affiliation path is never offered to an installer**. |
| **Prerequisites** | Increment 1 merged (so the negative assertion is meaningful). |

### Increment 3 — Personal Points accessibility
*A reachability fix for a shipped feature. Deliberately tiny and separately reviewable.*

| | |
|---|---|
| **Database** | **None.** The ledger, `points_balance()` and RLS are already correct and user-owned. |
| **Backend** | None — `src/server/queries/points.ts` already takes no user id. |
| **Frontend** | `/home/points`, reusing `features/points/*` **verbatim**. Nav entry. |
| **Tests** | Playwright: an org-less installer reaches their own Points and sees their own balance; `/b2b/*` still redirects them to `/home`; **no tier, level, streak, redeem or coupon** anywhere. |
| **Prerequisites** | Increment 2. |

### Increment 4 — Availability
*Small, self-contained profile state (D6).*

| | |
|---|---|
| **Database** | One migration: `profiles.available_for_work boolean not null default false`, `profiles.availability_updated_at timestamptz`; add both to the narrow `grant update` on `profiles`; add both to the `profile_public_directory` projection. |
| **Backend** | A `preferences`-style action to set it (direct table grant, no RPC needed). Directory query exposes it. |
| **Frontend** | Toggle on `/home/profile` and the Installer home; availability shown **with its age** on `/p/[profileId]` and `/b2b/technicians`. |
| **Tests** | pgTAP: a user updates only their own row; the column is in the public projection; no other column became updatable; **nothing but the user ever writes the flag — no trigger, job or query flips it** (O3). Playwright: toggling persists and surfaces on the public profile with its timestamp. |
| **Prerequisites** | Increment 2. |

### Increment 5 — Canonical trade taxonomy
*D8. Sequenced **before** the Jobs schema so `jobs.trade_id` is a real FK from its first migration.*

| | |
|---|---|
| **Database** | One migration: `public.trades` (`key` unique, `is_active`, `sort_order`; **no name columns** — i18n stays the single translation source) seeded as reference data with **no client write grant**; `public.user_trades (user_id, trade_id, is_primary)` with `ux_user_trades_one_primary`; RLS (own rows read/write, platform read); backfill from `individual_onboarding.prof_specialization`; add trades to `profile_public_directory`. `prof_specialization` retained but **demoted to transitional debt**. |
| **Backend** | `user_trades_set` RPC. Onboarding and profile queries read the table. `persona-fields.ts` keeps keys for **i18n and form rendering only**. |
| **Frontend** | Multi-select trades in `/home/profile/edit` and the onboarding professional step; trades on `/p/[profileId]` and `/b2b/technicians`. |
| **Tests** | pgTAP: many trades per user; **at most one primary**; a user cannot write another's trades; `trades` rejects a client insert; backfill preserved every existing specialization. Vitest: taxonomy resolution. Playwright: selecting multiple trades persists. |
| **Prerequisites** | Increment 2. |

### Increment 6 — Jobs database foundation
*The domain. Entities and write paths in one reviewable unit, or split entities/paths across two PRs.*

| | |
|---|---|
| **Database** | Enums `job_status` (**six states incl. `closed`**, O4), `job_application_status`, `job_assignment_status`. Tables `jobs` (incl. `trade_id` FK, `offered_amount`, `offered_currency`), `job_applications`, `job_assignments`, `job_progress_updates` (append-only via `forbid_mutation`). All constraints in `installer-jobs.md` §3, including `ux_job_assignments_active_job`. **Trigger `app.jobs_offer_immutable_after_application()`** (O7). RLS per §10.4. The hardened `open_job_opportunities` view, **joined to `organizations` on `is_verified`** (O1). Capabilities `job.post` / `job.manage`. Write paths per §10.5, **including `job_publish` (verification-gated) and `job_close`**. Audit events per §15. |
| **Backend** | `src/server/queries/jobs.ts`, `src/server/actions/jobs.ts` + form mapping, following the commerce query/action conventions. `NAV_CAPS` entries. |
| **Frontend** | **None.** Deliberately: this increment is provable entirely in pgTAP, and keeping UI out keeps the authority review clean. |
| **Tests** | pgTAP, all mandatory: the **persona gate** on `job_application_submit` (a non-installer is refused — the repo's first `primary_account_type`-derived write authority); **an installer whose trades do not match the job CAN still apply** (O5 — trade is never authority, and no policy references `user_trades`); an applicant cannot read a competing application; `site_address` absent from `open_job_opportunities`; **an assigned installer fails `app.is_org_member(poster_org_id)`**; two concurrent accepts → one wins, one rolls back; apply and accept are idempotent; only the poster org can `complete`; a cancelled assignment returns the job to `open` and permits re-award; **`closed` is terminal and refuses applications**; **an unverified org cannot `job_publish`**; **revoking verification removes the job from discovery and blocks new applications while accept/complete/review on existing work still succeed** (O1 — the test that proves suppression preserves); **changing `offered_amount` after the first application is rejected by the trigger** (O7); **`ck_points_ledger_event_type_known` and `ck_notifications_event_type_known` are unchanged** (the mechanical proof the frozen modules were not touched). |
| **Prerequisites** | Increment 5. **No open decisions.** |

### Increment 7 — Organization job posting UI
*Required scope. Sequenced before installer discovery so there are authentic jobs to discover.*

| | |
|---|---|
| **Database** | None. |
| **Backend** | Poster-side list/detail queries; create/publish/cancel actions. |
| **Frontend** | `/b2b/jobs` (list, create, publish, **close**), `/b2b/jobs/[jobId]` (detail, applicant list). Nav entry gated on `job.post` / `job.manage` / `org.manage`. An **unverified** organization sees its drafts and a clear explanation that publishing needs verification — never a locked-out workspace (O1). |
| **Tests** | Playwright: an org member with `job.post` creates and publishes a job; a member without it sees no nav entry and gets no route; the compensation field requires a **positive** amount and shows an explicit currency; **an unverified org can draft but not publish, and is told why**; **the compensation field is read-only once the first application exists** (O7); **closing an unawarded job is offered and is terminal — no reopen control exists** (O4). |
| **Prerequisites** | Increment 6. |

### Increment 8 — Installer discovery and application
| | |
|---|---|
| **Database** | None. |
| **Backend** | Discovery query over `open_job_opportunities` with trade / location / availability filters. `job_application_submit` / `withdraw` actions. |
| **Frontend** | `/home/jobs` (list + filters — the trade filter **defaults** to the caller's trades and is always clearable, O5), `/home/jobs/[jobId]` (detail + apply; a trade mismatch is **communicated, never blocking**), application tracking on `/home`. |
| **Tests** | Playwright: an installer discovers a published job, applies, sees it tracked, withdraws; a **second apply is idempotent, not an error**; a non-installer persona cannot apply; **an installer can clear the trade filter and successfully apply to a job outside their specialties** (O5); a `closed` job is absent from discovery. **Negative:** no match percentage, no km distance, no messaging entry point, and the amount reads as **offered**, never paid/earned. |
| **Prerequisites** | Increment 7. |

### Increment 9 — Assignment and My Work lifecycle
| | |
|---|---|
| **Database** | None. |
| **Backend** | Accept/reject actions (with sibling auto-rejection); start / progress / complete / cancel actions; assignment queries for both seats. |
| **Frontend** | Poster: applicant review, accept, progress monitoring, complete on `/b2b/jobs/[jobId]`. Installer: `/home/work`, `/home/work/[assignmentId]` with progress updates. |
| **Tests** | Playwright, **the full end-to-end flow of `installer-jobs.md` §1 in one spec**: create → publish → apply → accept → assignment → start → progress → poster completes. Plus: accepting one applicant auto-rejects the others; **the installer cannot mark work complete**; cancelling returns the job to `open`. |
| **Prerequisites** | Increment 8. |

### Increment 10 — Media/Storage foundation
*D5. Independent of Jobs — may run in parallel from Increment 2 onward.*

| | |
|---|---|
| **Database** | **Spec first:** `docs/database/media-storage.md` (private bucket, `public.media`, object-level RLS, upload/download paths, MIME + size limits, deletion story) — **approved before SQL.** Then the migration. |
| **Backend** | Signed upload/download paths. No public URLs. |
| **Frontend** | **None.** A foundation increment with no UI, deliberately. |
| **Tests** | pgTAP + integration: a user reads only their own objects; no anonymous read path; MIME and size limits hold; deletion removes the object and the row. |
| **Prerequisites** | Increment 2 (for a place to attach later). **No dependency on Jobs.** |

### Increment 11 — Portfolio and certificates
| | |
|---|---|
| **Database** | Portfolio entries and certificates, referencing `public.media`. **No `photo_url text`, no placeholder columns, no fake media rows.** |
| **Backend** | CRUD over the owner's own records. |
| **Frontend** | Portfolio + certificate sections on `/home/profile`, `/home/profile/edit` and `/p/[profileId]`. |
| **Tests** | pgTAP: owner-only writes; a media reference cannot point at another user's object. Playwright: upload → appears on the public profile. |
| **Prerequisites** | Increment 10 merged. **Hard gate — no upload UI before the foundation exists.** |

### Increment 12 — Reviews and ratings
| | |
|---|---|
| **Database** | `public.job_reviews` (immutable, `unique (assignment_id)`), `job_review_create` RPC, the derived `installer_rating_summary` view, **`public.job_review_moderations`** (append-only, platform-only) + `job_review_moderate` RPC (O2), audit events `job.review.created` / `.suppressed` / `.restored`. |
| **Backend** | Review creation action (poster seat); summary + list queries that **exclude suppressed reviews from every non-platform surface**; a thin platform moderation action for the existing `/admin` area. |
| **Frontend** | Review step on the poster's completed assignment; `/home/reviews`; rating summary + reviews list on `/p/[profileId]`, **attributed to the posting organization, never the acting member** (O6). Minimal suppress/restore control in `/admin`. |
| **Tests** | pgTAP: a review requires a **completed** assignment; a cancelled assignment is unrateable; a rejected application can never reach one; only the poster org may review; an installer cannot review themselves; **exactly one review per assignment**; a repeat call is idempotent; the review is immutable — **a reviewer cannot edit or delete it** (O2); **a suppressed review disappears from the summary, the public list and `/home/reviews`, while the row remains intact and platform-visible**; only platform staff may moderate. Playwright: **average, total and 1–5 distribution only** — no category scores, no satisfaction %, no trend chart, no badges; **no individual reviewer name is rendered**. |
| **Prerequisites** | Increment 9 (needs completed assignments). **No open decisions.** |

### Increment 13 — Showroom / business network
| | |
|---|---|
| **Database** | **None.** A derived view over `completed` assignments joined to `organization_public_directory`. |
| **Backend** | One query. |
| **Frontend** | `/home/network`. |
| **Tests** | Playwright: only organizations from **completed** work appear; an in-progress assignment does not; **no call/message buttons, no network points, no level ring, no organization rating**; and the page reaches no Sales affiliation RPC. |
| **Prerequisites** | Increment 9. |

### Increment 14 — Settings and the final Installer integration gate
| | |
|---|---|
| **Database** | **None.** |
| **Backend** | None beyond composition. |
| **Frontend** | `/home/settings` composing profile editing, availability, service areas, locale, appearance and existing account/security surfaces (D7). **No notification preferences.** |
| **Tests** | **The integration gate — one spec that walks the entire §1 flow end-to-end in both locales and both themes**, then asserts the full negative set in one place: no tier/level/redeem/coupon · no "+200 per friend" · no match percentage · no km distance · no category ratings or satisfaction percentages · no organization rating · **no individual reviewer name** (O6) · no messaging entry point · no monetary value labelled paid/earned/due · **no earnings or balance aggregate anywhere** · **no counter-offer or negotiation control** (O7) · **no job reopen control** (O4) · no Sales affiliation path reachable by an installer. Plus the frozen-contract pgTAP guard re-run. |
| **Prerequisites** | Increments 1–13. |

### Dependency summary

```
1 ──▶ 2 ──┬──▶ 3
          ├──▶ 4
          ├──▶ 5 ──▶ 6 ──▶ 7 ──▶ 8 ──▶ 9 ──┬──▶ 12 ──┐
          │                                 └──▶ 13 ──┤
          └──▶ 10 ──▶ 11 ────────────────────────────┴──▶ 14
```

---

## 7. Test conventions

pgTAP under `supabase/tests/` (new numbered file per migration); Playwright under `frontend/e2e/`;
Vitest beside the unit. **Known conditions:** pgTAP requires a clean `supabase db reset`; the default
locale is Arabic; `sales.spec.ts` has pre-existing failures unrelated to this work.

Two guards run in **every** increment that touches SQL:
`ck_points_ledger_event_type_known` still holds exactly `referral.organization_approved` +
`admin.adjustment`, and `ck_notifications_event_type_known` is unchanged.

## 8. Constraints honoured

Not modified, and not proposed for modification: `UI-UX/design.pen` · Notifications · Transactional
Chat · Points Core · the existing Sales affiliation **behaviour** (Increment 1 adds a persona gate
only, changing nothing for a real salesperson) · all supply-side behavior.

- **Points:** user-owned; no wallet or redeemable rewards; `referral.organization_approved = +100`;
  existing-organization referral linking = 0; **no other earning event, including no job event.**
- **Commerce:** `requester_org_id` / `supplier_org_id` / `executing_org_id` stay `NOT NULL`; the
  distinct-party `CHECK`s stay; commerce RLS untouched; no shadow one-person organizations.
- **Chat:** organization↔organization over a closed `subject_type`. The messaging expansion is the
  **next** milestone — which is why Installer surfaces ship with no messaging entry point.
- **Compensation:** disclosure only. No wallet, escrow, payment status, payout, settlement,
  commission or invoice processing, and no surface implies an offered amount has been paid.
