# Aladdin Design System — Governance

How the Aladdin Design System ("The Aperture") is versioned, synchronized, extended, and enforced. This document is authoritative for design-system *process*; concrete values live in [`tokens/`](./tokens/), the brand language in [`../DESIGN.md`](../DESIGN.md), and UI behavior in [`../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../UI-UX/UI_UX_SYSTEM_GUIDE.md).

- **Version:** `1.0.0` · **Status:** Approved, hardened (pre-feature) · **Updated:** 2026-08-01

## Source-of-truth hierarchy

No lower source may contradict a higher one. On conflict, **stop and reconcile downward** — never silently follow the narrower source.

| # | Source | Owns |
|---|---|---|
| 1 | [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](../docs/product/PRODUCT_DIRECTION_GUIDE.md) | Product truth & constraints. |
| 2 | [`DESIGN.md`](../DESIGN.md) | Normative brand & visual-design language. |
| 3 | [`design/tokens/*.json`](./tokens/) | Canonical machine-readable token *values*. |
| 4 | [`UI-UX/UI_UX_SYSTEM_GUIDE.md`](../UI-UX/UI_UX_SYSTEM_GUIDE.md) | UI behavior, UX rules, component usage, a11y, responsive. |
| 5 | `UI-UX/design.pen` | Canonical approved screens & compositions (private, gitignored). |
| 6 | `frontend/src/styles/tokens.css` + `tailwind.config.ts` | Code implementation of the canonical tokens. |

Rules: **DESIGN.md must never contradict PRODUCT_DIRECTION_GUIDE.md. UI_UX_SYSTEM_GUIDE.md must never contradict DESIGN.md. Frontend code must never invent values outside the canonical tokens.**

### Synchronization — edit order

A token value change is edited **top-down in a single commit**:

1. `design/tokens/*.json` (canonical).
2. `DESIGN.md` frontmatter (normative mirror).
3. `frontend/src/styles/tokens.css` (CSS custom properties; primitives + `.dark`).
4. `frontend/tailwind.config.ts` (maps vars/scales to Tailwind).
5. `.impeccable/design.json` — *gitignored* local sidecar; refresh if present, never authoritative.

The same hex intentionally appears in the token JSON, DESIGN.md frontmatter, and `tokens.css`: three mirrors of one canonical value. A change touching only one is a bug. This documented duplication exists because Stitch/Tailwind and CSS need literal values; there is no compiler yet that derives them from the JSON.

## Versioning

Semantic versioning on the whole system; the `version` field appears in `DESIGN.md`, `CHANGELOG.md`, and each `tokens/*.json`.

- **MAJOR** — a breaking visual or component-contract change (renamed/removed semantic token, changed component API/anatomy, palette overhaul).
- **MINOR** — new tokens, components, states, or supported theme behavior (backward-compatible).
- **PATCH** — non-breaking corrections, documentation, or contrast adjustments.

Every version bump adds a [`CHANGELOG.md`](./CHANGELOG.md) entry (Added/Changed/Fixed/Deprecated/Removed/Migration notes) and updates the `version`/`Last updated` in `DESIGN.md`.

## New-component governance

Before creating any new component, the author (human or agent) **must**:

1. Search [`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md).
2. Search existing frontend components (`frontend/src/components/`, `features/*/components`).
3. Search approved design references (`design.pen`, QA authority board `00H`).
4. Decide whether an existing component can be **reused or extended** (prefer a variant over a new component).
5. If new, **document why** it is required (what existing component cannot do).
6. Add it to [`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md) with status, themes, directions, states, a11y, and known gaps.
7. Define **all required states** (see matrix below).
8. Validate **RTL, both themes, accessibility, and responsive** behavior before marking `Ready`.

**Naming:** semantic, responsibility-based names (`QuoteComparisonCard`, `OtpField`, `PipelineStageColumn`). **Prohibited:** `Button2`, `NewCard`, `UpdatedInput`, `FinalModal`, `ComponentCopy`, or any version/qualifier suffix. One canonical component per concept; extend, don't fork.

## Component states

Required states by component type. **State is never communicated by color alone** — pair with icon, text, weight, border, or position.

