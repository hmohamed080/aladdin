# Sprint 7.1 — Client-Ready UI Foundation (frontend)

| | |
|---|---|
| **Status** | Implemented · 2026-08-06 · Phase 2 |
| **Branch** | `feature/ui-client-ready-foundation` (from `main` @ `be05ab4`) · PR → `main` |
| **Objective** | Turn the functional engineering UI into a professional, client-presentable foundation **without changing behavior**. |
| **Scope (per prompt)** | sign-in, B2B app shell, desktop + mobile navigation, cockpit, shared components + states. Customer/lead/follow-up **detail content deliberately untouched** (inherits the shared foundation; deeper polish in Sprint 7.6). |

## Design references used

- `docs/frontend/ui-auth-onboarding-audit.md` (the approved audit; §3–§4 UI mapping).
- `UI-UX/UI_UX_SYSTEM_GUIDE.md` — Aperture identity, split-panel auth, workspace-with-sidebar, derived nav / no role switcher, empty/loading rules, RTL + light/dark parity, restrained gradients.
- `UI-UX/design.pen` (read-only, via Pencil export): `02.1.1 Sign In` (desktop split panel), the reusable component vocabulary (Logo Lockup, Progress Header, Segmented, OTP, cards), and the token system in `src/styles/tokens.css` + `tailwind.config.ts`.
- No `.pen` was modified; no new `.pen` master; no new visual direction.

## Surfaces changed

| Surface | Before | After |
|---|---|---|
| `/auth/sign-in` | single centered card | **desktop split panel** (dark Aperture Brand Panel + form panel) → single column on tablet/mobile; language/theme switchers on the auth screen; stronger card hierarchy; polished OTP verify state (mono, tracked code field). Behavior unchanged: Email OTP, `shouldCreateUser:false`, resend, change-email, sibling (non-nested) forms. |
| App shell | top bar + horizontal tabs | **persistent icon+label sidebar** (desktop/tablet) + slim top context bar (org/branch + language/theme/account + Realtime) + **polished fixed bottom nav** (mobile). Routes, active org/branch, capabilities, Realtime, sign-out, canonical identity — all preserved. |
| `/b2b` cockpit | 5 plain cards | welcome header (greeting + org + quick actions), **KPI tiles** (overdue/due-today/open-leads), iconized section headers + see-all links, leads-by-stage bars, tidier rows, better empty lines. **Same queries/RPCs.** |
| Shared components | `controls.tsx`, `primitives.tsx` | consistent radius/spacing/focus; `Button` gains `size`; `SubmitButton` shows a spinner; fields use `border-strong` + rounded-md + clear focus; `Select` has a chevron affordance; `StatePanel` gains an optional icon; `Field` wraps long AR/EN text. One system — no second design system. |
| No-org notice, states | plain | brand + iconized state panel. |

New, dependency-free additions: `components/ui/icons.tsx` (inline Lucide-style SVGs, `currentColor`) and `components/layout/brand.tsx` (Aperture lockup) + `features/auth/brand-panel.tsx`. **No runtime dependency added; shared JS unchanged at ~103 kB.** Two i18n keys added (`auth.brandTagline`, `auth.brandNote`) in en + ar.

## Viewports / matrix tested (executed browser QA)

Playwright against the production build (`next build` + `next start`):
- **Viewports:** 360×800, 390×844, 768×1024, 1440×900.
- **Cells:** Arabic light, Arabic dark, English light, English dark.
- **Surfaces:** sign-in (send + verify), app shell, cockpit, desktop sidebar, mobile bottom nav, customers/leads/follow-ups lists, dialogs, loading/empty/not-found/permission/out-of-scope states.
- **Assertions:** no horizontal overflow, correct `<html dir>` (rtl/ltr) + `.dark` class, dialog focus-trap/Escape/restore, reachable controls. Screenshots in `test-results/vqa/` and `test-results/s71/` (sign-in + cockpit per cell).
- **Result:** visual-QA matrix **4/4 pass**; evidence spec **2/2 pass**; **no overflow at any cell**. Sign-in split panel, sidebar shell, and cockpit render correctly in en/ar × light/dark on desktop/tablet/mobile.

## Validation

- Frontend `typecheck` ✓ · `lint` ✓ · **130 tests** ✓ · `build` ✓ (shared JS ~103 kB).
- **E2E behavior regression:** `playwright test --project=chromium-desktop` **22 passed / 0 failed** — all Sprint-6 behavior (sign-in, nav, org/branch/language/theme switchers, Realtime, sales flows, dialogs) preserved. Full `pnpm --filter frontend e2e` (both projects) run once via the deterministic global setup.
- No DB / RPC / query / auth-behavior change; no `.pen` change.

## Remaining visual gaps (for Sprint 7.6 — existing sales UI client-ready polish)

- **Customer / lead / follow-up detail + list content** deliberately not re-designed this sprint — they inherit the shared foundation but need deeper polish (data-grid pattern per the guide instead of hand-built lists; richer detail headers; per-row action affordances).
- **Aperture mark** is a restrained dot at small sizes — a higher-fidelity mark/artwork (and the eventual auth Brand Panel 3D/WebGL) is a later brand pass.
- **Sidebar** is persistent-only (no collapse-to-icons / off-canvas drawer on tablet yet) — the guide's collapsible behavior is a follow-up.
- **Favicon / app icon** still absent (one benign `/favicon.ico` 404) — pending an approved asset (tracked debt).
- Empty states use iconized panels, not the designed illustrated empty states.
- Registration / onboarding surfaces remain unbuilt (Sprint 7.2+ per the audit).
