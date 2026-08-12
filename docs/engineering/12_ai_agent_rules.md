# 12 — AI Agent Development Rules

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | Root [`AGENTS.md`](../../AGENTS.md), [`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md), [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) |
| **Related** | all [`.`](README.md) engineering docs, [`../technical/`](../technical/) |

Covers **AI Agent Development Rules (25)** — the rules **every AI agent** must follow when building Aladdin. This consolidates the enforceable constraints already stated across the repo into one place; the sources remain authoritative.

> **Distinguish two things:** (a) *rules for AI agents that write the code* (this doc); (b) *rules for the product's own AI features* (human-in-the-loop, tenant-filtered retrieval — [`security-model.md`](../security/security-model.md), [`11_performance_and_security`](11_performance_and_security.md)). Both apply.

## 1. Before doing anything

1. **Read the memory** in the [mandated order](../../AGENTS.md#reading-order-follow-every-time): root `AGENTS.md` → the 4 core-memory files → `RUNTIME_STATE.md` → the nearest scoped `AGENTS.md` → relevant ADRs → the relevant spec.
2. **Find the authority:** on any conflict, follow the [documentation authority order](../technical/README.md#authority) (ADRs → Product Direction → MVP Scope → UI System → Runtime State). Never silently follow the narrower source — report and reconcile.
3. **Confirm scope:** the task fits `mvp-scope`/roadmap. If a decision is `⚑ OPEN` (unresolved product decision), **stop and surface it** — do not invent it.

## 2. Must NOT (hard rules)

**Product & architecture**
- Do **not** build "never" features: add-to-cart/checkout/storefront, price-war/blind bidding, generic horizontal CRM, profile (persona) switcher / "Use As" / account-identity switching, password/forgot/reset flows.
- Do **not** create a second user/auth identity for the same person (per role, per contact channel, or per business), model a business as anything but an `Organization` reached through a `Membership`, add a generic `workspaces` table, or copy business identity onto the user (or personal identity into organization records) as a second source of truth. *(Switching the active **work context** between the personal surface and organizations with an active membership is allowed — it is not persona switching.)*
- Do **not** change product direction, architecture, or the design system outside the documented change process (+ the required memory/ADR updates).
- Do **not** introduce excluded tech (Vite/SPA/React Router, Alembic, `create_all()` in staging/prod, Kubernetes/Kafka/Redis/Elasticsearch/second DB) without a new ADR.
- Do **not** recreate product CRUD in FastAPI; do **not** add unapproved integrations (Cloudinary/Firebase/Google-Maps/payments) — use the approved stack ([`13_integrations`](../technical/13_integrations.md)).

**Data & security**
- Do **not** ship a tenant table without RLS + organization-isolation tests.
- Do **not** trust client-supplied `user_id`/`organization_id`; derive identity from the JWT.
- Do **not** leak data across organizations (UI/API/worker/AI retrieval).
- Do **not** put secrets/`service_role` in client code; do **not** commit `.env`/secrets/`.pen`.
- Do **not** let the product's AI auto-send or take irreversible action without human review.

**Design system**
- Do **not** invent colors, spacing, type roles, shadows, radii, breakpoints, z-index, components, or a second icon library — consume canonical **semantic tokens** and follow [`design/GOVERNANCE.md`](../../design/GOVERNANCE.md).
- Do **not** ship one-theme-only or non-RTL components; do **not** surface technical/implementation copy in UI.

**Files & process**
- Do **not** edit, rename, or delete any `.pen` file from a coding task (they are private, gitignored, MCP-only).
- Do **not** squash/force-push shared history; do **not** merge with failing checks or an unmet Definition of Done.
- Do **not** claim unfinished work is complete; report validation faithfully (failures included).

## 3. Must DO

- **Reuse before adding:** search existing components/docs/services; extend, don't fork. Cross-reference; never duplicate documentation.
- **Validate at boundaries** (Zod/Pydantic); use the shared `Result`/`ApiError`.
- **Test the required paths** (validation, RLS/isolation, state transitions, mappers, money/quantity) — green before Done.
- **Keep memory synchronized:** any change that touches architecture/product/design updates, in the same change, the relevant canonical-memory file(s), the affected technical/engineering doc(s), the ADR (if architectural), `RUNTIME_STATE.md`, and `AGENT_WORK_LOG.md` ([docs index sync rule](../README.md#documentation-standard)).
- **Follow the workflows:** [feature](07_feature_workflow.md) · [migration](08_database_migration_workflow.md) · [PR/review](09_pull_request_and_review.md).
- **When adding a design-system token/component,** update `DESIGN.md`, the token JSON, `UI_UX_SYSTEM_GUIDE.md`, the component inventory, `design/CHANGELOG.md`, and the operations memory together ([`design/GOVERNANCE.md`](../../design/GOVERNANCE.md)).

## 4. When unsure

If an important decision cannot be inferred safely from the authoritative docs, **stop and ask** (or record it as a `needs-product-decision` / `⚑ OPEN` item) rather than documenting or coding an assumption. Surfacing an unknown is always preferred to inventing one.

## 5. Source rules (authoritative; this doc consolidates, it does not override)
Root [`AGENTS.md`](../../AGENTS.md) · scoped `AGENTS.md` (frontend/backend/supabase/UI-UX/docs/data) · [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) "What Agents Must NEVER Do" · [`design/GOVERNANCE.md`](../../design/GOVERNANCE.md) "AI-agent design rules" · [`security-model.md`](../security/security-model.md) · the ADRs.
