---
description: 
alwaysApply: true
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is right now

**Design-led, with the architecture foundation now scaffolded.** The primary design work product is the encrypted Pencil file `UI-UX/design.pen`. As of the repository-architecture-foundation task, the code foundation exists but **no product features are implemented yet**.

- `AGENTS.md` (root) is the **source of truth for coding conventions**, backed by a scoped hierarchy: `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/AGENTS.md`, `data/AGENTS.md`, `UI-UX/AGENTS.md`. **Read the root `AGENTS.md` and every applicable scoped one before touching a file.**
- Architecture is fixed in ADRs under `docs/decisions/` (ADR-0001 approved architecture, ADR-0002 migrations, ADR-0003 agent-instruction hierarchy, ADR-0004 deployment, ADR-0005 Python data access). Product scope: `docs/product/mvp-scope.md`.

## Project Memory — Read First

Five files are **persistent project memory and part of the core architecture**, not optional docs. Product, architecture, UI, and unfinished-work decisions must **not** live only in prompts or chat history — they live here, and agents read them before making changes:

1. [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](docs/product/PRODUCT_DIRECTION_GUIDE.md) — product direction & guardrails.
2. [`docs/architecture/ARCHITECTURE_GUIDE.md`](docs/architecture/ARCHITECTURE_GUIDE.md) — currently active architecture (complements the ADRs).
3. [`UI-UX/UI_UX_SYSTEM_GUIDE.md`](UI-UX/UI_UX_SYSTEM_GUIDE.md) — design system, tokens, UX rules.
4. [`docs/operations/AGENT_WORK_LOG.md`](docs/operations/AGENT_WORK_LOG.md) — append-only session log & unfinished work.
5. [`docs/operations/RUNTIME_STATE.md`](docs/operations/RUNTIME_STATE.md) — current live repository state.

Full authority rules and the end-of-session checklist: root [`AGENTS.md`](AGENTS.md) and [`docs/AGENTS.md`](docs/AGENTS.md). Documentation map: [`docs/README.md`](docs/README.md).
- `frontend/` is a Next.js App Router scaffold (typecheck/lint/tests green); `backend/` is a specialized FastAPI service scaffold; `supabase/` holds migrations (schema source of truth). Commands live in each service's README and `docs/guides/`.
- `docs/product/design-idea.md` is the original founder brief (Arabic). `UI-UX/design.*.BACKUP-*.pen` are frozen backups — **never delete or overwrite them.** All `.pen` files are gitignored and must never be edited by a coding task.

## The product: Aladdin

AI-first operating system / digital infrastructure for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector. **B2B-first**, with a connected B2C consultation/discovery/project layer.

- Three surfaces: **B2C**, **B2B** (Sales is the key daily-active user), **Admin**.
- Core value chain: Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up. It is a **consultation-first** platform, **not** an add-to-cart / price-war marketplace.
- Multi-role taxonomy, **one canonical identity**: the roles (End Consumer, Installer/Technician, Engineer, Interior Designer, Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Sales, Contractor, Trainer, Trainee, Admin) are kept **separate** even when behavior overlaps — do not merge them. A user has **one current primary account type** at a time; there is **no Profile Switcher / "Use As" mode / persona-switching UI**. Navigation and access are **derived** from primary account type, organization membership, branch assignment, permission capabilities, verification state, and subscription state. See [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](docs/product/PRODUCT_DIRECTION_GUIDE.md).
- **Account / organization / workspace model (canonical):** **one person = one user ID** — another business never creates another user. Personal identity (`users`/`profiles`) is **not** a business, and a personal professional may hold **zero** organizations. A business is an **Organization**, created **once** in the UX (backend transactionally creates organization + owner membership + primary branch), linked by a **Membership** that owns relationship, capabilities, branch scope, and lifecycle; employees join by invitation. One login may hold **zero/one/many** organizations, and an existing user can add a business later with no second sign-up. **"Owner/manager" is a relationship, never an account/business type** (the generic entry is transitional back-compat only). A **workspace is derived** (Personal = User+Profile · Business = Organization+active Membership) — **no `workspaces` table**; switching the active **work context** is allowed and is *not* persona switching. Never duplicate business identity onto the user or personal identity into organization records.
- Egyptian context: real locality data (Cairo, New Cairo, Sheikh Zayed), EGP. English-first release, but components must support **Arabic RTL** from day one; Arabic version is part of the MVP. **Light + Dark** from the first design system.

