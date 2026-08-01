# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

---

## Session — Phase 0.7: MVP Technical Specification & System Blueprint
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Produce the complete engineering blueprint for the MVP under `docs/technical/` — detailed enough for a senior engineer to build the MVP without further questions. **Specification only: no product feature, code, migration, API, table, UI, or architecture change; no `.pen` edit.**

### Deliverables (15 files under `docs/technical/`)
`README.md` (index + authority) · `01_system_overview` · `02_domain_model` · `03_database_design` · `04_relationships` (ERD) · `05_storage_design` · `06_rls_strategy` · `07_permissions_matrix` · `08_api_contracts` · `09_background_jobs` · `10_events` · `11_state_machines` · `12_validation_rules` · `13_integrations` · `14_future_extensions`. Linked from `docs/README.md`.

### Key reconciliations (authority hierarchy applied)
- **Integrations:** documented the **approved stack only** (Supabase Storage, OpenAI, Azure Document Intelligence [OCR candidate], WhatsApp Business API, Email provider [⚑ OPEN], Sentry, Excel/PDF libraries). The task's examples **Cloudinary / Firebase-push / Google Maps-Places / payments** are **not approved** → substitutes documented (Supabase Storage; Realtime+email+WhatsApp; internal localities + PostGIS; deferred) and flagged.
- **Roles:** used the canonical account-type + capability + platform-role model (no profile switcher); mapped the task's generic role names (Guest/Company/Exhibition/Support/Moderator/Super Admin) onto it.
- **Undecided items** (pricing/tiers, OCR provider finalization, email provider, retention windows, verification doc sets, product attribute schemas, media/OTP caps) recorded as `⚑ OPEN` inline, not invented.

### Validation
- 123 internal markdown links across `docs/technical/` checked, **0 broken**. Working tree otherwise clean before commit.

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture or UI change; no `.pen` edit. Specification documents only.

---

## Session — Final Network-Dependent Foundation Gate (Docker + Supabase)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Run the network-dependent pre-merge gate that prior sessions had to defer: Docker image build/inspection/run and the Supabase local stack (start / db reset ×2 / db lint / extension inspection). **No product feature, no product table, no `.pen` edit, no merge/push.**

### Baseline (re-run, GREEN)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen --python 3.12` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ (1 benign `StarletteDeprecationWarning`).

### Docker validation — PASSED
- `docker version` server **29.6.2**. Pulls: `python:3.12-slim` ✅ (Docker Hub); `ghcr.io/astral-sh/uv:latest` ✅ (after retries — intermittent `ghcr.io` TLS-handshake timeouts).
- `docker build --no-cache -t aladdin-backend-foundation ./backend` ✅ (multi-stage; `uv sync --frozen --no-dev` resolved 53 packages from PyPI).
- Inspect: runtime **Python 3.12.13**; user **appuser (uid 10001)** — non-root; **HEALTHCHECK** configured; `Cmd=uvicorn app.main:app`.
- No `.env`/`.pen`/PDF/customer-data/`.git`/app-logs in image (only base-image `apt/dpkg` logs). **No Alembic, no SQLAlchemy** (`find_spec` False; no site-packages).
- `docker run` + `curl --fail /health` → **HTTP 200 `{"status":"ok","service":"backend","env":"local"}`**; running process **uid 10001**; container **health=healthy**. Test container stopped and removed.
- Hygiene note (not a defect): no `.dockerignore` → the whole `backend/` context (incl. `.venv/`) is sent to the daemon, and 3 local `app/**/__pycache__` dirs are copied in. Selective `COPY` keeps the image itself clean.

