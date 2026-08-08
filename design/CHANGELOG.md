# Aladdin Design System — Changelog

All notable changes to the Aladdin Design System ("The Aperture"). Newest first.

This system follows **semantic versioning** ([policy](./GOVERNANCE.md#versioning)):
**MAJOR** = breaking visual or component-contract change · **MINOR** = new tokens, components, states, or theme behavior · **PATCH** = non-breaking corrections, documentation, or contrast adjustments.

Each entry uses: Added · Changed · Fixed · Deprecated · Removed · Migration notes.

---

## 1.1.0 — 2026-08-08 — Canonical Private-Pilot B2B contracts

### Added
- Fifteen Draft reusable B2B Pencil component families: Data Grid, Mobile Data Row, Opportunity Card, Pipeline Stage, Task Row, Task Editor, Customer Need Summary, Product Match Card, Smart Share Item, RFQ Line Item, Quotation Line Item, Project Workspace Shell, Activity Timeline Item, Notification Item, and Responsive Workspace Navigation.
- Canonical responsive usage contracts across Desktop, Tablet and Mobile with Light/Dark and AR/EN parity.

### Changed
- Reconciled the private Pencil semantic variable mappings and legacy onboarding aliases to The Aperture palette and typography authority. Canonical machine token values did not change.
- Component inventory now distinguishes Draft Pencil masters from frontend-implemented `Ready` components.

### Removed
- Quote Comparison from the Private-Pilot MVP component requirement; no component was created.

### Migration notes
- Frontend remains unimplemented. When product implementation starts, map these Draft contracts to domain components and complete keyboard, focus, screen-reader, interaction-state and responsive validation before promoting them to `Ready`.

---

## 1.0.0 — 2026-08-01 — Foundation finalized & hardened

First approved, hardened Design System foundation. No product components implemented yet; the token contract is ready to build against.

### Added
- **Canonical machine-readable tokens** under [`design/tokens/`](./tokens/): `colors`, `typography`, `spacing`, `radii`, `shadows`, `motion`, `breakpoints`, `z-index`, plus a token `README`. Establishes the machine-token layer of the source-of-truth hierarchy.
- **Design System metadata** in [`../DESIGN.md`](../DESIGN.md): version, status, maintainer, source-of-truth hierarchy, and compatibility notes.
- **Governance** ([`GOVERNANCE.md`](./GOVERNANCE.md)): source-of-truth hierarchy, versioning policy, synchronization/edit-order, new-component governance, component-state matrix, motion system, accessibility (WCAG 2.2 AA) with measured contrast, responsive system, RTL/LTR, light/dark, and enforceable AI-agent design rules.
- **Component inventory** ([`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md)) — 28 component families with status, themes, directions, states, a11y, and known gaps (all `Proposed`/`Draft`; none implemented yet).
- **Icon policy** ([`icons/README.md`](./icons/README.md)) — default library decision, stroke/size/mirroring rules, custom-icon approval process.
- **Frontend motion + z-index tokens** and canonical named breakpoints (`tablet`/`desktop`/`wide`) in `tokens.css` and `tailwind.config.ts`.
- **`prefers-reduced-motion`** global handling in `frontend/src/app/globals.css`.

### Fixed
- **Dark-theme primary color was broken:** `frontend/src/styles/tokens.css` `.dark { --primary: var(--lime) }` referenced an **undefined** variable (`--lime` was renamed to `--on-dark`). Corrected to `var(--on-dark)`. Impact: dark-theme primary action fill/text resolved to an invalid value at runtime; the production build did not catch it.

### Changed
- **Breakpoints reconciled** to the `UI_UX_SYSTEM_GUIDE.md` canonical viewports (Mobile 390 / Tablet 768 / Desktop 1024 / Wide 1440), superseding the provisional 1080/1360 values in the gitignored `.impeccable/design.json` sidecar.
- Tailwind `transitionTimingFunction` now references the CSS-variable easing tokens instead of duplicating literal cubic-beziers.

### Migration notes
- None (no consumers yet). Product code should consume **semantic** utilities (`bg-canvas`, `text-fg`, `text-accent`, `border`, `bg-primary`) so both themes and the dark-primary fix apply automatically. Brand artwork/mark/seals may use fixed `brand.*` primitives.

---

## 0.1.0 — 2026-08-01 — "The Aperture" approved & extracted (pre-hardening)

### Added
- Founder-approved **"The Aperture"** identity from the Brand Toolkit v1 plate recorded in `DESIGN.md`: Basalt/Limestone grounds, Ink actions, Lumen signal, Bronze verification, Lapis data; Archivo/Reem Kufi/Readex Pro/JetBrains Mono type; named rules; do's/don'ts.
- Frontend token bridge: `tokens.css` (primitives + light/dark semantics), Tailwind theme mapping, and the four self-hosted fonts via `next/font`.
- Accessible semantic text tones (`lumen-ink`, `bronze-ink`, `verdigris-deep`, `ochre-deep`, `stone-muted`) so normal-size text clears AA without altering the display primitives.

### Changed
- `UI_UX_SYSTEM_GUIDE.md` and `PRODUCT.md` reconciled from "brand not approved" to the approved identity + artifact-authority chain.
