# ADR-0025 — One persistent Showroom shell across /showroom and /b2b

**Status:** Accepted for implementation · 2026-11-05 · owner request ("the sidebar must stay fixed; only the body changes")

## Context

- A Showroom's sidebar mixes two kinds of destinations: V2 pages under `/showroom/*` and the finished commerce modules that still live under `/b2b/*` (Direct RFQs, quotations, orders, projects, reports, team, points...).
- The two trees were separate top-level route segments (`app/showroom/(app)` and `app/b2b`). Each had its own layout and each layout drew the same `ShowroomFrame`.
- Next.js keeps a layout mounted only while the segment that owns it stays on screen. A link that crossed from one tree to the other therefore unmounted the whole shell and mounted a new one: the sidebar reset to the top (its own scroll position was lost), the header and its menus remounted, and every query the frame runs (identity, notifications, unread counts, conversations, branch, work context) ran again.
- Moves inside one tree were not affected, which is why the problem looked intermittent.
- `loadWorkspaceContext` was also called independently by the `/b2b` layout and by the Showroom context check (which the frame calls), so one request read the same membership data more than once.

## Decision

1. **A `(workspace)` route group** (`frontend/src/app/(workspace)/`) now contains both trees: `app/(workspace)/b2b` and `app/(workspace)/showroom`. A route group adds no URL segment, so **no URL changes**. Only the public Showroom pages `/showroom/sign-in` and `/showroom/sign-up` stay in `app/showroom`, outside the shell.
2. **The group layout draws the shell once**, through `ShowroomDealerFrame` (`features/showroom-shell/dealer-frame.tsx`), for a `showroom_dealer` organization. That is the one organization type the two trees already showed in the same shell.
3. **No other account type changes.** The `/b2b` layout still draws the workspace shell for Supplier, Manufacturer, Importer, Engineer and every other type; the `/showroom` layout still draws the Showroom frame for the non-dealer types eligible for the Showroom suite. For those types the two surfaces are different shells by design, so moving between them is still a full swap.
4. **The work context is read once per request** through `loadRequestWorkspaceContext` (`server/queries/request-workspace.ts`, a request-scoped `React.cache` over `getServerSupabase`). Read-only render paths only; server actions that change membership keep calling `loadWorkspaceContext` directly.
5. **A structural test** (`showroom-shell/persistent-shell.test.ts`) fails if either tree is moved back out of the group, because the regression it guards against (a moved directory) is invisible to render tests.

## Consequences

- Moving between `/showroom/*` and `/b2b/*` as a Showroom dealer keeps the sidebar mounted (state, scroll position, display mode) and the header menus mounted; only `<main>` changes.
- The frame's server queries run when the shell first renders and when the page is loaded or refreshed, not on every cross-tree link.
- The group layout runs for every route in both trees, including the account-safe notice and the redirects that live in the `/b2b` layout; those keep their behavior and tests.
- Moving files changed their repository path (79 files, history preserved by `git mv`). Comments that mention `app/b2b/...` describe the old path.
- Not changed: the Installer/Personal shell under `/home`, the Admin shell under `/admin`, and the workspace shell under `/b2b` for non-dealer types. Each already keeps its shell for navigation inside its own tree.

## Related files

`frontend/src/app/(workspace)/layout.tsx`, `frontend/src/app/(workspace)/b2b/layout.tsx`, `frontend/src/app/(workspace)/showroom/layout.tsx`, `frontend/src/features/showroom-shell/dealer-frame.tsx`, `frontend/src/features/showroom-shell/frame.tsx`, `frontend/src/features/showroom-shell/context.ts`, `frontend/src/server/queries/request-workspace.ts`, `docs/frontend/showroom-fullstack-v2.md`.
