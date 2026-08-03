# 12 — Validation Rules

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | 02_domain_model.md, 03_database_design.md |
| **Related** | 08_api_contracts.md, 11_state_machines.md |

Every business validation for the MVP. **Validation is Zod-first** (`frontend/src/features/*/schemas` and `lib/validation`): one schema shared client + server; validate at boundaries (HTTP input, external APIs, DB writes), trust internal state ([`AGENTS.md`](../../AGENTS.md) code style). DB `CHECK`/`unique` constraints ([03](03_database_design.md)) are the last line. Error messages are **localizable keys** (AR/EN), inline and non-blaming ([UI_UX_SYSTEM_GUIDE](../../UI-UX/UI_UX_SYSTEM_GUIDE.md)).

**Conventions:** `required`, `optional`, ranges are `[min,max]`. All string inputs are trimmed; user HTML is escaped/sanitized; no raw HTML stored.

## 1. Auth & registration

| Field / rule | Validation |
|---|---|
| Contact channel | ∈ `{whatsapp, email}` |
| Phone (WhatsApp) | E.164, valid country (Egypt default `+20`); **no SMS** path |
| Email | RFC 5322; normalized lowercase; MX check best-effort (non-blocking) |
| OTP code | fixed length (⚑ 6), numeric; TTL (⚑ 5 min); **attempt cap** (⚑ 5) then lockout/backoff |
| reCAPTCHA | **required on account creation only**; verified server-side |
| Primary account type | ∈ `account_type` enum; exactly one |
| One primary contact | exactly one verified `is_primary` contact at creation |
| Rate limits | OTP requests per contact/IP throttled → `429` ([13](13_integrations.md)) |
| Passwordless | **reject** any password/confirm/forgot field — they must not exist |
| Display name | required, `[2,80]`, no control chars |

## 2. Profile

| Rule | Validation |
|---|---|
| display_name | `[2,80]` | 
| headline/bio | optional, `[0,120]` / `[0,1000]` |
| avatar | image rules (§8); `avatars/` bucket |
| locality | valid `locality_id` (exists, leaf/any level) |
| portfolio | professional account types only |
| **account type** | `primary_account_type` is **server-controlled** — never accepted from a client profile edit; changes only via the approved upgrade/admin workflow ([ADR-0007 D10](../decisions/ADR-0007-identity-and-tenancy-model.md)) |
| **public visibility** | `public_profile_status` (`hidden`/`listed`) is **server-controlled** — set by the approved professional-verification/upgrade workflow, never self-listed; public discovery requires `listed` + professional type + active + not deleted |

## 3. Organization

| Rule | Validation |
|---|---|
| name | required, `[2,120]`, unique-ish (trgm dupe warning, not hard block) |
| org_type | ∈ enum subset that can own an org (not `end_consumer`) |
| locality | valid `locality_id` |
| logo | image rules; `logos/` bucket |
| submit-for-verification | required fields complete + ≥1 verification doc + creator has `org.manage` |
| create limit | ⚑ per-user org creation cap (anti-abuse) OPEN |

## 4. Membership & capabilities

| Rule | Validation |
|---|---|
| invite | valid contact; not already an active member (`uq` user+org) |
| capabilities | each key ∈ fixed catalog ([07](07_permissions_matrix.md)); inviter can grant only capabilities they hold (no escalation) |
| branch assignment | active membership + active branch; both belong to the same org; duplicate assignment is an idempotent no-op; `primary_branch_id` grants no access |
| revoke / capability removal | cannot remove the **last** active `org.manage` owner; every protected mutation locks the stable organization row before recheck/change |
| write boundary | direct membership/capability/branch-assignment DML denied to `authenticated` and `service_role`; RPC audit failure rolls back the mutation |

## 5. Verification & professional

| Rule | Validation |
|---|---|
| subject | exactly one of user/org per `subject_type` (DB CHECK) |
| documents | ≥1 doc to submit *(deferred — enforced when storage/OCR lands; Sprint 2 allows doc-less submit, table is a placeholder)* |
| doc types | required set per subject/account type (⚑ e.g. Engineer → syndicate card; Company → commercial register — exact list OPEN with product) |
| decision | reviewer authority only from `platform_role_grants`; assigned reviewer is sticky; reviewer is not the user subject nor a member of the organization subject; reason required on reject/needs_more_info |
| account-upgrade request | self-service; caller-derived (`auth.uid()`, no user_id param); target is a professional type ≠ current, ≠ `end_consumer`; one open request per user (partial unique index); same-target `needs_more_info` call resubmits, clears the prior claim/reason, and requires fresh `review_start`; never mutates account type/listing |
| apply | only an unexpired, approved, professional user verification applies; target user comes from the immutable verification; idempotent (`applied_at`); lists only when the immutable approved `grants_public_listing` flag is true |
| immutability | subject/type/target/submission metadata cannot change; terminal/applied decisions cannot change; listing flag changes only during approval |
| write boundary | direct privileged identity/verification DML denied to browser and `service_role`; audit failure rolls back account/listing/applied_at |
| expiry | optional `expires_at > submitted_at`; expired approval cannot apply |

## 6. Catalog (products)

| Rule | Validation |
|---|---|
| name | required `[2,140]` |
| category/brand | valid ids if provided |
| attributes | conform to the category's attribute schema (⚑ per-category schema registry OPEN) |
| indicative price | `min ≤ max`, both `≥ 0`, `numeric(14,2)`; **ranges only** — reject any single "buy price"/checkout semantics |
| currency | `EGP` |
| **publish gate** | required fields present + ≥1 media + org `is_verified` (⚑ confirm) + `catalog.publish` |
| media count | ≤ (⚑ cap, e.g. 12) images |

