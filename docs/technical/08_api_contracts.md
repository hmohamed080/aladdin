# 08 — API Contracts

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | 02_domain_model.md, 07_permissions_matrix.md, 12_validation_rules.md, ../decisions/ADR-0001-approved-architecture.md |
| **Related** | 09_background_jobs.md, 10_events.md |

Every API surface that will exist in the MVP. **Specification only — no implementation.**

## 0. Surface model (important)

Per ADR-0001, the web app is **Server-Component + Server-Action first**, not a REST API:

- **Reads** → React Server Components call typed **query functions** (`features/*/queries`) using `supabase-js` with the user JWT (RLS enforced). Not public HTTP endpoints.
- **Mutations** → **Server Actions** (`features/*/actions`) validated by **Zod**. These are the "write API". Documented below as action contracts.
- **Route Handlers** (`src/app/**/route.ts`) → only for webhooks, health, and BFF proxying to the FastAPI service. The only true HTTP endpoints.
- **FastAPI service** → internal HTTP endpoints for AI/OCR/documents, reachable only server-to-server with a verified JWT.

Contract fields below: **Auth** (who), **Input** (validated shape), **Output**, **Validation** (→ [12](12_validation_rules.md)), **Errors**. All inputs are Zod-validated; all mutations check capability ([07](07_permissions_matrix.md)); all identity derives from the session JWT (never the body).

**Common error codes:** `UNAUTHENTICATED (401)`, `FORBIDDEN (403, capability/RLS)`, `NOT_FOUND (404)`, `VALIDATION_ERROR (422, field errors)`, `CONFLICT (409, unique/state)`, `RATE_LIMITED (429)`, `INTERNAL (500)`. Errors never leak stack traces/schema to the client.

---

## 1. HTTP Route Handlers (Next.js)

| Method | URL | Auth | Input | Output | Errors |
|---|---|---|---|---|---|
| GET | `/api/health` | none | — | `{status, service, env}` 200 | 500 |
| POST | `/api/webhooks/whatsapp` | **signature** (Meta) | WhatsApp delivery/inbound payload | 200 ack | 401 bad sig |
| GET | `/api/webhooks/whatsapp` | verify token | hub challenge | echo | 403 |
| POST | `/api/webhooks/email` | provider signature | delivery/bounce event | 200 ack | 401 |
| POST | `/api/ai/*` (BFF proxy) | session JWT | forwarded to FastAPI | streamed/JSON | 401/403/502 |

Webhooks are **idempotent** (dedupe by provider message id), verify signatures, and enqueue work rather than processing inline ([09](09_background_jobs.md)).

---

## 2. Auth (`auth`) — Server Actions

| Action | Auth | Input | Output | Validation / Errors |
|---|---|---|---|---|
| `requestOtp` | guest | `{channel: whatsapp|email, value, recaptchaToken?}` | `{challengeId, expiresAt}` | valid E.164/email; reCAPTCHA required on **create**; rate-limited → 429 |
| `verifyOtp` | guest | `{challengeId, code}` | `{session}` + user | code match, TTL, attempt cap → 422/429; `CONFLICT` if consumed |
| `registerAccount` | post-OTP | `{primaryAccountType, displayName, locale}` | `{user, profile}` | account type ∈ enum; one primary contact verified |
| `addSecondaryContact` | user | `{channel, value}` | `{contact}` → triggers OTP | not duplicate; verify before primary-eligible |
| `signOut` | user | — | ok | — |

> **No password/forgot/reset actions exist** (passwordless).

---

## 3. Accounts (`accounts`)
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| Q `getMyProfile` | user | — | profile |
| `updateProfile` | user | `{displayName?, headline?, bio?, localityId?, languages?}` | profile |
| `setAvatar` | user | `{mediaUploadRef}` | profile |
| Q `getPublicProfile` | guest | `{userId|slug}` | public profile subset |
| `setPrimaryAccountType` | user | `{accountType}` | user (⚑ change policy OPEN — may require re-verification) |

---

## 4. Organizations (`organizations`)
| Action / Query | Auth | Input | Output | Notes |
|---|---|---|---|---|
| `createOrganization` | user | `{name, orgType, localityId}` | org (`draft`) | creator gets owner membership |
| `updateOrganization` | `org.manage` | `{...fields}` | org | |
| `createBranch` | `branch.manage` | `{name, localityId}` | branch | |
| `inviteMember` | `org.members.manage` | `{contact, branchId?, capabilities[]}` | membership (`invited`) | fixed capability keys |
| `acceptInvite` | invited user | `{membershipId, token}` | membership (`active`) | |
| `updateMemberCapabilities` | `org.members.manage` | `{membershipId, capabilities[]}` | membership | can't escalate beyond own grant |
| `revokeMember` | `org.members.manage` | `{membershipId}` | membership (`revoked`) | attribution preserved |
| Q `listMembers` / `getOrg` | member | filters | paginated | RLS-scoped |

