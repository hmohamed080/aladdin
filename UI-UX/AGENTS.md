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
