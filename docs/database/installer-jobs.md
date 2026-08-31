# Installer Jobs — Database Specification

**Status:** **Specification only** · reconciled 2026-08-31 · `feature/installer-pilot` · **no migration, table, type, RPC, policy, view, index, seed row or application code exists for this domain.**

**All Installer Pilot product decisions are closed (2026-08-31).**

| Decision | Outcome |
|---|---|
| **D1** | Jobs + complete work lifecycle **in Pilot** for `installer_technician`, superseding the post-MVP deferral. |
| **D2** | **Organization posts → individual `installer_technician` user applies**, as a **new domain**. Commerce spine unchanged. |
| **D3** | Installer↔Showroom network is **not** a Sales membership; it is **derived from completed work**. |
| **D3-residual** | `showroom_join_request_create` gets a **minimal persona gate** (§7). No redesign of Sales affiliation. |
| **D4** | **One review per completed assignment**, poster-org authored, installer targeted, score 1–5 (§6). |
| **D5** | **Storage first.** A real Media/Storage foundation precedes any Portfolio/Certificate upload UI. No temporary URL fields, no fake media rows. |
| **D6** | **Availability** is persisted, user-controlled profile state (§8). Not presence, not realtime, not a calendar. |
| **D7** | **Settings composes existing capabilities** (§9). No new settings domain. Notification preferences deferred. |
| **D8** | **Database-backed canonical trade taxonomy** (§4). Installers hold **many** specialties; a job has **one** required primary trade. |
| **D9** | **Jobs carry and display an offered compensation amount** — disclosure only, never payment (§5). |
| **D10** | **Any active organization** may post when the acting member holds `job.post` (§10.3). |

**The seven follow-up items O1–O7 are also closed (2026-08-31).**

| Item | Outcome |
|---|---|
| **O1** | **Verification gates *publishing*, not drafting.** A member with `job.post` may create and manage a draft; publishing into discovery requires the posting organization to be **verified**. Losing verification suppresses discovery and new applications while **preserving** existing ones (§10.3). |
| **O2** | Reviews stay **immutable** — no reviewer edit, delete or correction workflow. A **separate moderation/suppression record** lets Platform Support hide an abusive review from presentation **without altering the evidence** (§6.5). Full dispute workflow deferred. |
| **O3** | **No automatic availability expiry.** `available_for_work` is user-controlled; `availability_updated_at` is persisted and displayable. No 7/14/30-day policy may be invented (§8.3). |
| **O4** | **No automatic job expiry.** An explicit manual **`closed`** state lets a poster close an unawarded job; it is terminal and accepts no applications. Reposting requires a new job. `awarded → open` on assignment cancellation is preserved (§3.5). |
| **O5** | An installer **may apply outside their declared specialties.** Trade is a discovery/profile **signal, never an authorization boundary** — RLS and the write path must not use trade membership as application authority (§4.5). |
| **O6** | A public review identifies the **posting organization**, never the acting member. `reviewer_user_id` is retained internally for audit/authority only (§6.1, §11). |
| **O7** | **No counter-offers or negotiation.** An application is submitted against the job's disclosed offer, and `offered_amount`/`offered_currency` become **immutable once the first application exists** (§5.3). Changing the offer means closing the job and creating a new one. |

