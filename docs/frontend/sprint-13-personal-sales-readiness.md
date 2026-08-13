# Sprint 13 — Personal Experience + Sales Affiliation + Type Separation

**Branch:** `feature/pilot-personal-sales-readiness` · **Status:** implemented, targeted acceptance green, PR open (not merged).

Three pieces of work, each closing something the previous sprint left open:

1. the person/business separation moved from **convention into the type system**, and the shared-enum technical debt is **closed**;
2. a **Salesperson** gained a real way to reach the Sales tools of a business they do **not** own — without becoming its owner and without a second user;
3. personal `/home` stopped looking like a form under review.

Canonical documentation for the model itself lives in [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) (*Business Classification Belongs to the Organization*, *The Salesperson Pilot Rule*) and [`ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md). This file records what was **built**.

---

## 1. Two disjoint types, and one dropped enum

`public.account_type` typed **both** `users.primary_account_type` and `organizations.org_type`. Sprint 12 fixed the *meaning* in comments and RPC guards — but a rule enforced only there is a rule a future `update` statement can quietly violate.

| | Before | After |
|---|---|---|
| A person | `public.account_type` (contained business values) | **`public.persona_type`** — no business classification exists in it |
| A business | `public.account_type` (contained persona values) | **`public.organization_type`** — no personal persona exists in it |
| `users.primary_account_type = 'supplier'` | refused by an RPC guard | **22P02 — a type error, in every path** |
| `organizations.org_type = 'engineer'` | possible | **22P02 — a type error, in every path** |
| `public.account_type` | the shared source of the ambiguity | **dropped** |

```
public.persona_type       end_consumer · engineer · interior_designer ·
                          installer_technician · contractor · sales ·
                          trainer · trainee

public.organization_type  showroom_dealer · supplier · manufacturer ·
                          importer · wholesaler · contractor_company ·
                          design_office
```

The sets are **disjoint**, so both failure modes are now impossible rather than merely refused — including for a direct SQL statement by a superuser. `trainer` and `trainee` are legacy but legitimate *personal* personas and are preserved.

`DROP TYPE public.account_type` (RESTRICT, the default) is also the migration's completeness check: it fails and names anything still referencing the old enum.

### Two things the audit forced

**Two organizations legitimately carried a persona spelling as their classification** — a design studio typed `interior_designer` and a contracting company typed `contractor`. Both are real business classifications the product recognises, so they are **preserved under business-shaped names**:

```
interior_designer  →  design_office        (a design / engineering office)
engineer           →  design_office
contractor         →  contractor_company   (a contracting business)
```

The rename happens *inside* the `USING` cast, because the new label is not a value of the old enum. An organization holding any **other** persona value has no honest business meaning, so the migration **stops with an instruction naming the rows** rather than assigning a guessed type. The owner of a renamed business may separately hold the matching *personal* persona — the two values now coexist honestly instead of colliding.

**`onboarding_progress.selected_account_type` held either taxonomy depending on the track** — the debt's last hiding place ("I am an Engineer" and "I am creating a Showroom" landed in one column). It is **split by meaning**:

| Column | Type | Meaning |
|---|---|---|
| `selected_persona` | `persona_type` | the persona claimed on the professional track |
| `selected_org_type` | `organization_type` | the classification intended on the business track |

A CHECK keeps them mutually exclusive and consistent with the track. The union survives only as a TypeScript type at the read boundary, because the registration *choice* genuinely spans both taxonomies — it is never a column again.

### A bug found en route

`apply_account_upgrade` tested the persona **VALUE** for presence and raised *"verification subject has no identity row"*. Sprint 12 made that column nullable, and a professional's persona is legitimately `null` until this very function applies it — so **Admin approval of every individual professional created after Sprint 12 was failing.** It now locks and tests the **ROW**, exactly as `request_account_upgrade` already did.

---

## 2. The Salesperson Pilot rule

> A Salesperson has a usable personal Aladdin account **immediately**. A showroom's Sales / B2B tools require an **ACTIVE affiliation** with that showroom.

Five states, each moving independently — never merged into one percentage or badge:

| State | Controls |
|---|---|
| Account status | whether the person can use Aladdin — yes, from onboarding onward |
| Profile completeness | nothing; a derived quality signal |
| Personal verification | trust and public discoverability, never access |
| Showroom affiliation | whether *that showroom's* Sales tools open |
| Showroom verification | the showroom's own trust state, not the salesperson's |

A salesperson who is `ACTIVE` / 80% complete / verification `PENDING` / affiliation `PENDING` uses their personal account normally and simply cannot yet open that showroom's B2B workspace. **Verification is not an activation gate**, and landing is never derived from persona.

### Path A — the showroom is on Aladdin (`organization_join_requests`)

```
Connect your showroom → search → select → select branch → request to join
                                                              ↓
                     Owner/Manager of THAT showroom decides (org.members.manage)
                                                              ↓
                       app.membership_grant_sales → ACTIVE Sales membership
```

- Search (`showroom_directory_search`) returns **only** the approved public business-directory columns, needs ≥2 characters, and caps results. It deliberately includes `pending_verification` showrooms: hiding unverified ones would push their staff into referring **duplicates of businesses already on the platform**, which is exactly what the referral review exists to prevent.
- The decision happens on the **existing** People surface (`/b2b/organization`) under the **existing** `org.members.manage` capability. No second permission architecture and no second approval console.
- A request grants **nothing** — no membership, no capability, no workspace. It is idempotent per (caller, showroom), so a double-tapped button cannot queue duplicates for the approver.
- Approval grants the sales capability set and **never** `org.manage` / `org.members.manage`.
- **Rejection requires a reason**, shows it to the salesperson, and leaves their personal account entirely untouched.

### Path B — the showroom is not on Aladdin (`organization_referrals`)

```
Can't find your showroom? → Add showroom → candidate submitted → Admin review
                                                                     ↓
                                          link to an existing org  OR  create it
                                                                     ↓
                                    referring salesperson = SALES MEMBER, not Owner
```

- This is **not** the owner "Add Business" flow, and the UI says so outright. Submitting creates no organization and grants no access.
- Reviewed on the **existing** Admin verifications surface with platform authority. **Linking is preferred over creating:** an exact case/whitespace-insensitive name match of the same classification auto-links, and a trigram shortlist is shown for the human's judgement. **Company name stays non-unique** — two genuinely different showrooms may share one, so de-duplication is a reviewed decision, not a constraint.
- Retry-safe and resumable: the draft is the resume handle, and re-submitting or re-approving returns the same referral / the same organization.

### The owner question, answered explicitly

The data model has **no invariant requiring an organization to have an owner** — `app.assert_not_last_owner` protects an owner that *exists*; nothing demands one exist. So the honest outcome is available and is what happens: a referred showroom is created with its primary branch and the referring salesperson's **Sales** membership, and with **no owner membership at all**. It is a platform-managed business, claimable later by its real owner through the normal verification path. No ownership is faked.

`created_by` on such an organization is the reviewing **Admin**, not the referrer — that column feeds the `organizations_insert_creator` RLS policy and would read as ownership if it named the salesperson. Attribution lives in its own column.

### Attribution only — no rewards system

| Column | |
|---|---|
| `organizations.source` | `self_created` \| `salesperson_referral` |
| `organizations.referred_by_user_id` | the referring salesperson |

Both are **write-once**, enforced by `app.organizations_provenance_immutable()` — a reward paid on a mutable field is a reward paid to whoever wrote last. *"Which salesperson referred this showroom?"* is one query, forever. **No wallet, points balance, leaderboard, or reward calculation exists.**

---

## 3. Personal `/home` — product pass

Pilot UAT reported the previous home as *"waiting to be approved"*, too narrow, and diagnostic-feeling. Both root causes were reaches for the wrong end of an **existing** scale, not missing tokens:

| | Before | After |
|---|---|---|
| Content column | `max-w-[900px]` | **`max-w-[1120px]`** |
| Page title | `text-title` (1.25rem — 1.4× body) | **`text-headline`** (2rem) |
| What leads | two status panels | **identity + real actions** |
| Completeness / verification | two large cards at the top | a compact **secondary strip** at the end, still separate from each other |
| Consumer "coming soon" | three prominent cards | **one footnote** |

The first message after onboarding now reads *your account is ready, use Aladdin* — never *your account is waiting*. Verification copy states plainly that it affects trust and discoverability, **not** access.

- **Consumer** leads with the **project brief** — real data this account owns, and exactly what a consultation-first platform needs. `Add a business` stays available: a consumer may own a business without becoming a second user.
- **One professional structure** serves all five personas (Engineer · Interior Designer · Installer/Technician · Contractor · Salesperson) with persona-aware content — not five page architectures. The Salesperson variant adds the affiliation panel, which reports a **connection**, never an account state.
- The **workspace switcher** keeps `Add business` and `Connect a showroom` visibly separate. Collapsing them is precisely how a salesperson ends up creating a duplicate of their own employer.

---

## 4. What shipped

| Area | |
|---|---|
| Migrations | `20260815090001_persona_organization_type_separation`, `20260815090002_showroom_affiliation` |
| New tables | `organization_join_requests`, `organization_referrals` |
| New types | `persona_type`, `organization_type`, `affiliation_request_status`, `referral_status` |
| Dropped | `public.account_type` |
| New RPCs | `showroom_directory_search`, `showroom_branches`, `showroom_join_request_create` / `_cancel`, `my_showroom_affiliations`, `my_showroom_referrals`, `org_join_requests_list`, `org_join_request_approve` / `_reject`, `showroom_referral_save` / `_submit`, `admin_showroom_referrals_list`, `showroom_referral_approve` / `_reject` |
| New routes | `/home/showroom`, `/home/showroom/refer` |
| Extended surfaces | `/b2b/organization` (join requests), `/admin/verifications` (referral review) |

## 5. Validation

| Gate | Result |
|---|---|
| frontend typecheck | ✅ |
| frontend lint | ✅ 0 errors, 0 warnings |
| unit tests | ✅ 204/204 |
| bilingual parity gate | ✅ exact EN/AR key parity |
| `supabase db reset` | ✅ clean, both seeds |
| pgTAP | ✅ **729/729** across 29 files (79 new — all fourteen required DB acceptances) |
| targeted Playwright (desktop 1440×900) | ✅ **9 passed / 0 failed, no retries** — all ten required journeys |
| targeted Playwright (mobile Pixel 5) | ✅ **8 passed / 1 flaky** — journey 4 timed out once at the decline step under the slower emulation and passed on retry #1 |
| production build | ✅ (Playwright runs against `next build` + `next start`) |

Repository-wide E2E, Lighthouse and the full persona matrix were deliberately **not** run — this is a feature sprint, not the final Integration Gate. No `.pen` file was touched.

## 6. Out of scope (unchanged)

Points / rewards calculation · salesperson wallet · leaderboard · commission engine · account deactivate/delete · payments · invoices · AI · Community · Academy · advanced analytics · broad Admin redesign · a generic new permission system · a generic `workspaces` table · persona/profile switching. **Referral attribution for future points is in scope; the points system is not.**
