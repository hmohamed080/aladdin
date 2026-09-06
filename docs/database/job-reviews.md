# Job Reviews — Contract

**Status:** **Implemented** · Installer Pilot Increment 12 · `feature/installer-pilot`
**Migration:** `supabase/migrations/20260909090001_job_reviews.sql`
**Tests:** `supabase/tests/49_job_reviews_test.sql` (65)
**Contract:** [`installer-jobs.md`](installer-jobs.md) **D4**, **O2**, **O6**

One organization says one thing, once, about work that is finished. Everything
here is arrangement around the three words in that sentence — and around one
asymmetry: **a review is a lasting public claim about a named person who cannot
reply to it.**

---

## 1. The model

| Table | Holds |
|---|---|
| `job_reviews` | One immutable review per completed assignment |
| `job_review_moderations` | Append-only moderation acts; suppression is **derived** from the latest |

```
job_reviews
  assignment_id      uuid  UNIQUE  -> job_assignments (RESTRICT)
  installer_user_id  uuid          -> users
  poster_org_id      uuid          -> organizations
  rating             smallint      CHECK 1..5
  comment            text          <= 1500, nullable
  submitted_by       uuid          audit/authority only, never projected
  created_at         timestamptz
```

**There is no `updated_at`.** The row cannot change, so a column recording when
it changed would be a permanent lie about a table whose whole point is that it
does not move.

**`assignment_id` is UNIQUE**, so "one review per completed assignment" is a
shape the table refuses to break rather than a rule a writer has to remember.

**RESTRICT, not CASCADE.** A review must outlive the ordinary lifecycle. If
anybody ever needs to remove an assignment they have to deal with its review
consciously rather than take it with them.

### 1.1 What is deliberately absent

No helpful votes, likes, reply threads, recommendation flag, per-category
ratings, verification badge, or sentiment/AI score. Each would need an authority
this product does not have — and a per-category score in particular would be five
numbers nobody ever entered, scoring a professional on axes no client was asked
about. `49_job_reviews_test` asserts the absence by column pattern.

---

## 2. Submission

`public.job_review_submit(assignment_id, rating, comment)` — the only writer.

| Check | Rule |
|---|---|
| Authenticated | `auth.uid()` is not null |
| **Authority first** | `app.can_manage_job(poster_org_id)` — `job.manage` **or** `org.manage` |
| State | assignment status is `completed` |
| Range | 1–5, enforced by the **table**, so no writer can reach the column another way |
| Count | idempotent — a second call returns the existing review |

**Authority is checked before state**, so a stranger cannot learn an assignment's
status from which refusal they get.

**Idempotent rather than an error**, the shape `job_application_submit` already
uses: a double tap or a retried request converges instead of failing at somebody
who did nothing wrong.

**The installer gets the same refusal a stranger does** — they hold no capability
on the posting organization, so no special case is needed to stop them reviewing
themselves.

---

## 3. Immutability

**No update path and no delete path exists for anybody**, enforced by
`app.forbid_mutation` on both triggers — the same guard the append-only progress
history uses.

This is stronger than a withheld grant, because it also refuses **every
security-definer function in the schema**, including the ones in this migration.
pgTAP proves it by trying both as the owning role and being refused.

A correction is therefore a moderation act with its own record, never a quiet
rewrite of what somebody once said.

---

## 4. Moderation

`public.job_review_moderate(review_id, action, reason)` — `suppress` or
`restore`, requiring `app.is_platform('moderator')` (satisfied by a moderator or
an administrator).

* **Neither interested party can reach it.** Not the organization that wrote the
  review — a review it can withdraw is not a review — and not the professional it
  is about.
* **A reason is required.** An unexplained suppression is indistinguishable from
  a mistake, and this table exists so that distinction survives.
* **Suppression is DERIVED, never stored.** There is no `suppressed` column;
  state is the latest row, so the history cannot contradict a flag because there
  is no flag. A restore is another row, not an undo, and both are kept.
* **Ordered by `seq`, never `created_at`.** Two acts in one transaction share the
  transaction timestamp exactly, and ordering by it decided "latest" on a random
  uuid — a bug pgTAP caught before it shipped.
* **The history is readable by no client role at all.** A reader learning that a
  review was suppressed, or why, would be reading the moderation decision itself.

**No moderation UI in this increment.** The authority and the RPCs exist and are
tested; an admin screen is deferred and reported.

---

## 5. Read models

Both are `security_invoker` views over `security definer` readers — the
`profile_public_directory` pattern — because three separate policies would
otherwise erase the context of finished work: an installer is not a member of the
reviewing organization, a retired trade vanishes, and a job out of discovery is
unreadable.

| View | Who | Columns |
|---|---|---|
| `my_job_reviews` | the reviewed professional | id, rating, comment, org_name, job_title, trade_key, created_at |
| `public_profile_reviews` | anyone, for a **listed** profile | + profile_id |

**Neither carries `submitted_by`, an assignment id, or any moderation state**, and
the public one carries no user id of any kind — the rule
`17_public_directory_hardening` keeps for every public surface. Asserted by exact
column list.

**Suppressed reviews are absent from BOTH.** Showing the professional a review the
public cannot see would let them read the moderation decision by inference.

### 5.1 What survives

A retired trade, an unverified organization and a job that has left discovery
together do not erase a review or its context. Asserted directly.

---

## 6. Publication

A review is publicly visible when **the profile is currently listed** and **the
review is not suppressed**. Listing is read from `profile_public_directory`, the
same projection the public profile page is built on, so publication cannot mean
one thing to a page and another to a review.

Unlisting withdraws every review at once without touching a row; relisting
restores them with nothing to resubmit.

---

## 7. Rating summary

One derivation — `lib/reviews/summary.ts` — taking the **same array** the list
renders. That is what makes "the summary and the list cannot disagree" a property
rather than a promise: no second query to drift, no cache to go stale.

**Zero reviews yields `average: null`, never `0.0`.** Zero is a score somebody
could conceivably be given; "no reviews yet" is not a bad one, and a fresh
professional shown `0.0` beside five empty stars would be the product delivering
a verdict nobody delivered.

---

## 8. Notification

`job.review.received` → the reviewed professional, via `app.notify`. One
unambiguous recipient, so it does not need the capability-addressed `notify_org`:
the organization is the party that just acted. No organization-facing
counterpart, no realtime, no email or push.

---

## 9. Audit

`job.review.submitted`, `job.review.suppressed`, `job.review.restored`. There is
deliberately no `job.review.updated` or `.deleted`, because no such act exists.

---

## 10. Files

| Concern | File |
|---|---|
| Schema, RPCs, projections | `supabase/migrations/20260909090001_job_reviews.sql` |
| Security tests | `supabase/tests/49_job_reviews_test.sql` |
| Summary derivation | `frontend/src/lib/reviews/summary.ts` |
| Reads | `frontend/src/server/queries/reviews.ts` |
| Submission | `frontend/src/server/actions/reviews.ts` |
| Reviews page | `frontend/src/features/reviews/` |
| Poster panel | `frontend/src/features/reviews/leave-review.tsx` |
| Public section | `frontend/src/features/profile/public-reviews.tsx` |
