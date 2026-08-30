# Points Core — Database Specification

**Status:** **Proposed — awaiting review** · 2026-08-30 · branch `feature/points-core` · **no migration exists and none may be written until this document is approved**

**Product decisions closed 2026-08-30:** the Pilot's approved earning-event set is **`referral.organization_approved` alone** (D6 — no Tier B commerce events); a derived balance **may display negative** after a correction and is never clamped or floored (D2); **numeric point values remain unresolved for every event, including the approved one** (D1, still open). See [Open product decisions](#open-product-decisions).

## Purpose

Authorize and constrain the first persisted Points model, so that
`supabase/AGENTS.md` (*"do not invent production tables without an approved
database specification"*) is satisfied before any migration is written.

This document specifies **Points Core only**: an append-only, user-level ledger
of engagement credit, plus the authority and idempotency rules that make it
safe to write to. It is a **specification increment**. It creates no table, no
RPC, no policy, no route body and no seed data. Its success criterion is that
the following database increment can be implemented **without inventing a
single product rule** — a bar that now holds for everything except one approved
event's point value ([**D1**](#open-product-decisions)), which the wiring
increment must obtain from product rather than choose.

### What Points are

Points are an **engagement / reputation incentive mechanism**. They record that
a person did something the platform wants to encourage, in a form that can later
be read back, audited, and — if the product decides so — consumed by some other
system.

### What Points are not

For the Pilot, Points are **not** money, a wallet balance, a commission, a
cashback, a supplier-funded reward, a redeemable currency, a withdrawable
balance, a Sales Wallet, a Universal Wallet, or the Sales Score itself. These
are separate concepts and **must not be merged into this one**. The ledger
carries an integer named `points_delta`; it carries no currency, no rate, and no
convertibility. See [Relationship to other systems](#relationship-to-other-systems)
and [Out of scope](#out-of-scope).

Points **may later** feed reputation, challenges, rankings, rewards or a Sales
Score. None of those integrations is part of this Core, and none may be built
from this document alone.

## Existing product authority

Everything below is quoted from material already merged to `main`. This section
is the evidence base; where it is silent, [Open product decisions](#open-product-decisions)
records the gap rather than filling it.

| Source | What it settles |
|---|---|
| [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) §referral | Referral attribution (`organizations.source` + `organizations.referred_by_user_id`) is retained write-once *"so a future rewards feature can **credit the salesperson**"*; **"no points, wallet, leaderboard or reward calculation exists."** This is the **only** approved statement of intent that any Points award should ever exist, and it names a **person** as the party credited. |
| [`frontend/src/app/b2b/points/page.tsx`](../../frontend/src/app/b2b/points/page.tsx) (shipped) | *"Points are the **caller's own standing on the platform, not an organization record**, so no capability could sensibly decide who may look."* The route is ungated (`NAV_CAPS.points = null`). |
| [`frontend/src/lib/nav/modules.test.ts`](../../frontend/src/lib/nav/modules.test.ts) (shipped, asserted) | `points` is in the nav set of a member holding **zero capabilities** — *"Points is the caller's own standing, not an organization record — there is no capability that could gate it."* |
| [`docs/operations/AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) (shell entry) | *"No balance. No tier, no rewards, no transactions, no leaderboard… an invented balance is the single worst thing this page could show, because people would act on it."* The next sprint *"fills the Points page body"* and moves neither the route nor the nav entry. |
| [`docs/database/notifications-core.md`](notifications-core.md) §Out of scope | *"Points / gamification. No balance, ledger, tier, reward, or leaderboard model. The `/b2b/points` route stays a shell."* |
| [`docs/database/chat-core.md`](chat-core.md) §Adjacent | *"Points and gamification (a separate, unspecified increment)."* |
| [`docs/frontend/sprint-13-personal-sales-readiness.md`](../frontend/sprint-13-personal-sales-readiness.md) | *"**Referral attribution for future points is in scope; the points system is not.**"* Provenance columns are write-once because *"a reward paid on a mutable field is a reward paid to whoever wrote last."* |
| [`docs/frontend/sprint-14-showroom-mvp-completeness.md`](../frontend/sprint-14-showroom-mvp-completeness.md) | The reference design's points / tier card was **deliberately refused**: *"no points, wallet, or leaderboard exists in Aladdin, and Sprint 13 explicitly kept referral attribution without a rewards feature."* |

**Two findings matter more than the rest.**

1. **Ownership is already decided, in shipped and asserted code.** Points are the
   caller's own standing, not an organization record. This specification does not
   get to re-open it.
2. **Exactly one earning event has product intent behind it** — crediting a
   salesperson for a referred organization. Everything else in
   [Pilot earning events](#pilot-earning-events) is a *proposal*, and is labelled
   as one.

**No conflicts were found.** Every document above says the same thing in the same
direction: attribution yes, rewards not yet, ownership personal. **"Sales Score"
and "Sales Passport" have no definition anywhere in the repository** — "Sales
Passport" appears once, as a deferred feature set with no content
([`sprint-7`](../frontend/sprint-7-individual-persona-onboarding.md)), and
"Sales Score" appears nowhere at all. Nothing in this Core may therefore be
justified by, or shaped to fit, either of them.

## Core model

### Points are a ledger, not a balance

The source of truth is a set of **immutable ledger entries**. A balance is
**derived** by summing them. There is no writable balance column anywhere in
this Core, and no code path that sets one.

This is not a stylistic preference. A mutable balance has three failure modes
this product cannot absorb:

| Mutable `balance` column | Append-only ledger |
|---|---|
| A wrong number has **no explanation** — nobody can say which award produced it | Every unit of the total names the event that created it |
| A double-award and a correct award look **identical** afterwards | A duplicate is a visible second row, and is preventable by a unique key |
| Fixing it means **overwriting history**, destroying the evidence of the bug | Fixing it means **adding a compensating row**; the original stays readable |

The repository already runs this exact pattern twice — `public.audit_log`
(append-only, `app.forbid_mutation()` on UPDATE and DELETE) and
`public.notifications` (per-recipient rows written inside the emitting
transaction). Points Core **inherits** those two enforcement patterns rather
than inventing a third.

### The canonical owner is the USER

| Candidate owner | Verdict |
|---|---|
| **User** | **Canonical.** |
| Organization | Rejected as owner; retained as **context** only. |
| Membership | Rejected outright. |

**Why the user.**

- **It is already decided.** The shipped Points route and an asserted navigation
  test both state that Points are *"the caller's own standing on the platform,
  not an organization record"*, and the route is deliberately ungated because
  *"no capability could sensibly decide who may look."* Making the ledger
  org-owned would contradict merged, tested product behaviour.
- **The one approved intent names a person.** The product direction retains
  referral provenance so a future rewards feature can *"credit the
  salesperson"* — not the salesperson's employer.
- **It matches the canonical identity rule.** `CLAUDE.md`: *one person = one
  user ID*; a user may hold **zero, one or many** organizations, and personal
  identity is **not** a business. Points are career and reputation identity, so
  they belong to the identity that persists across employers.
- **Membership is the wrong grain because it is disposable.** A membership can
  be revoked, re-issued, moved between branches, or replaced when someone
  rejoins. Anchoring earned reputation to it would mean a person's history
  vanishes the day an HR record is corrected — the same class of bug Sprint 13
  avoided by making provenance write-once.

**Why the organization is still recorded.** `organization_id` is stored as the
**business context in which the point was earned** — the workspace the actor was
acting in when the qualifying event fired. It is useful for explaining an entry
and for future org-scoped reporting.

> **Hard rule.** `organization_id` is **context, never authority.** It must
> never appear in a `USING` clause, never widen who may read an entry, and never
> be the basis on which points are awarded, reversed, or read. This is the same
> rule `notifications-core.md` already enforces for its own `organization_id`,
> and Points Core adopts it verbatim.

`organization_id` is **nullable**: a person with no organization can still earn
points, and a genuinely personal event has no business context to record.

## Ledger entry contract

Conceptual fields only. **No SQL is written in this increment** — column types,
constraint names and index shapes are the following increment's work, bounded by
what is settled here.

| Field | Required | Contract |
|---|---|---|
| `id` | yes | Surrogate primary key, server-generated. Never supplied by a client. |
| `user_id` | yes | **The owner.** References the canonical user identity. The subject of every read policy. The recipient, not the actor. |
| `organization_id` | no | **Context only** (see the hard rule above). Nullable. Never an authority input. |
| `event_type` | yes | Bounded enumeration of known keys, enforced by a CHECK against an explicit allow-list — the pattern `ck_notifications_event_type_known` already uses. An unknown key must fail the write, not be stored. |
| `points_delta` | yes | **Signed integer.** Positive for an award, negative for a reversal or debit. **Never zero** — a zero entry records nothing and only pollutes history. No decimals, no currency, no rate. |
| `source_type` | yes | The kind of authoritative record that justified the entry — e.g. `organization`, `order`, `quotation`. Bounded, like `event_type`. |
| `source_id` | conditional | The identifier of that record. **Required for every event whose award derives from a business record**, which in the Pilot is all of them. |
| `reverses_entry_id` | no | Set **only** on a compensating entry; references the entry being reversed. Null on every ordinary award. |
| *(idempotency)* | yes | **Not a column.** Derived from `(user_id, event_type, source_type, source_id)` — see [Idempotency](#idempotency). |
| `awarded_by_user_id` | no | The platform actor responsible, for **administrative** entries only. Null for system-issued awards, whose actor is the transaction that fired them. |
| `reason_code` | no | Bounded enumeration, **required on administrative entries**, explaining why a human wrote a row (e.g. `support_correction`, `event_invalidated`). Not free text. |
| `metadata` | yes (defaulted) | Bounded JSON object, defaulted to empty. **Display context only** — see the exclusions below. |
| `created_at` | yes | Server clock, defaulted, never client-supplied. The ledger's only ordering axis. |

**`user_id` is the recipient, not the actor.** For the one approved Pilot event
the two differ — a referral credits the referrer, who is not the person clicking
Approve — so the distinction must be structural from the first migration rather
than discovered later.

**There is no `updated_at`.** A row that can be updated is not append-only, and
a column implying otherwise invites exactly the code this specification forbids.

### What must never be persisted in `metadata`

`metadata` exists so an entry can be *rendered* without re-querying four tables.
It is not a general-purpose sidecar. The following must **never** be written
into it:

- **Anything authorization depends on.** Capabilities, roles, membership state,
  organization ids used as permission input. If a value decides who may do
  something, it belongs in a column with a constraint, or must be re-derived
  from the source record at read time. JSON cannot be constrained, cannot be
  trusted, and must never be read by a policy.
- **The point value.** `points_delta` is the amount. A second copy in metadata
  creates two sources of truth, and they will one day disagree.
- **Personal data.** Names, phone numbers, e-mail addresses, national IDs,
  addresses — masked or otherwise. The ledger is inspectable by platform
  support; it must not become a second, unpoliced copy of the identity tables.
- **Authored content.** Message bodies, note text, quotation terms, customer
  free text. `notifications-core.md` already draws this boundary for
  `message.sent` (*"never the message body"*); Points is a weaker-context table
  than Notifications and must be at least as strict.
- **Money.** Prices, totals, currency codes, margins, commissions. Points are
  not money, and a monetary amount stored beside a `points_delta` is the first
  step to being read as an exchange rate.
- **Anything mutable that would need to stay in sync.** Organization names,
  statuses, product titles. Store the id; resolve the label at render time.

Positively: metadata carries **small, stable, non-sensitive display context** —
for example an enum discriminator the UI needs in order to choose copy. It is an
**object**, size-capped (the 4096-byte cap `ck_notifications_params_size` sets is
the precedent), and its permitted keys are enumerated **per `event_type`** in the
implementing migration rather than left open.

## Append-only rule

Points history is an **audit surface**. It is the evidence a person is shown
when they ask why their standing is what it is, and the evidence support reads
when they disagree.

| Rule | Enforcement |
|---|---|
| Entries are **immutable after creation** | `BEFORE UPDATE` trigger that raises — exactly as `audit_log_no_update` does today via `app.forbid_mutation()` |
| Entries are **never deleted** | `BEFORE DELETE` trigger that raises — exactly as `audit_log_no_delete` does today |
| **No client UPDATE** | No UPDATE policy exists, and UPDATE is not granted to `authenticated` |
| **No client DELETE** | No DELETE policy exists, and DELETE is not granted to `authenticated` |
| **No client INSERT** | No INSERT policy exists; every write goes through a `SECURITY DEFINER` path |
| **Corrections add rows** | A correction is a new compensating entry referencing the original. History is never rewritten |

The triggers are not redundant with the missing policies. Policies bind the
`authenticated` role; the triggers bind **everyone**, including the
`SECURITY DEFINER` functions this Core will itself introduce. That is the point:
the append-only guarantee must survive a mistake in our own RPC, not only a
hostile browser.

### Negative adjustments

Negative entries are **allowed**, and are the **only** correction mechanism.
They may be written exclusively by:

1. a **platform actor** holding `support` or `administrator` in
   `platform_role_grants`, through the administrative correction RPC; or
2. an **automatic invalidation** rule firing inside the same transaction that
   invalidates the originating business event — and only where a product rule
   explicitly requires it. **No such rule exists yet**; see
   [Event quality and anti-gaming](#event-quality-and-anti-gaming).

No ordinary user, no organization owner and no capability holder may write a
negative entry against anyone — **including against themselves**.

## Balance

**A balance is `SUM(points_delta)` over a user's entries. Nothing else is a
balance.**

- It is **derived at read time**. There is no writable balance column, no
  balance table, and no RPC that sets a total.
- It is **per user**, not per organization and not per membership. Summing a
  user's entries filtered by `organization_id` yields *"points earned while at
  this business"*, which is a **report**, not a balance.
- Reversals are ordinary entries with negative deltas, so a corrected balance is
  simply the same sum re-evaluated. There is no second code path — **and no
  floor**: if the corrected sum is negative, the balance is negative (D2).

**Caching is an optimization, not a source of truth.** If the sum ever becomes
too expensive — which, for a Pilot in which the only approved earning event
fires once per referred organization, it will not — a materialized total or a
summary row may be added later, under three non-negotiable conditions:

1. It is **derivable**: it can be dropped and recomputed from the ledger alone,
   with no loss.
2. It is **never written by application code** — only by a trigger or scheduled
   recompute over the ledger.
3. **Disagreement is a bug in the cache**, always resolved by recomputing from
   the ledger, never by editing the ledger to match the cache.

Until then: the index that makes the sum cheap is the one on `user_id`, and that
is the whole optimization strategy for the Pilot.

> **The displayed balance is the ledger sum, unmodified.** The shipped shell
> warns that *"an invented balance is the single worst thing this page could
> show, because people would act on it."* Two consequences, both binding:
> a derived sum over an empty ledger is **zero, and honestly zero** — the only
> number the page may show before an earning event is wired; and a sum that is
> **negative after a correction is displayed as negative**, never clamped or
> floored (**D2, decided 2026-08-30** — see
> [Can a derived balance go negative?](#can-a-derived-balance-go-negative)).
> Any transformation between `SUM(points_delta)` and the rendered figure is a
> defect.

## Authority and RLS

### The rule the whole model protects

**The browser must never be able to award itself points.** Every other rule in
this section follows from that one.

### Read

| Who | May read | Mechanism |
|---|---|---|
| **The owner** | Their **own** entries, in full | `SELECT` policy on `user_id = auth.uid()` — the recipient-only shape `notifications` already uses |
| **Another ordinary user** | **Nothing** | No policy grants it. Sharing an organization grants **no** visibility |
| **An organization owner / manager** | **Nothing**, in this Core | Deferred — see [Privacy and multi-tenancy](#privacy-and-multi-tenancy) |
| **A supplier / showroom organization** | **Nothing** | Organizations are not readers; only people are |
| **Platform `support` / `administrator`** | All entries, **read-only** | A dedicated policy or reader RPC gated on `app.is_platform(...)` |

**On the platform read path — a deliberate divergence from Notifications.**
`notifications-core.md` gives platform admins *no* read path, because a
notification is private correspondence with no dispute surface. Points are
different in kind: they are a **contested record**. A person will ask why their
standing changed, support must be able to answer, and an administrative
correction cannot be issued responsibly by someone who cannot see what they are
correcting. Refusing the read would not protect the user — it would leave
support guessing. The divergence is therefore intentional and is recorded here
so it is not later mistaken for an inconsistency.

### Write

There is **no client write path of any kind**. `INSERT`, `UPDATE` and `DELETE`
are ungranted to `authenticated`, and no policy exists for them.

| Action | Who | Path |
|---|---|---|
| **Issue points** | The platform, never a person | Internal `SECURITY DEFINER` helper (`app.award_points(...)`), callable only from inside a trusted RPC. `EXECUTE` revoked from `public`, never granted to `authenticated` |
| **Reverse / correct** | Platform `support` / `administrator` only | A public `SECURITY DEFINER` RPC that re-checks `app.is_platform(...)` **inside the function body** and writes a compensating entry |
| **Automatic invalidation** | The invalidating transaction | The same internal helper, from inside the RPC that invalidates the business event |

**Awards are emitted from existing transitions, not from a new endpoint.** The
call site sits beside the `app.record_audit_event` call the RPC already makes,
**inside the same transaction** — the identical placement
`notifications-core.md` specifies for `app.notify*` (*"immediately beside its
existing `app.record_audit_event` call and inside the same transaction"*).
Points Core adds **no new call sites**; it adds a call to sites that already
exist and are already authorized.

This has three consequences worth stating plainly:

1. **A person can only earn points by doing the real thing.** There is no
   "award" endpoint to call, so there is nothing to forge a request to. The
   award is a side effect of a business transition that the caller had to be
   authorized to perform in the first place.
2. **The award inherits the transition's authorization.** If the RPC rejects the
   caller, no points are written, because the transaction never commits.
3. **A failed business action awards nothing.** Award and transition commit
   together or roll back together.

### The membership trap, stated explicitly

> **Organization membership is never permission to alter another user's points.**

A capability such as `org.manage` authorizes acting on **organization records**.
Points are not an organization record — the shipped navigation contract says so.
No capability, no owner role, and no branch scope may be read as authority to
write, reverse, or read another person's ledger. The only authority over another
person's points is **platform role**, and it is correction authority only.

## Idempotency

**Mandatory.** A qualifying business event must award points **exactly once**,
regardless of retry, refresh, duplicated request, repeated event execution, or
two concurrent calls.

### The strategy: deterministic event identity, enforced by the database

The idempotency key is **derived from the event itself**, never generated by a
client:

```
(user_id, event_type, source_type, source_id)
```

enforced by a **unique index** over ordinary award entries — that is, entries
where `reverses_entry_id is null`. A second attempt to award the same event to
the same person for the same source record does not produce a second row; it
violates the constraint, and the award helper treats that violation as
**success with no effect** rather than an error, so the surrounding business
transaction still commits.

**Why deterministic and not a client token.** A frontend-generated idempotency
key protects against a client retrying *its own* request. It does nothing about
two different code paths awarding the same event, a webhook replayed by an
external system, or an event re-emitted by a future backfill — and it makes
correctness depend on the least trusted participant. The tuple above is
reconstructible by anyone holding the source record, forever, by any code path,
in any order.

### The four duplication routes, and what closes each

| Route | What closes it |
|---|---|
| **User refreshes the page / double-submits** | The business RPC is already the guard: the underlying transition is not repeatable (an approved organization cannot be approved twice). Even if it were, the unique key absorbs the second write |
| **Client or network retry** | Award and business transition share **one transaction**. A retry that re-runs the RPC hits the unique key; a retry of a transaction that never committed writes nothing to roll back |
| **Repeated event / webhook execution** | Same unique key. Replay is idempotent by construction, with no replay log to maintain |
| **Two concurrent calls** | The unique **index** — not an application-level `if not exists` check, which races between its `SELECT` and its `INSERT`. One transaction commits, the other sees the violation and treats it as a no-op |

### Consequences for the event set

Because the key includes `source_id`, an event is **repeatable across distinct
source records and non-repeatable within one**. That is the correct default and
it is why every Pilot earning event must name an **authoritative source record**
in [Pilot earning events](#pilot-earning-events).

**An event with no natural source record cannot be made idempotent by this
mechanism and is therefore not eligible for the Pilot.** "Points for logging in
today" would need a synthetic date-derived identity; the Pilot does not have
such an event, and one must not be introduced without extending this section
first.

**Reversal entries are excluded from the unique index** (they carry
`reverses_entry_id`), and are instead constrained by a **unique index on
`reverses_entry_id`** so that a given entry can be reversed **at most once**.

## Pilot earning events

### Two questions, deliberately separated

| | |
|---|---|
| **Technical event eligibility** | Does an authoritative source record exist, is there a trusted trigger point inside an existing transaction, and can the award be made idempotent and abuse-resistant? **This specification answers this.** |
| **Business point value** | How many points is it worth, and should it be worth any at all? **This specification does not answer this, and must not.** |

Conflating the two is how gamification systems get invented by accident: an
engineer establishes that an event *can* be awarded and ships a number that
nobody approved. Every amount below therefore reads **PRODUCT DECISION
REQUIRED**, and the repository contains **no approved numeric point value for
anything** — the search found none, so none is proposed here.

**This survived the 2026-08-30 review deliberately.** Product closed the
*eligibility* question (D6: one event, no Tier B) while **explicitly leaving
values unresolved — including for the approved event**. That is not an
oversight to be tidied up later: `referral.organization_approved` is eligible,
specified, and worth an amount **nobody has set**. The wiring increment must
therefore stop and ask, and no default, placeholder or "1" may be substituted
for the missing decision.

### Tier A — product intent exists

**One event qualifies.** The product direction retains referral provenance
write-once precisely *"so a future rewards feature can credit the salesperson"*.
That is the single statement in the repository that authorizes any Points award
to exist at all.

| | |
|---|---|
| **Event key** | `referral.organization_approved` |
| **Recipient** | `organizations.referred_by_user_id` — the referring salesperson, **not** their employer and **not** the approving Admin |
| **Authoritative source record** | `public.organizations`, where `source = 'salesperson_referral'`. Both provenance columns are **write-once**, enforced by `app.organizations_provenance_immutable()` |
| **Trigger point** | The Admin approval that verifies the referred organization — inside the existing verification-approval transaction, beside its existing audit call |
| **Proposed amount** | **PRODUCT DECISION REQUIRED** |
| **Repeatability** | **Once per organization, ever.** An organization has exactly one provenance and can be approved once |
| **Idempotency identity** | `(referred_by_user_id, 'referral.organization_approved', 'organization', organizations.id)` |
| **Abuse risk** | **Low, and already mitigated.** The salesperson cannot self-approve — approval is a platform-role action by a different party. Fabricated referrals are caught at the same review that already gates the organization's existence. The credited column cannot be rewritten to redirect an award, which is exactly why Sprint 13 made it immutable: *"a reward paid on a mutable field is a reward paid to whoever wrote last."* |

This event is **technically eligible today**, and is the **Pilot's entire
approved earning-event set** (D6). Its point value is the one thing still
missing (D1) — it is eligible, specified, and worth an amount nobody has set.

### Tier B — DEFERRED candidates, explicitly not approved

> **DECIDED 2026-08-30 (D6).** Product reviewed the candidates below and
> approved **none of them for the Pilot**. They remain **deferred candidates**,
> recorded for a future review — **not** earning rules, and **not** an
> implementation backlog.

The commerce RPCs offer trusted, already-authorized transition points, and it
would be easy to attach awards to them. That ease is precisely why the decision
had to be explicit: each one is technically eligible, and each carries a
collusion risk that is not closed.

**The Pilot's approved earning-event set is Tier A alone.** Nothing below may be
added to `event_type`, wired to an RPC, or seeded — not as a flag, not behind a
toggle, not "ready but disabled". A deferred candidate that exists in the
allow-list is an approved event with an extra step.

| Candidate | Recipient | Source record | Trigger | Amount | Repeatability | Idempotency identity | Abuse risk |
|---|---|---|---|---|---|---|---|
| `quotation.accepted` | the acting user who submitted the winning quotation | `quotations` | `decide_quotation`, on acceptance | **PRODUCT DECISION REQUIRED** | once per quotation | `(user, key, 'quotation', quotation_id)` | **Medium — collusion.** Two organizations a person belongs to, or two cooperating businesses, can transact solely to farm awards |
| `order.completed` | the acting user on the supplying side | `orders` | `complete_project` (there is no `complete_order` RPC) | **PRODUCT DECISION REQUIRED** | once per order | `(user, key, 'order', order_id)` | **Medium — same collusion route**, at higher effort |
| `project.completed` | the acting user | `projects` | `activate_project` / `complete_project` | **PRODUCT DECISION REQUIRED** | once per project | `(user, key, 'project', project_id)` | **Medium**, and partly redundant with `order.completed` — completing the project is what completes the order |

**Explicitly rejected as earning events, at any value:**

- **Draft creation** — `rfqs` and `quotations` both have draft states, and a
  draft costs nothing to create. Awarding it is unbounded free points.
- **`rfq.submitted`** — cheap, self-initiated, and repeatable at will against
  any supplier. It is a request, not an outcome.
- **Chat messages** — see
  [Relationship to other systems](#relationship-to-other-systems). Awarding
  correspondence turns a business thread into a points faucet.
- **Sign-in, page views, profile completion, streaks** — none has an
  authoritative source record, so none can be made idempotent by the mechanism
  this Core defines, and all are pure activity rather than outcome.

### The approved Pilot set, in one line

**Points Core ships with exactly one earning event: `referral.organization_approved`.**

This is the decided scope, not a provisional minimum. It proves the ledger, the
idempotency key, the authority model and the reversal path against a real,
low-risk, already-approved business intent, and it leaves the gamification
surface unbuilt — which every prior sprint deliberately chose. The
`event_type` allow-list therefore contains **one** value, and adding a second
requires a new product decision, not a new migration.

## Event quality and anti-gaming

Pilot safeguards only. **This Core builds no fraud scoring, no risk engine, no
velocity limits and no anomaly detection**; it establishes the structural
properties that make those unnecessary at Pilot scale.

| Safeguard | How it is enforced |
|---|---|
| **Drafts never earn** | No draft transition is an earning event. Enforced by the `event_type` allow-list, not by convention |
| **Status toggling cannot farm points** | The idempotency key is `(user, event, source_type, source_id)`. Toggling a record back and forth re-presents the **same** key, so the second award is a no-op. Farming would require creating new source records, not re-touching one |
| **Retries never duplicate** | Same key, plus award-inside-the-business-transaction. See [Idempotency](#idempotency) |
| **Self-generated activity is bounded by the business model** | Every eligible event requires a **real business record that survived its own authorization**. There is no event that a person can fire alone, on demand, with no counterparty and no cost |
| **The award cannot outlive a failed action** | One transaction. A rolled-back transition writes no points |
| **The credited party cannot be redirected** | The one approved event reads a **write-once** column; there is no update path that could point an existing award at someone else |

**Known risk of the deferred candidates, recorded as a precondition.** The Tier B commerce
candidates are farmable by **collusion** — a person who is a member of both
sides, or two cooperating businesses, can manufacture qualifying transactions.
The Pilot's answer is **not to approve those events** — which is now a decision
(D6), not a pending question. The risk is therefore **not present in the Pilot
at all**: no commerce transition awards points, so there is nothing to collude
toward.

It is recorded because it is a **precondition on any future approval**, not a
live exposure. Should product ever revisit Tier B, the collusion case must be
closed first, and the two obvious mitigations are (a) requiring the two
organizations to be distinct and to share no member, and (b) making the award
conditional on a transition that requires the *counterparty* to act. Both are
additive and neither changes this Core.

### Invalidation of a cancelled or rejected action

**A cancellation or rejection does not automatically reverse an earlier award,
and this Core adds no rule that it should.** Adding one silently would be a
product decision smuggled in as an implementation detail.

Two properties make the question safe to defer:

1. **The eligible events are terminal.** Approving a referred organization, like
   completing an order, is not a state that is later undone by an ordinary
   business action.
2. **The mechanism already exists if the answer changes.** Automatic
   invalidation is a compensating entry written from inside the invalidating
   transaction — the same helper, the same table, no schema change. Turning it
   on later costs one call site per rule.

Until a product rule explicitly requires an automatic reversal, the only
reversal path is **administrative**.

## Reversals and corrections

**Every correction is a new entry. No historical entry is ever mutated.**

A compensating entry carries `reverses_entry_id` pointing at the original, a
negative `points_delta`, a `reason_code`, and the `awarded_by_user_id` of the
platform actor responsible. The original stays exactly as written, and the pair
reads as a complete account of what happened and what was decided about it.

| Case | Mechanism | Authority |
|---|---|---|
| **Administrative correction** — an award was wrong | Compensating entry referencing the original | Platform `support` / `administrator`, re-checked inside the RPC body |
| **Event invalidation** — the business event ceased to qualify | Compensating entry, written inside the invalidating transaction | The invalidating RPC, **only where a product rule requires it** — none does yet |
| **Reversal of a reversal** | **Not supported.** `reverses_entry_id` is unique, so an entry is reversible at most once. A mistaken reversal is corrected by a new administrative award with its own `reason_code` | Platform `support` / `administrator` |
| **Deleting an entry** | **Impossible.** `BEFORE DELETE` raises, for every role | — |
| **Editing an entry** | **Impossible.** `BEFORE UPDATE` raises, for every role | — |

**Every administrative entry is audited.** The correction RPC calls
`app.record_audit_event` in the same transaction, exactly as every other
platform action does, so a correction appears in **two** append-only records:
the ledger it adjusts and the forensic log.

### Can a derived balance go negative?

**Yes — in storage and on screen. DECIDED 2026-08-30 (D2).**

**In storage: it must.** The ledger sum is arithmetic over signed integers.
Forbidding a negative sum would mean either refusing a legitimate correction, or
silently writing a smaller reversal than the error requires — both of which
corrupt the record to protect a display. **A constraint that clamps the sum at
zero must not be written.**

**On screen: the displayed balance is the ledger sum, faithfully.** Product has
decided that a user-facing balance **may display a negative value** after a
legitimate correction or reversal.

| Rule | |
|---|---|
| **No clamping** | No `greatest(sum, 0)`, no `max(0, …)`, in SQL, in a query layer, in a view model, or in a component |
| **No visual flooring** | A negative total is not rendered as `0`, as `—`, as an empty state, or as a hidden field |
| **No suppression** | A negative balance does not hide the page, the history, or the entries that produced it |
| **History carries the explanation** | The adjustment entries — their `reason_code`, their reversal link and their timestamp — are what explain the negative, and must be visible alongside it |
| **Formatting must survive the sign** | The sign is part of the number in **both** languages; Arabic RTL numeral rendering must not drop or misplace it |

**Why faithful rather than flattered.** A floor at zero makes a correction
invisible: the ledger says −40, the page says 0, and the person is told nothing
happened. They then have no reason to query a correction that may itself be
wrong — which is exactly the dispute the platform read path in
[Authority and RLS](#authority-and-rls) exists to resolve. A displayed balance
that can disagree with the ledger is the mutable-balance failure mode
reintroduced at the presentation layer, and the shipped shell already names the
principle: *"an invented balance is the single worst thing this page could
show, because people would act on it."* A floored zero is an invented balance.

**Out of scope of this decision.** Whether a negative standing *gates* anything
is not settled here and is not raised as an open question, because **nothing
consumes the balance** — there is no tier, reward, challenge or Sales Score to
gate. When a consumer is specified, its own eligibility rule is part of that
specification.

## Organization changes

**Previously earned points stay with the user. Always, in every case, with no
exception and no transfer.**

| The user… | Effect on their ledger |
|---|---|
| **Leaves an organization** | **None.** Entries keep the `organization_id` they were earned under, as historical context. Nothing is deleted, recalculated, or moved |
| **Moves between branches** | **None.** Branch is not on the ledger at all — it is membership scope, and Points are not a membership record |
| **Joins another organization** | **None.** New entries record the new context; old entries keep the old one. The person's total is continuous across the move |
| **Loses a capability** | **None.** Capabilities gate organization records. Points are the caller's own standing, and the shipped route is deliberately ungated |
| **Has their membership revoked or suspended** | **None.** Revocation ends access to a workspace, not a personal history |
| **Holds several organizations at once** | Entries carry different `organization_id` values; the balance is one number, because the person is one person |

**Rationale, from product direction rather than convenience.**

- *One person = one user ID*, and *personal identity is not a business*
  (`CLAUDE.md`). Points are owned by that identity, so an employment change
  cannot touch them.
- The shipped contract calls Points *"the caller's own standing on the
  platform"*. Standing that resets when you change jobs is not standing.
- **Business classification belongs to the Organization**, and the product
  direction forbids mirroring business state onto the user. The mirror image is
  equally forbidden: **personal reputation must not be absorbed into an
  organization record**, which is exactly what "points stay with the business"
  would do.
- Practically, the alternative is unimplementable. A user may hold several
  organizations simultaneously; there is no rule that could decide which one a
  departing person's points belong to.

**Nothing is transferable.** There is no path — RPC, policy, admin tool or
migration — that moves an entry from one user to another. Reputation is not
assignable, and a transferable reputation ledger is a marketplace, which this
product explicitly is not.

**Deletion.** If a user identity is deleted, their ledger goes with it, by the
same `on delete cascade` from `public.users` that `notifications` already uses.
The ledger is personal data about that person; it does not outlive them as
orphaned rows.

## Privacy and multi-tenancy

**Default: a points ledger is private to the person it belongs to.** Sharing an
organization is not a reason to see someone's standing.

| Question | Answer | Why |
|---|---|---|
| Can a **same-org colleague** see another person's points? | **No** | Membership is not a reason to read a personal record. There is no policy that would permit it, and no capability that could grant it |
| Can a **manager or owner** see a team member's history? | **No, in this Core** | Deferred. Team visibility is a leaderboard-shaped feature, and Sprints 13 and 14 both **refused** leaderboards for want of a model. Approving manager visibility here would ship the leaderboard's data layer under another name |
| Can a manager see **team totals**? | **No, in this Core** | An aggregate over colleagues is the same disclosure with a coarser grain. Small teams make a total trivially attributable |
| Can a **supplier / showroom organization** see user-level detail? | **No** | Organizations are not readers. Only people read, and only their own ledger. Cross-tenant user detail has no path here at all |
| Can **platform admins / support** inspect entries? | **Yes — read-only**, gated on `app.is_platform(...)` | Points are a contested record. Support must be able to answer *"why did my points change?"*, and a correction cannot be issued responsibly by someone who cannot see what they are correcting. `audit_log` already gives platform admins full forensic visibility of every transition, so withholding the ledger would be inconsistent rather than protective |
| Can platform admins **write**? | Only compensating entries, only via the correction RPC, always audited | See [Reversals and corrections](#reversals-and-corrections) |

**The org-membership escalation, closed explicitly.** `notifications-core.md`
establishes the rule that a personal row's `organization_id` *"must never reach a
`USING` clause"*. Points Core enforces the same thing. The failure this prevents
is concrete: an owner reading `organization_id = <my org>` would harvest the
standing of every employee, past and present, including points those people
earned at **other** employers — because entries keep their historical context and
a departed colleague's rows still carry that org id.

**If manager visibility is later approved**, it must arrive as its own reviewed
specification, defining consent, the aggregate grain, whether past employees are
included, and whether the subject is told. It is not an RLS tweak.

## Relationship to other systems

Each seam is **defined and left unimplemented**. Nothing in this section may be
built from this document.

### Notifications

**Seam:** an award *could* later emit a notification, since the award already
fires inside a transaction that has `app.notify*` available beside it.

**Not in this Core.** No `points.*` event key is added to
`ck_notifications_event_type_known`, and no award emits a notice. Two reasons:
until amounts are approved the notice would have nothing to say, and
`notifications-core.md` lists Points under Out of scope — reversing that needs a
decision, not an import. When it is approved, the change is additive: one event
key and one call beside the existing audit call.

### Chat

**Chat messages must not earn points.** No message event is eligible, and
`send_message` gains no award call. This is the clearest gaming vector in the
product — a points-per-message rule turns business correspondence into a faucet,
and would corrupt the one channel counterparties rely on. `chat-core.md` already
lists Points as *"a separate, unspecified increment"*; that stands.

### Sales Score

**Points are not the Sales Score.** They are also not a component of it, not an
input to it, and not a renamed version of it.

**"Sales Score" has no definition anywhere in this repository** — the term does
not appear in any document, migration or source file. It therefore cannot be
designed against, and nothing here is shaped to fit it. If a Sales Score is
specified later it would be a **consumer** of the ledger, reading the same
derived sum any other consumer reads, with its own specification.

### Wallet and commission

**No monetary conversion exists in this Core, in any direction.** No currency,
no rate, no redemption, no payout, no withdrawal, no supplier funding, no
commission calculation. `points_delta` is a dimensionless integer.

Sprint 13 already refused the salesperson wallet and the commission engine, and
Sprint 14 refused the rewards tier card. Points Core does not reopen any of
them. **A points balance must never be rendered, described or translated as an
amount of money** in any surface or in either language.

### Challenges and leaderboard

**Future consumers of the ledger, not part of Points Core.** No challenge
definition, no progress tracking, no ranking, no ordering across users, no
badges, no tiers. Both were explicitly refused in Sprints 13 and 14 for want of
a model, and this Core does not supply one. A leaderboard in particular is a
**cross-user read**, which the privacy model above forbids outright — building
one requires reopening [Privacy and multi-tenancy](#privacy-and-multi-tenancy),
not merely adding a query.

## Realtime

**Explicitly deferred. Nothing is mandated and nothing is added.**

No table joins the `supabase_realtime` publication, no subscription is created,
and no client channel is opened. This matches Notifications and Chat, both of
which shipped without Realtime.

A points balance is also the weakest possible case for it: awards fire at human
business tempo — for the one approved event, at most once per referred
organization ever — and the existing `router.refresh()` reconciliation the
notification badge already uses is more than sufficient. If it is ever wanted,
adding the table to the publication is additive and changes nothing here.

## Out of scope

Explicitly **not** part of Points Core, and not to be added without a further
approved specification:

- **Redeemable rewards** — no catalogue, no redemption, no fulfilment, no
  reward inventory.
- **Cash withdrawal / payout** — none, by any route.
- **Wallets** — no Sales Wallet, no Universal Wallet, no balance that is money.
- **Commissions** — no commission model, rate, or calculation.
- **Supplier reward budgets** — no funding party, no sponsored award, no
  budget accounting.
- **Referral rewards beyond the single Tier A event** — the referral *ledger
  entry* is specified; referral programmes, tiers, multi-level attribution and
  referral payouts are not.
- **Commerce earning events** — `quotation.accepted`, `order.completed` and
  `project.completed` are **deferred by product decision (D6, 2026-08-30)**, not
  merely unbuilt. They must not be added to the `event_type` allow-list, wired
  to an RPC, or shipped behind a feature flag.
- **Challenges engine** — no challenge, mission, quest, streak or progress
  model.
- **Leaderboard** — no ranking, no cross-user read, no team totals.
- **Badges** and **tiers** — no achievement or level model of any kind.
- **Sales Score calculation** — undefined in the repository; not designed
  against.
- **AI recommendations** — no scoring, ranking or suggestion driven by points.
- **Consumer (B2C) gamification** — the Pilot scope is B2B, as with
  Notifications.
- **Expiration / decay** — entries never expire, and no scheduled job touches
  the ledger. See [**D4**](#open-product-decisions).
- **Point marketplace / transfer between users** — forbidden by the ownership
  model, not merely unbuilt.
- **Realtime** — deferred as above.
- **Any UI** — the `/b2b/points` route stays the shell it is today. This
  increment changes no frontend file.
- **Any migration, table, RPC, policy, index or seed row** — this increment is
  specification only.

## Open product decisions

**Numbering is stable.** D2 and D6 were closed by product on 2026-08-30 and are
recorded under [Decided](#decided-2026-08-30) below rather than renumbered away,
so that every reference to a decision id keeps meaning the same thing.

An item is listed as open **only** because existing repository authority
genuinely does not settle it; everything the repository does settle, and
everything product has since decided, is closed rather than deferred.

### Still open

| # | Decision | Why it is open | Blocks |
|---|---|---|---|
| **D1** | **Numeric point value for `referral.organization_approved`** — the Pilot's only earning event | The repository contains **no approved numeric point amount for anything**, and product has reaffirmed (2026-08-30) that values remain unresolved **even for the approved event**. Inventing one would be a product decision made by an engineer | The **wiring** increment only. Does **not** block the table, RLS, idempotency or the reversal path |
| **D3** | **Do managers or owners get any visibility of team points?** | Refused by default here, because it is leaderboard-shaped and Sprints 13 and 14 both refused leaderboards. But manager visibility was never asked and answered on its own terms | Nothing today. Reopening it later is a **new specification**, not an RLS tweak |
| **D4** | **Do points ever expire or decay?** | No authority. Expiry is a product stance on whether standing is cumulative or current | Nothing today. Expiry is implementable additively as scheduled compensating entries — **never** as deletion |
| **D5** | **Future relationship to Sales Score, reputation and leaderboard** | "Sales Score" is **undefined in the repository**; "Sales Passport" appears once as a deferred feature set with no content. Neither can be designed against | Nothing today. Now the **only** decision that could reopen the event set, since D6 closed Tier B — a future consumer's needs are the plausible reason to revisit which events are worth recording |

**D1 is the only item on the critical path**, and it blocks strictly less than
it appears to: the ledger, its RLS, its idempotency key and its reversal path
are all fully specified without it. D3, D4 and D5 block nothing that is being
built.

### Decided 2026-08-30

| # | Decision | Resolution |
|---|---|---|
| **D2** | May a derived balance display negative after a correction? | **Yes.** The displayed balance is `SUM(points_delta)`, faithfully — **no clamping, no visual floor, no suppression**, in either language. The adjustment history explains the sign. Storage was already settled; this closed the display rule. See [Can a derived balance go negative?](#can-a-derived-balance-go-negative) |
| **D6** | Which Tier B commerce events are approved? | **None.** `quotation.accepted`, `order.completed` and `project.completed` stay **deferred candidates**, not earning rules and not an implementation backlog. The Pilot's approved set is **`referral.organization_approved` alone**. See [Tier B](#tier-b--deferred-candidates-explicitly-not-approved) |

**Not open, and recorded here so they are not re-litigated:** ownership is the
user; the ledger is append-only; balance is derived and displayed unmodified;
no client write path exists; idempotency is deterministic; corrections are
compensating entries; points survive every organization change; colleagues
cannot read each other's ledgers; chat never earns points; there is no monetary
conversion; and the Pilot has exactly one earning event.

## Blockers

**None.** Every table, helper, capability, platform-role check and transition
point this specification depends on already exists and is merged —
`public.users`, `public.organizations` with write-once referral provenance,
`platform_role_grants` with `app.is_platform`, `app.record_audit_event`,
`app.forbid_mutation`, and the verification-approval transaction the one
approved event attaches to.

**Implementation of the ledger, its RLS, its idempotency key and its reversal
path can begin on approval of this document.** Wiring the one approved earning
event additionally requires [**D1**](#open-product-decisions) — its point value.
No other decision blocks anything: D6 closed the event set to
`referral.organization_approved` alone, and D2 closed the display rule.

## References

- [`notifications-core.md`](notifications-core.md) — the recipient-only RLS
  shape, the `organization_id`-is-context rule, the same-transaction emission
  pattern, and the `params` bounding this document reuses for `metadata`.
- [`chat-core.md`](chat-core.md) — Points listed as a separate, unspecified
  increment; the no-content-copying boundary.
- [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md)
  — referral attribution retained to credit the salesperson; no points, wallet,
  leaderboard or reward calculation exists.
- [`../frontend/sprint-13-personal-sales-readiness.md`](../frontend/sprint-13-personal-sales-readiness.md)
  — write-once provenance, and *"referral attribution for future points is in
  scope; the points system is not."*
- [`../frontend/sprint-14-showroom-mvp-completeness.md`](../frontend/sprint-14-showroom-mvp-completeness.md)
  — the points / tier card deliberately refused.
- [`../decisions/ADR-0007-identity-and-tenancy-model.md`](../decisions/ADR-0007-identity-and-tenancy-model.md)
  — one canonical identity; `platform_role_grants` as the only platform
  authority; `app.is_platform` as the single read point.
- [`../decisions/ADR-0002-database-migrations.md`](../decisions/ADR-0002-database-migrations.md)
  — migrations are the schema source of truth.