### Supabase local stack — PASSED
- `supabase --version` 2.110.0. `supabase start` ✅ (exit 0) after several retries — Docker Hub and `public.ecr.aws` reachable; `ghcr.io` TLS-handshake timeouts repeatedly slowed the multi-image pull (Docker Desktop also flapped once and recovered). Migration `20260729000000_extensions.sql` applied; `seed.sql` applied.
- Services healthy: **db, kong (API), auth, storage, realtime, studio** (+ rest, analytics, inbucket, pg_meta, edge_runtime). `imgproxy` + `pooler` intentionally disabled in `config.toml`. `vector` (log router) flaps on restart — benign, unrelated to Postgres/schema.
- **First `db reset`** ✅ (exit 0). **First `db lint`** ✅ (exit 0) — all findings are inside bundled `extensions.*` PostGIS/pgcrypto functions; **zero** in our migration or `public`.
- Extensions (name | schema | version): **pgcrypto | extensions | 1.3**, **pg_trgm | extensions | 1.6**, **vector | extensions | 0.8.2**, **postgis | extensions | 3.3.7**. `extensions` schema present. **0 product tables in `public`.** Migration recorded: `20260729000000`.
- **Second `db reset`** ✅ (repeatable, no manual intervention) — identical extensions/versions, still 0 public tables, no drift, seed repeatable. **Second `db lint`** ✅ — 16 finding-groups, all in `extensions`, none in our code.
- Cleanup: `supabase stop` ✅.

### `.pen` integrity
- **This session modified no `.pen` file.** All 16 backup snapshots are byte-identical before/after. The canonical `UI-UX/design.pen` **changed on disk during this window** (`ca54598…d581c` → `f1756cd…b7402`, mtime 14:51) because a **concurrent design agent ("Pi")** flushed its "missing-variant completion" Pencil edits and wrote one new gitignored backup. `.pen` files are **gitignored**, so this is outside the git tree and does not affect the commit or merge — and it was not caused by this task.

### Result
**Full architecture and infrastructure foundation validation complete.** No product feature/table/screen; no `.pen` modified; no live cloud/production service used; Docker + Supabase ran locally only.

---

## Session — Design System Finalization & Hardening (v1.0.0)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8) with Impeccable
**Branch:** `chore/repository-architecture-foundation`

### Objective
Finalize and harden the Aladdin Design System before any product-feature work: audit, source-of-truth reconciliation, machine-readable token architecture, component governance, and implementation validation. **No product feature, no new screen, no journey redesign, no `.pen` edit.**

### Pre-edit audit — key findings
- **Defect (theme):** `frontend/src/styles/tokens.css` `.dark { --primary: var(--lime) }` referenced an **undefined** variable (primitive is `--on-dark`) — dark-theme primary action color broken at runtime; production build did not catch it.
- **Missing:** no canonical machine-readable tokens; no design-system versioning/changelog; no component inventory; no icon policy; no motion-duration/z-index tokens; no canonical named breakpoints; no `prefers-reduced-motion`.
- **Source-of-truth ambiguity:** color hex duplicated across `DESIGN.md` frontmatter, `tokens.css`, and the *gitignored* `.impeccable/design.json` with no documented canonical source or edit-order.
- **Accessibility:** measured 22 semantic pairs — one sub-AA pairing (`fg-muted` on Sand = 4.27:1); all others pass.
- **Breakpoint conflict:** UI guide (1440/768/390) vs sidecar (1080/1360) — reconciled to the guide.

### Changes
- **Fixed** the dark-theme `--primary` (`--lime` → `--on-dark`).
- **Added canonical machine tokens** `design/tokens/{colors,typography,spacing,radii,shadows,motion,breakpoints,z-index}.json` + README (manually maintained; documented sync edit-order).
- **Added** `design/GOVERNANCE.md` (source-of-truth hierarchy, semantic versioning, synchronization, new-component governance, component-state matrix, motion, measured-AA accessibility, responsive, RTL, light/dark, enforceable AI-agent rules), `design/COMPONENT_INVENTORY.md` (28 families, all `Proposed`/`Draft`), `design/icons/README.md` (Lucide default; custom-icon process), `design/CHANGELOG.md`, `design/README.md`.
- **DESIGN.md:** added versioning metadata, source-of-truth hierarchy, compatibility notes, honest font-license/PDF-strategy record, measured-contrast + Muted-On-Sand rule.
- **Frontend:** added motion (duration/easing) + z-index tokens to `tokens.css`; canonical `tablet/desktop/wide` screens, `transitionDuration`, `zIndex`, and CSS-var easings to `tailwind.config.ts`; `prefers-reduced-motion` to `globals.css`.
- **Memory reconciled:** `UI_UX_SYSTEM_GUIDE.md`, `ARCHITECTURE_GUIDE.md`, root/`frontend`/`UI-UX` `AGENTS.md`, `docs/README.md`, `RUNTIME_STATE.md`. **`PRODUCT_DIRECTION_GUIDE.md` untouched** (no product-direction change).

