# UI, Authentication, Registration & Onboarding Audit (Sprint 7.0)

| | |
|---|---|
| **Status** | Audit (read-only) · 2026-08-06 |
| **Branch** | `chore/ui-auth-onboarding-audit` (from `main` @ `7715c37`, PR #9 merged) |
| **Scope** | Sign-in, B2B shell + sales surfaces, auth/account access, registration entry, persona onboarding. **Evidence-based; no code/`.pen`/DB was changed.** |
| **Sources** | `frontend/src/app/**`, `frontend/src/server/actions/auth.ts`, `frontend/src/server/auth/session.ts`, `frontend/src/features/auth/**`, `UI-UX/design.pen` (via Pencil MCP export), `UI-UX/UI_UX_SYSTEM_GUIDE.md`, identity migrations `2026080209000x`/`20260803090001-2`/`20260804090001`, `docs/product/PRODUCT_DIRECTION_GUIDE.md`, `mvp-scope.md` |

Recommendations below are labelled **[REC]** — they are proposals, not existing requirements.

---

## 1. Executive status

- **Sales workspace (B2B) is functionally client-usable** and was hardened through Sprint 6 (RLS, Realtime, dirty-form safety, executed visual-QA at 4 viewports × en/ar × light/dark). It is **engineering UI built on the approved design system tokens/components**, not a render of canonical `design.pen` workspace screens — visually *good and consistent*, but not yet the premium "Aperture" treatment the design intends for marquee surfaces.
- **Authentication is Sign-In-only, Email-OTP-only.** `requestEmailOtp` uses `shouldCreateUser:false` (no enumeration, never creates a user). There is **no Sign Up, no registration, no onboarding, no phone/WhatsApp OTP** in code.
- **The full registration + onboarding + upgrade journey is extensively DESIGNED** in `design.pen` (Sign In premium, Registration, Basic Profile, Account-Type Selection, Professional Onboarding, Business Onboarding, Upgrade & Activation) — but **0% implemented**.
- **The identity backend already supports the workflow spine** (auth→profile bootstrap trigger, `request_account_upgrade` + verification review + `apply_account_upgrade`, `membership_invite`/`membership_activate`) — but **no UI reaches it, and nothing creates a new `auth.users` row from the app**, so a new user cannot self-register today.
- Several **product decisions are undefined** (channel policy, public vs invite-only, payment-in-upgrade, recovery). The design canvas itself flags one: *"BLOCKED — PRODUCT DECISION REQUIRED"*.

---

## 2. Current route / screen inventory (implemented)

| Route | Purpose | Readiness |
|---|---|---|
| `/` | redirect → `/b2b` | functional (no public landing) |
| `/auth/sign-in` | Email-OTP two-step sign in (single centered card) | **functional, visually incomplete** (no Brand Panel, no WhatsApp tab) |
| `/b2b` | Sales cockpit (my leads, overdue/today, stage counts, activity) | functional, visually acceptable |
| `/b2b/customers` · `/new` · `/[id]` · `/[id]/edit` | customers list / create / detail / edit (+ ownership) | functional, client-usable |
| `/b2b/leads` · `/new` · `/[id]` · `/[id]/edit` | leads list+pipeline / create / detail / edit (+ source/branch) | functional, client-usable |
| `/b2b/follow-ups` · `/[id]/edit` | follow-up board / edit + reassign | functional, client-usable |
| `/b2b/error` · `/loading` · `/not-found` | route-level states | functional |
| `/api/health` | health probe | n/a |

**~12 product screens implemented**, all under Sign In + one B2B surface. B2C, Professional, Admin, and all registration/onboarding surfaces = **0 routes**.

---

## 3. UI-UX reference mapping (canonical `design.pen`)

`design.pen` top-level groups: Consumer, **Authentication & Account Access**, **Professional & Talent**, **B2B Business**, Admin, Shared/System, Foundation, Archive. Designed flows relevant here:

| Design flow | Screens (device × theme × AR designed; EN via bilingual system) | Implemented? |
|---|---|---|
| **02.1 Sign In** | 02.1.1 Sign In, 02.1.2 WhatsApp OTP, +Invalid/Cooldown/Delivery-Failed/Verifying states, 02.S1/S2 specs | **Partial** — email step only, no split-panel, no WhatsApp |
| **03.1 Registration** | Select Verification Method → Phone/Email Registration → WhatsApp/Email OTP → Account Created | **No** |
| **03.2 Basic Profile** | Personal Information → Contact Information (Phone/Email primary) → Consent | **No** |
| **04 Account-Type Selection** | User Intent → Professional Type / Business Type (+ details/comparison) | **No** |
| **05.2 Professional Onboarding** | Identity → Services & Skills → Service Location → Portfolio → Verification Requirements → Review (6) | **No** |
| **05.3 Business Onboarding** | Business Identity → Official Info → Public Address → Branches & Coverage → Products/Services → Responsible Contact → Documents → Review (8) | **No** |
| **07.1 Upgrade & Activation** | Introduction → Direction → Type → **Plan/Billing → … → Verification Checkpoint → Approved → Payment → Activated** (17) | **No** |
| Sales workspace (cockpit/CRM) | Not found as canonical numbered screens in the auth/prof/B2B export (10.1.1 *Business* Cockpit exists; sales CRM screens are engineering-built) | **Impl. w/o canonical screen** |

**Reusable design components already authored** (map 1:1 for future work): Button Primary/Secondary/**WhatsApp**, Language Switcher, Logo Lockup, Text Input, **Phone Input EG**, **Segmented Toggle** (email/phone), **OTP Cell / OTP Input Group**, Checkbox, Inline Alert, **Progress Header**, **Account Type Card / Detailed / Account Intent Card / Verification Method Card**, **Verif Badge**, **Req Item**, **Review Row**, **Doc Upload Card**, **reCAPTCHA**, App Status Card, Timeline Item, **Email/WhatsApp Delivery State**, Help Drawer, Sidebar Item, Stat Tile.

---

## 4. UI quality gap matrix (implemented surfaces)

| Surface | State | Closest UI-UX ref | Major gaps |
|---|---|---|---|
| Sign in | functional, visually incomplete | 02.1.1 | No desktop **split-panel/Brand Panel**; single card; no WhatsApp OTP tab; no premium Aperture treatment |
| B2B shell | functional | (workspace shell rules in guide) | Header-bar nav, not the canonical **collapsible sidebar**; account area minimal |
| Cockpit | functional | dashboard UX rules | Acceptable action tiles; not a canonical cockpit frame; visual polish pending |
| Customers/Leads/Follow-ups | functional, client-usable | design-system components | Hand-built lists (guide asks TanStack data-grid for non-trivial); polish/empty-state art pending |
| Dialogs | client-ready | ConfirmDialog rules | Accessible (focus trap/Escape/restore verified Sprint 6.2); good |
| Empty/loading/error/permission | functional | Shared/System states | Present and localized; not the designed illustrated empty states |
| Mobile nav | functional | bottom-nav | Works (verified); reachable |

Cross-cutting (verified green in Sprint 6.2): **RTL/LTR, light/dark, 360/390/768/1440, no horizontal overflow, dialog focus management, ≤2.5s LCP.** Primary UI debt is **premium visual fidelity + sidebar shell + sign-in split-panel**, not correctness. One benign `/favicon.ico` 404 (no approved icon asset outside `.pen`).

---

## 5. Authentication / account-access gap matrix

| Capability | Classification | Evidence |
|---|---|---|
| Sign In | **implemented** | `requestEmailOtp`/`verifyEmailOtp`; `sign-in-form.tsx` |
| Email OTP | **implemented** | `signInWithOtp({email})` |
| Resend OTP | **implemented** (cooldown) | `sign-in-form.tsx` ResendButton (reuses send) |
| Change email (pre-verify) | **implemented** (UI reset to step 1) | `handleChangeEmail` |
| Sign Up / public registration | **designed, not implemented** | 03.x designed; no route; `shouldCreateUser:false` |
| Invitation-only registration | **partially (backend only)** | `membership_invite` requires an **existing** `user_id`; no email-invite-to-new-user, no UI |
| Phone OTP | **designed, not implemented** | 03.1.2A/03.1.3A designed; code email-only |
| WhatsApp OTP | **designed, not implemented** | 02.1.2/03.1.3A + WhatsApp components; code email-only |
| One- vs two-channel verification | **product decision + designed** | product: verify **one** primary, secondary later; design: Select Method + Contact Info step |
| Duplicate email/phone | **undefined product decision** | no rule in code/docs; DB has intra-org phone dedup only (sales), not identity |
| Terms / Privacy / pilot consent | **designed, not implemented** | 03.2.3 Consent (Terms, Privacy, operational, marketing, WhatsApp offers) |
| Locale selection | **implemented (switcher)**; onboarding step **designed** | `NEXT_LOCALE` cookie + Language Switcher; Basic Profile "preferred language" field |
| Activation state | **backend implemented, no UI** | `users.status` default `pending_verification`; `apply_account_upgrade`; no UI surfaces state |
| Manual org activation | **backend implemented, no UI** | `membership_activate`; review RPCs |
| Registration abandonment / resume | **undefined; no design** | no autosave/resume design or code found |
| Change phone (post-account) | **missing** | no design/impl |
| Account recovery / lost verification channel | **missing / undefined** | no recovery/support/lost-access screen in `design.pen`; no code |
| Support path (lost channel) | **missing / undefined** | only registration-time "Change Verification Method"; no post-account support flow |

**Auth summary:** 4 capabilities implemented (sign-in, email OTP, resend, change-email-pre-verify); **~10 designed-but-unimplemented**; **~5 missing/undefined** (duplicates, recovery, support, resume, change-phone).

---

## 6. Registration journey map (current reality)

- **Guest entry:** `/` → `/b2b` → middleware → `/auth/sign-in`. **No Sign Up entry; Sign In and Sign Up are not distinguished** (only Sign In exists).
- **OTP flow reuse:** Sign In uses email OTP; the designed registration reuses the same OTP component family (email/phone) — **not yet shared in code**.
- **Locale:** selected via header Language Switcher (cookie); design also collects "preferred language" in Basic Profile.
- **Legal consent:** collected nowhere in code; **designed** at 03.2.3 (Terms + Privacy + operational + marketing + WhatsApp).
- **Account type / persona:** chosen nowhere in code (DB default `end_consumer`); **designed** at 04.x (User Intent → Professional/Business Type).
- **After OTP verification:** `verifyEmailOtp` → `redirect('/b2b')`. No profile/consent/persona step; a non-org user lands on the **No-Organization notice**.
- **Abandonment/resume:** none — no draft state, no resume.
- **Existing email:** Sign-In send is indistinguishable for known/unknown emails (anti-enumeration); there is **no "email already exists → Sign In" redirect** because there is no Sign Up to collide with.
- **Unactivated account:** `users.status='pending_verification'` exists in DB but **no UI communicates activation state**; a user with no membership sees the generic No-Org notice.

---

## 7. Persona onboarding matrix

Account types in DB (`account_type`): end_consumer, installer_technician, engineer, interior_designer, showroom_dealer, supplier, manufacturer, importer, wholesaler, **sales**, contractor, trainer, trainee, administrator.

**Shared onboarding shell found in design:** `Progress Header` (Step X of Y) + `Sticky Mobile Onboarding Footer` + the common **Basic Profile** steps (Personal → Contact → Consent) and **Account-Type Selection** (User Intent → Type). Persona-specific work then branches into **Professional Onboarding (05.2)** or **Business Onboarding (05.3)**, with the **Upgrade/Activation (07.1)** flow gating professional/business status via verification (+ payment as designed).

| Persona | Org relationship | Verification/review | Activation condition | First destination | Designed | Implemented |
|---|---|---|---|---|---|---|
| End consumer | none | none | immediate | consumer/discovery | Registration+Basic Profile (03.x) | No |
| Engineer / Interior Designer | individual (may add org) | **doc review** (05.2.5) | approved (+plan, designed) | professional workspace | Prof. Onboarding 05.2 (6) | No |
| Installer/Technician | individual | doc review | approved | professional workspace | Prof. Onboarding 05.2 | No |
| Contractor | individual/company | doc review | approved | professional/business | 05.2 (+05.3 if company) | No |
| Showroom/Dealer | organization | doc review (05.3.7) | approved | business cockpit | Business Onboarding 05.3 (8) | No (10.1.1 cockpit designed) |
| Supplier | organization (registered address, no walk-in variant) | doc review | approved | business cockpit | 05.3 (+05.3.3S1) | No |
| Manufacturer/Importer/Wholesaler | organization | doc review | approved | business cockpit | 05.3 (Business Type 04.2.2) | No |
| Salesperson | **invited** into org, branch-scoped | none (capability-granted) | membership `active` | **B2B sales workspace (implemented)** | invite is backend-only | Workspace yes; **join flow no** |
| Org owner/manager | creates org | org verification (05.3) | membership `active` + org verified | business cockpit | 05.3 Business Onboarding | No |
| Invited org employee | joins existing org | none | `membership_activate` | derived workspace | **no invite-accept design/UI**; RPC needs existing user | No |

**Undefined for personas:** exact per-type document requirements; whether persona is chosen at registration or only via **Upgrade (07.x)**; how an **invited employee who doesn't yet have an account** is created (RPC needs a pre-existing `user_id`).

---

## 8. Unresolved decision register

**[REC] = recommended Pilot default (a proposal, not a requirement).** Owner approval required before implementing any row marked ✔.

| # | Question | Evidence | [REC] Pilot default | Risk | Approval? |
|---|---|---|---|---|---|
| D1 | Email vs phone vs WhatsApp OTP | code=email; design=all three; product="WhatsApp/Email OTP" | **Email OTP for pilot; ship WhatsApp next** | WhatsApp is culturally expected in EG — email-only may feel off | ✔ |
| D2 | When to collect 2nd contact channel | product: "secondary later in settings"; design: Contact Info step | **Verify one at registration; 2nd optional in profile** | asking both up front adds friction | ✔ |
| D3 | Sign In vs Sign Up distinction | only Sign In exists; design has both | **Add a distinct Sign Up entry reusing the OTP family** | conflating them risks silent sign-up / enumeration | ✔ |
| D4 | Duplicate email | no identity-level rule | **One identity per verified email; existing email → Sign In** | must avoid enumeration in copy | ✔ |
| D5 | Duplicate phone | intra-org sales dedup only | **One identity per verified phone** | shared family numbers in EG | ✔ |
| D6 | Public vs invitation-only registration | `shouldCreateUser:false`; no reg path | **Public self-registration for consumer + upgrade; invite for org employees** | open registration → spam/abuse without reCAPTCHA | ✔ |
| D7 | Manual org/professional activation | review RPCs exist; payment designed | **Manual review-based activation; NO payment in pilot** (payments deferred per product) | design assumes payment gate — must decouple | ✔ |
| D8 | Account recovery / lost channel | none designed/implemented | **Support-assisted recovery + add 2nd channel early** | account lockout with a single channel | ✔ |
| D9 | Registration resume | none | **Autosave draft + resume from Progress Header** | abandonment loss without it | (design later) |
| D10 | Consent requirements | design: Terms+Privacy+operational+marketing+WhatsApp | **Require Terms+Privacy+pilot consent; marketing opt-in** | legal/PII exposure if skipped | ✔ |
| D11 | Persona/account-type mutability | product: one current type; DB upgrade path exists | **Set at registration; change only via reviewed Upgrade** | free switching breaks derived-nav model | ✔ |

---

## 9. Recommended implementation sequence

| Sprint | Objective | Routes | Major components | DB impact | Decisions first | Acceptance |
|---|---|---|---|---|---|---|
| **7.1 Client-Ready UI Foundation** | Bring sign-in + shell to canonical fidelity (split-panel, sidebar shell, empty/loading polish, favicon) | `/auth/sign-in`, `/b2b/*` shells | Brand Panel, Sidebar, Progress Header, empty-state art | **No** | D1 (channel for the OTP UI) | sign-in matches 02.1.1; sidebar shell; a11y/RTL/theme parity; console clean |
| **7.2 Account Access & Registration** | Sign Up entry + registration (Select Method → OTP → Account Created), consent | `/auth/sign-up`, `/auth/verify` | Verification Method Card, OTP Input Group, reCAPTCHA, Consent | **Maybe** (create-user path; RLS unchanged) | D1,D3,D4,D5,D6,D10 | new user self-registers (email); anti-enumeration; consent stored |
| **7.3 Shared Onboarding Engine** | Progress-header shell + Basic Profile (Personal → Contact → Consent) + Account-Type Selection; autosave/resume | `/onboarding/*` | Progress Header, Account Intent/Type Cards, Sticky Footer | **Maybe** (profile writes via RPC) | D2,D9,D11 | one shell drives all personas; resume works; lands per persona |
| **7.4 Individual Persona Onboarding** | Professional Onboarding (05.2) → verification submit | `/onboarding/professional/*` | Doc Upload Card, Req Item, Review Row, Verif Badge | **No** (uses `request_account_upgrade`) | D7,D8 | professional completes 6 steps → verification submitted |
| **7.5 Business/Org Onboarding** | Business Onboarding (05.3) + org creation + employee invite/accept | `/onboarding/business/*`, invite accept | Doc Upload, Branches, Review; invite-accept | **Yes-ish** (invite-new-user path if adopted) | D6,D7 (payment decoupling), invite-new-user | org created + verified; employee joins & lands in workspace |
| **7.6 Existing Sales UI Client-Ready Polish** | Raise implemented CRM surfaces to premium fidelity (data-grid, cockpit frame) | `/b2b/*` | data-grid, cockpit tiles | **No** | — | visual parity with design system; no regressions to Sprint-6 gates |

---

## 10. Exact next-sprint recommendation

Start with **Sprint 7.1 — Client-Ready UI Foundation** (sign-in split-panel + workspace sidebar shell + empty/loading polish + favicon): it is **UI-only, no DB change, minimal unresolved decisions** (only D1's channel choice for the OTP UI), it delivers immediate client-facing quality, and it establishes the shell that 7.2/7.3 onboarding will plug into. Registration (7.2) should not begin until **D1, D3, D4, D5, D6, D10** are approved by the product owner.
