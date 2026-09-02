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
| **O3** | **No automatic availability expiry.** `available_for_work` is user-controlled; `availability_updated_at` is **server-derived** (trigger-stamped, in no client grant) and is persisted and displayable. No 7/14/30-day policy may be invented (§8.3). |
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
| `20260831090002_public_profile_professional_fields.sql` | `profile_public_directory` now also carries the professional's **self-declared practice** — `specialization`, core `services`, `years_experience`, `service_areas` — LEFT JOINed from `individual_onboarding`. This is the projection the applicant side of this domain reads (§11); it is what lets a poster judge a candidate without any new job-domain column. |
| `20260831090003_professional_profile_edit_authority.sql` | `app.is_professional_persona(uuid)` — an individual professional is recognised by **canonical persona OR declared `prof_concrete_type`**, never by onboarding track. Sibling of `app.is_sales_persona` (§7). Governs who may maintain the profile this domain matches on. |

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
| ~~`awarded`~~ | ~~`cancelled`~~ | **REMOVED — see §3.6, correction 8.** An awarded job is not cancellable in one step; the assignment is cancelled first (returning the job to `open`), and the opening is then cancelled from there. |

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

The two **decided** states — `accepted` and `rejected` — are terminal. There is no un-accept and no
un-reject; a mistake is corrected by cancelling the assignment, which returns the job to `open` for a
fresh round.

**`withdrawn` is not a decision and is not terminal.** It is the applicant's own statement about their
own availability, and `job_application_submit` returns that same row to `submitted` while the job is
open and the poster verified (§3.6, correction 9). Exactly one edge leaves a non-`submitted` state,
and it is that one.

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

### 3.6 What Increment 6 shipped, and where it narrows this document

`20260902090001_jobs_domain.sql` implements §3.1–§3.5, §10 and §12. **Reviews (§6)
are NOT implemented** — they remain Increment 12; the seam is
`job_reviews.assignment_id → job_assignments.id`, and nothing about it required a
column or a placeholder here.

Ten places where the implementation is deliberately **not** what this document
says. Seven are narrowings for security, atomicity or internal consistency; two
are approved lifecycle corrections made during review; the tenth was found while
building the poster UI in Increment 7 and is the only one that WIDENS anything.
None was a discovery made while typing.