### Validation (commands + results)
- Frontend: `typecheck` ✅ · `lint` ✅ · `test` **3 passed** ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Tokens: all 9 JSON files parse ✅; 33/33 color primitive names unique ✅; **no dangling `var(--x)`** references in `tokens.css` ✅.
- Docs: **192 internal relative links, 0 broken** ✅; no duplicate H1/H2 headings in new design docs ✅.
- **`.pen` unchanged:** `UI-UX/design.pen` sha256 `ca54598…d581c` identical before/after ✅.

### Unverified / open items
- Formal OFL license-file audit of the four self-hosted fonts (marked pending, not claimed verified).
- PDF/Arabic document-font strategy (FastAPI quote/RFQ PDFs) — recorded as an open item.
- Component-level a11y (keyboard, focus-trap, SR labels, tab order, touch targets) — cannot be verified before components exist; gated in the inventory `Ready` criteria.
- Lucide icon library decided but **not installed** (deferred to first real need).

### Out of scope (confirmed not done)
No product feature, no product screen, no journey redesign, no `.pen` edit, no unapproved brand asset created, no auth/Sales/Catalog/RFQ/Projects/Admin/AI flow started.

---

## Session — Approved Aperture Brand Token Extraction
**Date/time:** 2026-08-01
**Agent/tool:** Codex with Impeccable (`extract` playbook)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Turn the founder-approved Brand Toolkit v1 plate into a durable root design record and a production-ready frontend token foundation, while keeping the canonical UI/product memory consistent and without starting product workflows.

### Changes
- Added root `DESIGN.md` as the approved token/rule record for **The Aperture** identity: exact palette, bilingual typography, spacing, radii, component defaults, elevation, mark rules, and do/don't constraints.
- Added `frontend/src/styles/tokens.css` with fixed brand primitives and light/dark semantic aliases; components can consume semantic values without hardcoding hex.
- Mapped the complete approved foundation into `frontend/tailwind.config.ts`: semantic and brand colors, bilingual font families, typography roles, spacing, radii, shadows, and easing.
- Loaded Archivo, Reem Kufi, Readex Pro, and JetBrains Mono through `next/font/google` in the root layout; established Readex Pro and semantic canvas/foreground/focus defaults globally.
- Added accessible light-theme semantic tones from the approved tonal ramps. Brand primitives remain unchanged; normal-size text/focus/status tokens now clear WCAG AA rather than incorrectly treating every display primitive as text-safe.
- Reconciled `PRODUCT.md` and `UI_UX_SYSTEM_GUIDE.md`: removed the obsolete “brand not approved” state and documented the authority chain (`UI_UX_SYSTEM_GUIDE.md` policy → `DESIGN.md` approved token/rule record → `design.pen` visual source → frontend token mirror).
- Kept `.impeccable/design.json` as the existing ignored local tooling sidecar and synchronized its accessible semantic metadata; the committed durable record is `DESIGN.md`.

### Validation
- Impeccable detector on all changed frontend targets: `[]` (0 findings).
- Contrast calculation for semantic normal-size text: minimum light-theme ratio **4.76:1**; dark-theme semantic text/status ratios remain **≥5.40:1**. Primary action contrast is **15.64:1**.
- Frontend TypeScript: `tsc --noEmit` ✅.
- Frontend lint: `eslint .` ✅.
- Frontend tests: Vitest **3 passed** ✅.
- Frontend production build: Next.js **15.5.22** build ✅; `/`, `/_not-found`, and `/api/health` generated successfully.
- Repository checks: `git diff --check` ✅; **154** internal Markdown links checked, **0 broken** ✅.

