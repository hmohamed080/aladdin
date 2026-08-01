# 10 — Domain Events

The domain-event catalog for the MVP. Events are the seam between contexts: a context emits an event; notifications, analytics, workers, and Realtime react. **Specification only.**

## 1. Model

- **Naming:** `PascalCase` past-tense (`QuoteAccepted`). Each event has a stable `type`, a tenant context (`organization_id`/`user_id`), a `subject` reference, an `actor`, `occurred_at`, and a small typed `payload`.
- **Emission:** events are raised **inside the transaction** that changes state (transactional outbox pattern — write the state change and an `events`/outbox row atomically), then dispatched to consumers by a worker. This guarantees no "sent notification for a change that rolled back". ⚑ Outbox vs. direct Realtime-only is an engineering choice at build; the outbox is recommended for anything with side effects.
- **Consumers:**
  - **Realtime** — push to subscribed clients (live status).
  - **Notifications** — create `notifications` + fan-out jobs ([09](09_background_jobs.md)).
  - **Analytics** — increment/refresh snapshots.
  - **Workers** — trigger embeddings/OCR/PDF/etc.
  - **Audit** — security-relevant events also write `audit_log`.
- **Tenant safety:** an event never crosses tenants; consumers respect the event's org scope (a Realtime channel is per-org/per-user).

## 2. Event catalog

| Event | Producer (context) | Payload (key fields) | Consumers |
|---|---|---|---|
| `UserRegistered` | auth | userId, primaryAccountType | notifications(welcome), analytics |
| `ContactVerified` | auth | userId, channel | notifications, audit |
| `AccountTypeChanged` | accounts | userId, from, to | audit (⚑ maybe re-verify) |
| `OrganizationCreated` | organizations | orgId, createdBy | notifications, analytics |
| `OrganizationSubmittedForVerification` | organizations | orgId | verification queue, notifications |
| `OrganizationApproved` | verification | orgId, reviewerId | notifications(org), unlock capabilities, analytics, audit |
| `OrganizationRejected` | verification | orgId, reason | notifications, audit |
| `OrganizationSuspended` | admin | orgId, reason | notifications, audit, Realtime |
| `MemberInvited` | organizations | membershipId, contact | email/whatsapp invite job |
| `MemberJoined` | organizations | membershipId | notifications, analytics |
| `MemberCapabilitiesChanged` | organizations | membershipId, caps | audit |
| `MemberRevoked` | organizations | membershipId | audit, notifications |
| `VerificationSubmitted` | verification | verificationId, subject | admin queue, notifications, `verification.ocr` job |
| `VerificationDecided` | verification | verificationId, decision | notifications, audit, Realtime(status), unlock/lock gates |
| `ProductCreated` | catalog | productId, orgId | analytics |
| `ProductPublished` | catalog | productId | `embedding.generate`, discovery index, notifications(followers?⚑), analytics |
| `ProductArchived` | catalog | productId | discovery de-index |
| `InventoryChanged` / `AvailabilityChanged` | inventory | productId, state | Realtime(availability) |
| `NeedCaptured` | sales | needId, subject | matching (AI), analytics |
| `OpportunityCreated` | sales | opportunityId, ownerId | Realtime(pipeline), analytics |
| `OpportunityStageChanged` | sales | opportunityId, from, to | Realtime(pipeline), analytics, audit(won/lost) |
| `MatchShared` (Smart Share) | sales | matchId, conversationId | notifications, conversation, analytics |
| `TaskCreated` / `TaskUpdated` | sales/projects | taskId, status | Realtime(task), notifications(assignee) |
| `FollowUpSent` | sales | followUpId | conversation/message, notifications, audit |
| `RfqCreated` | rfq | rfqId | analytics |
| `RfqSent` | rfq | rfqId, recipients | notifications(recipients), Realtime |
| `QuoteRequested` | rfq | rfqId, recipientOrgId | notifications(responder) |
| `QuoteSubmitted` | quotations | quoteId, rfqId | notifications(requester), Realtime(quote status), analytics |
| `QuoteAccepted` | quotations | quoteId | notifications(responder), `pdf.generate`, may `ProjectCreated`, analytics, audit |
| `QuoteRejected` | quotations | quoteId, reason | notifications, audit |
| `ProjectCreated` | projects | projectId, sourceQuoteId | notifications, analytics |
| `ProjectStatusChanged` | projects | projectId, status | Realtime(project), notifications |
| `ProjectActivityAdded` | projects | projectId, activityId | Realtime(project) |
| `ConversationStarted` | conversations | conversationId, subject | notifications(participants) |
| `MessageSent` | conversations | messageId, conversationId | Realtime(messages), notifications, `notification.deliver` |
| `DocumentUploaded` | documents | documentId, ownerType | `*.ocr`/`embedding` jobs |
| `MediaUploaded` | media | mediaId, ownerType | transform/validate |
| `NotificationCreated` | notifications | notificationId | `notification.deliver` job, Realtime |
| `AdSubmitted` | advertisements | adId | moderation queue |
| `AdApproved` / `AdRejected` | advertisements | adId | notifications, publish/hide, audit |
| `SubscriptionStateChanged` | subscriptions | subscriptionId, status | capability gates, notifications, audit |
| `ExportRequested` / `ExportReady` | analytics | exportId | `export.generate` job / notifications |
| `AdminActionPerformed` | admin | action, subject | audit (always) |

## 3. Event → notification → channel

`NotificationCreated` fans out per the recipient's `notification_preferences` ([02](02_domain_model.md)) to in-app (Realtime) + optional email/WhatsApp ([09](09_background_jobs.md)). **Operational/transactional** events (verification decided, quote submitted, invite) may be non-disable-able; **marketing** ones are opt-in. Never color-only in the UI; every notification carries type + severity + text.

## 4. Realtime channels ↔ events

| Channel | Fed by |
|---|---|
| `notifications:{userId}` | NotificationCreated / MessageSent |
| `pipeline:{orgId}` | OpportunityCreated/StageChanged, TaskCreated/Updated |
| `verification:{subjectId}` | VerificationSubmitted/Decided |
| `project:{projectId}` | ProjectStatusChanged, ProjectActivityAdded |
| `availability:{orgId}` | Inventory/AvailabilityChanged |
| `quote:{rfqId}` | QuoteSubmitted/Accepted/Rejected |
| `messages:{conversationId}` | MessageSent |

## 5. Guarantees

- **At-least-once** delivery to consumers; consumers are idempotent ([09](09_background_jobs.md)).
- **Ordering** is best-effort; consumers re-check current state before acting.
- **Auditability:** every security/state-relevant event has a corresponding `audit_log` row.
- **Tenant isolation:** channels and consumers are org/user-scoped; no event crosses tenants.

## 6. Open items

- ⚑ Transactional outbox vs. Realtime-only for side-effecting events (recommend outbox).
- ⚑ Whether product "followers" get `ProductPublished` notifications in MVP.
- ⚑ Event schema versioning approach (add `version` to payloads from day one).
