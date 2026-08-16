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
| Action / Query | Auth | Input | Output |
|---|---|---|---|
| `startConversation` | context participant | `{subjectType, subjectId, participantUserIds[]}` | conversation |
| `sendMessage` | `conversation.participate` | `{conversationId, body, attachments[]?}` | message (Realtime) |
| Q `listMessages` | participant | `{conversationId, page}` | paginated (Realtime) |
| Q `listNotifications` | user | `{status?, page}` | paginated (Realtime) |
| `markNotificationRead` | user | `{id|all}` | ok |
| `updateNotificationPreferences` | user | `{inApp, email, whatsapp, typeOverrides}` | prefs |

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