## 7. Documents

| Rule | Validation |
|---|---|
| MIME | ∈ bucket allow-list ([05](05_storage_design.md)); magic-byte sniff must match declared MIME |
| size | ≤ bucket max (25 MB docs) |
| filename | sanitized to UUID object name; original kept in row |
| verification docs | private `verification/` bucket only; never public |
| OCR | async; failure ≠ upload failure (doc stays, `ocr_status=failed`, retry) |

## 8. Images

| Rule | Validation |
|---|---|
| MIME | jpeg/png/webp (svg only for logos) |
| size | ≤ bucket max (5 MB avatar/logo, 10 MB product) |
| dimensions | min (⚑ e.g. 200×200), max (⚑ e.g. 6000×6000); reject 0-byte |
| EXIF | stripped for avatars/verification (privacy) |
| primary | at most one `is_primary` per product |

## 9. Videos (reels/portfolio)

| Rule | Validation |
|---|---|
| MIME | mp4/webm |
| size | ≤ bucket max (⚑ 50 MB) |
| duration | ≤ (⚑ 60s reels) |
| codec | H.264/VP9 (⚑ confirm); reject unplayable |

## 10. WhatsApp

| Rule | Validation |
|---|---|
| number | E.164; opted-in (WhatsApp policy) |
| template | pre-approved template id + valid variables (Meta template rules) |
| OTP send | rate-limited; **no SMS fallback**; retries backoff |
| copy | **never** expose technical terms ("WhatsApp Business API") in user-facing text |

## 11. Email

| Rule | Validation |
|---|---|
| address | RFC valid, normalized |
| OTP/verification link | signed, single-use, TTL; link opens verification, not password reset |
| operational vs marketing | marketing requires opt-in ([02](02_domain_model.md) preferences) |
| bounces/complaints | processed via webhook → suppress list ([13](13_integrations.md)) |

## 12. OCR

| Rule | Validation |
|---|---|
| input | a stored `document` id in an allowed MIME |
| output | `ocr_text` stored on the doc row; confidence captured (⚑ threshold to flag manual review) |
| Arabic | OCR must handle Arabic script (Azure DI candidate) — **⚑ verify AR accuracy before finalizing provider** |
| failure | retry (backoff) then dead-letter; never blocks human verification review |

## 13. Sales, needs, matches

| Rule | Validation |
|---|---|
| need summary | required `[3,500]`; attributes typed |
| opportunity | has owner membership + valid stage |
| stage change | must be a legal transition ([11](11_state_machines.md)) |
| match | score ∈ `[0,1]`; explanation non-empty; AI output flagged as AI, human-reviewed before share |
| Smart Share | requires `sales.match.share`; human confirms before send |

## 14. RFQ

| Rule | Validation |
|---|---|
| items | ≥1; each quantity `> 0`; product ref **or** spec text present |
| recipients | ≥1 valid org; requester has `rfq.create` |
| send | RFQ in `draft` with complete items |
| anti-auction | recipients cannot see each other or each other's quotes |

## 15. Quotes

| Rule | Validation |
|---|---|
| responder | org is an RFQ recipient + has `quote.submit` |
| items | ≥1; `unit_price ≥ 0`, `quantity > 0`; `line_total` = unit×qty |
| total | derived = Σ line_total; currency EGP |
| valid_until | future date |
| one active quote | `uq` per (rfq, responder) |
| decision | requester `quote.decide`; single decision; on accept → project/opportunity transitions |

## 16. Projects

| Rule | Validation |
|---|---|
| create | title required; optional source quote/opportunity must belong to same org |
| status change | legal transition ([11](11_state_machines.md)) |
| activity | append-only; body or upload present |
| **no** milestone/escrow/payment fields (deferred) |

## 17. Notifications & preferences

| Rule | Validation |
|---|---|
| preference | per-channel booleans; operational types may be non-disable-able |
| severity | ∈ enum; UI pairs color with icon+text (never color-only) |

## 18. Subscriptions

| Rule | Validation |
|---|---|
| plan | valid active `plan_id` |
| state | legal transition ([11](11_state_machines.md)); admin-set (no billing) |
| entitlement checks | server-side against plan limits (seats, catalog size, ad slots, AI usage) — ⚑ values OPEN |

## 19. Advertisements

| Rule | Validation |
|---|---|
| subject | product or brand of the same org |
| schedule | `starts_at < ends_at`, future |
| creative | image rules; `ad-creatives/` |
| moderation | must be approved before `active`/public |

## 20. Cross-cutting

- **Tenancy:** every write asserts the target row's `organization_id`/`user_id` matches the caller's scope (defense-in-depth over RLS).
- **Idempotency:** retryable operations validate/dedupe an idempotency key.
- **Bilingual/RTL:** inputs accept AR + EN; numerals/EGP formatted per locale; no meaning by italics in Arabic.
- **No technical leakage:** validation/error copy never exposes stack/schema/implementation terms.
- **Pagination inputs:** `page ≥ 1`, `pageSize ≤ cap`.

## Open items
- ⚑ Exact OTP length/TTL/attempt caps; per-category product attribute schemas; required verification doc sets per account type; media caps; video codec/duration; OCR confidence threshold + Arabic accuracy; org-creation caps; subscription entitlement values; subscription degradation behavior.
