# 07 — Permissions Matrix

The complete permission model for the MVP. Access is **capability-based and derived** (PRODUCT_DIRECTION_GUIDE): what a user can do = f(primary account type, org membership, branch, granted capabilities, verification state, subscription state, platform role). There is **no role toggle / profile switcher**.

## 1. Audiences (reconciled)

The task's generic role names map to Aladdin's canonical model:

| Generic (task) | Aladdin audience | Kind |
|---|---|---|
| Guest | **Guest** (unauthenticated) | anon |
| End User | **End Consumer** | account type (B2C) |
| Engineer | **Engineer** (+ Interior Designer, Installer/Technician) | professional account types |
| Exhibition | **Showroom/Dealer** | business account type |
| Company | **Supplier / Manufacturer / Importer / Wholesaler / Contractor** | business account types |
| — | **Sales** | account type (key daily user) |
| — | **Org Owner/Admin** | membership capability tier (org-level) |
| Support | **Support** | platform role |
| Moderator | **Moderator** | platform role |
| Admin | **Administrator** | platform role |
| Future Super Admin | **Super Admin** | ⚑ future platform role |

Two independent dimensions:
- **Account type** (one per user) + **org membership capabilities** → what you do inside the product.
- **Platform role** (support/moderator/administrator) → governance across tenants.

## 2. Capability catalog (fixed keys)

Capabilities are granted on a `membership` (`membership_capabilities.capability_key`). Fixed set (extend only via governance + [10](10_events.md)/[14](14_future_extensions.md)):

| Domain | Capability keys |
|---|---|
| org | `org.manage`, `org.members.manage`, `branch.manage` |
| verification | `verification.submit`, `verification.read` |
| catalog | `catalog.read`, `catalog.write`, `catalog.publish` |
| inventory | `inventory.write` |
| sales | `sales.opportunity.read`, `sales.opportunity.write`, `sales.match.share`, `sales.task.write`, `sales.followup.send` |
| rfq | `rfq.create`, `rfq.respond` |
| quotes | `quote.submit`, `quote.decide` |
| projects | `project.read`, `project.write` |
| conversations | `conversation.participate` |
| ads | `ad.manage` |
| subscription | `subscription.read`, `subscription.manage` |
| analytics | `analytics.view` |
| exports | `export.data` |

Platform capabilities (from `platform_role_grants`, not memberships): `platform.verification.decide`, `platform.moderate`, `platform.reference.manage`, `platform.audit.read`, `platform.org.govern`, `platform.support.read`.

## 3. Action legend

`R`=read `W`=create `U`=update `D`=delete(soft) `Ap`=approve/decide `V`=verify `X`=export `An`=analytics `N`=notifications(receive/act). `—`=none. `own`=own rows only. `pub`=public/published subset. `cap`=only with the listed capability. `tenant`=within own org(s). `xt`=cross-tenant.

## 4. Matrix — by domain

### Identity & profile
| Audience | R | W | U | D | Notes |
|---|---|---|---|---|---|
| Guest | pub profiles | — | — | — | public professional/company profiles only |
| End Consumer | own + pub | own signup | own | own (deactivate) | |
| Professional/Business/Sales | own + pub | own | own | own | portfolio for professionals |
| Support | xt (read) | — | — | — | audited, scoped to support context |
| Administrator | xt | — | xt (status) | suspend | audited |

### Organizations, branches, memberships
| Audience | R | W | U | D | Ap |
|---|---|---|---|---|---|
| Org Owner (`org.manage`) | tenant | create org | tenant | archive | — |
| Member (`org.members.manage`) | tenant | invite | member/caps | revoke | — |
| Member (no cap) | tenant (self) | — | — | — | — |
| Sales / other members | tenant | — | — | — | — |
| Administrator | xt | — | xt status | suspend/archive | org govern |

### Verification
| Audience | R | W(submit) | Ap(decide) | V | Notes |
|---|---|---|---|---|---|
| Subject (user/org, `verification.submit`) | own | own | — | — | no self-approval |
| Support | xt | — | decide (cap) | ✔ | audited |
| Moderator | xt | — | decide (cap) | ✔ | audited |
| Administrator | xt | — | decide | ✔ | audited |

### Catalog (products, brands, categories, media)
| Audience | R | W | U | D(soft) | Ap(publish) |
|---|---|---|---|---|---|
| Guest / End Consumer | pub | — | — | — | — |
| Business member (`catalog.write`) | tenant+pub | tenant | tenant | tenant | `catalog.publish` |
| Sales | tenant+pub | — | — | — | — |
| Moderator | xt | — | hide | — | moderate |
| Administrator | xt | reference (brands/categories) | xt | xt | — |