### Authentication model (canonical)

**Passwordless.** Register / sign in via **WhatsApp OTP** or **Email OTP / verification link**. User verifies exactly **one** primary contact during account creation; a secondary is added later from profile settings. **No passwords** — password / forgot / reset flows are legacy/superseded. WhatsApp OTP only for phone (no SMS). reCAPTCHA only on Create Account. One canonical identity regardless of verification method. Never surface technical implementation copy in the UI (no "WhatsApp Business API", "canonical account", server-side notes, etc.).

### Design roadmap (order matters)

Build inner workflows **before** dashboards. Order: **05C** B2B Sales workflow (first — Sales is the daily driver) → **05A** Core B2C value journey → **05B** Quote & Project journey → **05D** Supplier/Showroom/Product ops → **05E** B2B Cockpit & Admin completion (dashboards last). Do not start a Session 05 module until the foundation baseline is reconciled and reviewed.

## Working with the Pencil design file

`UI-UX/design.pen` is **encrypted**. Access it **only** through the `mcp__pencil__*` MCP tools — **never** `Read`, `Grep`, or `cat` a `.pen` file.

- Before using any Pencil tool, call `get_app_state({ include_schema: true, include_canvas_design: true, include_scripts_and_shaders: false, include_browser: false })` — all four flags required — to load the current schema. You cannot use the other tools correctly without it.
- Node **names derive from the first ~22 chars of their content**, so name-search misses mid-string text. To search content, use `export_html` / `export_nodes` and grep the output.
- Canvas layout: top-level is a set of real container frames — `ROW 00 Foundation` (boards 00A–00H; **00H is the current QA authority**, overriding all historical QA boards), product `ROW 02`–`ROW 11`, then zones for Component Library, Documentation, Historical QA, and an Archive for legacy/superseded screens. Each product row uses lane order Desktop L/D · Tablet · Mobile L/D · Supporting States.
- Theme axis is **only `mode: light/dark`**. Platform / device / language are naming lanes, **not** theme axes.

### Pencil gotchas (learned the hard way)

- **Do not `Update()` layout props (`justifyContent`, `alignItems`) right after creating a frame** — it can corrupt that subtree's layout cache and render blank while the data reads correct. Build layout right in the first `Insert`. If a subtree renders blank, `Delete()` and rebuild it in one clean pass.
- **Persistence:** MCP edits land in the live editor's working copy; the on-disk `.pen` does **not** flush mid-session (mtime stays at session start) — it saves on the editor's own save trigger. Verify persistence by mtime/size.
- **Stale renders:** the screenshot tile-cache can show freshly built boards as blank for a canvas band until the file reloads. Trust an overlap/bounds scan (`Get(...)`) over a blank screenshot. `ctx.problems` flags only child-vs-parent clipping, not sibling overlap — compute sibling overlap yourself.
- Instance overrides use `descendants:{ childId: { prop } }`. `Replace(id, node)` swaps a node while keeping its layout slot. Warnings that name an already-replaced id are stale — verify by render.

### Trust rules

This file was built by a prior AI agent across sessions 01–04D, then taken over for context recovery. **Do not trust prior session summaries, QA boards, or "complete/ready" labels** — independently review each screen's full rendered UI. The consumer/business/admin home frames (Rows 09/10/11) are single rich frames, not stubs; much of the core value journey (05A–05E workflows) does not exist yet.

## Approved stack (see ADR-0001)

**Next.js App Router** + React + TypeScript strict + Tailwind (frontend, `pnpm`) · **Supabase** Postgres/Auth/Storage/RLS/Realtime/pgvector (schema via `supabase/migrations`, ADR-0002) · **specialized FastAPI** service for AI/OCR/RAG/documents/workers only — *not* the CRUD backend (`uv`) · OpenAI. Hosting: Vercel + Railway + Supabase (ADR-0004). **Not Vite, not a React SPA.**

Config is centralized per service (`frontend/src/lib/env`, `backend/app/config.py`) — never read `process.env` / `os.getenv` directly in app code, and don't call `load_dotenv`. Fail fast on missing config; no silent defaults for secrets. Default to writing code yourself; justify every runtime dependency (see `AGENTS.md` "Dependency policy"). `pnpm` only for Node, `uv` only for Python.