---

## 5. Verification (`verification`)
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `startVerification` | `verification.submit` | `{subjectType, orgId?}` | verification (`draft`) |
| `uploadVerificationDoc` | `verification.submit` | `{verificationId, docType, uploadRef}` | doc |
| `submitVerification` | `verification.submit` | `{verificationId}` | verification (`submitted`) |
| Q `getVerification` | subject/reviewer | `{id}` | verification + docs |
| `reviewVerification` | platform `verification.decide` | `{id, decision, reason?}` | verification (`approved`/`rejected`/`needs_more_info`) — **audited**, no self-approval |

---

## 6. Catalog (`catalog`) & inventory
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `createProduct` | `catalog.write` | `{name, categoryId?, brandId?, attributes, description, priceMin?, priceMax?}` | product (`draft`) |
| `updateProduct` | `catalog.write` | `{id, ...}` | product |
| `addProductMedia` | `catalog.write` | `{productId, uploadRef, isPrimary?}` | media |
| `publishProduct` | `catalog.publish` | `{id}` | product (`active`) — requires required fields + ≥1 media + org verified |
| `archiveProduct` / `deleteProduct` | `catalog.write` | `{id}` | soft-deleted |
| `setInventory` | `inventory.write` | `{productId, branchId?, quantity, unit}` | inventory |
| `setAvailability` | `inventory.write` | `{productId, branchId?, state, leadTimeDays?}` | availability (Realtime) |
| Q `searchProducts` | guest/user | `{q, categoryId?, localityId?, brandId?, availability?, page, pageSize}` | paginated public/pub+tenant | FTS + trgm + filters |
| Q `getProduct` | guest/user | `{id}` | product (public if active) |

---

## 7. Sales (`sales`)
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `createOpportunity` | `sales.opportunity.write` | `{title, needId?, branchId?}` | opportunity (`new`) |
| `updateOpportunityStage` | same | `{id, stage}` | opportunity (valid transition [11](11_state_machines.md)) |
| `captureNeed` | sales/consumer | `{summary, categoryId?, localityId?, attributes}` | need |
| Q `getMatches` | `sales.opportunity.read` | `{needId|opportunityId}` | ranked matches + explanations (AI) |
| `shareMatch` (Smart Share) | `sales.match.share` | `{matchId, conversationId?}` | share record (human-reviewed) |
| `createTask` | `sales.task.write` | `{opportunityId|projectId, title, dueAt?, assigneeMembershipId?}` | task |
| `updateTask` | same | `{id, status}` | task |
| `draftFollowUp` | sales | `{opportunityId}` | follow-up (`drafted`, AI) |
| `sendFollowUp` | `sales.followup.send` | `{id}` | follow-up (`sent`) — **never auto-sent** |
| Q `getPipeline` | `sales.opportunity.read` | `{branchId?, stage?, page}` | pipeline board (Realtime) |

---

