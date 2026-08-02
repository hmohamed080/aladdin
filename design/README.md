# Aladdin Design System

The versioned, machine-readable home of the Aladdin Design System — **"The Aperture"**. This folder governs *how* the design system is structured, versioned, and enforced; the human-readable brand language lives in root [`../DESIGN.md`](../DESIGN.md).

- **Version:** `1.0.0` · **Status:** Approved, hardened (pre-feature) · **Updated:** 2026-08-01

## Contents

| Path | What it is |
|---|---|
| [`../DESIGN.md`](../DESIGN.md) | **Normative brand & visual-design language** (frontmatter tokens + prose rules). The primary human-readable record. |
| [`tokens/`](./tokens/) | **Canonical machine-readable token values** — colors, typography, spacing, radii, shadows, motion, breakpoints, z-index. |
| [`GOVERNANCE.md`](./GOVERNANCE.md) | Source-of-truth hierarchy, versioning, synchronization, new-component governance, component states, motion, accessibility, responsive, RTL, themes, and AI-agent rules. |
| [`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md) | The register of reusable components (search before creating one). |
| [`icons/README.md`](./icons/README.md) | Icon-library policy and custom-icon process. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Semantic-versioned change history. |

## Source-of-truth hierarchy (short form)

`PRODUCT_DIRECTION_GUIDE.md` → **`DESIGN.md`** → `design/tokens/*.json` → `UI_UX_SYSTEM_GUIDE.md` → `design.pen` → frontend code. No lower source contradicts a higher one. Full detail and edit-order: [`GOVERNANCE.md`](./GOVERNANCE.md#source-of-truth-hierarchy).

## Implementation

The system is implemented in the frontend as CSS variables (`frontend/src/styles/tokens.css`) and the Tailwind theme (`frontend/tailwind.config.ts`), with fonts self-hosted via `next/font` in `frontend/src/app/layout.tsx`. Components consume **semantic** tokens so Light/Dark and RTL parity are automatic.

## Related project memory

Root [`../AGENTS.md`](../AGENTS.md) · [`../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../UI-UX/UI_UX_SYSTEM_GUIDE.md) · [`../docs/architecture/ARCHITECTURE_GUIDE.md`](../docs/architecture/ARCHITECTURE_GUIDE.md) · [`../docs/README.md`](../docs/README.md)