### Environment note
The Codex pnpm wrapper repeatedly attempted a non-interactive dependency reinstall after its bundled runtime changed. A single approved `pnpm install --frozen-lockfile --ignore-scripts --child-concurrency=1` restored the locked workspace from cache (402 packages reused, 0 downloaded); validation then ran through the same local package binaries. No dependency or lockfile changed.

### Unfinished / intentionally out of scope
- Theme-selection UI/persistence is not wired yet; the token contract and `.dark` override are ready for it.
- Runtime logo/app-icon exports and reusable Aperture React components have not been created yet.
- No auth, database table, RLS policy, or B2B/B2C/Admin workflow was implemented. This session is frontend design-system foundation, not product-feature implementation.

---

## Session — Approved Missing Variant Completion Pass
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Complete faithfully derivable missing device/theme variants in the live `design.pen` using copied canonical screens and locked reusable components only; replace ambiguous missing placeholders with validated screens or precise decision blockers.

### Completed
- Added 87 product-screen variants, increasing the live product-screen count from 120 to 207.
- Completed Sign In Tablet Dark and the OTP main flow across Desktop Light/Dark, Tablet Light/Dark, and Mobile Dark.
- Completed Mobile Dark registration, Desktop Dark Basic Profile, Mobile Light Consent, Mobile Dark Basic Profile, Desktop/Mobile Dark Account Type, Mobile Dark Consumer Onboarding, Desktop/Mobile Dark Professional Onboarding, Mobile Dark Business Onboarding, Mobile Dark Verification, and faithful Dark mirrors of existing Subscription screens.
- Added workspace-only traceability notes recording source, reused hierarchy/components, target, content changes, and unresolved items.
- Replaced every generic `MISSING —` placeholder: current count is 0. Forty-eight remaining gaps are explicitly labelled Partial, Blocked, Responsive Decision, Unresolved Product Requirement, or Not Required.
- Updated `00I — Current Design Status Report` with actual per-device/theme completion, partial, blocked, needs-review, and not-required status.

### Validation
- 207 product screens; 8 top-level groups; 0 top-level overlaps; 0 organizational sibling overlaps.
- Representative new screens visually compared with their sources after each family pass.
- Existing source screens and component masters were not modified.
- Newly copied screens retain canonical dimensions, token bindings, RTL behavior, hierarchy, and component instances.
- Known layout warnings reproduced from locked source screens are documented as inherited and were not repaired inside product UI.

### Backup
`UI-UX/design.BACKUP-BEFORE-MISSING-VARIANT-COMPLETION-20260801-143042.pen`

### Remaining decisions
- Consumer Experience and Business Operations require approved workflow behavior before screen production.
- Admin Tablet/Mobile needs an approved responsive shell; Admin Light is not required in current scope.
- Tablet onboarding/profile variants require responsive composition approval despite the general responsive specification.
- Several Desktop onboarding sequences remain partial; Subscription pricing/payment and omitted product-step scope remain unresolved.

---

## Session — Permanent Device/Theme Canvas Governance
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Reorganize the live private `UI-UX/design.pen` workspace into a permanent Product Surface → Flow → Device → Theme → Sequence hierarchy without changing any existing product-screen internals, document missing coverage explicitly, add a device/theme status matrix, and make the rule durable in project policy.

### Changes
- Reparented 120 existing product-screen frames intact into eight top-level areas: Authentication, Consumer, Professional/Talent, B2B/Business, Admin, Shared/System, Foundation/Components/Documentation, and Archive.
- Added explicit Desktop → Tablet → Mobile and Light → Dark lanes, with separate Main Flow, Supporting States, Error States, Responsive Test Variants, and Specifications/Annotations lanes.
- Kept 360px/430px responsive tests separate from canonical Mobile 390px.
- Added 56 workspace-only missing-coverage placeholders; no missing UI was fabricated.
- Added `00I — Current Design Status Report` with per-flow Desktop Light/Desktop Dark/Tablet Light/Tablet Dark/Mobile Light/Mobile Dark status.
- Added the permanent policy to root `PRODUCT.md` and mirrored the operational UI rule into `UI-UX/UI_UX_SYSTEM_GUIDE.md`.

