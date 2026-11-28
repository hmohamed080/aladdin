# Aladdin Design System — Changelog

All notable changes to the Aladdin Design System ("The Aperture"). Newest first.

This system follows **semantic versioning** ([policy](./GOVERNANCE.md#versioning)):
**MAJOR** = breaking visual or component-contract change · **MINOR** = new tokens, components, states, or theme behavior · **PATCH** = non-breaking corrections, documentation, or contrast adjustments.

Each entry uses: Added · Changed · Fixed · Deprecated · Removed · Migration notes.

---

## Unreleased — 2026-10-25 — Engineer RFQ page composition

Changed: owner-reference compact architectural hero, four task benefits,
numbered product/location/notes/images sections, live summary (right in Arabic,
mirrored in English; stacked on mobile) and real showroom selection.

Added: explicitly labelled local four-requirement example behind the existing
local-environment and loopback-database gate. Production retains real product,
saved draft or empty input.

Migration notes: existing engineer palette, save-draft → review → explicit-publish
flow and private saved-item images are preserved. JPEG/PNG/WebP only, two images
per item, 5 MB each; PDF and pre-save uploading remain unsupported. No token,
shared-shell, schema or deployment change belongs to this entry. TypeScript, focused lint and six composer tests pass; this is not a release-readiness claim.

## 1.3.0 — 2026-11-28 — Engineer account theme (authored 2026-10-19)

Added: owner-approved engineer palette in `tokens/engineer.json` and its scoped semantic CSS mapping. The colors are sand `#D8C7A6`, terracotta `#B96F52`, cream `#F2E9D8`, and navy `#071A2D`.

Changed: engineer home/profile/navigation, quotation composer, discovery and personal collections compose the canonical shell, cards and controls. The existing Aladdin showroom architectural artwork supplies decorative hero imagery; real records never receive fabricated photos, ratings or reviews.

Fixed: explicit hero text contrast and complete shell/canvas token mapping. Both theme variants retain the same four brand primitives.

Migration notes: the theme applies only within `.engineer-surface`; other account surfaces keep their existing token values. New business response screens reuse the business theme. Browser responsive and theme checks must pass before the feature is marked ready.
## 1.2.0 — 2026-11-15 — Brand-landing palette registered

### Added
- **`brandLanding` scope** in [`tokens/colors.json`](./tokens/colors.json): four owner-approved primitives for the public landing page `/` only — `landing-navy` `#071A2D`, `landing-sand` `#D8C7A6`, `landing-terra` `#B96F52`, `landing-cream` `#F2E9D8` — mirrored in `DESIGN.md` frontmatter, `frontend/src/styles/tokens.css` (`--landing-*`) and Tailwind `brand.landing-*`.
- The landing consumes them through scoped `--lb-*` variables; every other tone on that page (soft grounds, hairlines, secondary text, shadows, scrims) is a `color-mix()` or an alpha of those four. No white, black or other hue.

### Changed
- `terra` measures 3.3:1 on cream, so small accent text uses the derived `terra-text` (terra mixed with navy, >= 4.5:1); terra itself is kept for icons, step numbers and fills.

### Migration notes
- Product UI is unaffected and keeps consuming the semantic tokens. The landing is light-only and Arabic-RTL by owner decision; it has no dark counterpart.
- `tokens/colors.json` already carried `1.1.0` without a changelog entry; this entry supersedes it.

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

## 2026-10-24 — Public portfolio reference correction

Rebuilt public portfolio composition around supplied references, added generated service imagery and explicitly guarded local sample content. Replaced section anchors with isolated accessible tabs. Preserved the four-color palette and public-data restrictions.