| Component type | Required states |
|---|---|
| Buttons / interactive controls | default · hover · active/pressed · focus-visible · disabled · loading |
| Inputs / selects / textareas | default · hover · focus-visible · filled · disabled · read-only · error · (success where validated) |
| Checkbox / radio / switch | default · hover · focus-visible · checked/on · disabled · error |
| Search | default · focus-visible · typing · loading · results · no-results · error |
| Cards / list items | default · hover (if interactive) · selected (if selectable) · loading (skeleton) |
| Tables | default · loading (skeleton) · empty · error · row hover · row selected · sorted column |
| Tabs / navigation / sidebar | default · hover · active/current · focus-visible · disabled (hidden, not disabled, when unauthorized) |
| Dialogs / drawers / bottom sheets | opening · open (focus-trapped) · closing · (loading/error of inner content) |
| Toasts / banners | enter · shown · pausable-on-hover · exit; severity via icon+text+token |
| Data regions | empty · no-results (filters) · loading · error · populated |

## Motion system

Tokens in [`tokens/motion.json`](./tokens/motion.json). Motion **communicates hierarchy or state**; it never decorates or delays a task.

- **Hover:** `fast` (150ms) `standard`. **Pressed:** `instant` (100ms). **State/UI transitions:** `base` (200ms) `standard`.
- **Enter/exit (dialog, drawer, bottom sheet):** `slow` (300ms); drawers `in-out`, entrances `out-expo` from an already-visible default.
- **Loading:** skeletons that match final layout for content regions; small inline spinners only for button/inline waits. Never a full-screen blocking spinner for a partial update.
- **Success/error feedback:** brief, token-timed; reinforced by icon + text, not motion alone.
- **AI streaming:** token-by-token reveal with a calm caret/cursor; no bouncing or attention-grabbing loops. The Lumen light-point may pulse subtly to signal "thinking" — bounded, `standard` easing.
- **Reduced motion:** every animation/transition collapses to near-instant under `prefers-reduced-motion` (enforced globally in `globals.css`). Content stays visible by default; effects are additive.

## Accessibility

Target: **WCAG 2.2 AA**. Do not mark an item "complete" without evidence.

### Text/UI contrast (measured 2026-08-01)

| Pair | Ratio | AA-normal (4.5) | AA-large/UI (3.0) |
|---|---|---|---|
| Light `fg` / canvas | 15.64 | PASS | PASS |
| Light `fg-secondary` / canvas | 5.61 | PASS | PASS |
| Light `fg-muted` / canvas | 4.76 | PASS | PASS |
| Light `fg-muted` / **Sand** | **4.27** | **FAIL** | PASS |
| Light `accent` (lumen-ink) / canvas | 5.36 | PASS | PASS |
| Light `success/warning/danger/info` / canvas | 7.15 / 7.17 / 5.29 / 5.91 | PASS | PASS |
| Light `bronze` (bronze-ink) / Sand | 5.74 | PASS | PASS |
| Light primary text (limestone / ink) | 15.64 | PASS | PASS |
| Dark `fg` / canvas | 16.51 | PASS | PASS |
| Dark `fg-secondary` / canvas | 10.09 | PASS | PASS |
| Dark `fg-muted` / canvas | 5.40 | PASS | PASS |
| Dark `accent` (lumen) / canvas | 9.66 | PASS | PASS |
| Dark `success/warning/danger/info` / canvas | 8.43 / 8.71 / 6.08 / 7.41 | PASS | PASS |
| Dark primary text (basalt / on-dark) | 16.51 | PASS | PASS |

**Governed exception:** `fg-muted` on Sand fails AA-normal (4.27:1) — see the **Muted-On-Sand Rule** in `DESIGN.md`: on Sand, use `fg-secondary`/`fg` for normal-size text.

### Required practices

- **Focus-visible** on every interactive element (token ring `--focus`; enforced in `globals.css`).
- **Full keyboard operability**, logical tab order, focus management on route change and in dialogs/drawers (trap + restore to trigger).
- **Screen-reader names** on all controls; icon-only buttons carry labels; **error association** via `aria-describedby`; form instructions programmatically associated.
- **Touch targets** ≥ 24px (WCAG 2.2 minimum), ≥ 44px preferred on touch.
- **Non-color status:** every status pairs color with icon + text.
- **Semantic headings + landmarks**; tables use real `th`/scope/caption; charts carry text/table alternatives.
- **`prefers-reduced-motion`** respected globally.

### Verified vs unverified

