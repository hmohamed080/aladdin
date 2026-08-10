# Sprint 11 — Pilot Personas, Admin Operations & Connected Demo World

**Branch:** `feature/mvp-pilot-readiness` · **Base:** `main` @ Sprint 10 (`2ef6205`)
**Goal:** make the Aladdin B2B Pilot usable as a **connected multi-role product** — every
persona has an account → correct landing → correct UI → correct capabilities → realistic
data → meaningful interaction with the other personas — and replace the developer-only Admin
experience with a real in-product Admin console.

This is a **feature** sprint. The repository-wide MVP integration audit is intentionally **not**
run here.

---

## 1. What shipped

| Area | Change |
|---|---|
| **Persona landing** | Landing is now **derived**, not hardcoded to `/b2b`. `resolveActiveLanding()` routes platform staff → `/admin`, an active org member → `/b2b`, and a consumer / org-less individual → a new non-B2B `/home`. Every `active_personal → /b2b` redirect in the onboarding funnel now goes through this resolver. |
| **Capability-aware navigation** | `allowedNavKeys(capabilities)` filters the workspace nav per membership capability (`org.manage` is a blanket in-org unlock, matching the trusted RPCs). A branch salesperson sees only the CRM; a catalog manager sees Products/Catalog; owners see everything; the **Organization** (people-ops) item is gated on `org.members.manage`. |
| **Consumer home** | `/home` — a slim, non-B2B destination (never the Sales cockpit) with profile-aware greeting and discovery/advice empty states. Bilingual. |
| **Organization people ops** | `/b2b/organization`: manager-gated roster (masked identity via the trusted `org_members_list` read-model), invite-by-email (existing token `invitation_create`), capability-preset **roles**, branch-scope assignment, and suspend/reactivate/revoke — all over existing trusted RPCs. |
| **Admin console** | Platform-staff-gated `/admin` with a dense Aladdin-branded shell: dashboard (KPIs + distributions + recent activity), users list + detail, organizations list + detail, verifications queue (approve/reject via `review_*`), and a readable audit log. |
| **Admin security** | Route guard reads `platform_role_grants`; **every** admin query stays RLS-scoped by `is_platform()`, so the guard is defense in depth, not the boundary. No RLS weakened; no client-controlled privilege path. |
| **Connected Pilot world** | `supabase/seed-pilot.sql` (loaded by `db reset` after the pgTAP-pinned base seed): 10 new identities across every distinct persona, five business orgs + branches, capability-scoped memberships, a pending token invitation, one end-to-end commercial story, and two orgs queued for Admin verification. |
| **DB** | Migration `20260812090001_pilot_people_ops.sql`: `org_members_list` read-model + refreshed `membership_set_capabilities` allow-list (adds the live `sales.*` / `order.*` keys). |

---

## 2. Pilot Account Matrix

All accounts sign in by **Email OTP** at `/auth/sign-in` (read the code from Mailpit
`http://127.0.0.1:54324`). All data is **synthetic**. `supabase db reset` recreates this world
deterministically.

### Individual personas

| Identity (email) | Persona | Organization | Branch scope | Role / key capabilities | Expected landing | Primary Pilot journey |
|---|---|---|---|---|---|---|
| `consumer@example.test` | End Consumer | — | — | none | `/home` | Non-B2B consumer home; never the cockpit |
| `yasser@example.test` | Engineer | Horizon Contracting | New Cairo | `project.read/write`, `catalog.read`, `rfq.create` | `/b2b` | Project execution + raise buyer RFQs |
| `nadia@example.test` | Interior Designer | Delta Interiors Studio (owner) | org-wide | `org.manage`, `org.members.manage` | `/b2b` | Design studio workspace |
| `ahmed@example.test` | Installer / Technician | Horizon Contracting | New Cairo | `project.read/write` | `/b2b` | Project execution |
| `mostafa@example.test` | Contractor | Horizon Contracting (owner) | org-wide | full owner set | `/b2b` | Buyer side of the commercial workflow |
| `youssef@example.test` | Salesperson | Cairo Ceramics Showroom | Nasr City | `sales.read/write` | `/b2b` | Scoped CRM (customers/leads/follow-ups) only |

### Business personas