### Inventory & availability
| Audience | R | W/U |
|---|---|---|
| Business member (`inventory.write`) | tenant | tenant |
| Others | pub state | — |

### Sales workflow (opportunities, needs, matches, tasks, follow-ups)
| Audience | R | W | U | Share(match) | Send(followup) |
|---|---|---|---|---|---|
| Sales (`sales.*`) | tenant/branch | ✔ | ✔ | `sales.match.share` | `sales.followup.send` (human-reviewed) |
| Org Owner | tenant | ✔ | ✔ | ✔ | ✔ |
| End Consumer | own need/consult | own | own | — | — |
| Administrator | xt (govern) | — | — | — | — |

### RFQ & quotations
| Audience | Create RFQ | Respond (quote) | Decide | Read scope |
|---|---|---|---|---|
| End Consumer / requester (`rfq.create`) | ✔ | — | `quote.decide` (own RFQ) | own RFQ + submitted quotes to it |
| Business responder (`rfq.respond`,`quote.submit`) | — | ✔ | — | RFQs addressed to org + own quotes only |
| Sales | ✔ (on behalf) | — | facilitate | tenant |
| Administrator | — | — | — | xt read (audited) |
> **Guarantee:** no responder ever reads another responder's quote/pricing (anti price-war).

### Projects
| Audience | R | W | U |
|---|---|---|---|
| Org member (`project.read`/`project.write`) | tenant/branch | ✔ | ✔ |
| Requester/consumer (participant) | own project | — | limited (activity) |
| Administrator | xt (govern) | — | — |

### Conversations & messages
| Audience | R | Send | Attach |
|---|---|---|---|
| Participant (`conversation.participate`) | own threads | ✔ (human) | ✔ |
| Non-participant | — | — | — |
| Moderator/Admin | xt (on report) | — | — | audited |

### Notifications
| Audience | Receive (N) | Manage prefs | Read center |
|---|---|---|---|
| All authenticated | ✔ | own | own |
| Guest | — | — | — |

### Advertisements
| Audience | R | W/U | Ap | 
|---|---|---|---|
| Business (`ad.manage`) | tenant+pub(active) | tenant | — |
| Moderator/Admin | xt | — | approve/reject |
| Guest/Consumer | pub(active) | — | — |

### Subscriptions
| Audience | R | Manage |
|---|---|---|
| Org Owner (`subscription.read`/`manage`) | own org | ✔ (state; **no billing in MVP**) |
| Administrator | xt | set state (admin) |

### Analytics
| Audience | View (An) | Scope |
|---|---|---|
| Org member (`analytics.view`) | ✔ | own org/branch |
| Sales | ✔ | own pipeline |
| Administrator | ✔ | platform-wide |
| Others | — | — |

### Exports
| Audience | Export (X) | Scope |
|---|---|---|
| Member (`export.data`) | ✔ | own org data (to private `exports/`) |
| Administrator | ✔ | platform (audited) |
| Others | — | — |

### Audit log
| Audience | Read |
|---|---|
| Administrator (`platform.audit.read`) | xt |
| Org Owner | ⚑ own-org subset (decide) |
| Others | — |

## 5. Platform-role summary

| Capability | Support | Moderator | Administrator | Super Admin (⚑ future) |
|---|---|---|---|---|
| Cross-tenant read | scoped/audited | moderation surfaces | full | full |
| Verification decide | ✔ | ✔ | ✔ | ✔ |
| Moderate content/ads | — | ✔ | ✔ | ✔ |
| Manage reference data | — | — | ✔ | ✔ |
| Govern orgs (suspend/archive) | — | — | ✔ | ✔ |
| Manage platform roles | — | — | ⚑ limited | ✔ |
| Read audit log | scoped | scoped | ✔ | ✔ |
| Platform config/secrets | — | — | — | ✔ |

All platform-role actions that touch a tenant are **written to `audit_log`** with actor + subject + timestamp.

## 6. Derivation rules (enforced in UI + RLS)

- Navigation/menu items are **hidden** when the capability is absent (not shown-disabled); RLS still enforces server-side ([06](06_rls_strategy.md)).
- **Verification-gated:** publishing a catalog / responding to RFQ / running ads may require the org to be `verified` (⚑ confirm exact gates with product).
- **Subscription-gated:** capability *availability* and limits (seats, catalog size, ad slots, AI usage) are bounded by the org's `Plan` entitlements (⚑ tier values OPEN).
