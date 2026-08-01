# Aladdin Component Inventory

The register of reusable UI components. **Search this file before creating any component** (see [new-component governance](./GOVERNANCE.md#new-component-governance)).

- **Version:** `1.0.0` · **Updated:** 2026-08-01
- **Status legend:** `Proposed` (named, not designed) · `Draft` (in `design.pen`, not implemented) · `Ready` (implemented + validated: themes, RTL, a11y, states, responsive) · `Deprecated` · `Superseded`.

## Current reality

**No product components are implemented yet.** `frontend/` has the scaffold home page only; there is no `frontend/src/components/ui/`. Every entry below is therefore `Proposed` — this inventory defines the *contract* each component must meet when built, not existing code. Do not read a row as "exists".

## Shared defaults (apply to every component unless a row overrides)

- **Supported themes:** Light + Dark (both first-class; parity required).
- **Supported directions:** LTR + RTL (one component, direction-aware; never a duplicate).
- **Supported platforms:** Web — responsive PWA (Mobile 390 / Tablet 768 / Desktop 1024 / Wide 1440).
- **Planned implementation path:** `frontend/src/components/ui/` (primitives) or `frontend/src/features/<domain>/components/` (domain), per `frontend/AGENTS.md`.
- **Design reference:** `UI-UX/design.pen` under QA authority board `00H`; the phone/OTP verification family is the approved premium reference. Confirm the specific component against `design.pen` before implementing — do not trust historical QA boards.
- **Accessibility baseline:** WCAG 2.2 AA — keyboard operable, visible focus (`--focus`), accessible name, non-color status, touch target ≥24px (≥44px touch).
- **Required states:** per the [component-state matrix](./GOVERNANCE.md#component-states).

## Inventory

| Component | Purpose | Status | Key states (beyond default) | a11y focus | Known gaps |
|---|---|---|---|---|---|
| **Button** | Primary/secondary/ghost actions | Proposed | hover, pressed, focus, disabled, loading | Name; loading `aria-busy`; not color-only | Variant set + icon-button labels TBD |
| **Input (text)** | Single-line entry | Proposed | focus, filled, disabled, read-only, error | Label assoc; `aria-invalid`+`describedby` | RTL numerals/bidi rules TBD |
| **Select** | Choose one from a list | Proposed | focus, open, selected, disabled, error | Listbox semantics; keyboard | Native vs custom listbox decision |
| **Textarea** | Multi-line entry | Proposed | focus, filled, disabled, error | Same as Input | Autosize behavior TBD |
| **Checkbox** | Boolean/multi-select | Proposed | hover, focus, checked, indeterminate, disabled, error | Group labeling | — |
| **Radio** | One-of-many | Proposed | hover, focus, checked, disabled, error | Radiogroup semantics | — |
| **Switch** | Immediate on/off | Proposed | hover, focus, on/off, disabled | Role switch; state in text | Distinguish from checkbox usage |
| **Search** | Query entry + results | Proposed | focus, typing, loading, results, no-results, error | Combobox pattern | Debounce/server-search contract |
| **Card** | Grouped content container | Proposed | hover (if interactive), selected, loading | Heading structure | Interactive vs static variants |
| **Table (data grid)** | Sortable/filterable business data (TanStack) | Proposed | loading, empty, error, row hover, row selected, sorted | `th`/scope/caption; keyboard; RTL column order | Server sort/filter/paginate contract |
| **Tabs** | Switch views in place | Proposed | hover, active, focus, disabled | Tab/tabpanel roles; arrow keys | Overflow/scrollable tabs |
| **Navigation (top)** | B2C discovery nav + search | Proposed | hover, active/current, focus | Landmark `nav`; skip link | Derived-visibility wiring |
| **Sidebar** | B2B/Admin workspace shell nav | Proposed | collapsed, expanded, active, hover, focus | Landmark; collapsed label; RTL trailing edge | Derived capability filtering |
| **Mobile navigation** | Bottom nav / drawer on mobile | Proposed | active, pressed, drawer open/closed | Focus trap in drawer | Bottom-nav vs drawer per surface |
| **Breadcrumbs** | Deep-flow wayfinding | Proposed | hover, focus, current | `aria-current`; RTL separators mirror | — |
| **Dialog (modal)** | Blocking decision | Proposed | opening, open (focus-trap), closing | Trap+restore; Esc/backdrop; no native alert | Never nest; scroll-lock |
| **Drawer** | Contextual side task | Proposed | opening, open, closing | Trap+restore; RTL edge | — |
| **Bottom sheet** | Mobile focused task | Proposed | opening, open, closing, drag | Trap+restore; reduced-motion | Drag affordance/limits |
| **Toast** | Transient confirmation | Proposed | enter, shown, pausable, exit | `aria-live` polite; not color-only | Critical-action items don't toast |
| **Banner** | Persistent contextual state | Proposed | info/success/warning/danger; dismissible | Role/severity by icon+text | Placement rules |
| **Empty state** | Nothing-here surface | Proposed | empty vs no-results vs error variants | Heading + primary action | Per-surface copy |
| **Loading state** | Skeletons / spinners | Proposed | skeleton, inline spinner, button loading | Not full-screen block; `aria-busy` | Skeleton shapes per surface |
| **Error state** | Failure + recovery | Proposed | inline, section, page | Names the problem + recovery | Retry contract |
| **Pagination** | Navigate large sets | Proposed | hover, current, disabled, focus | `nav` + `aria-current`; RTL order | Server-side contract |
| **Status badge** | State label | Proposed | per status (verified/won/lost/pending…) | Color + icon + text always | Status taxonomy per domain |
| **File upload** | Attach documents | Proposed | idle, dragover, uploading, success, error | Keyboard trigger; progress `aria` | Off-request-path upload + progress via Realtime |
| **Charts** | Data visualization | Proposed | loading, empty, error, populated | Text/table alternative; RTL axes; theme-aware | Follow the dataviz skill; palette per theme |
| **AI surfaces** | Consult / Smart Share / suggestion + explanation | Proposed | idle, streaming, awaiting-review, sent | Human-review before send; streaming `aria-live`; Lumen "thinking" | Never auto-send; attribution + explanation required |

## Signature brand components (custom, not library)

| Component | Purpose | Status | Notes |
|---|---|---|---|
| **Aperture mark** | Logo/app-icon/favicon | Draft (approved geometry) | Geometry approved on the Brand Toolkit plate; runtime SVG export not yet produced (see [`icons/README.md`](./icons/README.md)). |
| **Verification seal** | Trust anchor (Verified Provider) | Proposed | Bronze concentric ring + monochrome Aperture + "Verified" pill (icon+text). |
| **OTP / verification field** | Passwordless code entry | Draft | Auth family is the approved reference in `design.pen`. No password fields anywhere. |

## Known system-wide gaps

- No component is implemented yet; all `Ready` criteria (keyboard, focus-trap, SR labels, touch targets, responsive) are **pending first implementation**.
- Icon library not yet installed (policy decided — see [`icons/README.md`](./icons/README.md)).
- PDF/document component fonts (Arabic shaping) unresolved — see `DESIGN.md` Typography.