| Identity (email) | Persona | Organization | Branch scope | Role / key capabilities | Expected landing | Primary Pilot journey |
|---|---|---|---|---|---|---|
| `hana@example.test` | Showroom / Dealer Owner | Cairo Ceramics Showroom (owner) | org-wide | full owner set | `/b2b` | Supplier side: products → RFQ → quote → order → project |
| `a-owner@example.test` | Supplier Owner | Nile Finishing Supplies (owner) | org-wide | `org.manage`, `catalog.write`, … | `/b2b` | Supplier operations |
| `tarek@example.test` | Manufacturer Owner | Egypt Marble Manufacturing (owner) | org-wide | full owner set | `/b2b` | Manufacturer workspace (org pending Admin verification) |
| `sara@example.test` | Importer Owner | Nile Import & Trade (owner) | org-wide | full owner set | `/b2b` | Importer workspace (org pending Admin verification) |
| `khaled@example.test` | Wholesaler Owner | Delta Wholesale Supply (owner) | org-wide | full owner set | `/b2b` | Wholesaler workspace |
| `laila@example.test` | Organization Manager | Horizon Contracting | org-wide | `org.members.manage`, `branch.manage`, project/buyer caps | `/b2b` | People operations + projects |
| `nour@example.test` | Invited Employee | Horizon Contracting (**pending invite**) | New Cairo (on accept) | granted on accept | invitation → `/b2b` | Accept `/auth/invite/pilotinvite000000000000000000nour01` → scoped workspace |

### Platform

| Identity (email) | Persona | Role | Expected landing | Primary Pilot journey |
|---|---|---|---|---|
| `admin@example.test` | Platform Admin | `administrator` grant | `/admin` | Manage/review platform users, orgs, verifications, audit |

> Platform authority comes **only** from `platform_role_grants` — never from `primary_account_type`.

---

## 3. The connected demo story

```
Cairo Ceramics Showroom (Hana, supplier)
  → publishes products (Porcelain Tile, Wall Paint, Marble Slab)
Horizon Contracting (Mostafa, buyer)
  → RFQ "Finishing materials — New Cairo villa"  ──▶  Cairo Ceramics
Cairo Ceramics
  → Quotation (EGP 143,000)  ──▶  Horizon (ACCEPTED)
  → Order (in progress)  →  Project (active, New Cairo villa finishing)

Horizon Contracting
  → owner Mostafa + manager Laila + engineer Yasser + installer Ahmed
  → PENDING invitation to Nour  ──▶  accept  ──▶  scoped membership

Egypt Marble Manufacturing + Nile Import & Trade
  → submitted organization verifications  ──▶  Admin queue  ──▶  approve/reject
  → result visible on the affected organization
```

---

## 4. Validation

| Gate | Result |
|---|---|
| Frontend typecheck | ✅ |
| Frontend lint | ✅ (0 problems) |
| Frontend unit tests | ✅ 163 passed (incl. new capability-nav suite) |
| Frontend production build | ✅ (all `/admin/*`, `/home`, `/b2b/organization` routes compile) |
| `supabase db reset` (base + pilot seed) | ✅ |
| `supabase db lint --schema public,app` | ✅ (only a pre-existing `set_customer_ownership` unused-variable warning) |
| pgTAP (`supabase test db`) | ✅ 579/579 (reconciled admin-count assertions in `06`; de-fragilized `14`'s org-verification lookup) |

**Targeted validation approach:** persona-access and capability-nav rules are pinned by
deterministic unit tests (`src/lib/nav/modules.test.ts`) plus the full RLS/pgTAP suite (which
exercises `org_members_list`, the capability allow-list, the review RPCs, and admin cross-tenant
reads). Per the sprint rules, no repeated full-suite Playwright loops were run and no unrelated
known flakes were touched. Browser persona-landing E2E remains for the pre-audit gate.

---

## 5. Notes / follow-ups

- Admin surfaces individual **display names** and **masked** emails only (identity PII stays out of
  the client); raw emails are never exposed to org managers or admins.
- `membership_set_capabilities` allow-list now includes the live `sales.*` and `order.*` keys — it
  had drifted behind the Sprint 3 / Sprint 10 domains.
- `supabase/demo-seed.sql` (manual Org-A sales populator) is unchanged and still available.