**There are no remaining product blockers to the 14-increment sequence.** Deferred, non-blocking
questions are listed under [Deferred, non-blocking](#deferred-non-blocking).

## Purpose

Authorize and constrain the Installer Jobs domain, so that
[`supabase/AGENTS.md`](../../supabase/AGENTS.md) (*no production tables without an approved
database specification*) is satisfied before any migration is written.

This document specifies the **authority model, lifecycle and boundaries** of person-level work.
It creates no table, no RPC, no policy, no route body and no seed data. Its success criterion is
the same one Points Core set: the following database increments must be implementable **without
inventing a single product rule**.

### What this domain is

A **job** is a unit of on-site work an **organization** publishes, with a stated **offered
compensation**, which an **individual `installer_technician`** may discover, apply to, be assigned,
execute, report progress on, and have confirmed as complete — after which it becomes the anchor for
exactly one review.

### What this domain is not

It is **not** a second commerce system. A job is not an RFQ, not a quotation, not an order and not
a project. It does not price goods, it does not carry line items, **it does not process, settle,
hold or record payment**, and it does not create a tenant relationship between two organizations. It
is also **not** a membership, an affiliation, or any route to a capability inside the posting
organization.

---

## 1. The end-to-end Pilot flow (confirmed)

The organization-side flow is **required Pilot scope**, not an extra: an Installer discovery
experience without a real, authoritative posting path is not shippable.

**Organization** — Create Job → Publish → Review applicants → Accept one applicant → Assignment →
Monitor work/progress → Complete assignment → Review installer.

**Installer** — Discover open jobs → Job details → Apply → Track application → Accepted assignment →
My Work → Progress updates → Completion confirmed by poster → Review appears on professional profile.

Every arrow above maps to exactly one state transition in §3.

---

## 2. Existing product authority

| Source | What it settles |
|---|---|
| [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) | *"A personal professional can exist with no organization at all."* This is why the applicant side **must** be a user. |
| [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) | **Activation ≠ verification.** Verification gates *trust and public discoverability*, never access. Governs §10.3. |
| `20260815090001_persona_organization_type_separation.sql` | `installer_technician` is a **personal persona**; a business classification in that column is impossible. |
| `20260810090001_catalog_rfq_quotation.sql`, `20260811090001_orders_projects.sql` | RFQ/order/project parties are **two organizations**, `not null`, with distinct-party `CHECK`s. **Unchanged.** |
| `20260823090001_chat_core.sql` | Conversations are org↔org over a **closed** `subject_type` allow-list. **Unchanged.** |
| `20260830090001_points_core.sql` | Points are user-owned, append-only, **derived** balance. **Unchanged**; no job event earns Points. |
| [`points-core.md`](points-core.md) | The pattern this spec follows, including *"a derived value is never a writable column"* — applied to rating aggregates in §6.4. |

---

## 3. Core model — jobs, applications, assignments, progress

### 3.0 The decision this document was asked to settle

> *Does an accepted application own the complete work lifecycle, or is a separate
> assignment/engagement record needed?*

**Settled: a separate `job_assignments` record.** Four independent reasons:

1. **Different transition owners.** An application is the *applicant's* candidacy and they may
   withdraw it. An assignment is a bilateral engagement whose completion is the *posting
   organization's* decision. Fusing them yields one status column with two authorities — the shape
   that makes an RLS policy unreadable and a write path unprovable.
2. **Auditability.** An application must remain durable evidence of *who applied, when, on what
   terms*. If it mutates through `scheduled → in_progress → completed`, the application-as-submitted
   is overwritten. The repository already treats mutable attribution as a defect: referral
   provenance is write-once because *"a reward paid on a mutable field is a reward paid to whoever
   wrote last."*
3. **The rating anchor.** D4 requires *one review per completed assignment* and *rejected
   applications are never rateable*. Referencing `job_assignments` makes every row in the FK target
   a real engagement **by construction**, instead of enforcing it with a trigger.
4. **Cardinality.** A cancelled assignment must be re-assignable without corrupting the first
   applicant's history.

**Rejected:** status columns on `job_applications` alone. Cheaper by one table; loses (2) and (3)
permanently, and (3) is now a hard Pilot requirement.

### 3.1 `public.jobs` — the opening

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `poster_org_id` | `uuid` **not null** → `organizations` | The **only** organization party. There is no second org. |
| `poster_branch_id` | `uuid` | Optional; composite FK `(poster_org_id, poster_branch_id)` → `branches`, mirroring `fk_rfqs_requester_branch`. |
| `title` | `text` **not null** | 2–200 chars. |
| `description` | `text` | ≤ 2000 chars. |
| **`trade_id`** | `uuid` **not null** → `public.trades` | **The single required primary trade (D8).** A foreign key, never free text — see §4.3. |
| **`offered_amount`** | `numeric(12,2)` **not null** | `> 0`. The organization's **offered compensation** for the work (D9) — see §5. **Immutable once the first application exists (O7, §5.3).** |
| **`offered_currency`** | `text` **not null** default `'EGP'` | `check (offered_currency = 'EGP')` for the Pilot. Explicit, never implied. **Immutable once the first application exists.** |
| `governorate` / `city` | `text` | **General** location only, ≤ 80 chars — the rule `individual_onboarding` already applies. |
| `site_address` | `text` | ≤ 300 chars. **Never exposed before assignment** — §11. |
| `expected_duration_days` | `smallint` | 0–365, optional. |
| `starts_on` / `ends_by` | `date` | Optional; `ends_by >= starts_on`. |
| `status` | `public.job_status` **not null** | Default `draft`. |
| `version` | `integer` **not null** | Optimistic concurrency, mirroring `rfqs.version` / `projects.version`. |
| `published_at`, `closed_at` | `timestamptz` | |
| `created_by` | `uuid` **not null** → `users` | `on delete restrict`. |
| `created_at`, `updated_at` | `timestamptz` **not null** | |

**Forbidden columns, permanently:** `payment_status`, `paid_at`, `payout_*`, `settlement_*`,
`escrow_*`, `commission_*`, `invoice_*`, `wallet_*`, or any balance. See §5.

### 3.2 `public.job_applications` — the candidacy

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `job_id` | `uuid` **not null** → `jobs` `on delete cascade` | |
| `applicant_user_id` | `uuid` **not null** → `users` `on delete cascade` | **A user, never an organization.** This column is the point of the domain. |
| `note` | `text` | ≤ 1000 chars, applicant-authored. **No counter-offer field** — see §5.3. |
| `status` | `public.job_application_status` **not null** | Default `submitted`. |
| `decided_by` | `uuid` → `users` | Poster-side actor. Null until decided. |
| `decided_at` | `timestamptz` | |
| `decision_reason` | `text` | ≤ 500 chars; **required on `rejected`**, mirroring `ck_ref_reject_reason`. |
| `created_at`, `updated_at` | `timestamptz` **not null** | |

**Constraints** — `uq_job_applications_job_applicant unique (job_id, applicant_user_id)` (the
idempotency identity, §12.1) · `ck_job_app_decision_stamp` · `ck_job_app_reject_reason`.

### 3.3 `public.job_assignments` — the engagement

Created **only** by accepting an application, in the same transaction.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `job_id` | `uuid` **not null** → `jobs` `on delete cascade` | |
| `application_id` | `uuid` **not null** → `job_applications` `on delete restrict` | Provenance. `restrict`, so deleting a candidacy can never orphan work. |
| `installer_user_id` | `uuid` **not null** → `users` | Denormalized from the application so every policy is a flat column check — the `conversations` two-party precedent. |
| `poster_org_id` | `uuid` **not null** → `organizations` | Denormalized from the job, same rationale. |
| `status` | `public.job_assignment_status` **not null** | Default `scheduled`. |
| `latest_progress_percent` | `smallint` **not null** default 0 | 0–100. Maintained by the progress write path in the same transaction — the `conversations.last_message_at` precedent. Never client-written. |
| `last_progress_at` | `timestamptz` | Same. |
| `version` | `integer` **not null** | |
| `started_at`, `completed_at`, `cancelled_at` | `timestamptz` | |
| `cancellation_reason` | `text` | ≤ 500 chars, required on `cancelled`. |
| `created_at`, `updated_at` | `timestamptz` **not null** | |

**Constraints**
- `uq_job_assignments_application unique (application_id)` — one engagement per accepted candidacy.
- **`ux_job_assignments_active_job unique (job_id) where status <> 'cancelled'`** — at most one live
  assignment per job. This makes re-assignment after cancellation safe *and* double-award impossible.
- `ck_job_assignment_progress_range` (0–100) · `ck_job_assignment_cancel_reason`.

### 3.4 `public.job_progress_updates` — the installer's channel

Append-only, mirroring `audit_log` and `points_ledger` (`app.forbid_mutation()`; no client
`UPDATE`/`DELETE` grant).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `assignment_id` | `uuid` **not null** → `job_assignments` `on delete cascade` | |
| `author_user_id` | `uuid` **not null** → `users` | |
| `progress_percent` | `smallint` **not null** | 0–100. |
| `stage` | `text` | ≤ 80 chars, optional label. |
| `note` | `text` | ≤ 1000 chars. |
| `created_at` | `timestamptz` **not null** | |

**No media column, and none may be added before the storage foundation exists (D5).** A
`photo_url text` here would be exactly the "temporary public URL field" D5 forbids. Job-progress
photos are an additive increment **after** `media-storage.md` lands.

### 3.5 Lifecycle states

Three enums, each owned by exactly one party.

#### `public.job_status` — owned by the posting organization

Six states. **There is no automatic expiry (O4)** — a job leaves `open` only because a human moved it.

```
draft ──publish──▶ open ──accept application──▶ awarded ──assignment completed──▶ completed
  │                 │  │                          │
  │                 │  └──close (manual)──▶ closed └──assignment cancelled──▶ open
  └──▶ cancelled    └──▶ cancelled
```

| From | To | Actor |
|---|---|---|
| `draft` | `open` | poster org (`job.post`) — **requires a verified organization** (§10.3) |
| `draft` / `open` | `cancelled` | poster org |
| `open` | **`closed`** | poster org — **manual close of an unawarded job (O4)** |
| `open` | `awarded` | **side effect of accepting an application** — never set directly |
| `awarded` | `completed` | **side effect of the assignment completing** — never set directly |
| `awarded` | `open` | **side effect of the assignment being cancelled**; the opening returns to the pool |
| `awarded` | `cancelled` | poster org, cancelling the whole opening (also cancels the live assignment) |

`awarded → open` is why `ux_job_assignments_active_job` excludes cancelled rows. **This behaviour is
preserved unchanged by O4** — a re-awardable job returns to `open`, never to `closed`.

**`closed` vs `cancelled`** — both terminal, deliberately distinct:

- **`closed`** — the poster stopped recruiting for an **unawarded** job. Nothing was promised to
  anyone. Reachable only from `open`. **Reposting requires a new job**; there is no reopen path,
  because a reopened job with a stale offer and stale applications is exactly the ambiguity O7 closes.
- **`cancelled`** — the opening is called off, possibly with a live assignment that is cancelled with it.

A `closed` job **accepts no applications** and does not appear in discovery. Applications already
submitted against it are preserved and readable by both parties — closing recruits nobody new; it
does not erase who applied.

#### `public.job_application_status`

```
submitted ──withdraw (applicant)──▶ withdrawn
    ├──accept (poster)──▶ accepted   ── creates the assignment
    └──reject (poster)──▶ rejected
```

**Accepting one application auto-rejects every sibling still `submitted`** on that job, in the same
transaction, with a system `decision_reason`. Leaving losing candidacies open would show an
installer a live application against an already-awarded job — a lie the model can prevent
structurally.

All three decided states are **terminal**. There is no un-accept; a mistake is corrected by
cancelling the assignment, which returns the job to `open` for a fresh round.

#### `public.job_assignment_status`

```
scheduled ──start (installer)──▶ in_progress ──confirm (poster org)──▶ completed
    └──────────── cancel ────────────┴──▶ cancelled
```

**Completion authority is the posting organization, never the installer.** This is the single most
important rule here: a rating anchored to work the rated party declared complete about themselves is
not evidence. The installer signals readiness with a `job_progress_updates` row at 100% — a *claim*
the poster then confirms. Either party may **cancel**, with a reason.

`completed` and `cancelled` are terminal.

---

## 4. Canonical trade taxonomy (D8)

### 4.1 The rule

> The trade vocabulary is **database-backed and canonical**. Onboarding, the professional profile,
> jobs and discovery all resolve against the **same** table. TypeScript is never the long-term
> authority, and **free text is never authorization or filter identity.**

### 4.2 `public.trades` — the reference table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | The FK target. |
| `key` | `text` **not null unique** | Stable machine identifier (`kitchens_doors`, `plumbing`, …). ≤ 64 chars, lower snake case. |
| `is_active` | `boolean` **not null** default `true` | Retire a trade without deleting history. |
| `sort_order` | `smallint` **not null** default 0 | Deterministic presentation order. |
| `created_at`, `updated_at` | `timestamptz` **not null** | |

**Display names are NOT columns.** They live in the existing i18n message catalogs keyed by `key`,
exactly as the shipped code already does (`t(\`onboarding.professional.specializations.${key}\`)`).
Putting `name_en`/`name_ar` here would create a **second translation source of truth** competing with
`src/lib/i18n/messages/{en,ar}.ts`, and the repository's rule is one canonical source per fact.
Seeding is reference data, not user content: rows are inserted by migration, and the table carries
**no client write grant at all**.

Reads are open to `authenticated` (it is a public vocabulary; there is nothing to isolate).

### 4.3 `public.user_trades` — the minimum user↔specialty relation

The minimum relation the spec requires, and no more.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` **not null** → `users` `on delete cascade` | |
| `trade_id` | `uuid` **not null** → `trades` `on delete restrict` | |
| `is_primary` | `boolean` **not null** default `false` | |
| `created_at` | `timestamptz` **not null** | |

- Primary key `(user_id, trade_id)` — **an installer may hold many specialties (D8)**.
- `ux_user_trades_one_primary unique (user_id) where is_primary` — at most one primary per person.
- RLS: a user reads and writes **their own** rows (`user_id = auth.uid()`); platform staff read all.
  The public projection (§4.6) is what exposes another person's trades.

### 4.4 A job holds exactly one trade

`jobs.trade_id` is `not null` and singular — **one required primary trade per job (D8)**. Multi-trade
jobs are not modelled; a job needing two trades is two jobs. Discovery matches
`jobs.trade_id ∈ (the caller's user_trades)`.

### 4.5 Trade is a signal, never an authorization boundary (O5)

> **An installer MAY apply to a job outside their declared specialties.** The UI may communicate the
> mismatch; it must **not** prevent submission.

Three binding consequences:

1. **`job_application_submit` performs no trade check.** Adding one would convert a profile signal
   into an access rule.
2. **No RLS policy may reference `user_trades`.** Trade membership is never an application authority
   input, and `open_job_opportunities` is not filtered by the caller's trades — filtering is applied
   by the *query*, at the caller's discretion.
3. **Discovery may default the trade filter to the caller's declared trades, but must always let them
   clear it.** A default is a convenience; a locked filter is a gate wearing a filter's clothes.

This is what keeps §4.1's taxonomy useful without letting it quietly become permission logic — a
tiler who has done gypsum work before is the platform's problem to inform, not to forbid.

### 4.6 Migration path from the current vocabulary

- Seed `trades` from `SPECIALIZATIONS.installer_technician` plus the trades the references imply, as
  approved reference data.
- Backfill `user_trades` from `individual_onboarding.prof_specialization` (one row, `is_primary`).
- `individual_onboarding.prof_specialization` is retained as **transitional debt** and **stops being
  authority** the moment `user_trades` exists. Its removal is a later mechanical migration, recorded
  now so it is not forgotten.
- `src/lib/onboarding/persona-fields.ts` keeps the keys **for i18n and form rendering only**; every
  authorization, filter and join reads the table.

---

## 5. Compensation disclosure (D9)

### 5.1 What the columns mean

`offered_amount` + `offered_currency` are **the organization's offered compensation for the work**.
Disclosure, and nothing else.

- **Positive.** `check (offered_amount > 0)`. There is no zero-value or "negotiable" job in the Pilot.
- **Explicit currency, never implied.** `offered_currency` is `not null`; the Pilot constraint pins
  it to `'EGP'`, so adding a second currency is a deliberate migration.
- **`numeric(12,2)`, not `integer`.** The contrast with `points_ledger.points_delta` — deliberately an
  integer *because Points are not currency* — is meaningful and should be preserved in both directions.

### 5.2 What it is not

**Never introduced:** wallet · escrow · payment status · payout · settlement · commission ·
invoice/payment processing · earnings balance · transaction history.

### 5.3 No counter-offers, and the offer freezes on first contact (O7)

> **Counter-offers and negotiation are out of the Pilot.** An application is submitted **against the
> job's disclosed `offered_amount` / `offered_currency`**, and those two columns become **immutable
> the moment the first application exists**.

**Enforcement, belt and braces:**

- **Structural** — a trigger `app.jobs_offer_immutable_after_application()` raises when
  `offered_amount` or `offered_currency` changes and any `job_applications` row exists for that job.
  This is the `app.organizations_provenance_immutable()` precedent, and it is the authority: a write
  path that forgets the rule still cannot break it.
- **Ergonomic** — `job_update` checks the same condition first, so the poster gets a clear error
  instead of a trigger exception.

**Changing the offer means closing the job (O4) and creating a new one.** That is not a workaround;
it is the point. An applicant applied to a stated number, and silently moving it afterwards would
make every application a bid on something that no longer exists.

**Never created:** counter-offer state · negotiated amount · bid/ask fields · payment · wallet ·
settlement. `job_applications.note` carries free text only and is never parsed as an amount.

### 5.4 The UI rule this creates

> **The amount is always presented as *offered*, never as paid, earned, received, due or owed, and
> it is never aggregated into a balance or an earnings total anywhere in the product.**

An installer surface summing completed jobs into "total earned" would assert a payment the platform
never made and cannot evidence. This rule is testable and is a required negative assertion (§14).

---

## 6. Ratings and reviews (D4)

### 6.1 `public.job_reviews`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `assignment_id` | `uuid` **not null unique** → `job_assignments` `on delete restrict` | **Exactly one review per completed assignment.** The `unique` is the whole contract. |
| `reviewee_user_id` | `uuid` **not null** → `users` | **The assigned installer.** Denormalized from the assignment. |
| `reviewer_org_id` | `uuid` **not null** → `organizations` | The posting organization — the source of reviewer authority. |
| `reviewer_user_id` | `uuid` **not null** → `users` | The acting member, for audit. **Not publicly exposed** (§11). |
| `score` | `smallint` **not null** | `check (score between 1 and 5)`. |
| `body` | `text` | Optional, ≤ 1000 chars. |
| `created_at` | `timestamptz` **not null** | |

**Immutable**, via `app.forbid_mutation()` — the `audit_log` / `points_ledger` pattern. No client
`INSERT`/`UPDATE`/`DELETE` grant; creation only through the RPC below.

**A reviewer can never edit or delete their review (O2).** There is no reviewer correction workflow
in the Pilot. Abuse is handled by suppression, not mutation — §6.5.

`reviewer_user_id` exists **for audit and authority only** and appears in no public projection (O6).

### 6.2 The single write path

`public.job_review_create(p_assignment_id uuid, p_score smallint, p_body text)` — `security definer`,
`set search_path = ''`. Every one of these is enforced, and each maps to an approved rule:

| Check | D4 rule |
|---|---|
| assignment `status = 'completed'` | *review can only be created after the assignment is completed* |
| assignment is not `cancelled` | *cancelled assignments are never rateable* |
| the anchor is an **assignment**, so no rejected/withdrawn application can reach it | *rejected applications are never rateable* |
| caller holds `job.manage` or `org.manage` in `assignment.poster_org_id` | *reviewer authority derives from the posting organization* |
| `reviewee_user_id = assignment.installer_user_id` | *review target = assigned installer user* |
| `reviewer_user_id <> reviewee_user_id` | *installer cannot review themselves* (belt-and-braces; the capability check already precludes it, but a defect that grants an installer a poster capability must not also grant self-review) |
| `unique (assignment_id)` | *exactly one review per completed assignment* |

Idempotency: a second call on the same assignment returns the **existing** review id unchanged,
following `showroom_referral_approve`.

### 6.3 History is tied to the assignment

`assignment_id` is `on delete restrict` and `reviewee_user_id` is denormalized, so a review survives
every membership, employer and organization change on the poster side — the same durability rule
Points Core applies to a person's earned history.

### 6.4 Aggregates are DERIVED, never stored

Per the Points Core precedent (*"balance is derived, never a writable column"*), there is **no**
`profiles.average_rating` and **no** `review_count` column. A hardened `security_invoker` view —
`public.installer_rating_summary` — computes, per installer:

- `average_score` · `review_count` · `count_1` … `count_5` (the 1–5 distribution).

Approved for the UI: **average rating · total reviews · 1–5 star distribution · reviews list.**

### 6.5 Moderation and suppression (O2)

The Pilot needs a way to stop an abusive review from being *shown* without pretending it never
existed. That is a **separate record**, never a mutation of the review.

**`public.job_review_moderations`** — append-only, platform-only.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `review_id` | `uuid` **not null** → `job_reviews` `on delete restrict` | `restrict` — evidence outlives moderation. |
| `action` | `text` **not null** | `check (action in ('suppress','restore'))`. |
| `reason_code` | `text` **not null** | Bounded vocabulary, mirroring `ck_points_ledger_reason_code_known`. |
| `note` | `text` | ≤ 500 chars, internal. |
| `moderated_by` | `uuid` **not null** → `users` | The platform actor. Always attributable. |
| `created_at` | `timestamptz` **not null** | |

**Design rules, each deliberate:**

- **Append-only, latest-action-wins.** A restore is a *new row*, never an update or delete — the same
  reasoning Points Core uses for compensating entries: *"a correction that overwrites its own history
  is not a correction."* The moderation trail is itself evidence.
- **The review is never altered.** `job_reviews` keeps `forbid_mutation`; no column on it changes, and
  nothing is deleted. Suppression is **derived** by joining the latest moderation action.
- **Platform authority only.** Writes require `app.is_platform('support')`, the same gate
  `showroom_referral_approve` uses. Neither party to the work can suppress a review.
- **Suppressed means hidden from every non-platform surface** — excluded from
  `installer_rating_summary` (so it affects neither the average nor the count), from the public
  reviews list, and from the installer's own `/home/reviews`. A review judged abusive should not keep
  being shown to the person it targets either.
- Audit event `job.review.suppressed` / `job.review.restored`.

**Deferred:** a full dispute workflow — reviewee-initiated challenge, reviewer response, adjudication
state. Not in the Pilot, and this record is shaped so adding one later needs no change to
`job_reviews`.

### 6.6 Explicitly NOT approved

Category / sub-rating dimensions · satisfaction percentages · quality / cleanliness / value
percentage scores · synthetic recommendation badges · rating trend charts · any other fabricated
analytic. These reference elements remain **visual inspiration only** and must not be rendered.

There is also **no organization rating model**. D4 covers rating an installer's work; showroom star
ratings (reference 06) remain unapproved.

---

## 7. Sales-affiliation hardening (D3-residual)

### 7.1 The defect

`public.showroom_join_request_create` (`20260815090002_showroom_affiliation.sql`) gates on
`app.require_verified_caller()` and on the target being `org_type = 'showroom_dealer'` — **but not on
the caller's persona.** Approval calls `app.membership_grant_sales`, which grants `sales.*`. So an
`installer_technician` can request showroom affiliation today and, if an Owner/Manager approves,
receive Sales authority.

### 7.2 The minimal increment

**Forward-only, no redesign.** One new helper plus `create or replace` on the existing functions —
the exact shape `20260830090002_referral_points_wiring.sql` used. **No table, column, policy, index
or enum changes; no behavioural change for an actual salesperson.**

**`app.is_sales_persona(p_user uuid) returns boolean`** — true when either:
- `users.primary_account_type = 'sales'` (the canonical persona), **or**
- `individual_onboarding.prof_concrete_type = 'sales'` (the **declared** persona).

The second branch is required, not generous. The canonical persona is written only by the
approved-and-applied upgrade workflow, so between submission and approval it is still null — and the
shipped `personal-home.ts` already resolves the account this exact way (*"the declared type is what
the account actually is"*). Gating on the canonical value alone would break real salespeople mid-review.

**Gated on `app.is_sales_persona(auth.uid())`:** `showroom_join_request_create` ·
`showroom_referral_save` · `showroom_referral_submit`.

**Also gated, as defence in depth:** `org_join_request_approve` refuses to grant a sales membership
when the requester is not a sales persona — because a request created before this increment could
otherwise still be approved into `sales.*`.

Refusals raise `42501`, consistent with every other authority failure in the schema.

### 7.3 The Installer side stays separate

The Installer's business network is **derived** (§13) and creates **no** organization membership and
**no** sales capabilities. No Installer route, action, query, nav entry or component may reference
`showroom_join_request_create`, `showroom_referral_*`, or `my_showroom_affiliations`; the existing
`persona === "sales"` gate in `/home/layout.tsx` stays; and a Playwright negative assertion proves it.

---

## 8. Availability (D6)

### 8.1 The model

Persisted, user-controlled profile state. **Two columns on `public.profiles`:**

| Column | Type | Notes |
|---|---|---|
| `available_for_work` | `boolean` **not null** default `false` | Self-declared. |
| `availability_updated_at` | `timestamptz` | Stamped on every change. |

Added to the existing narrow `grant update` on `profiles` (alongside `display_name`, `headline`,
`bio`, `languages`, …) so the user controls it directly — no RPC needed.

**Rejected alternative:** a separate `professional_availability` table. A boolean and a timestamp do
not earn a table, a policy set and a join on every profile read.

### 8.2 What it is not

Not online presence · not Realtime presence · not calendar scheduling · not shift management. There
is no heartbeat, no session hook, and nothing writes it except the person.

### 8.3 No automatic expiry (O3)

> **There is no availability expiry or staleness cutoff in the Pilot.** `available_for_work` changes
> only when the person changes it. **No 7-, 14- or 30-day expiration policy may be invented**, and no
> job, cron, trigger or query may silently flip the flag to false.

`availability_updated_at` is still persisted and **displayable** — the UI may show *when* the state
was last set, so a reader can weigh it themselves. Showing the age is information; expiring the flag
would be the platform asserting something the person never said.

This is the same distinction the product applies to verification: surface the signal, let the human
judge, do not manufacture state.

### 8.4 Reach

`available_for_work` and `availability_updated_at` are added to the `profile_public_directory`
projection, so a poster browsing `/b2b/technicians` sees the same state the installer set. Discovery
filtering by availability is enabled by this and specified when a filter is built.

---

## 9. Settings (D7)

**No new settings domain, no new schema.** `/home/settings` is a **composition route** over
capabilities that already exist or land elsewhere in this Pilot:

| Section | Backed by |
|---|---|
| Personal / professional profile editing | `individual_save_professional` (shipped) + the profile hub |
| Availability | §8 (`profiles` column, direct grant) |
| Service areas | `individual_onboarding.prof_service_areas` (shipped) |
| Locale | `src/server/actions/preferences.ts` (shipped) |
| Appearance | shipped theme layer |
| Account / security | existing auth surfaces (`/auth/*`) |

**Notification preferences are out of scope** until separately specified — there is no preference
model, and Notifications are a frozen module this milestone does not touch.

---

## 10. Authority, capabilities and RLS

### 10.1 The rule this model protects

> **A job never creates a relationship inside the posting organization.** An installer who applies
> to, is assigned, executes and completes a job gains **no membership, no capability, no branch
> scope and no workspace** in that organization — before, during or after the work.

### 10.2 Capabilities

| Capability | Grants |
|---|---|
| `job.post` | Create, edit, publish and cancel this organization's jobs. |
| `job.manage` | Decide applications, confirm/cancel assignments, and create the review. |

`org.manage` remains the **blanket in-org unlock**, checked as an OR on every trusted write path,
exactly as every existing commerce and sales RPC treats it. `NAV_CAPS` mirrors the set so no module
dead-ends.

**No capability is ever granted to the installer side.** The installer's authority is their own
`auth.uid()` and nothing else.

### 10.3 Poster eligibility and the verification boundary (D10 + O1)

> **Any organization may draft a job**, gated purely by capability — **no `org_type` restriction**,
> because no existing canonical authority requires one.
>
> **Publishing into Installer discovery additionally requires the posting organization to be
> verified.**

This is precisely the canonical line, not an exception to it: verification gates **public
discoverability and trust**, never **workspace access**. A member of an unverified organization keeps
full access to their workspace and can create, edit and manage drafts; what verification unlocks is
*being surfaced to installers* — the same thing `profiles.public_profile_status = 'listed'` gates for
a person.

| Action | Requires |
|---|---|
| `job_create` · `job_update` · `job_cancel` (draft) | active org · active membership · `job.post` (or `org.manage`) |
| **`job_publish`** (`draft → open`) | the above **plus `organizations.is_verified = true`** |
| Appearing in `open_job_opportunities` | job `status = 'open'` **and** poster org currently verified |
| `job_application_submit` | job `status = 'open'` **and** poster org currently verified |
| Accept · reject · start · progress · complete · cancel · review | **no verification check** |

#### Losing verification suppresses; it never destroys

If an organization's verification is later lost, the effect is **derived, not stored**:

- the job **disappears from discovery** and **stops accepting new applications** — because both read
  `organizations.is_verified` **live**, through a join, rather than caching it on the job;
- the job's `status` does **not** change, no row is rewritten, and nothing cascades;
- **existing applications and assignments are fully preserved and remain manageable** — the poster can
  still accept, reject, monitor, complete and review; the installer can still start, report progress
  and be paid the reputation of a completed job.

Making suppression derived rather than a stored transition is the whole reason this is safe. A
migration that "denormalised verification onto `jobs` for performance" would freeze the wrong answer
in both directions — a suppressed job staying visible, or a re-verified organization's jobs staying
buried. **`open_job_opportunities` and `job_application_submit` must read the live organization row.**

> **An `installer_technician` personal account never becomes a posting organization.** There is no
> personal posting path, no self-posted job, and no shadow one-person organization. `jobs.poster_org_id`
> is `not null` and references `organizations`; the schema cannot express a personal poster.

### 10.4 Reads

| Table | Who may select |
|---|---|
| `jobs` | poster-org members (`app.is_org_member(poster_org_id)`); the assigned installer; platform staff |
| `job_applications` | the applicant (`applicant_user_id = auth.uid()`); poster-org members; platform staff |
| `job_assignments` | the assigned installer; poster-org members; platform staff |
| `job_progress_updates` | the parties of the parent assignment; platform staff |
| `job_reviews` | the reviewee; poster-org members; platform staff — plus the **public projection** in §6.4 |
| `trades` | `authenticated` (public vocabulary) |
| `user_trades` | own rows; platform staff; plus the public directory projection |

**Discovery is a hardened view, not a policy on the base table.** Open jobs reach the installer pool
through `public.open_job_opportunities` — a `security_invoker` view over
`jobs where status = 'open'` **joined to `organizations` on `is_verified` and not soft-deleted**
(O1, §10.3) — projecting **display columns only** and **excluding `site_address`**. The verification
join is what makes suppression derived: no row is rewritten when verification lapses, the job simply
stops matching. This follows the shipped
`catalog_published_products` / `profile_public_directory` pattern
(`20260817100000_catalog_view_invoker_hardening.sql`), and is deliberately preferred over a
persona-conditioned `USING` clause on `public.jobs`: a base-table grant exposes every future column
to the whole installer pool by default, whereas a view exposes exactly what it names.

**An applicant never sees a competing application.** No policy branch, view or RPC returns another
user's candidacy to an installer.

### 10.5 Writes

Every write is a `security definer` RPC with `set search_path = ''`. No table receives a direct
client `INSERT`/`UPDATE` grant (except the `profiles` availability columns, §8.1).

| RPC | Actor | Authority |
|---|---|---|
| `job_create` · `job_update` · `job_cancel` | poster org | `job.post` or `org.manage`; org active. `job_update` also enforces the **offer freeze** (§5.3) |
| **`job_publish`** | poster org | the above **plus the org is verified** (O1, §10.3) |
| **`job_close`** | poster org | `job.post` or `org.manage`; job is `open` (O4) |
| `job_application_submit` | installer | `app.require_verified_caller()` · persona is `installer_technician` · job is `open` · **poster org currently verified** (O1). **No trade check** (O5) |
| `job_application_withdraw` | applicant | `applicant_user_id = auth.uid()` |
| `job_application_accept` · `job_application_reject` | poster org | `job.manage` or `org.manage`. **No verification check** — decisions on existing applications survive verification loss (O1) |
| `job_assignment_start` | assigned installer | `installer_user_id = auth.uid()` |
| `job_progress_add` | assigned installer | `installer_user_id = auth.uid()`, assignment `in_progress` |
| `job_assignment_complete` | poster org | `job.manage` or `org.manage` |
| `job_assignment_cancel` | either party | poster capability **or** `installer_user_id = auth.uid()` |
| `job_review_create` | poster org | §6.2 |
| **`job_review_moderate`** | **platform only** | `app.is_platform('support')` (O2, §6.5) |
| `user_trades_set` | self | `user_id = auth.uid()` |

**Two authority shapes here are new and must be tested, not assumed:**

1. **The persona gate on `job_application_submit`** — the first write path in the repository whose
   permission derives from `users.primary_account_type`.
2. **The verification split (O1)** — `job_publish` and `job_application_submit` read the poster
   organization's **live** verification state; every other write path deliberately does not. A pgTAP
   test must prove that revoking verification stops new applications **without** breaking accept,
   complete or review on work already under way.

**And one shape that must stay absent:** no write path and no policy may reference `user_trades`
(O5). Trade is a signal, never authority.

### 10.6 The membership trap, stated explicitly

`app.is_org_member(poster_org_id)` must **never** be reachable via the installer's relationship to a
job. An installer's read of their assigned job is granted by `installer_user_id = auth.uid()` on the
**assignment**, not by any organization predicate. A future refactor that "simplifies" the two into
one org-membership check would silently hand installers tenant reads.

---

## 11. Privacy

| Rule | Enforcement |
|---|---|
| **General location at discovery; precise site address only after assignment.** | `site_address` excluded from `open_job_opportunities`; base-table policies require assignment or org membership. Mirrors the onboarding rule: *"no detailed address is requested at onboarding; that is asked later, per-request, with consent."* |
| **A poster sees a candidate's public projection, not their raw record.** | Application views join `profile_public_directory`. `individual_onboarding`, `contacts`, phone and email are never exposed by this domain. |
| **An applicant never sees competing applicants.** | §10.4. |
| **A public review names the organization, never the reviewing person.** | The public projection exposes score, body, date, job title/trade and the poster org's public display name. `reviewer_user_id` is audit-only. |
| **Applying is not consent to be contacted off-platform.** | No contact channel is disclosed by this domain at any stage. |
| **Progress notes are bilateral, never public.** | Readable by the two parties and platform staff only. |
| **Cross-tenant leakage is impossible by shape.** | A job names exactly one organization; there is no second-org column to join across tenants. |

---

## 12. Idempotency and concurrency

### 12.1 Apply
- **Identity:** `uq_job_applications_job_applicant (job_id, applicant_user_id)`.
- **Behaviour:** a repeat call returns the **existing** application id — the shipped
  `showroom_join_request_create` pattern (*"a retry or a second tap never queues a duplicate"*). Not an error.
- **Race:** `select … from public.jobs where id = … for update` before insert, so an apply cannot
  land on a job being awarded or cancelled concurrently.

### 12.2 Accept
- **Identity:** `uq_job_assignments_application` **and** `ux_job_assignments_active_job`.
- **Behaviour:** accepting an already-`accepted` application returns its **existing assignment id**,
  as `showroom_referral_approve` returns the organization it already produced.
- **Race:** the job row is locked `for update`; the transaction then (a) sets the application
  `accepted`, (b) auto-rejects siblings, (c) inserts the assignment, (d) moves the job to `awarded`.
  Two concurrent accepts on different applications: the second fails the partial unique index and the
  whole transaction rolls back — **never a double award**.

### 12.3 Review
`unique (assignment_id)`; a repeat call returns the existing review id (§6.2).

### 12.4 Optimistic concurrency
`jobs.version` and `job_assignments.version` gate every edit, following
`20260805110000_sales_edit_concurrency.sql`.

---

## 13. Showroom / business network

**Derived, not stored.** The Installer's business network is:

> the distinct posting organizations of the caller's `completed` `job_assignments`, projected through
> `public.organization_public_directory`.

No new table. No relationship record. No membership, capability, request, approval or invitation.
The relationship is *earned by having worked together* and is a fact the database already holds once
§3 exists. This is the safer equivalent D3 asked for: reference 06's "businesses I work with" with
**zero new authority**.

**Excluded:** "add a showroom you know" + invitations (a referral mechanic; the only approved referral
is a *salesperson* referring an *organization*) · network points and level rings (contradict the
Points contract) · showroom star ratings (no organization rating model, §6.6) · call/message buttons
(contact details are not in `organization_public_directory`, and chat is org↔org).

---

## 14. What is reused, and what is deliberately NOT reused

### Reused as-is
`users` · `profiles` (extended by two availability columns) · `profile_public_directory` (extended by
the availability and trade projections) · `organizations` · `organization_public_directory` ·
`branches` · `memberships` + `membership_capabilities` · `audit_log` · `app.is_org_member()` ·
`app.require_verified_caller()` · `app.record_audit_event()` · `app.forbid_mutation()` ·
`individual_onboarding` (read-only; `prof_specialization` demoted to transitional debt, §4.6) ·
`points_ledger` (read-only; **no job event earns Points**).

### Deliberately NOT reused

| Not reused | Why |
|---|---|
| `rfqs`, `quotations`, `orders`, `order_items` | Organization↔organization by `NOT NULL` + `CHECK`. Adapting them is exactly what D2 forbids. |
| `projects` | Executing side is an organization; RLS reads `app.is_org_member(executing_org_id)`. A person has no seat. **`job_assignments` is the person-level analogue, deliberately separate.** |
| `conversations`, `messages` | Org↔org over a closed `subject_type`. Untouched — §14.1. |
| `organization_join_requests`, `app.membership_grant_sales` | Grants Sales capabilities. Excluded by D3; hardened by §7. |
| `notifications` | Closed event-type `CHECK`; a frozen module (§14.2). |
| Shadow one-person organizations | Forbidden by D2 and the canonical account model. |

### 14.1 Transactional Chat is untouched
No column, constraint, policy or `subject_type` value changes. `ck_conversations_subject_type` stays
`('rfq','quotation','order')`. Installer surfaces **must not render a messaging entry point**, because
none exists for them. Personal↔organization chat is the **next** milestone.

### 14.2 Notifications are untouched
`ck_notifications_event_type_known` is unchanged. The audit event names in §15 are **reserved** so the
next milestone adds call sites without renaming. No Installer surface may assume a notification exists.

### 14.3 Media/Storage is a separate, prior foundation (D5)
There is no media or storage capability in the repository today. Portfolio and certificates are
required for the completed persona, therefore:

> **A real Media/Storage foundation must be specified (`docs/database/media-storage.md`) and
> implemented BEFORE any Portfolio/Certificate upload UI.** No temporary public-URL fields. No fake
> media records. No placeholder columns.

**Jobs, applications and assignments have no dependency on it** and may be implemented first. The same
foundation will later support job-progress photos and Chat attachments — **designed for, not
integrated now**; neither integration is in this milestone.

---

## 15. Audit events

Emitted via `app.record_audit_event(...)` inside the same transaction as the state change — the
placement Points Core and Notifications Core established.

| Event | Subject |
|---|---|
| `job.published` · `job.closed` · `job.cancelled` | `job` |
| `job.application.submitted` · `job.application.withdrawn` | `job_application` |
| `job.application.accepted` · `job.application.rejected` | `job_application` (including auto-rejected siblings) |
| `job.assignment.started` · `job.assignment.progress_updated` | `job_assignment` |
| `job.assignment.completed` · `job.assignment.cancelled` | `job_assignment` |
| `job.review.created` | `job_review` |
| `job.review.suppressed` · `job.review.restored` | `job_review` (platform moderation, §6.5) |

`organization_id` is the **poster org** on every event. Metadata carries ids and status transitions
only: never contact details, never a note or review body, never a site address, **never the offered
amount** (a monetary value in an audit payload invites exactly the payment reading D9 forbids).

---

## 16. Route map

| Route | Reference | Surface |
|---|---|---|
| `/home` | 01 | Installer home — real counts from this domain |
| `/home/jobs` · `/home/jobs/[jobId]` | 02 | Discovery over `open_job_opportunities`; detail + apply |
| `/home/work` · `/home/work/[assignmentId]` | 03 | Assignments by status; detail + progress |
| `/home/profile` · `/home/profile/edit` | 04 | Profile hub + standalone editor (trades, availability, service areas) |
| `/home/reviews` | 05 | Received reviews + summary (§6.4) |
| `/home/network` | 06 | Derived completed-work network (§13) |
| `/home/points` | 01, 04 | Personal Points — reuses `/b2b/points` components verbatim |
| `/home/settings` | 04 | Composition route (§9) |
| `/p/[profileId]` | 04 | Public professional profile — trades, availability, rating summary, reviews |
| **`/b2b/jobs`** | — | **Poster side.** Job list + create/publish. |
| **`/b2b/jobs/[jobId]`** | — | **Poster side.** Applicants, accept, monitor progress, complete, review. |

The poster-side routes are **required** (§1), not an extra.

---

## Deferred, non-blocking

**Every product decision is closed — D1–D10 and O1–O7. There are no remaining product blockers to
the 14-increment sequence.** What follows is deferred work with a known home, not an open question.

| Item | Why it is deferred, and where it lands |
|---|---|
| **Full review dispute workflow** | O2 approves suppression, which is what the Pilot needs to act on abuse. A reviewee-initiated challenge, reviewer response and adjudication state is a larger contract. `job_review_moderations` (§6.5) is shaped so adding one later requires **no change to `job_reviews`**. |
| **Availability staleness policy** | O3 explicitly forbids inventing one. `availability_updated_at` is persisted and displayable, so a future policy has its input without the Pilot guessing a number. |
| **Job expiry / auto-close** | O4 explicitly forbids automatic expiry. The manual `closed` state covers the real need; an automatic rule can be added later without a lifecycle change. |
| **Job-progress photos** | Additive to `job_progress_updates` once the storage foundation lands (§14.3). Not in this milestone. |
| **Chat attachments, personal↔organization chat, Realtime** | The **next** milestone. §14.1 keeps Transactional Chat untouched so that milestone starts from a clean contract. |
| **Notification events for this domain** | The audit event names in §15 are **reserved**; `ck_notifications_event_type_known` is unchanged. |
| **Organization ratings** | §6.6. D4 covers rating an installer's work only. |
| **Geo / locality data** | The reference's radius filter and km distances have no backing; `profiles.locality_id` remains an unconstrained placeholder. Discovery filters on governorate/city text as `individual_onboarding` already does. |
| **AI matching / match scoring** | Deferred by `mvp-scope.md`. Discovery is filter-based (§4.5). |
| **Multi-trade jobs, multi-installer crews** | Out of scope; `jobs.trade_id` is singular and `ux_job_assignments_active_job` is exclusive. Both are additive later. |

**Recorded technical debt (not product decisions):**
`individual_onboarding.prof_specialization` retained but demoted to non-authority (§4.6) — its removal
is a later mechanical migration. `frontend/src/lib/nav/modules.ts:105-108` still describes Points as
*"a UI shell in this sprint"*, stale since `b25e249`; comment-only, and deliberately not touched by a
documentation-scoped change.

## Out of scope

Payments, settlement, escrow, milestones, disputes · organization↔organization jobs · multi-installer
crews · multi-trade jobs · job templates or recurrence · AI matching or match scoring · Points earning
from any job event · notifications · realtime · chat · media upload · job-progress photos ·
chat attachments · organization ratings · public job boards visible to non-installers ·
installer→installer subcontracting.