## 8. RFQ & quotations (`rfq`, `quotations`)
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `createRfq` | `rfq.create` | `{needId?, opportunityId?, items[], recipients[]}` | rfq (`draft`) |
| `sendRfq` | `rfq.create` | `{id}` | rfq (`sent`) |
| Q `getRfq` | requester/recipient | `{id}` | rfq (scoped view) |
| `submitQuote` | `quote.submit` | `{rfqId, items[], validUntil}` | quote (`submitted`) |
| Q `listQuotesForRfq` | requester | `{rfqId}` | submitted quotes (never other responders' drafts) |
| Q `compareQuotes` | requester | `{rfqId}` | normalized comparison view |
| `decideQuote` | `quote.decide` | `{quoteId, decision, rationale?}` | decision (`accepted`/`rejected`) → may start project |
| `closeRfq` / `cancelRfq` | requester | `{id}` | rfq status |

---

## 9. Projects (`projects`)
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `createProject` | `project.write` | `{title, sourceQuoteId?, opportunityId?}` | project (`planned`) |
| `updateProjectStatus` | `project.write` | `{id, status}` | project (valid transition) |
| `addProjectActivity` | participant | `{projectId, activityType, body?, uploadRef?}` | activity (Realtime) |
| Q `getProject` / `listProjects` | `project.read`/participant | filters | scoped |

---

## 10. Conversations (`conversations`) & notifications

> **Reconciled 2026-08-23 with what shipped.** This section previously sketched
> `startConversation({… participantUserIds[]})`, `sendMessage({… attachments[]})`
> and Realtime delivery. All three were **deliberately dropped**; the authority is
> [`docs/database/chat-core.md`](../database/chat-core.md) and
> [`docs/database/notifications-core.md`](../database/notifications-core.md), and
> the schema source of truth is `supabase/migrations` (ADR-0002). See the
> [departures](#101-what-changed-from-the-original-sketch-and-why) below.

### Transactional Chat

**A conversation is not a room — it is a property of a transaction.** It exists
only when anchored to a commercial record that already names exactly two
organizations, and it is reachable only from that record.

| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `openConversationAction` → `open_conversation` | `conversation.participate` in a **party** org | `{subjectType: 'rfq'\|'quotation'\|'order', subjectId}` | `conversationId` (idempotent get-or-create) |
| `sendMessageAction` → `send_message` | same | `{conversationId, body}` — plain text, 1–4000 chars | `messageId` |
| `markConversationReadAction` → `mark_conversation_read` | same | `{conversationId}` | ok (monotonic, idempotent) |
| Q `listConversations` | RLS | `{limit?}` — bounded, recent-first | conversations + caller's own read position |
| Q `getConversation` | RLS | `{id}` | conversation, or `null` |
| Q `listMessages` | RLS | `{conversationId, limit?}` | bounded newest page, rendered chronologically |
| Q `countUnreadConversations` | RLS | — | integer |

**Contract rules that differ from the rest of this document, and are load-bearing:**

- **No organization id is ever an input**, in any action or query. Both parties
  are derived inside the RPC from the authoritative subject row. There is no
  parameter for one and no prop for one.
- **`participantUserIds[]` does not exist.** Access is *derived*, never stored:
  active membership **+** `conversation.participate` **+** membership in one of
  the transaction's two organizations. A colleague holding the capability reads
  the whole thread — transactional correspondence is company records, not
  personal mail. There is no way to start a conversation with a *person*.
- **Sender identity is derived, not supplied.** `sender_user_id` comes from
  `auth.uid()`; `sender_organization_id` is resolved by capability lookup against
  the conversation's own two party columns. That resolution *is* the
  anti-spoofing mechanism.
- **Reads take no RPC.** Listing, reading a thread and counting unread are plain
  RLS-scoped `SELECT`s.
- **Messages are immutable plain text.** No edit, delete, reply, reaction,
  forward, attachment, media, voice, or markup — and no translation: a body
  renders exactly as authored.
- **Unread is per *conversation*, not per message** — `conversations.last_message_at`
  against the caller's own `conversation_read_state.last_read_at`. There are no
  read receipts.
- **Errors** map from Postgres, not from a Zod layer: `42501` → `FORBIDDEN`,
  `22023` → `VALIDATION_ERROR` (invalid subject type, draft subject, empty,
  whitespace-only or over-4000-character body). A `42501` renders as **one
  neutral message** that never discloses whether the conversation exists.

**Surfaces.** There is deliberately **no `/chat` or `/messages` route**. The
thread renders inside the existing header Chat panel, and each of the RFQ,
quotation and order detail pages carries one entry point that calls
`open_conversation`. `project` is **not** a subject type — a project uses its
parent order's conversation.

### Notifications

Recipient-scoped in-app inbox. Rows store **i18n keys and params, never rendered
text**, so a reader's locale can change after the row is written.

| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `markNotificationRead` → `mark_notification_read` | recipient only | `{id}` | ok (idempotent) |
| `markAllNotificationsRead` → `mark_all_notifications_read` | recipient only | `{orgId?}` | ok |
| Q `listNotifications` | RLS (`recipient_user_id = auth.uid()`) | `{orgId?, limit?}` | bounded, recent-first |
| Q `countUnread` | RLS | `{orgId?}` | integer |

- **`organization_id` is context, never authority.** It scopes the list to the
  active work context and must never appear in a `USING` clause: an inbox is
  personal even when its subject is corporate.
- **Writes are internal only.** `app.notify` / `app.notify_org` are
  `security definer` and executable by no client role; `app.notify` suppresses
  self-notification centrally.
- **`updateNotificationPreferences` does not exist.** No per-event mute, digest,
  channel selection or quiet hours model is specified or implemented.

**`message.sent`** is emitted by `send_message`, in the same transaction as the
message insert, to the **opposite** party organization via `app.notify_org` with
capability `conversation.participate`. It deep-links to the underlying record
(`/b2b/rfqs/{id}`, `/b2b/quotations/{id}`, `/b2b/orders/{id}`), carries business
context only (`counterparty_name`) and **never the message body**, and is the one
event with the `org.manage` owner fallback **disabled** — nobody is told about a
thread they could not open. No dedupe, grouping or digest in the Pilot.

### 10.1 What changed from the original sketch, and why

| Sketched | Shipped | Why |
|---|---|---|
| `participantUserIds[]` | derived from membership + capability + the transaction's two orgs | a participant list is a second, divergenceable copy of an authorization decision the schema already makes |
| `attachments[]` | plain text only | no storage, scanning, retention or quota model exists; adding a column would imply one |
| Realtime message/notification delivery | persisted reads + `router.refresh()` | deferred deliberately; no table joined the `supabase_realtime` publication |
| `startConversation` | `open_conversation` | it is honestly get-**or**-create, and calling it twice is not an error |
| `{id\|all}` on mark-read | two distinct RPCs | a union-typed input hides two different authorization shapes |
| `updateNotificationPreferences` | — | no preferences model is approved |

---

## 11. Advertisements & subscriptions
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `createAd` | `ad.manage` | `{productId?/brandId?, placements[], startsAt, endsAt}` | ad (`draft`) |
| `submitAd` | `ad.manage` | `{id}` | ad (`pending_review`) |
| `reviewAd` | platform `moderate` | `{id, decision}` | ad (`active`/`rejected`) — audited |
| Q `getSubscription` | `subscription.read` | — | subscription + plan entitlements |
| `setSubscriptionState` | admin | `{orgId, planId, status}` | subscription (**no billing MVP**; admin-set) |

---

## 12. Admin & analytics
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| Q `adminListVerifications` | platform | filters | queue |
| Q `adminModerationQueue` | moderator | filters | products/ads/reports |
| `suspendOrganization` | administrator | `{orgId, reason}` | org (`suspended`) — audited |
| Q `getAnalytics` | `analytics.view` | `{scope, range, metric}` | snapshots |
| `requestExport` | `export.data` | `{type, scope, filters}` | export job id → file in `exports/` ([09](09_background_jobs.md)) |
| Q `getAuditLog` | `platform.audit.read` | filters | paginated |

---

## 13. FastAPI service endpoints (internal, server-to-server)

Base: **`/api/backend`** — same origin as the web app, routed by the root `vercel.json` to the `backend` Vercel Service ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)), so no absolute base URL is configured per environment. Every request carries the caller's **Supabase JWT**; the service verifies it and derives identity. Reached only via the web BFF, never the browser — same origin does not change that boundary.

