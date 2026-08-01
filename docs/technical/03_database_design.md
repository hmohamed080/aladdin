# 03 — Database Design

Complete database **specification** for the MVP. **No migrations are created here** (ADR-0002 — schema is owned only by `supabase/migrations/*.sql`, authored with each approved feature). This document is the target schema a senior engineer implements migration-by-migration.

Follows [naming-conventions.md](../database/naming-conventions.md). Entities are defined in [02](02_domain_model.md); relationships in [04](04_relationships.md).

## 0. Global conventions

- **PK:** `id uuid primary key default gen_random_uuid()` (pgcrypto, in `extensions`).
- **Tenancy:** `organization_id uuid` on tenant tables; `branch_id uuid` on branch-scoped tables. Personal tables use `user_id uuid`.
- **Audit columns:** `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (maintained by `set_updated_at` trigger), `created_by uuid` where attribution matters.
- **Soft delete:** `deleted_at timestamptz null` on entities marked *soft-delete: yes* in [02](02_domain_model.md). Queries filter `deleted_at is null`; RLS policies include it. Audit/verification/quote/audit_log tables are **never** hard/soft deleted (immutable history).
- **Enums:** Postgres `enum` types named `<domain>_<thing>` (values `snake_case`).
- **Money:** `numeric(14,2)`, currency fixed to **EGP** (no multi-currency in MVP); store an explicit `currency char(3) default 'EGP'` for forward-compat.
- **Bilingual text:** `*_en` / `*_ar` column pairs for reference/labels (categories, localities, plans); free-form user content is single-column.
- **Booleans:** positive phrasing (`is_active`, `is_primary`).

### Enum types (MVP)

| Enum | Values |
|---|---|
| `account_type` | `end_consumer, installer_technician, engineer, interior_designer, showroom_dealer, supplier, manufacturer, importer, wholesaler, sales, contractor, trainer, trainee, administrator` |
| `platform_role` | `support, moderator, administrator` (⚑ future `super_admin`) |
| `contact_channel` | `whatsapp, email` |
| `user_status` | `pending_verification, active, suspended, deactivated` |
| `org_status` | `draft, pending_verification, active, suspended, archived` |
| `membership_status` | `invited, active, suspended, revoked` |
| `verification_status` | `draft, submitted, under_review, approved, rejected, needs_more_info, expired` |
| `verification_subject` | `user, organization` |
| `product_status` | `draft, active, archived` |
| `availability_state` | `in_stock, low, made_to_order, unavailable` |
| `opportunity_stage` | `new, qualified, matching, quoted, won, lost` |
| `task_status` | `open, in_progress, done, cancelled` |
| `followup_status` | `drafted, scheduled, sent, dismissed` |
| `rfq_status` | `draft, sent, responses_in, closed, cancelled` |
| `quote_status` | `draft, submitted, under_review, accepted, rejected, expired` |
| `project_status` | `planned, active, on_hold, completed, cancelled` |
| `conversation_status` | `open, archived, closed` |
| `notification_status` | `created, delivered, read, archived` |
| `notification_severity` | `info, success, warning, danger` |
| `ad_status` | `draft, pending_review, active, paused, ended, rejected` |
| `subscription_status` | `trialing, active, past_due, canceled, expired` |
| `media_kind` | `image, reel, document, avatar, logo, ad_creative` |

## 1. Identity & accounts

### `users`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | = `auth.uid()` (mirrors `auth.users`) |
| primary_account_type | account_type | no | one current type |
| status | user_status | no | default `pending_verification` |
| is_verified | boolean | no | default false (identity verification) |
| locale | text | no | default `en` (`en`/`ar`) |
| created_at/updated_at | timestamptz | no | |
- **Indexes:** `ix_users_primary_account_type`, `ix_users_status`.
- **RLS:** a user reads/updates own row; admin/support read per [06](06_rls_strategy.md).

### `profiles`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| user_id | uuid | no | FK→users (1–1, `uq_profiles_user_id`) |
| display_name | text | no | |
| headline | text | yes | professional types |
| bio | text | yes | |
| avatar_media_id | uuid | yes | FK→media |
| locality_id | uuid | yes | FK→localities |
| languages | text[] | yes | |
| deleted_at | timestamptz | yes | soft delete |
- **Indexes:** `uq_profiles_user_id`, `ix_profiles_locality_id`, GIN trigram on `display_name`.

### `contacts`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| user_id | uuid | no | FK→users |
| channel | contact_channel | no | |
| value | text | no | phone E.164 / email |
| is_primary | boolean | no | default false |
| is_verified | boolean | no | default false |
| verified_at | timestamptz | yes | |
- **Constraints:** `uq_contacts_channel_value` (unique verified value per channel — partial index on `is_verified`), partial unique `uq_contacts_primary_per_user` where `is_primary`.

## 2. Organizations & access

### `organizations`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| name | text | no | |
| org_type | account_type | no | subset that can own an org |
| status | org_status | no | default `draft` |
| is_verified | boolean | no | default false |
| locality_id | uuid | yes | FK→localities |
| logo_media_id | uuid | yes | FK→media |
| created_by | uuid | no | FK→users |
| deleted_at | timestamptz | yes | |
- **Indexes:** `ix_organizations_status`, GIN trigram on `name`, `ix_organizations_locality_id`.

### `branches`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| organization_id | uuid | no | FK→organizations |
| name | text | no | |
| locality_id | uuid | yes | FK→localities |
| is_active | boolean | no | default true |
| deleted_at | timestamptz | yes | |
- **Indexes:** `ix_branches_organization_id`.

### `memberships`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| user_id | uuid | no | FK→users |
| organization_id | uuid | no | FK→organizations |
| branch_id | uuid | yes | FK→branches |
| status | membership_status | no | default `invited` |
| invited_by | uuid | yes | FK→users |
| accepted_at | timestamptz | yes | |
- **Constraints:** `uq_memberships_user_org` (user_id, organization_id). **Indexes:** `ix_memberships_org`, `ix_memberships_user`.

### `membership_capabilities`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| membership_id | uuid | no | FK→memberships |
| capability_key | text | no | from fixed catalog ([07](07_permissions_matrix.md)) |
- **Constraints:** `uq_membership_capability` (membership_id, capability_key).

### `platform_role_grants`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| user_id | uuid | no | FK→users |
| role | platform_role | no | |
| granted_by | uuid | yes | FK→users |
- **Constraints:** `uq_platform_role` (user_id, role). Cross-tenant access derives from this ([06](06_rls_strategy.md)).

## 3. Verification

### `verifications`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| subject_type | verification_subject | no | user/organization |
| user_id | uuid | yes | FK→users (when subject=user) |
| organization_id | uuid | yes | FK→organizations (when subject=org) |
| status | verification_status | no | default `draft` |
| reviewer_id | uuid | yes | FK→users (platform role) |
| decided_at | timestamptz | yes | |
| reason | text | yes | required on reject/needs_more_info |
| expires_at | timestamptz | yes | |
- **Constraints:** CHECK exactly one of user_id/organization_id set per subject_type. **No delete** (audit). **Indexes:** `ix_verifications_status`, `ix_verifications_org`, `ix_verifications_user`.

### `verification_documents`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| verification_id | uuid | no | FK→verifications |
| document_id | uuid | no | FK→documents |
| doc_type | text | no | e.g. commercial_register, national_id |

## 4. Catalog

### `brands`
| Column | Type | Null | Notes |
|---|---|---|---|
| id, name_en, name_ar | uuid/text | no | |
| slug | text | no | `uq_brands_slug` |
| is_active | boolean | no | default true |
| deleted_at | timestamptz | yes | |

### `categories`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| parent_id | uuid | yes | FK→categories (tree) |
| name_en, name_ar | text | no | |
| slug | text | no | `uq_categories_parent_slug` (parent_id, slug) |
| sort_order | int | no | default 0 |
- **Constraints:** application-guarded acyclic tree.

### `products`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| organization_id | uuid | no | FK→organizations |
| brand_id | uuid | yes | FK→brands |
| category_id | uuid | yes | FK→categories |
| name | text | no | |
| description | text | yes | |
| attributes | jsonb | yes | typed spec attributes |
| indicative_price_min/max | numeric(14,2) | yes | **ranges only**, no checkout |
| currency | char(3) | no | default `EGP` |
| status | product_status | no | default `draft` |
| search_tsv | tsvector | yes | generated (FTS) |
| deleted_at | timestamptz | yes | |
- **Indexes:** `ix_products_org`, `ix_products_category`, `ix_products_brand`, `ix_products_status`, **GIN** on `search_tsv` (FTS), GIN trigram on `name`, GIN on `attributes`.

### `product_media`
| Column | Type | Null | Notes |
|---|---|---|---|
| id, product_id (FK), media_id (FK) | uuid | no | |
| sort_order | int | no | default 0 |
| is_primary | boolean | no | default false |
- **Constraints:** partial unique `uq_product_primary_media` where `is_primary`.

## 5. Inventory & availability

### `inventory`
| id, product_id (FK), branch_id (FK, null) | uuid | | |
| quantity | numeric(14,2) | no | CHECK ≥ 0 |
| unit | text | yes | |
- **Constraints:** `uq_inventory_product_branch` (product_id, branch_id).

### `availability`
| id, product_id (FK), branch_id (FK, null) | uuid | | |
| state | availability_state | no | |
| lead_time_days | int | yes | CHECK ≥ 0 |
- Streams via Realtime.

## 6. Sales workflow

### `opportunities`
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | |
| organization_id | uuid | no | FK→organizations |
| branch_id | uuid | yes | FK→branches |
| owner_membership_id | uuid | no | FK→memberships (Sales user) |
| need_id | uuid | yes | FK→needs |
| title | text | no | |
| stage | opportunity_stage | no | default `new` |
| deleted_at | timestamptz | yes | |
- **Indexes:** `ix_opportunities_org_stage` (organization_id, stage), `ix_opportunities_owner`.

### `needs`
| id | uuid | no | |
| user_id | uuid | yes | FK→users (consumer-originated) |
| organization_id | uuid | yes | FK (opportunity-originated) |
| category_id | uuid | yes | FK→categories |
| locality_id | uuid | yes | FK→localities |
| attributes | jsonb | yes | quantity, budget-range, specs |
| summary | text | no | |
- **Indexes:** GIN on `attributes`.

### `matches`
| id | uuid | no | |
| need_id | uuid | yes | FK→needs |
| opportunity_id | uuid | yes | FK→opportunities |
| product_id | uuid | yes | FK→products |
| matched_org_id | uuid | yes | FK→organizations |
| score | numeric(5,4) | no | 0..1 |
| explanation | text | no | AI-generated, human-reviewed |
| is_shared | boolean | no | default false (Smart Share) |

### `tasks`
| id | uuid | no | |
| organization_id | uuid | no | FK |
| opportunity_id | uuid | yes | FK |
| project_id | uuid | yes | FK |
| assignee_membership_id | uuid | yes | FK→memberships |
| title | text | no | |
| status | task_status | no | default `open` |
| due_at | timestamptz | yes | |
- **Constraints:** CHECK exactly one of opportunity_id/project_id.

### `follow_ups`
| id, opportunity_id (FK) | uuid | no | |
| status | followup_status | no | default `drafted` |
| draft_body | text | no | AI-drafted |
| scheduled_at, sent_at | timestamptz | yes | |
| conversation_id | uuid | yes | FK→conversations |

## 7. RFQ & quotations

### `rfq_requests`
| id | uuid | no | |
| requester_user_id | uuid | yes | FK |
| requester_org_id | uuid | yes | FK |
| need_id / opportunity_id | uuid | yes | FK |
| status | rfq_status | no | default `draft` |
| closes_at | timestamptz | yes | |
- **Constraints:** CHECK exactly one requester set.

### `rfq_items`
| id, rfq_request_id (FK) | uuid | no | |
| product_id | uuid | yes | FK |
| spec | text | yes | required if no product_id |
| quantity | numeric(14,2) | no | CHECK > 0 |

### `quotes`
| id | uuid | no | |
| rfq_request_id | uuid | no | FK→rfq_requests |
| responder_org_id | uuid | no | FK→organizations |
| status | quote_status | no | default `draft` |
| total_amount | numeric(14,2) | yes | derived from items |
| currency | char(3) | no | default `EGP` |
| valid_until | timestamptz | yes | |
- **Constraints:** `uq_quotes_rfq_responder` (rfq_request_id, responder_org_id) — one active quote per responder per RFQ. **No delete** (audit).

### `quote_items`
| id, quote_id (FK) | uuid | no | |
| rfq_item_id | uuid | yes | FK |
| description | text | no | |
| unit_price | numeric(14,2) | no | CHECK ≥ 0 |
| quantity | numeric(14,2) | no | CHECK > 0 |
| line_total | numeric(14,2) | no | generated |

### `quote_decisions`
| id, quote_id (FK, uq 1–1) | uuid | no | |
| decided_by | uuid | no | FK→users (requester side) |
| decision | text | no | `accepted`/`rejected` |
| rationale | text | yes | |
| decided_at | timestamptz | no | |

## 8. Projects

### `projects`
| id | uuid | no | |
| organization_id, branch_id | uuid | no/yes | FK |
| source_quote_id / opportunity_id | uuid | yes | FK |
| title | text | no | |
| status | project_status | no | default `planned` |
| deleted_at | timestamptz | yes | |

### `project_activities`
| id, project_id (FK) | uuid | no | |
| actor_membership_id | uuid | yes | FK |
| activity_type | text | no | |
| body | text | yes | |
- Append-only; streams via Realtime.

## 9. Conversations & notifications

### `conversations`
| id | uuid | no | |
| subject_type | text | no | need/rfq/quote/project |
| subject_id | uuid | no | polymorphic |
| organization_id | uuid | yes | FK (context tenant) |
| status | conversation_status | no | default `open` |
- **Indexes:** `ix_conversations_subject` (subject_type, subject_id).

### `conversation_participants`
| id, conversation_id (FK), user_id (FK) | uuid | no | |
- **Constraints:** `uq_conversation_participant` (conversation_id, user_id).

### `messages`
| id, conversation_id (FK) | uuid | no | |
| author_user_id | uuid | no | FK |
| body | text | no | |
| sent_at | timestamptz | yes | null while draft |
- **Indexes:** `ix_messages_conversation_sent` (conversation_id, sent_at).

### `message_attachments`
| id, message_id (FK), media_id/document_id (FK) | uuid | | |

### `notifications`
| id | uuid | no | |
| recipient_user_id | uuid | no | FK |
| organization_id | uuid | yes | FK context |
| type | text | no | event type ([10](10_events.md)) |
| severity | notification_severity | no | |
| subject_type, subject_id | text/uuid | yes | reference |
| status | notification_status | no | default `created` |
| read_at | timestamptz | yes | |
- **Indexes:** `ix_notifications_recipient_status` (recipient_user_id, status).

### `notification_preferences`
| id, user_id (FK, uq) | uuid | no | |
| in_app, email, whatsapp | boolean | no | per-channel defaults |
| type_overrides | jsonb | yes | per-type channel prefs |

## 10. Advertisements & subscriptions

### `advertisements`
| id, organization_id (FK) | uuid | no | |
| product_id / brand_id | uuid | yes | FK |
| status | ad_status | no | default `draft` |
| starts_at, ends_at | timestamptz | yes | |
| deleted_at | timestamptz | yes | |

### `ad_placements`
| id, advertisement_id (FK) | uuid | no | |
| surface | text | no | e.g. discovery_top |
| slot | text | no | |
| schedule | jsonb | yes | |

### `plans` (packages)
| id | uuid | no | |
| code | text | no | `uq_plans_code` |
| name_en, name_ar | text | no | |
| entitlements | jsonb | no | limits/features (⚑ OPEN values) |
| is_active | boolean | no | |

### `subscriptions`
| id | uuid | no | |
| organization_id | uuid | yes | FK |
| user_id | uuid | yes | FK |
| plan_id | uuid | no | FK→plans |
| status | subscription_status | no | default `trialing` |
| current_period_end | timestamptz | yes | |
- **Constraints:** CHECK exactly one of organization_id/user_id. **No billing integration in MVP** — status set administratively. ⚑ OPEN.

## 11. Documents, media, localities

### `media`
| id | uuid | no | |
| kind | media_kind | no | |
| bucket | text | no | matches [05](05_storage_design.md) |
| path | text | no | storage object path |
| organization_id / user_id | uuid | yes | owner context |
| mime_type | text | no | |
| size_bytes | bigint | no | CHECK ≤ bucket max |
| width/height/duration | int | yes | |
| deleted_at | timestamptz | yes | |

### `documents`
| id | uuid | no | |
| bucket | text | no | private by default |
| path | text | no | |
| owner_type, owner_id | text/uuid | no | polymorphic |
| organization_id / user_id | uuid | yes | tenancy |
| mime_type, size_bytes | | no | |
| ocr_text | text | yes | OCR-derived (async) |
| ocr_status | text | yes | pending/done/failed |
| deleted_at | timestamptz | yes | |
- **Indexes:** GIN on `to_tsvector(ocr_text)` for document search.

### `localities`
| id | uuid | no | |
| parent_id | uuid | yes | FK (governorate→city→district) |
| name_en, name_ar | text | no | |
| level | text | no | governorate/city/district |
| geom | geometry | yes | PostGIS (optional) |
- Seed data; not user-writable.

## 12. Analytics & audit

### `analytics_snapshots` (derived)
| id | uuid | no | |
| scope_type | text | no | org/branch/global |
| scope_id | uuid | yes | |
| metric_key | text | no | |
| value | jsonb | no | |
| as_of | timestamptz | no | |
- Refreshed async; never a source of truth.

### `audit_log` (immutable)
| id | uuid | no | |
| actor_user_id | uuid | yes | FK |
| actor_role | text | yes | platform role if applicable |
| action | text | no | e.g. `verification.approved` |
| subject_type, subject_id | text/uuid | no | |
| organization_id | uuid | yes | tenant context |
| metadata | jsonb | yes | PII-minimized |
| created_at | timestamptz | no | |
- **Append-only**; no `updated_at`, no delete. **Indexes:** `ix_audit_subject` (subject_type, subject_id), `ix_audit_org_created` (organization_id, created_at).

## 13. Cross-cutting strategies

### Soft-delete strategy
- `deleted_at timestamptz null` on operational, user-editable entities (profiles, orgs, branches, products, media, documents, opportunities, tasks, projects, ads).
- **Never** soft/hard-deleted: `verifications`, `quotes`, `quote_decisions`, `audit_log`, `notifications` (archive instead) — they are trust/audit history.
- All read paths and RLS policies filter `deleted_at is null`. A background job may hard-purge soft-deleted rows past retention ([09](09_background_jobs.md)) — ⚑ retention windows OPEN.

### Audit strategy
- Column-level: `created_at`, `updated_at` (via `set_updated_at` trigger), `created_by`/`actor` where relevant.
- Entity-level: the immutable `audit_log` records security-relevant/state-changing actions (verification decisions, membership/capability/platform-role changes, moderation, quote decisions, admin overrides, subscription changes).
- Written by server-side code (Server Actions / workers) using `service_role` only for the audit insert path; readable by admins per [06](06_rls_strategy.md).

### Search strategy
- **Full-text (FTS):** `tsvector` columns (`products.search_tsv`, document `ocr_text`) with **GIN** indexes; bilingual configuration (`simple` + language configs) — ⚑ AR stemming config OPEN.
- **Fuzzy:** `pg_trgm` GIN indexes on names (products, organizations, profiles) for typo-tolerant Smart Search.
- **Semantic:** `pgvector` embedding columns on catalog/documents for AI matching/RAG; `hnsw`/`ivfflat` indexes. Retrieval **always** applies the org ownership filter before returning rows ([06](06_rls_strategy.md)).
- **Geo:** PostGIS on `localities.geom` for locality/coverage queries where geo is required.
- All search is **server-side paginated/filtered**; never fetch unbounded rows.