**1. No client write grant on any of the four tables** (narrows §10.4's "a user
reads and writes their own rows", already reconciled for `user_trades` in §4.3).
There is no `INSERT`/`UPDATE`/`DELETE` privilege in any role, and no non-`SELECT`
policy. A client able to write directly would perform one user gesture as several
statements, and between any two of them the row set is a state nobody asked for.

**2. The offer freeze covers `trade_id` as well** as `offered_amount` and
`offered_currency` (extends §5.3). An applicant consented to a stated amount *for
a stated trade*; silently moving either afterwards makes the application a bid on
something that no longer exists. Same trigger, one more column.

**3. "Active org" is read as NOT suspended and NOT archived**, not as
`status = 'active'` (§10.3's table). The literal reading contradicts the same
section's rule two paragraphs above: everywhere else in this repository
`status = 'active'` is a DISCOVERABILITY condition — the public directory and the
catalog projection both use it that way — and applying it to `job_create` would
lock an organization in `pending_verification` out of drafting, which is exactly
the line verification must never cross. Publishing still requires
`is_verified AND status = 'active'`, because that IS the discoverability gate.

**4. Three lifecycle guards exist as triggers**, not only inside the RPCs:
`app.jobs_status_transition_guard()`, `app.job_applications_status_guard()` and
`app.job_assignments_status_guard()`. There is no client `UPDATE` grant, so these
cannot catch a browser — they catch **us**. A future write path that sets
`completed` from `open`, or reopens a `closed` job, fails at the trigger instead
of producing a job whose history is not a path.

**5. `job_assignments` carries `agreed_amount` / `agreed_currency`** (adds to
§3.3). The job's own offer is already immutable once an application exists, so
this is belt and braces — but a work record that must join back to a live row to
say what was agreed is a work record whose meaning changes when someone edits the
job. Disclosure only; no payment of any kind is asserted, recorded or implied.

**6. Two audit actions beyond §15** — `job.created` and `job.updated`. A draft is
private, but drafting an opening and changing its terms are both acts the poster
organization is answerable for, and the reject/accept trail is unreadable without
them. No Jobs event carries the offered amount, which §15 already forbids and
test 42 asserts.

**7. A second read seam, `public.my_job_applications`** (adds to §10.4). The base
policy on `jobs` deliberately excludes applicants, because the base row carries
`site_address` and §11 withholds that until assignment. Without a projection an
applicant's own candidacy is a `job_id` and a status — not a record a person can
read. Same `security_invoker`-over-definer-reader shape as
`open_job_opportunities`, and it withholds `site_address` for the same reason.

**RPC surface, as shipped:** `job_create` · `job_update` · `job_publish` ·
`job_close` · `job_cancel` · `job_application_submit` ·
`job_application_withdraw` · `job_application_reject` · `job_application_accept` ·
`job_assignment_start` · `job_progress_add` · `job_assignment_complete` ·
`job_assignment_cancel`. `job_create` takes a **trade KEY**, not an id:
`trades.id` is a `gen_random_uuid()` default that differs per environment, and the
key is the stable identifier the rest of the product already speaks.

**Lock order is `jobs` first, then the child row**, in every write path that
touches two. Without it `job_cancel` (job → assignment) and
`job_assignment_cancel` (assignment → job) form a cycle, and two concurrent
cancels would deadlock. The functions that need the child row's `job_id` first
read it unlocked, take the job lock, then re-read the child `for update`.

**8. `awarded → cancelled` is removed from the lifecycle** (corrects §3.5's table
and §10.5's `job_cancel` row). An awarded job has a person holding live work on
it. Cancelling the opening in one step would end that engagement as an *unnamed
side effect* — the assignment would be closed by a code path the poster never
aimed at the installer, and the cancellation reason on the record would be the
one written about the job, not about the work. So `job_cancel` accepts `draft`
and `open` only, and the trigger refuses the edge outright. The poster cancels
the assignment first (`job_assignment_cancel`, which requires its own reason and
returns the job to `open`), and cancels the opening from there if they still want
to. Two deliberate acts, two reasons on the record, in the order the installer
experiences them.

**9. A withdrawal is reversible; a decision is not** (resolves the question this
section previously recorded as open, and refines §12.1). `job_application_submit`
returns a caller's own `withdrawn` row to `submitted` **on the same id**,
atomically under the job lock, and only while the job is `open` and the poster is
**currently verified** — the same two gates a first-time applicant passes, so a
withdrawal is never a door back in that a newcomer does not have. `created_at` is
preserved, because it is the honest record of when this person first put their
name forward; the note is replaced with whatever they wrote on returning.

`accepted` and `rejected` remain **non-resubmittable**. Both are the poster's
decisions, and reversing either from the applicant's side would let someone
re-enter a competition they were already told they had lost. Calling
`job_application_submit` on a decided candidacy returns that row **unchanged** —
the caller gets their own record back and can read what happened to it, and not
one column is touched. `app.job_applications_status_guard()` permits exactly one
edge out of a non-`submitted` state, `withdrawn → submitted`, so no future write
path can widen this by accident.

---

**10. `job_applicants` returns identity for EVERY applicant, not only publicly
listed ones** (widens §11's "application views join `profile_public_directory`
and read nothing else"). Added by Increment 7 in
`20260903090001_job_applicants_projection.sql`.

Increment 6 shipped both installer-facing read seams and no poster-facing one,
and the poster is the party that has to decide. The literal instruction could not
be implemented: `profile_public_directory` exposes `profiles.id` and deliberately
never `user_id`, so there is **no key** to join an application to it — and the
join it describes is an INNER one against `public_profile_status = 'listed'`,
whose column default is `hidden`. A poster-side list built that way would render
most of its applicants anonymous, and the poster would be choosing who to hand
work to from a list of blanks.

So the projection returns **identity** (`display_name`, `headline`, avatar) for
every applicant, listed or not — somebody who applies to your job has, by that
act, told you who they are — plus the same self-declared **practice** columns the
public directory carries, and `public_profile_id` **only** when the person is
genuinely listed, so the UI links exactly where `/p/[id]` renders something.

It still returns **no contact channel, no address, no travel radius, no private
lead-time preference, no `consumer_*` column and no `applicant_user_id`**. Those
are what §11 protects, and every one of them remains unreachable through this
domain. Covered by `43_job_applicants_projection_test.sql`.

## 4. Canonical trade taxonomy (D8)

### 4.1 The rule

> The trade vocabulary is **database-backed and canonical**. Onboarding, the professional profile,
> jobs and discovery all resolve against the **same** table. TypeScript is never the long-term
> authority, and **free text is never authorization or filter identity.**

### 4.2 `public.trades` — the reference table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | The FK target — what a future `jobs.trade_id` names (§4.4). |
| `key` | `text` **not null unique** | Stable machine identifier (`kitchens_doors`, `plumbing`, …). Shape enforced by `trades_key_shape`: 2–64 chars, `^[a-z][a-z0-9_]*$`. |
| `is_active` | `boolean` **not null** default `true` | Retire a trade without deleting history. |
| `sort_order` | `smallint` **not null** default 0 | Deterministic presentation order. |
| `created_at`, `updated_at` | `timestamptz` **not null** | `updated_at` via `app.set_updated_at()`. |

**Display names are NOT columns.** They live in the existing i18n message catalogs keyed by `key`,
exactly as the shipped code already does (`t(\`onboarding.professional.specializations.${key}\`)`).
Putting `name_en`/`name_ar` here would create a **second translation source of truth** competing with
`src/lib/i18n/messages/{en,ar}.ts`, and the repository's rule is one canonical source per fact.
Seeding is reference data, not user content: rows are inserted by migration, and the table carries
**no client write grant at all**.

Reads are open to `authenticated` (it is a public vocabulary; there is nothing to isolate), but
`trades_select_active` withholds **inactive** rows from ordinary callers — a retired trade a client
cannot see is one it cannot offer. `app.is_platform('support')` reads the whole vocabulary, retired
rows included, because a support conversation about a withdrawn trade is unanswerable against a
filtered list. `anon` does not read the table at all: the public profile needs trade KEYS, and it
gets them from the §4.6 projection.

**Implemented by `20260901090001_trade_taxonomy.sql`.** The seeded Pilot vocabulary is seven keys —
`kitchens_doors`, `plumbing`, `electrical`, `hvac`, `gypsum_paint` (the five
`SPECIALIZATIONS.installer_technician` chips) plus `tiling` and `marble_granite`, which the demo
world already contains and the five cannot express.

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
- RLS: a user **reads** their own rows (`user_id = auth.uid()`); platform staff read all. The public
  projection (§4.6) is what exposes another person's trades.
- **Writes are narrower than this section originally specified, and deliberately so.** There is no
  client insert/update/delete grant and no write policy in any role: the only writer is
  `public.user_trades_set` (§4.3a), which is `security definer`. A client able to write rows directly
  would perform one user gesture as three statements, and between any two of them the selection is a
  state nobody asked for — zero primaries mid-swap, or two if the calls landed out of order. Removing
  the grant makes that unreachable rather than merely unlikely.

### 4.3a `user_trades_set` — the whole selection, atomically

`public.user_trades_set(p_trade_keys text[], p_primary_key text default null)`. It takes **no user
id**: acting on someone else is not a refused request, it is an unexpressible one. Authority is the
professional IDENTITY through `app.is_professional_persona` — canonical `users.primary_account_type`
or the declared `individual_onboarding.prof_concrete_type` — and **never** the caller's existing
trades, so holding a trade can never be what proves you were allowed to hold it.

It is **narrower than `individual_save_professional`**, which also admits a caller mid-professional
onboarding on the strength of their selected TRACK. A track carries no concrete type, so there is no
answer yet to which trades apply, and no onboarding step declares trades today.

**Exactly one primary whenever the selection is non-empty**, none when it is empty. `p_primary_key`
null means "you choose", and the choice is the FIRST submitted key — an order the caller controls and
can therefore predict. The complete behaviour:

| Case | Result |
|---|---|
| first trade selected | it becomes primary |
| primary changed | the named key is primary; the previous one stays selected |
| primary removed | the first REMAINING submitted key becomes primary |
| non-primary removed | the primary is untouched |
| duplicates submitted | deduplicated; converges rather than erroring |
| empty or null set | every row deleted; no primary |
| primary not in the set | `22023` — a contradiction, not a hint |
| unknown key | `22023`, **whole call refused** — a silently dropped key leaves the person believing they saved it |
| inactive key **not** held | `22023` — an inactive trade cannot be NEWLY selected |
| inactive key **already** held | accepted, so a retirement cannot trap a profile that could then never save again |

Because the call is a complete DESCRIPTION rather than a delta, two submissions in flight converge on
whichever lands last. `ux_user_trades_one_primary` is the backstop underneath that.

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
- Backfill `user_trades` from `individual_onboarding.prof_specialization` (one row, `is_primary`)
  **by exact key equality only.** That column holds two kinds of value: a stable vocabulary key where
  the onboarding chips wrote it, and free prose ("Marble and granite fixing") in every seeded and
  staging professional. The migration matches the first kind and leaves the second alone — nothing
  parses, matches or infers from prose. Mapping "Plumbing and sanitary fitting" onto `plumbing` looks
  obvious and is a guess; the next sentence is "Plumbing and gypsum", and a guess that is right four
  times and wrong once has published a false claim on somebody's public profile.
- The demo world's prose is resolved **explicitly, by user id**, in `supabase/seed-pilot.sql` §10.3b,
  where a human wrote each pair down and a reviewer can check them line by line. Values outside the
  Pilot's installer vocabulary (the interior designer, the site engineer) are left **unmapped**
  rather than covered by inventing two more professions' worth of taxonomy.
- The §4.6 public projection carries `trade_keys` (ACTIVE trades, primary first, then `sort_order`)
  and `primary_trade_key`. Keys, not ids — the label is an i18n lookup, and a uuid would be an
  internal identifier published for no reader's benefit. A retired trade leaves every published
  profile at once, which is what retiring one has to mean; the `user_trades` row survives.
- `individual_onboarding.prof_specialization` is retained as **transitional debt** and **stops being
  authority** the moment `user_trades` exists. Its removal is a later mechanical migration, recorded
  now so it is not forgotten.
- `src/lib/onboarding/persona-fields.ts` keeps the keys **for i18n and form rendering only**; every
  authorization, filter and join reads the table.

---

### 4.7 Retirement keeps history, and the seam that keeps it READABLE

`jobs.trade_id` is `not null references public.trades on delete restrict`, so
retiring a trade leaves every job that was posted in it intact — that FK is the
whole mechanism. What retirement does NOT leave intact is the poster's ability to
**read** the label: `trades_select_active` withholds inactive rows, so the plain
`jobs -> trades(key)` join the management list uses returns null, and the poster
loses the name of a trade they themselves chose on a job they themselves posted.

`public.job_trade_labels` (Increment 7,
`20260903090002_job_trade_labels.sql`) answers exactly that question and no
other: for jobs the caller's organization posted, which trade were they posted
in, and is it still active. `security_invoker = true` over a `security definer`
reader scoped by `app.is_org_member(poster_org_id)` — the same pattern as
`job_applicants`, and with no parameter to point elsewhere.

**Deliberately not a policy on `public.trades`.** A permissive policy would have
been one line, and it would have widened the TABLE rather than answering the
question: every `from("trades")` in the product would start returning the retired
row, including the vocabulary the create and edit forms offer. The retired trade
would reappear as a selectable option in the "post a job" dropdown — the exact
outcome `trades_select_active` exists to prevent.

**Reading a retired label never becomes posting in one.** `job_create` and
`job_update` still resolve `p_trade_key` against `is_active` and raise `22023`;
`job_publish` still re-checks that a draft's trade is active before the opening
becomes visible. `44_job_trade_labels_test.sql` asserts all three **after** the
retirement, in the same session that successfully reads the historical label, and
asserts that the same caller still cannot see the retired row in `public.trades`.

### 4.7a Editing a job whose trade was retired

Reading the label back was half the problem. The other half was that
`job_update` resolved `p_trade_key` against `is_active` and refused anything
else — so a poster whose job sat under a retired trade could not fix a typo in
the title, correct the site address or extend the schedule. The whole edit was
refused because of the value it was *retaining*.
`20260903090003_job_update_historical_trade.sql` draws the distinction:

| | `job_create` | `job_update` | `job_publish` |
|---|---|---|---|
| retired trade, newly chosen | refused `22023` | refused `22023` | — |
| retired trade, already held by this job | n/a — nothing to retain | **allowed** | still refused `22023` |
| active trade | allowed | allowed | allowed |

Resolution happens in two steps: resolve the key at all (an unknown key is
`22023`, unchanged), then accept an inactive one **only when it is the id this
job already holds**. Another job's retired trade — even one the same caller can
read a label for through §4.7 — is still refused.

**Publishing still refuses.** Editing a job is private housekeeping; publishing
is the moment it enters the installer pool, and the platform's decision to
withdraw a trade has to bite somewhere. It bites there.

**The post-application freeze is untouched.** The `v_has_apps` check compares the
*resolved id* against the *stored* one, so retaining a retired trade is not a
change and passes, while switching to an active trade on a job with applications
is refused exactly as before — with
`app.jobs_offer_immutable_after_application()` enforcing it underneath either
way. `44_job_trade_labels_test.sql` §C3 asserts both halves.

**In the form.** The edit form adds **one** option outside the catalog: the trade
*this job* holds, when it is retired, labelled as no longer offered.
`loadTradeCatalog()` stays active-only, so creating a job still cannot reach a
retired trade and neither can editing a job that holds a current one. Without
that option the select would have nothing matching its own value, submit blank,
and the edit would be refused for a field the poster never touched.

### 4.8 An application outlives its opening

`open_job_opportunities` is correct for DISCOVERY and wrong as the only way an
applicant can read a job: the moment it is awarded to somebody else, closed,
cancelled, or its poster's verification lapses, the row disappears — and with it
every detail of the thing this person applied to. `my_job_applications` exists so
that does not happen (it deliberately does not filter on verification), and
Increment 8 widened it from the LIST half of a job to the whole readable half:
`job_description`, `expected_duration_days`, `starts_on`, `ends_by`,
`published_at`.

Every one of those columns is already projected by `open_job_opportunities` to
any authenticated caller. Here they are narrower: only on the caller's own
application, resolved from `auth.uid()` inside the definer with no parameter to
point elsewhere. Still never `site_address` (§11 — the applicant is not the
assignee), never a competing application, never a poster-side management column.

**It needs no counterpart to `job_trade_labels`.** The definer joins
`public.trades` without `trades_select_active` in the way, so a trade retired
after the fact keeps its historical label on the applicant's own record for the
same reason §4.7's seam gives the poster theirs.

The installer's job-detail route reads discovery first and falls back to this
projection, so a job the caller applied to never 404s on them; a caller who never
applied to a job that has left discovery gets an ordinary not-found, which is the
honest answer.

### 4.9 An assignment is a record, not a set of uuids (Increment 9)

`public.my_job_assignments` (`20260905090001`) — a `security_invoker` view over
`app._my_job_assignments()`, scoped to `auth.uid()` with no parameter, the same
shape as the two seams above.

**What was already readable, and is not duplicated.**
`job_assignments_select_installer` is a FLAT column check,
`installer_user_id = auth.uid()`, with **no status predicate** — the installer
can already read every assignment row that is theirs, cancelled ones included.
`job_progress_select_parties` admits both parties of the parent assignment, so
the progress history needs no seam at all and this migration adds none: both
sides read `public.job_progress_updates` directly, through one query function.

**Why the projection exists anyway.** An assignment row on its own is a pile of
uuids and a number. **Three separate policies** stand between the installer and
the context that makes it a work record, and each one is a rule that should stay
exactly as it is:

| Policy | What it withholds | Why it must not be relaxed |
|---|---|---|
| `organizations_select_member` | the name of the organization that hired them | an installer is not a member; a policy for them would grant the whole pool every future column of the tenancy root |
| `trades_select_active` | a retired trade's label (§24) | relaxing it puts retired trades back in every catalog, including the "post a job" dropdown — the exact defect §4.7 fixed |
| `jobs_select_assigned_installer` | the JOB itself once the assignment is `cancelled` (the policy carries `and a.status <> 'cancelled'`) | it is the right rule for the base row; §19 needs the *record*, not the live job |

A projection names its columns; a policy names none, and grants every column
added after it.

**`site_address` is the one column with a condition on it.** §11 releases the
address to the professional who is awarded the work, which is precisely what
`jobs_select_assigned_installer` encodes, cancellation clause included. The
projection **reproduces** that clause rather than relaxing it: live, the address
is theirs; cancelled, it is withheld again. Every other column survives
cancellation, because none of them is what §11 protects.

The assignment's own `version` is projected and has to be —
`job_assignment_start` and `job_assignment_cancel` take `p_expected_version`, and
a UI that cannot read it cannot call them. Never a sibling application, never
another installer, never poster-side management metadata, never a contact detail.

**The state model is not in the query layer.** `readyForCompletion`,
`featuredAssignment`, `canStart`, `canReportProgress` and `canCancel` live in
`frontend/src/lib/work/assignment-state.ts` — pure, no server imports — because
every consumer is a client component and `server-only` said so. Each mirrors a
guard the RPC enforces and decides only what to OFFER. **There is no completion
predicate**, on either side of that split, because there is no installer-side
action for one to gate.

### 4.10 100 percent is not completion, on screen

`in_progress` with `latest_progress_percent = 100` is rendered as *"You reported
this work as finished — the organization confirms completion"*, with the status
badge still reading **In progress** and no further control. It is **derived
presentation**, not a fifth `job_assignment_status` and not a persisted
`waiting_review` column: the installer's claim must never look like a state the
installer had authority to set.

The poster's side of the same fact reads *"Reported as finished — waiting for
your confirmation"*, beside the one control that answers it.

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
  `offered_amount`, `offered_currency` **or `trade_id`** changes and any `job_applications` row
  exists for that job. The trade is included for the same reason as the amount: an applicant
  consented to a stated offer FOR A STATED TRADE (§3.6, departure 2).
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

**The chokepoint — `app.membership_grant_sales` (added during implementation).** Building this
increment exposed a better guard than gating each door. *Every* route to `sales.*` runs through
`app.membership_grant_sales`: `org_join_request_approve` calls it, `showroom_referral_approve` calls
it, and any future path would too. Guarding the capability grant itself, before it takes a lock or
writes a row, makes the property structural rather than procedural.

That is why this increment **does not recreate `public.showroom_referral_approve`**, as an earlier
draft of this section implied it would. That function carries the approved Points wiring
(`referral.organization_approved` = +100); reproducing ~150 lines of it to insert one guard would put
a frozen contract at risk for **no additional protection**, since its refusal already arrives from
the chokepoint inside the same transaction — leaving no organization, membership, join request,
audit row or Points entry behind.

Refusals raise `42501`, consistent with every other authority failure in the schema.

**Implemented** by `supabase/migrations/20260831090001_sales_affiliation_persona_hardening.sql`,
proven by `supabase/tests/37_sales_affiliation_persona_hardening_test.sql`.

**The same shape was needed again, one increment later.** `20260831090003` added
`app.is_professional_persona(uuid)` — canonical persona **or** declared `prof_concrete_type`,
resolved against the five individual-professional types — because
`individual_save_professional` had been gating profile edits on
`onboarding_progress.selected_track`, which records *how* an identity was created rather than *what
it is*. No seeded or Admin-upgraded professional has that track, so every professional the Pilot
actually runs on was locked out of their own profile. The two predicates are deliberately siblings
with the same two sources: **the declared branch is what keeps a real professional usable between
submitting their profile and an Admin applying the upgrade**, and any future authority question about
a personal professional identity should be answered the same way rather than by a third rule.

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
| `available_for_work` | `boolean` **not null** default `false` | Self-declared. **The one column the user writes.** |
| `availability_updated_at` | `timestamptz` | **Server-derived.** Stamped by `app.stamp_availability()` on every change; **not client-writable**. `NULL` = never set. |

`available_for_work` — and **only** that column — is added to the existing narrow `grant update` on
`profiles` (alongside `display_name`, `headline`, `bio`, `languages`, …), so the user controls the
claim directly with no RPC.

**`availability_updated_at` is deliberately excluded from every client grant**, and the reason is O3
(§8.3) read from the other side. O3 keeps the timestamp so a *reader* can weigh staleness for
themselves. A client-writable timestamp defeats exactly that: a professional could re-stamp `now()`
indefinitely without ever revisiting whether the claim is still true, and the single signal a poster
has for judging it would become the thing most worth faking. That is the same failure O3 forbids,
inverted — the platform would not be manufacturing state, but it *would* be publishing a freshness
claim nobody made. The value is therefore derived from `now()` by the trigger and any caller-supplied
value is discarded, including one from the table owner.

The same trigger carries the **non-professional guard**, at the column rather than at each entry
point (the shape §7.2 settled on for Sales): claiming availability requires a professional identity,
canonical or declared, via `app.is_professional_persona`. **Withdrawing it is always permitted** — an
identity that stops being a professional while marked available must still be able to turn it off,
or the platform goes on publishing a claim the person may no longer retract.

Implemented by `20260831090004_professional_availability.sql`; proven by pgTAP `40_`.

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
was last set, so a reader can weigh it themselves. It is **server-derived** precisely so that reading
is worth something (§8.1): a freshness stamp the claimant could write is one they would have every
reason to keep refreshing. Showing the age is information; expiring the flag
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
| `open_job_opportunities` (view) | `authenticated`; open jobs from CURRENTLY verified posters, display columns only, never `site_address` |
| `my_job_applications` (view) | the caller's own candidacies joined to the display half of each job (§3.6, departure 7). **Widened by Increment 8** with the job's description, expected duration, start/finish dates and publication time — every one already public in `open_job_opportunities`, and here restricted to the caller's own application, so the record survives the opening leaving discovery (§4.8) |
| `job_applicants` (view) | the POSTER side: applications for jobs the caller's organization posted, with the applicant's identity and self-declared practice (§3.6, departure 10). Added by Increment 7. |
| `job_trade_labels` (view) | the POSTER side: for jobs the caller's organization posted, the key of the trade it was posted in — **retired trades included** — plus whether that trade is still active (§4.7). Added by Increment 7. |
| `trades` | `authenticated`, ACTIVE rows only; platform staff also read retired ones; **no write grant in any role** |
| `user_trades` | own rows (read); platform staff; plus the public directory projection. **No client write grant** — `user_trades_set` is the only writer (§4.3a) |

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
| `user_trades_set` | self | `app.is_professional_persona(auth.uid())`; **no user-id parameter exists** (§4.3a) |

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
| **A poster sees a candidate's public projection, not their raw record.** | Application views join `profile_public_directory` and read nothing else. Since `20260831090002` that projection carries four `individual_onboarding` columns — `specialization`, core `services`, `years_experience`, `service_areas` — which the professional wrote about their own practice in order to be found. The rest of `individual_onboarding` stays private (availability, travel radius, base address, the secondary service list, every `consumer_*` answer), and `contacts`, phone and email are never exposed by this domain. The base table's RLS is unchanged: only the definer reader behind the view crosses into it. |
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
  A `withdrawn` row is the one exception: it is returned to `submitted` in place, on the same id,
  subject to the same two gates a first-time applicant passes (§3.6, correction 9).
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
| `job.created` · `job.updated` | `job` (added by Increment 6 — §3.6, departure 6) |
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
| **`/home/jobs`** | 02 | **Installer side.** Discovery over `open_job_opportunities`; search, trade, governorate and applied-state filters. **Shipped (Increment 8).** |
| **`/home/jobs/[jobId]`** | 02 | **Installer side.** The decision surface: full opening, apply, withdraw, re-apply. Falls back to the caller's own application record once the opening leaves discovery. **Shipped.** |
| **`/home/jobs/applications`** | 02 | **Installer side.** Application tracking over `my_job_applications`, with the four candidacy states. **Shipped.** |
| `/home/work` · `/home/work/[assignmentId]` | 03 | Assignments by status; detail + progress |
| `/home/profile` · `/home/profile/edit` | 04 | Profile hub + standalone editor (trades, availability, service areas) |
| `/home/reviews` | 05 | Received reviews + summary (§6.4) |
| `/home/network` | 06 | Derived completed-work network (§13) |
| `/home/points` | 01, 04 | Personal Points — reuses `/b2b/points` components verbatim |
| `/home/settings` | 04 | Composition route (§9) |
| `/p/[profileId]` | 04 | Public professional profile — trades, availability, rating summary, reviews |
| **`/b2b/jobs`** | — | **Poster side.** Job list, state filter, real counts. **Shipped (Increment 7).** |
| **`/b2b/jobs/new`** | — | **Poster side.** Create — always a DRAFT. **Shipped.** |
| **`/b2b/jobs/[jobId]`** | — | **Poster side.** Detail, publish, close/cancel, awarded summary. **Shipped.** |
| **`/b2b/jobs/[jobId]/edit`** | — | **Poster side.** Content edit while `draft`/`open`. **Shipped.** |
| **`/b2b/jobs/[jobId]/applicants`** | — | **Poster side.** The queue, accept and reject, over `job_applicants`. **Shipped.** |
| **`/home/work`** | — | **Installer side.** My Work: the featured current assignment, the status tabs, the all-work list and the summary breakdown, over `my_job_assignments`. **Shipped (Increment 9).** |
| **`/home/work/[assignmentId]`** | — | **Installer side.** One assignment: terms, site, progress, append-only history, and the lifecycle action this state permits. **Shipped (Increment 9).** |

The poster-side routes are **required** (§1), not an extra.

**Navigation.** The module is `NavKey` `jobs` at `/b2b/jobs`, gated on
`job.post` OR `job.manage` (with the usual `org.manage` blanket unlock), placed
in the **Network** section immediately after `technicians` in both the buyer and
seller layouts. That directory is who this business could hire; this module is
the work it is hiring for — same subject, two verbs. The gate is the UNION of the
two capabilities deliberately: either one alone is a reason to reach the module,
and gating on `job.post` would hide the applicants queue from the person whose
whole job is working it. Progress, completion and review controls are **absent by
design** — they belong to Increment 9 and Increment 12.

**Personal navigation (Increment 8).** The installer side is `PersonalNavKey`
`jobs` at `/home/jobs`, in its own **work** group between `account` and
`business` — the other personal destinations are the caller's own record, and
this is the one that is about the outside world. It is where Increment 9's My
Work joins. The gate is the persona, `variant === "professional"`, which is the
same test `app.is_professional_persona` applies inside
`job_application_submit`: discovery itself is open to any authenticated caller,
so this is about not advertising a door that does not open. `job.post` and
`job.manage` are membership capabilities and mean nothing here — the personal
rail takes no capability input at all. Application tracking is a route inside the
same Jobs area rather than a second rail entry, and `activePersonalNavKey` keeps
the parent entry lit on every nested route.

**One entry point on `/home`** — a single `ActionCard` at the head of the
existing "Start here" grid. No opportunity count: a number there would cost every
professional home render an extra read of a board most of them are not about to
open, and a stale or zero count is worse than none.

**My Work (Increment 9).** `PersonalNavKey` `myWork` at `/home/work`, joining
`jobs` in the same **work** group and gated on the same persona test. The two
stay **separate destinations** rather than one "Jobs" with tabs: an opening you
might take and an engagement you already hold are different states of the world,
and merging them would make "accepted" mean both *you won* and *you are working*.
`activePersonalNavKey` keeps the parent lit on `/home/work/[assignmentId]`.

`/home` gained **one** real work integration beside the existing entry point: the
current assignment with its organization, state and progress, or a compact honest
entry point when there is none. No counts, no board preview, no list. The final
Home composition pass remains Increment 14.

**Applications → My Work (§20).** An accepted candidacy on
`/home/jobs/applications` and on `/home/jobs/[jobId]` now offers *View in My
work*. The assignment id is **resolved**, never derived: it comes from
`job_assignments.application_id` — the foreign key `job_application_accept`
writes once — read back through `my_job_assignments`, one query for a whole page.
A rejected or withdrawn candidacy has no assignment and gets no link.

---

### 16.1 Notification events (Increment 8)

| Event | Recipient | Emitted by | Deep link |
|---|---|---|---|
| `job.application.accepted` | the awarded applicant, exactly | `job_application_accept` | `/home/jobs/applications` |
| `job.application.rejected` | the declined applicant, exactly — including **each** candidacy the award auto-closes | `job_application_reject`, `job_application_accept` | `/home/jobs/applications` |

Both use `app.notify` rather than `app.notify_org`: every recipient is named by
`job_applications.applicant_user_id`, so there is no fan-out, no capability
lookup and no owner fallback. Both are ordinary statements in the same
transaction as the decision, so a decision that commits without its notice is not
a reachable state. `ck_notifications_event_type_known` gained both values in
`20260904090002`, and the title/body keys mirror the event type exactly
(`notifications.job.application.accepted.title`), which is the convention
`view-model.test.ts` enforces for every event.

**`job.application.submitted` → the posting organization stays RESERVED.**
`app.notify_org` delivers against a capability, and this domain has two plausible
answers — `job.post` (whoever authored the opening) and `job.manage` (whoever
decides its applications) — with nothing in the approved contract choosing
between them. Guessing would install a recipient rule by accident. Test 42
asserts by name that it emits nothing.

---

### 16.2 Notification events (Increment 9 — the assignment lifecycle)

| Event | Recipient | Emitted by | Deep link |
|---|---|---|---|
| `job.assignment.ready` | the posting organization's `job.manage` holders (owner fallback) | `job_progress_add`, on the **transition** to 100 | `/b2b/jobs/{job_id}` |
| `job.assignment.completed` | the assigned installer, exactly | `job_assignment_complete` | `/home/work/{assignment_id}` |
| `job.assignment.cancelled` | whichever party did **not** cancel | `job_assignment_cancel` | `/home/work/{id}` or `/b2b/jobs/{job_id}` |

**Why an organization recipient is not ambiguous here, when it was for
`job.application.submitted`.** `job.post` has **no role anywhere in the
assignment lifecycle**: `app.can_post_job` is consulted by `job_create`,
`job_update`, `job_publish`, `job_close` and `job_cancel`, and by none of the
four assignment RPCs. Every action a recipient could take in response to these
notices — confirming completion, ending the engagement, re-awarding the reopened
job — requires `job.manage` and refuses `job.post`. The capability is therefore
**read off the action the notice asks somebody to take**, not chosen between two
candidates. A notice delivered anywhere else would be a notice its reader is
refused permission to act on.

**Only the transition to 100 is announced.** `job_progress_add` compares the
figure it is writing against the row it read before the update, so an installer
who reports 100 twice — correcting a note, adding a stage — announces it once. A
notice per progress report would make the useful ones unfindable, and progress is
a thing the poster goes and looks at.

**`job.assignment.cancelled` carries the same two params on both paths**
(`job_title`, `reason`) because the organization's copy cannot name the
organization to itself; a body referencing `{org_name}` would render a hole on
one of the two branches. `view-model.test.ts` enforces exactly that.

Reaching 100 still moves **nothing** (§3.5). The event tells the organization a
claim was made; the assignment stays `in_progress` until `job_assignment_complete`
runs.

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