### Validation
- Live tree: 8 top-level groups, 120 product-screen frames, 56 missing-coverage placeholders.
- Variant ancestry audit: 0 device/theme/responsive-lane mismatches.
- Canvas audit: 0 top-level overlaps and 0 organizational sibling overlaps.
- Product screen internals, dimensions, names, content, components, and styling were not edited; only complete frames were repositioned/reparented.
- Existing inherited product-screen layout warnings remain intentionally untouched because those screens are locked.

### Backup
`UI-UX/design.BACKUP-BEFORE-PERMANENT-VARIANT-ORGANIZATION-20260801-104124.pen`

### Unfinished / blocked
None for workspace organization. Missing variants remain explicit placeholders and require separately approved screen-design tasks.

---

## Session — Foundation Review, Hardening & Pre-Merge Validation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Independently verify the architecture foundation is correct, clean, executable, internally consistent, and merge-ready — review generated docs, run full local validation (frontend/backend/Supabase), security + repo-quality review, and confirm the canonical memory system. **No product feature.**

### Starting state
HEAD `18dc7f5`, 14 commits ahead of `main`, working tree carried one pre-existing generated diff (`frontend/next-env.d.ts`).

### Findings & fixes
- **3 stale SQLAlchemy references (genuine defect):** `docs/database/migration-strategy.md`, `docs/database/naming-conventions.md`, `docs/guides/backend-setup.md` still described SQLAlchemy as the current data-access mechanism — contradicting ADR-0005. **Fixed** to `supabase-py` + PostgreSQL RPC (RLS/JWT preserved).
- **gitignore gap:** no generic `logs/`, `*.log`, `*.transcript`. **Added.**
- **Generated file drift:** committed the Next-regenerated `next-env.d.ts` (typed-routes reference) so the tree is clean.
- **CI readiness:** added a documented recommended CI command sequence to `README.md`.
- **No other defects:** no duplicate headings/paragraphs, no truncation/garble, no broken links (152 checked, 0 broken), no competing lockfiles, empty files are only legitimate `__init__.py`/`.gitkeep`.

### Stale-term classification (section 11)
- `active profile` / `Use As` / `Profile Switcher`: all remaining hits are **valid current rules** (the "no profile switcher" rule) or **intentional historical** (verbatim founder brief `design-idea.md`, covered by a supersession note). No stale conflicts.
- `SQLAlchemy` / `Alembic`: after the 3 fixes, remaining hits are **ADR/deferred/historical** (ADR-0005 defining the decision, "deferred" statements, append-only log, the non-authoritative `agents/commands/db-migrate.md` marked superseded). No stale current-tense claims.
- `WCAG 2.1`: only **supersession/log records** ("2.1 → 2.2"); active target is **WCAG 2.2 AA**.
- `product-direction.md` / `agent-work-log.md`: only in **historical log + change-history** entries (the `git mv` records). Valid.

### Tests & validation (commands + results)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` ✅ (production build; `/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ · fail-fast (staging+missing secrets → `ValidationError`) ✅ · `/health` → `200 {"status":"ok","service":"backend","env":"local"}` ✅.
- Backend **Docker build BLOCKED** — `ghcr.io` TLS handshake timeout / `tls: bad record MAC` (reproduced 3× incl. `docker pull`). Dockerfile statically correct (non-root uid 10001, healthcheck, minimal COPY).
- Supabase: `--version` 2.110.0 ✅ · `config.toml` valid TOML ✅ · **full stack BLOCKED** — required images (Postgres 17 etc.) uncached and unpullable in this environment. Partial state cleaned via `supabase stop`.
- Extensions migration reviewed ✅ (pgcrypto/pg_trgm/vector/postgis into `extensions` schema); seed empty; **no `CREATE TABLE` anywhere** ✅.
- Security: no `.env`/secrets tracked ✅ · `.env.example` placeholders only ✅ · no service-role in `frontend/src` ✅ · browser client uses anon key only ✅ · `.pen` untracked + hashes unchanged ✅ · tracked-file secret scan clean ✅.

