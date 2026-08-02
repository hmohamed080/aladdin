# 05 — Validation Strategy & Shared Validation Rules

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../technical/12_validation_rules.md`](../technical/12_validation_rules.md), [`03_api_standards.md`](03_api_standards.md) |
| **Related** | [`06_testing_strategy.md`](06_testing_strategy.md) |

Covers **Validation Strategy (8)** and **Shared Validation Rules (18)**. The full per-domain rule catalog is [`12_validation_rules.md`](../technical/12_validation_rules.md); this doc defines the **strategy and the reusable primitives**.

## 1. Strategy

- **Zod-first, one schema, shared client + server.** Define the schema once in `features/<domain>/schemas`; use it in the client form (React Hook Form + `zodResolver`) and again in the Server Action before any work. Types derive from it (`z.infer`) so validation and types never drift.
- **FastAPI** validates with **Pydantic v2** at the boundary (mirroring the same rules for the specialized endpoints).
- **Three lines of defense:** (1) Zod/Pydantic at the boundary → (2) authorization (capability + RLS) → (3) DB `CHECK`/`unique`/FK constraints as the last line ([`03_database_design.md`](../technical/03_database_design.md)).
- **Validate at boundaries, trust internal state** — no re-validating already-validated internal data.
- **Errors** map to `VALIDATION_ERROR (422)` with `fields` for inline display; messages are **localizable keys** (AR/EN), specific and non-blaming.
- Validate on **blur/submit**, not every keystroke; summarize only for long forms.

## 2. Shared validation primitives

A single reusable module (`frontend/src/lib/validation/*`, mirrored in `backend/app/schemas`) provides the primitives every feature composes — never re-implemented per feature:

| Primitive | Rule |
|---|---|
| `zPhoneEG` | E.164, Egypt-aware (`+20` default); WhatsApp-capable; **no SMS** |
| `zEmail` | RFC-valid, normalized lowercase |
| `zOtpCode` | fixed length (⚑ 6), numeric |
| `zEgpAmount` | `numeric(14,2)`, `≥ 0`, currency `EGP` |
| `zQuantity` | `> 0` |
| `zUuid` | uuid |
| `zLocalityId` | exists in `localities` |
| `zPagination` | `page ≥ 1`, `pageSize ≤ MAX_PAGE_SIZE` |
| `zSlug` | kebab, unique per scope |
| `zBilingualText` | `{ en, ar }` for reference labels |
| `zMediaUpload` | MIME allow-list + size ≤ bucket max ([`05_storage_design`](../technical/05_storage_design.md)) |
| `zCapabilityKey` | ∈ fixed capability catalog ([`07_permissions_matrix`](../technical/07_permissions_matrix.md)) |
| `zEnum(<enum>)` | ∈ the DB enum ([`03_database_design`](../technical/03_database_design.md)) |

## 3. Cross-cutting invariants (enforced in every write)

- **Tenancy assertion:** the target row's `organization_id`/`user_id` matches the caller's scope (defense-in-depth over RLS).
- **State-transition guard:** only legal transitions ([`11_state_machines`](../technical/11_state_machines.md)); illegal → `CONFLICT`.
- **No password fields anywhere** (passwordless); reject if present.
- **No commerce semantics** (no checkout/cart/price-war); product pricing is indicative ranges only.
- **Idempotency key** validated on retryable operations.
- **Bidi/RTL:** accept AR + EN; format EGP/numerals per locale; never encode meaning with italics in Arabic.

## 4. Where domain rules live

Per-domain specifics (registration, org, verification, catalog, RFQ, quotes, media, OCR, etc.) are the **authoritative catalog** in [`12_validation_rules.md`](../technical/12_validation_rules.md). Implementers compose the primitives above to satisfy that catalog — they do not restate or fork the rules here.