| Method | URL | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/health` | none | — | `{status:"ok"}` |
| POST | `/v1/ai/consult` | JWT | `{message, context, orgId?}` | streamed advice (RAG, tenant-filtered) |
| POST | `/v1/ai/extract-intent` | JWT | `{text}` | structured need attributes |
| POST | `/v1/ai/explain-match` | JWT | `{needId, productId}` | explanation string |
| POST | `/v1/ai/draft-followup` | JWT | `{opportunityId}` | draft body (human-reviewed) |
| POST | `/v1/documents/ocr` | JWT/enqueue | `{documentId}` | job accepted → OCR text written back |
| POST | `/v1/documents/embed` | JWT/enqueue | `{entity, id}` | job accepted → embeddings written |
| POST | `/v1/retrieval/search` | JWT | `{query, scope}` | ranked rows (**org filter applied before return**) |
| POST | `/v1/imports/excel` | JWT/enqueue | `{documentId, mapping}` | job accepted → parsed rows |

All AI endpoints: retrieval applies authorization filters **before** returning content; outputs are drafts/rankings — **never auto-actions**. Heavy paths enqueue and return a job id ([09](09_background_jobs.md)).

## 14. Cross-cutting contract rules

- **Pagination:** cursor or `page/pageSize` (max page size capped); never unbounded.
- **Idempotency:** mutation actions that can be retried (webhooks, sends) accept/dedupe an idempotency key.
- **Bilingual:** validation error messages are localizable keys (AR/EN), not hard-coded strings.
- **Rate limits:** OTP, search, AI, and export endpoints are rate-limited ([13](13_integrations.md)).
