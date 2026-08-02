# Aladdin Design Tokens (canonical, machine-readable)

These JSON files are the **canonical, machine-readable source of truth** for Aladdin's design-token *values*. They sit under the human-readable brand record ([`../../DESIGN.md`](../../DESIGN.md)) in the [source-of-truth hierarchy](../GOVERNANCE.md#source-of-truth-hierarchy) and above the frontend implementation.

| File | Owns |
|---|---|
| [`colors.json`](./colors.json) | Primitives + light/dark semantic color tokens (with measured AA contrast). |
| [`typography.json`](./typography.json) | Font families, roles, weights, fallbacks, scripts, license status. |
| [`spacing.json`](./spacing.json) | 4-based spacing scale. |
| [`radii.json`](./radii.json) | Corner-radius scale. |
| [`shadows.json`](./shadows.json) | Elevation / shadow tokens (`card`, `glow`). |
| [`motion.json`](./motion.json) | Duration + easing tokens. |
| [`breakpoints.json`](./breakpoints.json) | Responsive breakpoints (min-width). |
| [`z-index.json`](./z-index.json) | Named stacking layers. |

## Maintenance model

**Manually maintained** (not generated). There is no build step that reads these yet; they are the human-and-agent-authored authority that the implementation mirrors. If a generator is ever added, it must read *from* these files, never write *to* them.

## Format

Each file is plain JSON with a small, self-describing shape:

- `name`, `version`, `description`, `maintenance` — metadata.
- Token groups (`primitives`, `semantic`, `scale`, `roles`, `layers`, …) whose leaves carry `value` plus optional `usage`/`description`/`note`/contrast fields.
- **Token references** use `{group.path.name}` (e.g. `{primitives.limestone}`). References resolve within the same file. This is intentionally close to, but not strictly, the W3C DTCG format — kept lightweight because these are read by humans and agents, not (yet) a token compiler.

Token **names are implementation-neutral and semantic** (`accent`, `fg-muted`, `surface-2`) — never Tailwind utility names. Implementations may alias them, but the canonical name never encodes a framework.

## Synchronization — which file is edited first

When a token value changes, edit in this order (top edited first, downstream reconciled in the same commit):

1. **`design/tokens/*.json`** — canonical value changes here first.
2. **`DESIGN.md` frontmatter** — the normative brand record's mirror.
3. **`frontend/src/styles/tokens.css`** — CSS custom properties (primitives + `.dark` semantics).
4. **`frontend/tailwind.config.ts`** — maps CSS vars / scales to Tailwind.
5. **`.impeccable/design.json`** — *gitignored* local tooling sidecar; refresh if present, but it is never authoritative.

The same hex therefore appears in `colors.json`, `DESIGN.md` frontmatter, and `tokens.css` by design — this is an **accepted, documented duplication** (three mirrors of one canonical value), not drift. A change that touches only one of them is a bug; keep them in lock-step in a single commit. See [`../GOVERNANCE.md`](../GOVERNANCE.md).

## Versioning

These files carry a `version` matching the Design System version in [`../CHANGELOG.md`](../CHANGELOG.md) and [`../../DESIGN.md`](../../DESIGN.md). Bump per the semantic-versioning policy in [`../GOVERNANCE.md`](../GOVERNANCE.md#versioning).