- **Verified now:** color-contrast ratios (computed), reduced-motion rule (present), focus-visible rule (present), `.dark` primary fix.
- **Unverified (requires rendered product UI):** keyboard traversal, focus trapping, screen-reader labels, tab order, touch-target sizes. These are **component-level checks** that cannot be completed before components exist; each is a gate in the component-inventory `Ready` criteria.

## Responsive system

Breakpoints in [`tokens/breakpoints.json`](./tokens/breakpoints.json): Mobile 390 (base) · Tablet 768 · Desktop 1024 · Wide 1440. Device test widths 360/390/430.

- **Mobile-first tokens**, enhance up. **Reflow, don't shrink:** sidebar → drawer, table → stacked/prioritized columns, split-panel → stacked, sticky primary action.
- **Page gutters** from the spacing scale (mobile body 24). **Max content widths** keep body measure 65–75ch.
- **Sidebar:** persistent on desktop, collapsible to icons, off-canvas drawer on mobile/tablet. **Header:** may become a compact bar with drawer trigger on mobile.
- **Tables:** horizontal scroll within their own container; never scroll the page body. **Dialogs/drawers:** full-screen sheets on mobile, not cramped centered modals.
- **Bottom navigation / sticky actions** on mobile where the surface warrants.
- Mobile, Tablet, Desktop remain **intentional layouts**, not compressed copies. Test every breakpoint in both directions and both themes.

## RTL and LTR

**Arabic (RTL) is a first-class product direction and an accessibility requirement**, not a nicety. English is LTR.

- Use **logical CSS properties** (`margin-inline-start`, `padding-inline`, `inset-inline`, `text-align: start`) and logical Tailwind utilities where practical; avoid hard-coded left/right for anything directional.
- **Do not duplicate components for RTL** — one component, direction-aware via `dir`/logical properties.
- **Mirror:** reading order, alignment, directional icons (back/forward chevrons, breadcrumbs, progress, timelines), navigation order, table column order, drawer/sidebar edge.
- **Do not mirror:** the Aladdin logo/Aperture mark, brand marks, or direction-neutral icons (search, settings, verified seal).
- **Numbers & currency:** locale-aware EGP formatting; align numerics; handle mixed Arabic/Latin/numeral (bidi) text correctly.
- **Charts:** axis/legend/reading direction mirror in RTL; series identity stays consistent.

## Light and Dark themes

Both are **first-class, fully-authored** themes (not an inverted filter). `.dark` class on `<html>`; semantic tokens swap per theme.

- **Every canonical component supports both themes** unless explicitly documented otherwise. Light and Dark must never differ in information or available functionality.
- **Surface hierarchy:** dark builds depth by layered stone (Basalt → Basalt 2 → Basalt 3) + border shift to Graphite; light uses Plaster/Sand + soft shadow + hairline.
- **Borders:** hairline `--border`; `--border-strong` for emphasis; both defined per theme.
- **Shadows:** `card` on light; on dark prefer tonal layering (the Tonal-First Rule).
- **Illustration / data-viz:** authored per theme; never a single asset dropped on both grounds.
- **Disabled & focus:** disabled reduces opacity/contrast but stays perceivable; focus ring (`--focus`) is defined and AA in both themes.
- **Admin** surfaces are intentionally Basalt-dark by default — keep it.

## AI-agent design rules (enforceable)

When any agent works on Aladdin UI, it **must not**:

- Invent new colors, spacing values, typography roles, shadows, radii, breakpoints, or z-index layers.
- Invent new components (follow new-component governance above).
- Introduce a second icon library (see [`icons/README.md`](./icons/README.md)).
- Ship a **one-theme-only** component, or one that differs in function between themes.
- Ignore RTL, or duplicate a component solely for RTL.
- Hardcode raw hex/px in components instead of consuming tokens.
- Copy technical/implementation language into user-facing UI (e.g. "WhatsApp Business API", "reCAPTCHA verified", "canonical account", stack/schema jargon).

**Any approved addition or change must update, in the same change:** `DESIGN.md` · the appropriate `design/tokens/*.json` · `UI-UX/UI_UX_SYSTEM_GUIDE.md` · `design/COMPONENT_INVENTORY.md` (where a component is involved) · `design/CHANGELOG.md` · `docs/operations/AGENT_WORK_LOG.md` · `docs/operations/RUNTIME_STATE.md`.

A genuine need for a value/component the system lacks is **reported and resolved explicitly** (add the token/component through this process), never worked around with an ad-hoc value.
