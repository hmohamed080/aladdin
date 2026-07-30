---
description: Scoped agent instructions for the Aladdin Pencil design files.
alwaysApply: true
---

# UI-UX — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `UI-UX/`.

## Canonical design file

- **`UI-UX/design.pen` is the single canonical Aladdin design file.**
- The `design.BACKUP-*.pen` files are **historical safety snapshots**. They are never the working file.

## Absolute rules

- **Do not rename, duplicate, rebuild, modify, or delete** `design.pen` or any backup.
- **Do not create another canonical design file.**
- **Coding tasks must not edit `.pen` files.** Design changes happen only in the Pencil editor via the `mcp__pencil__*` tools, and `.pen` files are opaque/encrypted — never `Read`, `Grep`, or `cat` them.
- **Internal session labels and design-agent notes must never enter production UI.** When implementing a screen, copy the *approved visual/content*, not scaffolding annotations (QA labels, "SAMPLE/DEMO" ribbons, session tags).

## Implementation reference

Front-end work implements **approved screens** from `design.pen`. Confirm a screen is approved (current QA authority: board `00H`) before building it — do not trust historical QA boards or prior "complete/ready" labels.

## Storage & versioning policy (recommended)

`.pen` files are large (canonical ~6 MB; backups ~2–5.5 MB each) private design IP. They are **gitignored** (`*.pen`) and must **not** enter public Git history.

Recommended versioning:
- Keep `.pen` files in **private** storage (private object storage / a private design vault / Git LFS on a **private** remote).
- Retain the `BACKUP-*` snapshots as the recovery trail; add new dated snapshots before risky edits rather than overwriting.
- If Pencil design files ever need Git versioning, use a **private** repository or Git LFS — never the public application repo.

---

# Design System & UX Guidelines

These rules govern **both** design work in `design.pen` **and** its frontend implementation. `design.pen` is the visual source of truth; the frontend design system (Tailwind theme + semantic CSS variables) must **extract** these tokens from the approved screens, not re-invent them. Where a concrete value (hex, typeface, spacing) is a **design token**, it is defined in `design.pen` and mirrored into `frontend/src/styles` + Tailwind theme — this document names the tokens and the rules, not ad-hoc values.

> **Approval reality:** final logo, typeface, and brand color *values* are **not approved yet** (founder brief). Do not hardcode a "final" brand. Build against **semantic tokens** so approved values drop in later without refactors.

## Brand Vision
- Aladdin is a **premium, trustworthy, AI-first operating system** for Egypt's finishing, construction, interior design, furnishing, and supply sector — **B2B-first** with a connected B2C consultation layer.
- The feel is **calm authority**: confident, uncluttered, expert — a professional tool, not a flashy consumer marketplace.
- The **canonical premium direction** is the phone/OTP verification screen family. The old flat "Basic Information / Contact Information" look is the **rejected** direction — do not reproduce it.

## Design Philosophy
- **Consultation-first, not commerce-first.** The product guides *Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up*. Never frame flows as add-to-cart/checkout.
- **Clarity over decoration.** Every element earns its place; whitespace and hierarchy do the work before color or ornament.
- **One system, three surfaces.** B2C (discovery), B2B workspace (Sales is the key daily user), Admin (intentionally darker/utilitarian) share tokens and components — they are skins of one system, not three designs.

## UX Principles
- **Show the next best action.** Screens lead to a real action (a cockpit tile leads to a workflow, not a dead end).
- **Progressive disclosure.** Ask for the minimum now; defer the rest to profile/settings (mirrors the passwordless one-primary-contact flow).
- **Trust signals over hype.** Verification, ratings, and provenance are surfaced; no pushy pricing pressure.
- **Bilingual by construction.** Every layout works identically in Arabic (RTL) and English (LTR).
- **No technical leakage in copy.** Never surface implementation terms ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", server notes).

## Information Hierarchy
- Each screen has **one primary object** and one primary action; everything else is secondary/tertiary and visually subordinated.
- Order of emphasis: **eyebrow/step → title → primary content → supporting → actions.** The `Progress Header` eyebrow ("Step X of Y") sets context on flow screens.
- Use size, weight, and `$text-secondary`/muted tokens to encode rank — **not** color alone.

## Grid & Layout System
- **Mobile** flow-screen recipe (canonical): header row = **language switcher (leading)** + **back row (trailing:** "Back/رجوع" label + chevron pointing toward the back direction**)**, header padding `[16,20]`, **no border**; body gutters `[·,24]`, vertical gap `16`.
- **Desktop auth/marketing** = **split panel**: Brand Panel (3D-style artwork, later video/WebGL) + Form Panel. Do not flatten these into a single centered column.
- **Progress track widths:** mobile ≈ `342px`, desktop ≈ `960px`; bar width = `ratio × track`.
- Content max-widths keep line lengths readable; workspace/dashboard uses a consistent content column beside the sidebar.

