---
description: Scoped agent instructions for the Aladdin Pencil design files.
alwaysApply: true
---

# UI-UX — Agent Instructions

Extends the root `AGENTS.md`. This file governs `UI-UX/`. It is intentionally concise and operational — the full design system and UX rules live in [`UI_UX_SYSTEM_GUIDE.md`](./UI_UX_SYSTEM_GUIDE.md).

## Read first (every time)

1. Root [`AGENTS.md`](../AGENTS.md).
2. The four core-memory files: [`PRODUCT_DIRECTION_GUIDE`](../docs/product/PRODUCT_DIRECTION_GUIDE.md) · [`ARCHITECTURE_GUIDE`](../docs/architecture/ARCHITECTURE_GUIDE.md) · [`UI_UX_SYSTEM_GUIDE`](./UI_UX_SYSTEM_GUIDE.md) · [`AGENT_WORK_LOG`](../docs/operations/AGENT_WORK_LOG.md).
3. [`RUNTIME_STATE`](../docs/operations/RUNTIME_STATE.md) for the current live state.
4. **[`UI_UX_SYSTEM_GUIDE.md`](./UI_UX_SYSTEM_GUIDE.md) before any UI or design change** — it is authoritative for tokens, components, accessibility, and UX rules.

## Canonical design file

- **`UI-UX/design.pen` is the single canonical Aladdin design file** and the visual source of truth.
- The `design.BACKUP-*.pen` files are **historical safety snapshots** — never the working file.

## Absolute rules

- **Do not rename, duplicate, rebuild, modify, or delete** `design.pen` or any backup. **Do not create another canonical design file.**
- **Coding tasks must never edit `.pen` files.** Design changes happen only in the Pencil editor via the `mcp__pencil__*` tools; `.pen` files are opaque/encrypted — never `Read`, `Grep`, or `cat` them.
- **Design tasks must create a verified, dated backup before risky edits** (add a new snapshot; never overwrite an existing one), and verify persistence by mtime/size afterward.
- **Prior session labels are not proof of approval.** Independently confirm a screen is approved (current QA authority: board `00H`) before building or trusting it.
- **All UI implementation must map to approved components/tokens** in `design.pen` — no ad-hoc values, no re-invented components.
- **Internal session labels and design-agent notes must never enter production UI** (no QA labels, "SAMPLE/DEMO" ribbons, session/agent tags).

## Storage & versioning

`.pen` files are large private design IP. They are **gitignored** (`*.pen`) and **must remain private and untracked** — never in public Git history. Keep them in private storage (private object storage / a private design vault / Git LFS on a **private** remote), and retain the `BACKUP-*` snapshots as the recovery trail.

## Design System authority

The token/brand *record* and *process* are versioned outside the `.pen` file: root [`../DESIGN.md`](../DESIGN.md) (normative brand + tokens), [`../design/tokens/`](../design/tokens/) (canonical machine tokens), and [`../design/GOVERNANCE.md`](../design/GOVERNANCE.md) (versioning, component & AI-agent rules). `design.pen` is the visual source for *screens/compositions*; when a design change alters a token or rule, reconcile it into `DESIGN.md` and the token files too — the `.pen` file is not the sole record.

## Related files

[`UI_UX_SYSTEM_GUIDE.md`](./UI_UX_SYSTEM_GUIDE.md) · [`../DESIGN.md`](../DESIGN.md) · [`../design/README.md`](../design/README.md) · root [`AGENTS.md`](../AGENTS.md) · [`../docs/README.md`](../docs/README.md)
