# Aladdin UI Contract

**Status:** canonical · **Applies to:** every change under `frontend/src` · **Since:** UI Foundation v1 (2026-09-01)

This is the rule set that keeps Aladdin looking like one product. It is short on
purpose. Read it before adding a component, a page, a route or an account type.

Related: [`AGENTS.md`](../../AGENTS.md) · [`frontend/AGENTS.md`](../../frontend/AGENTS.md) ·
[`UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md)

---

## The one rule everything else serves

> **Composition may differ. Visual language may not.**

A supply dashboard, an installer's home, an RFQ detail and the Admin console are
allowed to be laid out completely differently, because they carry completely
different information. They are **not** allowed to differ in palette, type scale,
spacing, radius, border weight, elevation, control language, or how a thing looks
when it is hovered, focused, selected or current.

When those diverge, an account type stops looking like a different *page* and
starts looking like a different *product*. That is the failure this contract
exists to prevent.

---

## The four layers

| Layer | Owns | May vary per product? |
|---|---|---|
| 1 · **Tokens** | colour, type, spacing, radius, border, shadow, motion, semantic states | **No** |
| 2 · **Primitives** | Button, Input, Search, Card, Panel, Badge, Table, Empty/Loading/Error | **No** |
| 3 · **Shell** | ground, header, navigation family, page container, page band, responsive behaviour | **No** |
| 4 · **Composition** | what a given page actually puts on screen | **Yes — freely** |

Only layer 4 is a product decision.

---

## Rules

### R1 — Canonical tokens are mandatory · *enforced*
All colour comes from `src/styles/tokens.css` through a semantic utility. No raw
hex, no `bg-[#…]`, no Tailwind default palette (`bg-slate-500` and friends).

The default palette is called out separately because it is the most dangerous of
the three: it looks canonical and is **theme-blind**, so it silently breaks one
theme while passing review in the other.

### R2 — No page-local colour when a semantic token exists · *enforced*
If a token expresses it, use the token. Anything on an accent fill uses
`text-on-accent` — never `text-brand-basalt`, never `text-brand-lumen-ink`. That
ambiguity previously produced two different inks on the same fill.

### R3 — No duplicate primitive · *review*
Do not write a new Button, Input, Search field, Card, Panel or Badge when the
canonical one supports the use case. Extend the canonical component instead; a
variant added there is available everywhere, and a copy is not.

### R4 — No new account- or persona-specific shell · *review*
**Route count does not authorize a new visual language.** A surface with three
destinations and a surface with twenty use the same shell and the same navigation
family; they differ in the *list*, not in the *organ*.

This rule has a worked example. The personal surface once shipped a bespoke
horizontal rail because four destinations "did not earn" a sidebar. The
information-architecture reasoning was sound; answering it with a different visual
language was not. `/home` now stands in the same `SidebarShell` as `/b2b` with a
shorter list.

A genuinely new shell needs an explicit product-design decision, recorded before
it is built.

### R5 — One foundation for AR/EN, RTL/LTR and light/dark · *partly enforced*
Use logical properties (`ms`, `pe`, `text-start`, `inset-inline`) — never `left`,
`right`, `ml`, `pr`. Never write an Arabic-only or a dark-only rule in a
component; if a theme needs a different value, that is a **token pair**, not a
component branch.

Locale parity is already compiler-enforced (`ar` is typed as the shape of `en`,
so a missing key is a type error). Direction and theme parity are review rules
plus the component tests listed below.

### R6 — Report the gap before building a local replacement · *review*
If a canonical component cannot express a required design, **say so and stop**.
A foundation gap reported is one fix; a local replacement is a permanent second
implementation that the next author will copy.

### R7 — Redesigns start at the foundation · *review*
A general visual change edits tokens, primitives and the shell. If a redesign is
touching individual pages, it is being done in the most expensive possible order
and will not survive the next one.

### R8 — Migrate legacy surfaces when touched · *review*
Feature work that edits a legacy surface also lands its mechanical migration step
(see below). Small, continuous, attached to work that was happening anyway.

### R9 — New UI uses the foundation immediately · *review*
There is no grace period for new code. "Legacy" describes what already exists,
never what is being added.

---

## What is mechanically enforced

`frontend/eslint.config.mjs`, rule set `aladdin/ui-foundation`, runs in the normal
`pnpm lint` path:

| Check | Rule |
|---|---|
| No raw hex in component code | R1 |
| No arbitrary Tailwind colour value | R1 |
| No Tailwind default-palette colour | R1, R2 |

It uses regexes over source text rather than a Tailwind-aware AST rule. That is a
deliberate trade: near-zero false positives, some false negatives (a class built
by string concatenation slips through), and no custom plugin to maintain. The
allow-list is limited to the token layer, brand artwork and generated types — **if
that list grows, the rule has stopped meaning anything.**

Everything else in this document is a review rule. R3, R4, R6 and R7 all require
judgement about whether a design is genuinely unsupported, and a check that
guessed at that would be worse than none.

---

## Source of truth

| Concern | File |
|---|---|
| Tokens | `src/styles/tokens.css`, `tailwind.config.ts` |
| Button, Input, Select, Textarea, Checkbox | `src/components/ui/controls.tsx` |
| Card, Badge, StatePanel, Field, Skeleton | `src/components/ui/primitives.tsx` |
| Panel, PageHead, PageHeader | `src/components/ui/workspace-layout.tsx` |
| Page bands (IdentityBand, Section) | `src/components/ui/page-band.tsx` |
| Table / list | `src/components/ui/data-table.tsx` |
| Loading states | `src/components/ui/page-skeletons.tsx` |
| **App ground** | `src/components/layout/app-shell.tsx` |
| Navigation panel (material, modes, carve) | `src/components/layout/sidebar-shell.tsx` |
| **Navigation row** | `src/components/layout/nav-item.tsx` |
| Navigation geometry | `src/lib/ui/nav-geometry.ts` |
| Header | `src/components/layout/app-header.tsx` |
| Search | `src/components/layout/global-search.tsx` |
| Content measure | `src/components/layout/content-column.ts` |

The `workspace-*` CSS class names in `globals.css` are **historical**. They date
from when the ground existed only under `/b2b`. Read them as "the app ground".

---

## Legacy classification

### Migrate when touched

| Surface | Step |
|---|---|
| `app/admin/layout.tsx` | Bespoke `<aside>` + second top nav → `AppShell` + a nav mode |
| `app/business/layout.tsx` | Hand-rolled header → `AppHeader` |
| `app/onboarding/layout.tsx` | Hand-rolled header → `AppHeader` (duplicate of the above) |
| `app/admin/users/page.tsx` | Only visible raw `<input>` in the repo → canonical search field |
| `features/home/parts.tsx` — `DetailCard`, `ActionCard` | → `Card` / `Panel` |

### Global UI consistency milestone

Deferred to a dedicated pass, highest divergence first:

1. Admin shell onto `AppShell` + a nav mode.
2. Business + Onboarding headers onto `AppHeader`; delete both duplicates.
3. Card vocabulary collapse (`DetailCard`, `ActionCard`, `CardRail`).
4. Extract the search **field** from `global-search.tsx` so in-page search reuses it.
5. Delete zero-caller exports (`Band` in `workspace-layout.tsx`).

**Not in scope for UI Foundation v1**, and deliberately: v1 builds the foundation
and proves it carries two surfaces. It does not convert the estate.
