# Sprint 12 — Pilot Account & Workspace Model

**Branch:** `feature/pilot-account-workspace-model` · **Status:** implemented, targeted acceptance green, PR open (not merged).

This sprint makes the approved account model real in schema and product:

> **ONE PERSON = ONE USER ID.** A person may have a personal identity, zero
> businesses, one, or many — all under the same login. A business is an
> **Organization**; a **Membership** links the two; a **workspace is derived**
> (Personal = User + Profile, Business = Organization + active Membership).

Nothing here introduces a `workspaces` table, a persona switcher, or a "use as"
mode. Documentation for the model itself is canonical in
[`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md); this file
records what was **built**.

---

## 1. The coupling that was removed

`public.users.primary_account_type` was doing two incompatible jobs: *what kind
of person are you* and *what kind of business do you run*. Because it was
`not null default 'end_consumer'`, the schema could not even **represent** a
business-only identity — so a showroom owner was forced to carry either a fake
consumer persona or (worse) their organization's type copied onto their person.

| | Before | After |
|---|---|---|
| `users.primary_account_type` | persona **and** business classification; `not null default 'end_consumer'` | **personal persona only**, nullable, no default |
| `organizations.org_type` | business classification | unchanged — the **only** business classification |
| business-only identity | not representable | `primary_account_type is null`, fully supported |

**`org_type` is never mirrored onto a user, and a persona is never inferred from
an organization.** `request_account_upgrade` now rejects business values outright:
a business is created as an Organization, never granted as a personal type.

### Migration of existing users (`20260814090001`)

Idempotent, and deliberately narrow — it only ever *clears* a mis-typed persona:

1. where an **explicit** personal professional type was independently declared
   (`individual_onboarding.prof_concrete_type`, chosen by the person in the
   personal track), that type is restored;
2. everyone else with a business-valued persona becomes a valid **business-only
   identity** — no persona at all. No persona is guessed from `org_type`.

Preserved without exception: user id, auth identity, organizations, memberships,
branches, capabilities, commercial/CRM history. No user or organization is
created, duplicated, or deleted. Re-running is a no-op (no business-valued
persona survives the first pass).

`app.has_personal_persona(uid)` answers *"is there a Personal workspace?"* from
**explicit** evidence only: a canonical persona, a reached personal onboarding
terminal, or a selected personal track. Never from an organization.

---

## 2. Business creation: durable, resumable, idempotent (`20260814090002`)

`business_onboarding` was keyed `user_id primary key` — one draft per person,
forever — which made the completion idempotency key the **user**. A second
business could then only exist by destroying the record of the first, and a
retried submit had nothing stable to recognise itself by.

`public.business_creation_drafts` holds **one row per creation attempt**:

- the **draft id** is both the resume handle and the idempotency key;
- `organization_id` is the canonical result, guarded by a partial unique index so
  no two drafts can ever claim the same organization;
- a partial unique index allows **one open draft per user** (unambiguous resume)
  and **unlimited completed drafts** (which is what allows many businesses).

`business_draft_submit(draft_id)` takes a row lock and short-circuits on the
recorded `organization_id`, so request 1 creates O1 and every retry — network,
double-click, concurrent — returns **O1**. A *different* draft is a different key
and legitimately creates O2. `business_save` / `business_submit` remain as
wrappers over the caller's open draft, so saved registration drafts still resume;
the no-arg submit returns the caller's most recent result rather than erroring,
and never treats "nothing open" as licence to create another business.

The legacy table is **not** dropped or emptied — rows are copied forward
deterministically and left in place.

Creation stays transactional: organization + owner membership + full owner
capability grant + primary branch, or nothing.

---

## 3. Product changes

### Registration is a direct question

*For myself* (Consumer · Engineer · Interior Designer · Installer/Technician ·
Contractor · Salesperson) or *For my business* (Showroom/Dealer · Supplier ·
Manufacturer · Importer · Wholesaler). Choosing *Showroom* means **"create a
business whose `org_type` is `showroom_dealer`"**.

**"Organization owner / manager" is no longer offered.** Owner is the
relationship that creating a business produces — not a type to pick from a list.
The key survives only as a resume label for saved drafts.

### The creator is the owner

The owner/manager confirmation checkbox is gone. The review step *states* the
outcome ("You'll be the owner of this business…") instead of asking. The business
type chosen at registration carries into the draft, so **the type step is dropped
from the wizard entirely** — it is never asked twice.

### Add a business (`/business/new`)

The authenticated entry point for an existing account: workspace menu →
**Add business** → type → details → location → branch → review → new workspace.
No Sign Up, no new OTP, no second `auth.users` row, no second personal profile.
Repeatable: each visit resumes the open draft or starts a fresh one.

### Workspace switcher

Compact selector in both shells: the Personal entry (only when a personal persona
exists), every organization with an **active** membership labelled by
relationship, and **Add business**. It changes *where* you work, never *who you
are* — switching never touches `primary_account_type` and never adds or removes a
membership.

Selecting a workspace is **not an authorization decision**. The rules live in a
pure, unit-tested module (`lib/workspace/model.ts`): a cookie naming a workspace
the caller does not have — including one whose membership was just revoked —
resolves safely to something they do have, and every request still re-checks
authentication, active membership, capability, branch scope and RLS.

### Deterministic landing

| Caller | Lands |
|---|---|
| Platform staff | `/admin` |
| Business-only identity with an active membership | `/b2b` — never a fake empty Personal home |
| Personal-only identity | `/home` |
| Personal + businesses | the selected context; Personal preferred when none is valid |
| No usable workspace | `/home`, account-safe terminal offering business creation |

Merely *belonging* to an organization no longer evicts a person from their
personal home — the fix that lets Consumer/Engineer + business owner coexist.
Verification is not consulted anywhere in landing: it is a trust state, not an
access gate.

### Admin

Unchanged in shape. It now distinguishes a **business-only user** (no personal
persona) from one with a persona, instead of rendering a blank account type, and
still reads business type from the Organization.

---

## 4. Validation

| Gate | Result |
|---|---|
| Frontend typecheck | ✅ |
| Frontend lint | ✅ 0 errors, 0 warnings |
| Unit tests | ✅ 204 (adds `lib/workspace/model.test.ts`, rewrites `landing.test.ts` and `business-flow.test.tsx`) |
| `supabase db reset` | ✅ 24 migrations from clean |
| pgTAP | ✅ **650 across 28 files** (adds `27_account_workspace_model_test.sql`) |
| EN/AR key parity | ✅ 1310 / 1310, no mismatches |
| Targeted Playwright — desktop | ✅ 17 (`account-workspace-model.spec.ts` 8 journeys + EN/AR RTL, and `pilot-uat-round-1.spec.ts`) |
| Targeted Playwright — mobile EN/AR | ✅ 3 (registration choice, workspace selector, Add business) |

Repo-wide E2E, Lighthouse, and the full persona matrix were deliberately **not**
run — those belong to the later Integration Gate.

`27_account_workspace_model_test.sql` proves the eight acceptance properties:
A one user in two organizations of different types · B creation never writes the
org type as personal identity · C transactional creation · D same draft retried
three times → **one** organization · E two drafts → two organizations ·
F membership uniqueness + RLS isolation · G revoked membership loses the
workspace · H migrated pilot owners retain access.

Three defects the tests caught during the sprint, all fixed:

- recreating `profile_public_directory` would have silently reverted the
  `security_invoker` hardening from `20260805100000` — the eligibility filter
  belongs in the reader function **behind** the view;
- `request_account_upgrade` had been rebased on a superseded version, dropping
  the needs-more-info resubmission path;
- splitting Engineer and Interior Designer into distinct registration choices
  left `interior_designer` absent from `PERSONA_BY_ACCOUNT_TYPE`, so choosing it
  bounced the user back to `/onboarding`. Each now maps to its own persona with a
  **fixed** concrete type, which also removes the in-flow "which best describes
  you?" sub-question; the combined `engineer_designer` persona is retained (with
  no fixed type) so a draft saved before the split still resolves.

---

## 5. Technical debt

**Removed this sprint**

- `users.primary_account_type` no longer carries business classification —
  the enum's business members are unreachable as a personal persona (rejected by
  `request_account_upgrade`, cleared by the backfill, absent from registration).
- One-draft-per-user business onboarding, which structurally prevented a second
  business.
- The generic "Organization owner / manager" registration entry.

**Remaining**

- The `account_type` **enum** still contains the business members
  (`showroom_dealer`, `supplier`, `manufacturer`, `importer`, `wholesaler`)
  because `organizations.org_type` is typed with the same enum. This is correct
  for the organization and unreachable for the person; splitting it into a
  dedicated `org_type` enum is a mechanical, separately-reviewed migration.
- `public.business_onboarding` is retained read-only for history. No current path
  writes it beyond a consistency touch on completion.
- `business_save` / `business_submit` remain as transitional wrappers for saved
  drafts and can be dropped once no client sends them.