## Typography
- Type scale is **token-driven**: `$fs-label` (≈13), `$fs-body` (≈14), `$fs-body-lg` (≈16), plus heading steps — all from `design.pen`.
- Field pattern: **label `$fs-label`**, **value `$fs-body-lg`**, leading icon `20`.
- The chosen typeface **must have first-class Arabic + Latin coverage** and matching metrics/weights across both scripts. Until a face is approved, use the design token family; never commit a "final" font choice here.
- Never encode meaning with italics in Arabic; use weight/size/color tokens instead.

## Spacing Rules
- Spacing is a **token scale** (4-based); use tokens, never arbitrary pixel values.
- Canonical rhythm: screen gutters `24` (mobile body), header padding `[16,20]`, inter-field gap `16`, field height ≈ `64`.
- Group related fields with tighter gaps; separate sections with larger gaps — spacing, not dividers, is the first grouping tool.

## Color System
- **Semantic tokens only** in UI and code: `$text` / `$text-secondary`, surface/background, `$border` / `$border-strong`, primary/accent, and status (success/warning/danger/info). Concrete values live in `design.pen` tokens and map to CSS variables + Tailwind theme.
- **Every color exists in both light and dark** with adequate contrast in each — a token is incomplete if only one theme is defined.
- Color is a **reinforcement**, never the sole signal (pair with icon/label/shape) — required for accessibility and RTL parity.
- Do **not** introduce raw hex in components; add/adjust a token instead.

## Dark Mode Rules
- The **only** theme axis is `mode: light/dark`. Platform/device/language are naming lanes, **not** theme axes — never fork a component per language for theming.
- Dark is a **first-class, designed** theme (not an inverted filter): surfaces use layered elevation, borders shift to `$border-strong` equivalents, and contrast is re-verified against WCAG AA in dark.
- **Admin surfaces are intentionally dark** by default — keep that deliberate, don't "fix" it to light.
- Implement via a `dark` class on `<html>` (Tailwind `darkMode: "class"`); tokens resolve per theme.

## Navigation System
- **Surface-appropriate navigation:** B2C = discovery-style top navigation + prominent search; B2B/Admin = **workspace shell with a sidebar**. Same account switches surfaces via **active-profile switching** (roles stay separate).
- Primary nav exposes the core journeys, not an exhaustive site map. Keep depth shallow; provide breadcrumbs in deep workspace flows.
- Navigation is fully **RTL-mirrored** (leading/trailing, chevron direction, back gestures) in Arabic.

## Sidebar Behavior
- Persistent on desktop workspace; **collapsible** to icons; off-canvas drawer on mobile/tablet.
- Reflects the **active profile/role** — items a role can't use are hidden, not shown-disabled (authorization is also enforced server-side; the UI never implies access it can't grant).
- Active item is unambiguous (token-based active state); collapsed state keeps icon + accessible label.
- Mirrors to the **trailing edge in RTL**.

## Dashboard UX
- Dashboards/cockpits are **action surfaces, not vanity walls.** Every tile answers "what should I do next?" and links to a real workflow (Sales cockpit → Opportunity/Need/Match/Follow-up/Quote/Pipeline/Task).
- Lead with the operator's live pipeline/queue; summaries and charts support, they don't headline.
- Dashboards are built **after** the inner workflows they summarize exist (roadmap: 05E last).

## CRM Workflow UX
- Sales is the **key daily-active user**; optimize for speed and low friction: keyboard-friendly, minimal clicks from Opportunity → Quote.
- Model the pipeline as explicit **stages** with clear status, next-step, and owner; status changes stream live (see Notifications/Realtime).
- **Smart Share** and follow-up drafting are AI-assisted but always **human-reviewable** before send; never auto-send on the user's behalf silently.
- Keep record, activity timeline, and next action visible together — no hunting across tabs for context.

## Tables & Data Views
- Use a real data-grid pattern (TanStack Table) for sortable/filterable/paginated business data; not hand-rolled tables for anything non-trivial.
- **Server-side** sort/filter/paginate for large sets; never fetch unbounded rows.
- Column set is intentional: identity + status + key metric + action. Support row density appropriate to the surface; make row actions discoverable, not hover-only on touch.
- Empty leading/utility cells are **explicit, named** structure (not "broken"); every column has a header (even if visually empty by design).
- Numbers/dates/currency use locale + **EGP** formatting; align numerics; RTL tables mirror column order.

## Forms & Validation
- **React Hook Form + Zod**; the Zod schema is the single validation source shared client/server. Validate at boundaries, trust internal state.
- Field anatomy: label `$fs-label`, value `$fs-body-lg`, `20` icon, `$radius-md`, height ≈ `64`, `$border-strong` stroke; consistent across the app.
- **Inline, specific, non-blaming** errors next to the field; summarize only for long forms. Validate on blur/submit, not on every keystroke.
- **Passwordless:** no password/confirm-password/forgot-password fields anywhere. OTP/verification uses the approved verification-field component.
- Long flows support **autosave / save-and-continue** with a visible indicator; show a `Progress Header` with step count.