### Commits
- `7d3c280` docs: correct three stale SQLAlchemy data-access references to supabase-py
- `f6ad9d6` chore: harden ignore rules for logs/transcripts; sync generated next-env.d.ts
- `adbea03` docs: add recommended CI command sequence to README
- (this entry) docs: refresh runtime state and record foundation-review session

### Unfinished / blocked
- **Environment-only:** backend Docker image build and Supabase local stack (`start`/`db reset`/`db lint`) not executable here (registry unreachable). Run in CI / stable network. No code change required.
- Git remote + push — none configured (branch stays local; not pushed).
- CI/CD pipeline — commands documented; not wired.
- First product migration + RLS + isolation tests — the next authorized step (not started).

### Blockers
Container registry unreachable in this sandbox (`ghcr.io` TLS timeout; `public.ecr.aws` Supabase images uncached). Not a foundation defect.

### Rollback notes
All on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` untouched. Revert a slice with `git revert <sha>`. No `.pen` modified; no live DB touched.

### Next recommended action
Foundation is verified merge-ready (with the two registry-dependent checks to be run in CI). Await explicit direction to merge or to begin the implementation roadmap (identity & multi-tenancy → orgs/memberships/branches → RLS + isolation tests → 05C Sales).

---

## Session — Core Project-Memory Consolidation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish four canonical persistent project-memory files + a live runtime-state file, reconcile all documentation/ADRs with them, defer the unused SQLAlchemy dependency, and add session-hygiene rules — **without** implementing any product feature, editing any `.pen` file, merging, or pushing.

### Starting state
10 commits ahead of `main`, working tree clean, HEAD `6f63867`. Existing memory docs: `product-direction.md`, `agent-work-log.md`. Contradictions present: profile-switching model in 6 files; WCAG 2.1; hardcoded component count; SQLAlchemy listed as a dependency but unused.

### Files moved (history preserved via `git mv`)
- `docs/product/product-direction.md` → `docs/product/PRODUCT_DIRECTION_GUIDE.md`
- `docs/operations/agent-work-log.md` → `docs/operations/AGENT_WORK_LOG.md`

### Files created
- `docs/architecture/ARCHITECTURE_GUIDE.md` (core memory — current-state architecture)
- `UI-UX/UI_UX_SYSTEM_GUIDE.md` (core memory — design system moved out of `UI-UX/AGENTS.md`)
- `docs/operations/RUNTIME_STATE.md` (core memory — mutable live snapshot)
- `docs/README.md` (documentation index)
- `docs/decisions/ADR-0005-python-data-access.md`

### Files modified
- Rewritten: `docs/product/PRODUCT_DIRECTION_GUIDE.md` (metadata, dual roadmap, decision process, change history, account-model correction); `UI-UX/AGENTS.md` (slimmed to operational).
- Reconciled: root `AGENTS.md` (reading order + persistent-memory policy + dependency policy), `CLAUDE.md`, `README.md`, `docs/AGENTS.md` (layout + end-of-session checklist), `docs/architecture/system-context.md`, `docs/product/mvp-scope.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/decisions/ADR-0002` (cross-ref) and `ADR-0003` (reading order).
- Backend (SQLAlchemy defer): `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/database/__init__.py`, `backend/.env.example`.

### Decisions made
- **Account/navigation model corrected** from "active-profile switching" to canonical **one current primary account type / no Profile Switcher / derived navigation** across all product, architecture, and UI docs. This is a wording/consistency correction of the identity model, **not** a product-strategy change.
- **ADR-0005:** Python data access uses **`supabase-py`**; **SQLAlchemy deferred** (was an unused scaffold dependency), **Alembic** stays excluded, complex ops via **PostgreSQL RPC**, user-facing ops preserve the caller JWT so **RLS applies**, service-role limited to trusted workers.
- **Accessibility target** raised WCAG 2.1 AA → **WCAG 2.2 AA**; removed the hardcoded "~127 components" count (design.pen is the source of truth).
- **Reading order** now mandates the four core-memory files + `RUNTIME_STATE.md` before scoped AGENTS/ADRs.

### Tests & validation
- `uv sync --python 3.12` → `sqlalchemy` removed, `supabase` 2.31.0 added, `uv.lock` regenerated. ✅
- `uv run ruff check .` → All checks passed. ✅
- `uv run pytest` → 3 passed, 1 benign warning. ✅
- Residual `sqlalchemy` in source: only the intentional "deferred" note in `app/database/__init__.py`. ✅
- Documentation-link validation and `.pen` hash re-check: run at session end (see final report). 
- Frontend suite **not** re-run — no frontend source changed (Markdown docs only).

### Commits
- `cf1e0cc` docs: establish canonical project-memory files
- `d4a52dc` docs: reconcile product, architecture, and UI guidance with core memory
- `da6c69a` refactor: defer unused SQLAlchemy; adopt supabase-py for Python data access
- (this entry) docs: add runtime state and session hygiene

### Unfinished work
- Supabase local stack + `db reset` + RLS/organization-isolation tests (needs Docker) — still pending.
- Git remote + push — none configured (branch is local-only; not pushed per task).
- CI/CD pipeline — deferred.
- design.pen → Tailwind token bridge — deferred to first UI feature.

### Blockers
None for documentation/memory work. Docker required for the full Supabase RLS test pass.

### Known warnings (benign)
Frontend pnpm peer-dep warning (`unrs-resolver`/`@emnapi`); backend `StarletteDeprecationWarning` under pytest. No functional impact.

### Rollback notes
All changes are on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is untouched. Revert a slice with `git revert <sha>` (commits are focused: memory files / reconciliation / SQLAlchemy / runtime+hygiene). `git mv` renames are reversible via `git mv` back. No `.pen` file was modified. No live DB/migration was applied.

### Next recommended action
Await explicit authorization to begin the implementation roadmap: **architecture hardening → identity & multi-tenancy → organizations/memberships/branches/permissions → RLS + tenant-isolation tests → 05C B2B Sales**. Do not start product implementation autonomously.

---

## Session — Repository Architecture Foundation
**Date:** 2026-07-29 → 2026-07-30
**Agent:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish the repository architecture foundation only — audit the repo, consolidate agent instructions, build the AGENTS hierarchy + ADRs + docs, and scaffold the approved stack (Next.js + Supabase + specialized FastAPI) — **without** implementing product features, connecting production services, or touching any `.pen` file. Two follow-on requests were completed in the same session: the UI-UX design-system guidelines and the product-direction guide.

### Changes Made
- **Git:** initialized the repo (`git init -b main`), committed the as-found baseline, branched. 10 commits, WHAT/WHY messages. Working tree clean.
- **Ignore/config:** authored `.gitignore` (secrets, `.claude/`, `*.pen`, node/python/supabase artifacts), `.gitattributes` (`*.pen binary`, LF normalization), `.editorconfig`.
- **Agent instructions:** rewrote root `AGENTS.md` (filled empty Stack section, added reading-order + composition rules, migrated the git-discipline rule in); added scoped `AGENTS.md` for `frontend`, `backend`, `supabase`, `docs`, `data`, `UI-UX`; added `agents/README.md` marking `agents/` as non-authoritative source material; recorded the source→destination map in `docs/decisions/agent-instruction-migration.md`.
- **Docs/ADRs:** ADR-0001..0004; architecture (×6), security (×3), database (×2), operations (×2), product (mvp-scope + moved design-idea/client-brief); rewrote the 3 setup guides. Later added `product-direction.md`.
- **Frontend:** Next.js 15 App Router scaffold (strict TS, Tailwind, ESLint flat config, Zod env module, Supabase browser factory, EN/AR i18n constants, `/api/health`, domain-oriented `features/lib/server` structure, one vitest test).
- **Backend:** specialized FastAPI scaffold (`aladdin-backend`) — app factory, Pydantic-Settings config (fail-fast in staging/prod), `/health`, capability-module boundaries, Dockerfile (non-root + healthcheck), health/config tests; removed stale Alembic/Vite-referencing artifacts.
- **Supabase:** kept `config.toml` (`project_id=aladdin`); added extensions migration (pgcrypto/pg_trgm/vector/postgis), `seed.sql`, functions/tests conventions.
- **Cleanup:** rewrote root `README.md`, `data/README.md`, `assets/brand/README.md` (canonical-source vs runtime-export rule); corrected `CLAUDE.md` stack (React+Vite → Next.js).
- **UI-UX:** appended a 24-section Design System & UX guideline to `UI-UX/AGENTS.md` (token-driven; consultation-first, passwordless, RTL, light/dark, anti-patterns).
- **Product:** added `docs/product/product-direction.md` (vision, positioning, philosophy, priority rules, "agents must never" guardrails).

### Files Modified
124 files changed vs baseline (`git diff --stat main..HEAD` → +8439 / −62). By area:
- Root: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `agents/README.md` (+ existing personas/commands retained)
- `frontend/**` (~49 files: configs, `src/app`, `src/lib`, `src/features/*`, `.env.example`)
- `backend/**` (~26 files: `app/*`, `tests/*`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `.env.example`)
- `supabase/**` (migrations, seed, functions, tests, `AGENTS.md`)
- `docs/**` (~26 files: AGENTS, ADRs, architecture, security, database, operations, product, guides) — incl. this file
- `assets/brand/README.md`, `data/**`, `UI-UX/AGENTS.md`
- Moved (history preserved): `docs/architecture.md`→`architecture/overview.md`; `docs/design_idea.txt`→`product/design-idea.md`; `docs/client-brief.md`→`product/client-brief.md`

### Architectural Decisions
- **ADR-0001** Approved architecture: modular monolith — Next.js App Router (no Vite/SPA) + Supabase + specialized FastAPI + workers.
- **ADR-0002** Supabase SQL migrations are the only schema source of truth; no Alembic; no `create_all()` in staging/prod; SQLAlchemy read-side only.
- **ADR-0003** Agent-instruction hierarchy + mandatory reading order.
- **ADR-0004** Deployment: Vercel (web) · Railway (FastAPI/workers, Docker) · Supabase (data) · Sentry.

### Remaining Work
- Stand up the local Supabase Docker stack; run `supabase db reset` + first RLS/organization-isolation tests (pending — needs Docker image pull).
- Add a git **remote** and push (currently local-only).
- Build CI/CD pipeline (deferred).
- Extract `design.pen` design tokens into `frontend/src/styles` + Tailwind theme (token bridge).
- Optional: `docs/README.md` index; persist a `runtime-state.md`.
- **Next feature phase:** 05C — B2B Sales operating workflow (start with the first authenticated tenant table migration + its RLS + isolation tests).

### Risks / Warnings
- **Toolchain:** `uv` installed via pip (at `…/pythoncore-3.14-64/Scripts/uv`; add to PATH). System Python is **3.14**; backend deliberately uses a uv-managed **3.12** (`uv sync --python 3.12`) to avoid missing 3.14 wheels.
- **No remote/push** yet; if this becomes a public repo, verify ignore rules still hold before first push (`.claude/`, `.env*`, `*.pen` are covered).
- **`.pen` files are gitignored** — ensure they are versioned in **private** storage (they are not in git).
- Benign only: pnpm peer-dep warning (`unrs-resolver`/`@emnapi`), pytest `StarletteDeprecationWarning`. No functional bugs.

### Testing Status
- Frontend: `tsc --noEmit` ✅ · `eslint .` ✅ · `vitest run` ✅ (3 passed)
- Backend: `uv run pytest` ✅ (3 passed) · `uv run ruff check .` ✅
- Supabase: `supabase --version` ✅ (2.110.0) · `config.toml` valid TOML ✅ (full `db reset`/RLS tests pending Docker)
- Repo: internal markdown links ✅ (0 broken) · secret scan ✅ (clean) · `.pen` sha256 ✅ (all 5 identical to baseline; none tracked)

### Rollback Notes
- All foundation work is on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is the repo **as-found**.
- Revert everything: `git checkout main` (or delete the branch). Revert a slice: `git revert <sha>` — commits are logically grouped (baseline / AGENTS / docs+ADRs / frontend / supabase / backend / cleanup / UI-UX / product).
- No `.pen` file was modified, so there is nothing to restore there; backups remain on disk.
- Deleting the whole scaffold is safe (nothing external was connected; no migrations were applied to any live DB).

---