## Modals & Drawers
- Use sparingly for **focused, interruptive** tasks. Prefer a **drawer** for contextual side-tasks that keep the parent visible; a **modal** for a blocking decision.
- Never nest modals. One clear primary action; explicit dismiss; **Esc + backdrop** close (unless data-loss risk → confirm).
- Trap focus, restore focus to the trigger on close, and lock background scroll. Full-screen sheets on mobile instead of cramped centered modals.
- **Do not trigger native browser dialogs** (`alert`/`confirm`) — use in-app components.

## Notifications
- Real-time surfaces (via Supabase Realtime) for: notifications, opportunity status, task updates, verification status, project activity, inventory availability, quotation status.
- **Match urgency to mechanism:** toast for transient confirmations, inline banners for contextual state, a notification center for history. Don't toast critical, actionable items that need a decision.
- Toasts auto-dismiss (non-critical), are pausable on hover/focus, and are announced to assistive tech. Never convey a status by color alone.

## Empty States
- Every list/table/dashboard has a **designed** empty state — never a blank area. Explain what goes here and offer the **primary action** to fill it.
- Distinguish **empty** (nothing yet) from **no results** (filters too narrow → offer "clear filters") from **error** (something failed → offer retry).
- Keep tone helpful and specific to the surface; no generic "No data."

## Loading States
- Prefer **skeletons** that match final layout for content regions (reduces layout shift); use spinners only for small inline/button waits.
- **Optimistic UI** for quick, low-risk mutations with rollback on failure. Disable + show progress on submit buttons to prevent double submit.
- Never block the whole screen for a partial update. Long/expensive work (OCR, imports, embeddings) runs in the background with progress + Realtime status, not a frozen UI.

## Accessibility
- Target **WCAG 2.1 AA**. Contrast verified in **both** light and dark.
- Full **keyboard** operability; visible focus states (token-based); logical tab order; focus management in modals/drawers/route changes.
- Semantic HTML + ARIA only where semantics fall short; all interactive controls have accessible names; icons-only buttons carry labels.
- Respect `prefers-reduced-motion`; never convey meaning by **color alone**; hit targets ≥ 44px on touch.
- **RTL is an accessibility requirement**, not a nicety: correct `dir`, mirrored layout/icons, and correct bidi handling of mixed AR/Latin/numeral content.

## Animation System
- Motion is **functional**: orient, show relationships, confirm actions — never decorative filler.
- Token-based durations/easing; keep UI transitions short (≈150–250ms) with standard easing; avoid long, blocking animations.
- Animate transform/opacity (cheap), not layout properties. Everything **honors `prefers-reduced-motion`** (reduce to instant/opacity).
- Ambitious visuals (auth Brand Panel 3D/WebGL/video) stay **isolated to their surface** and must degrade gracefully.

## Responsive Design Rules
- Design **Desktop + Tablet + Mobile** (PWA); the design lanes are naming lanes, not separate products.
- **Mobile-first tokens**, enhance up. Reflow, don't shrink: sidebar → drawer, table → stacked/prioritized columns, split-panel → stacked.
- Test every breakpoint in **both** LTR and RTL and **both** themes. Touch targets and gutters follow the spacing tokens.
- The page body never scrolls horizontally; wide content (tables, wide cards) scrolls within its own container.

## Component Consistency Rules
- **Reuse the component library first** (~127 canonical components in `design.pen`). Do not create a near-duplicate; extend or add a variant to the existing master.
- One canonical component per concept (one field, one button system, one alert, one progress header). Prefer instance overrides (`descendants`) over forked copies.
- Frontend components map 1:1 to design-system components and consume **tokens**, not literals. A visual change happens at the token/component level, propagating everywhere.
- Confirm a screen/component is **approved** (QA authority: board `00H`) before implementing — ignore historical QA boards and prior "complete/ready" labels.

## Anti-Patterns To Avoid
- **Commerce framing:** add-to-cart, checkout, buy-now — this is consultation-first.
- **Password UI:** sign-in-with-password, forgot/reset-password — the product is passwordless (WhatsApp/Email OTP).
- **Technical copy in UI:** "WhatsApp Business API", "reCAPTCHA verified on server", "canonical account", schema/stack jargon.
- **Design-scaffolding in production:** QA labels, "SAMPLE/DEMO" ribbons, session/agent tags, placeholder lorem.
- **Merging roles** because they look similar — roles stay separate (End Consumer, Installer, Engineer, Interior Designer, Showroom, Supplier, Manufacturer, Importer, Wholesaler, Sales, Contractor, Trainer, Trainee, Admin).
- **Inventing an approved brand** (final logo/font/hex) before sign-off; hardcoding raw hex/fonts instead of tokens.
- **The rejected flat direction** ("Basic/Contact Information" old look) instead of the premium OTP direction.
- **Color-only signaling**, single-theme tokens, non-mirrored RTL, dead-end dashboard tiles, hover-only actions on touch, native `alert/confirm` dialogs, unbounded tables, and full-screen blocking spinners for partial updates.
- **UI implying access it can't grant** — authorization is enforced server-side (RLS); never show data or actions a role isn't entitled to.
