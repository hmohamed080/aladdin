# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

---

## Session — A sentence that cannot be edited, and a correction that leaves a record

**Date:** 2026-09-08 → 2026-09-09 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `7be2267` (Increment 11)

Installer Increment 12: Completed-Work Reviews. One migration, two tables, two
RPCs, two read models, one owner page, one public section, and three integration
points on surfaces that already existed. The domain is small; almost all of the
work was in deciding what a review is NOT allowed to be.

### The four shapes that make it a record rather than an opinion box

**Its identity is the work.** `assignment_id` is `unique`, so "one review per
completed assignment" is a shape rather than a rule somebody has to enforce, and
a review can only exist against work the platform watched reach 100% and be
marked complete. Both foreign keys are `RESTRICT`: a review must outlive the
ordinary lifecycle, and removing an assignment out from under one should be a
conscious act, not a cascade.

**It cannot change.** `app.forbid_mutation` — the same guard the append-only
progress history uses — fires on UPDATE and DELETE. A trigger rather than a
withheld grant, because a grant only stops clients: this also stops every
`security definer` function in the file, which is what makes "immutable" a
property instead of a convention. There is no `updated_at`, because a column
recording when the row changed would be a permanent lie about a table whose whole
point is that it does not move.

**The reviewer is the organization.** `submitted_by` is stored for audit and
authority and is projected nowhere — not publicly, not to the installer. Naming
the employee who typed it would turn a business record into a personal one, on a
surface the reviewed professional cannot answer back on. §16 asserts its absence
from both read models by column list, so widening a projection breaks a test
rather than quietly publishing a name.

**A correction is a new fact.** There is no `suppressed` column. State is derived
from the latest row in `job_review_moderations`, which is itself append-only, so
the history cannot contradict the flag — there is no flag to contradict.
Restoring is another row rather than an undo, `reason` is required, and the
moderation table is readable by nobody: a reader learning that a review was
suppressed, or why, would be reading the moderation decision itself.

### The finding pgTAP made, which reading the file would not have

Ordering the moderation history by `created_at` is wrong, and wrong in a way that
only shows up under a test that does two things at once. `now()` is the
TRANSACTION timestamp — a suppression and a restore performed in one transaction
share it *exactly*, and "the latest act" then fell back to comparing two random
uuids. Roughly half the time the restore lost to the suppression that preceded
it. A `bigint generated always as identity` column is the only tiebreaker that
means what it says, and the assertion that caught it is now the one that keeps it.

The TRUNCATE hazard Increment 11 shipped and caught did not recur: the strip
precedes the grant in this migration by construction, with the reason written
above it.

### What the public sees, and the number that is absent

`public_profile_reviews` is keyed on `profiles.id` and joins
`profile_public_directory` — the same listing test the profile page itself is
built on — so publication cannot mean one thing to a profile and another to its
reviews, and delisting withdraws every review at once without rewriting a row.
It exposes the reviewing organization's display name, the rating, the comment,
the job and trade context and the date. No user id, no `submitted_by`, no
assignment id, no moderation state, and **no count of what is hidden** — a
"3 reviews not shown" line would publish the moderation decision by subtraction.

The rating summary has exactly one derivation (`lib/reviews/summary.ts`) shared
by the hub module, the owner page and the public section, and its empty case
returns `null` rather than `0`. A fresh professional leading with **0.0** reads as
a terrible score rather than an empty one, so the numeral does not appear until
there is one review to justify it.

### The bidi defect, and the four utilities that were never real

Building the review card turned up something wrong in Increment 11. Increment 9's
lesson had been that user-entered text needs `dir="auto"` or `truncate` clips it;
Increment 11 applied that to the portfolio card's `h3` and `p`. It fixes
clipping and introduces a second defect: `dir="auto"` sets the direction of the
**paragraph**, so a Latin title flips its whole block to LTR, `text-align: start`
then resolves to LEFT, and the title strands itself at the far edge of an
otherwise right-aligned card. `<bdi dir="auto">` isolates the *run* instead and
gives both. Eight display blocks across Portfolio, Certificates and the public
section were back-ported to it, measured at `gapFromStartEdge: 0` in both
directions for both scripts. Form controls deliberately keep `dir="auto"`, where
it sets the typing direction and is the right answer; a test pins that
distinction so a future sweep does not flatten it.

Confirming that fix turned up a second, quieter class of defect: **four semantic
utility names that do not exist and emit no CSS at all** — `bg-surface-sunken`,
`bg-warning-fg`/`text-warning-fg`, `border-line`, `text-heading`. Every use was
from Increments 11 and 12. Page titles had been rendering at inherited size and
information strips with no border, and nothing said so: `eslint`'s
`aladdin/ui-foundation` rule catches raw hex, arbitrary values and default-palette
colours, but a *misspelt semantic token is indistinguishable from a valid one* to
it. The fix was mechanical; the method matters more — every colour and type
utility in the increment's files was extracted and checked against the generated
stylesheet, 19 checked, 0 missing. **A rule validating utility names against the
Tailwind theme would have caught all four at write time, and is worth a Foundation
follow-up.**

### Composition and integration

`05-reviews.jpeg` supplied the owner page: summary rail, distribution bars, a
rating filter, and a card per review carrying the organization, the job and the
date. Three existing surfaces gained one thing each and nothing more — the poster
sees a submit action on a completed assignment, the installer's own assignment
detail states that a review may arrive, and `/home` gains a Reviews destination
under **work** rather than **account**, because a review is written by somebody
else about work, not a fact the professional maintains. `job.review.received`
joins the known notification events.

### Validation

Clean `supabase db reset`. **pgTAP 50 files, 1890 tests, PASS** — new
`49_job_reviews_test.sql` at 65 assertions, its fixture built through the real
RPCs end to end (create → publish → apply → accept → start → 100% → complete)
rather than by inserting rows, so the preconditions are the product's own.
`tsc` clean · `eslint` 0 errors (1 pre-existing) · `vitest` **1207/97** (was
1154/93) · `next build` clean.

Browser UAT in both locales at 1440px and 390px, light and dark: submit as the
poster, appearance on the installer's page and on the public profile, the filter,
suppression removing it from both public and owner views while the poster's
"already reviewed" state stands, restore returning it, and the empty state on a
professional with none. Teardown left 0 reviews, 0 portfolio items, 0
certificates and 0 storage objects.

`RUNTIME_STATE.md` is untouched and now thirteen increments behind.

---

## Session — A photograph a stranger may see, and everything else that must stay shut

**Date:** 2026-09-06 → 2026-09-08 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `af08e9f` (Increment 10)

Installer Increment 11: Portfolio and Certificates. Two metadata domains over
Increment 10's private buckets, two owner routes, one public section, one media
route, and three migrations — the third of which exists because the tests kept
finding that the boundary was wider than the design said.

### The decision that reshaped the increment

The blocking question was how a signed-out visitor reads a published photograph.
Increment 10 had fixed the object key as `<user_id>/<uuid>.<ext>`, and
`profiles.id` is deliberately NOT `users.id` — the public route is keyed on the
former, and `17_public_directory_hardening_test` asserts by name that `user_id`
stays out of every public projection.

In this stack the Next server IS the anonymous visitor: with no session it holds
the anon key, the same credential the browser has. So any function that turns a
public item id into a storage key is callable by the browser too, and an
owner-prefixed key publishes `users.id`.

Two options were put up — accept the leak, or introduce a service-role client —
and **both were rejected in favour of a third that dissolves the problem**:
change the Portfolio key itself. Portfolio keys became **opaque** (`<uuid>.<ext>`,
no owner segment, no filename, no separator at all), and ownership moved to where
it can be asked privately — `public.portfolio_items`, read by narrow
`security definer` booleans. Certificates keep Increment 10's owner-prefixed
contract unchanged, because nothing public ever resolves one.

That turned out to be **strictly stronger** than the check it replaced. Under
Increment 10 a well-formed key was sufficient to write; now a `pending` metadata
row owned by the caller must already exist, so bytes are unreachable until the
product has authorized that exact object. Both an invented key and the old
owner-prefixed shape are refused.

### Two systems, and the orders that make them converge

Postgres and Storage share no transaction, so every sequence is ordered so that a
failure at any step leaves a state that is safe and finishable:

* **ADD** `row(pending) → upload → row(ready)`. The row is the authority (S3), so
  the object identity is decided and recorded before any bytes exist. A pending
  row is invisible to the public, cannot be published (the table refuses it), and
  shows the owner an "unfinished upload" card with Finish and Discard. Finalize
  is idempotent, which is what makes a lost response recoverable rather than
  ambiguous.
* **REMOVE** `row(deleted) → remove object → purge row`. Visibility stops FIRST,
  atomically, before Storage is asked anything — the owner's own RLS policy
  excludes `deleted`, so the item leaves their list and the public projection in
  the same instant. Cleanup failure is deliberately NOT reported as a failed
  delete: telling somebody "could not delete" about an item they can no longer
  see is the one genuinely confusing outcome. Re-running the sequence finishes it.

No scheduler. Nothing pretends the two systems commit together.

### Three findings, each caught by a test rather than by reading the diff

**1. `anon` held TRUNCATE on both new tables.** Supabase's default privileges
grant `arwdDxtm` on every new public table, and **TRUNCATE is not restricted by
RLS**. Enabling row-level security without stripping the defaults first would
have left an anonymous caller able to empty both tables. Every other table in the
repo revokes it; mine didn't. The Jobs migration even documents the reason. Now
asserted by an assertion that names the hazard.

**2. The media route cached for 60 seconds.** The reasoning was that an
unpublished item vanishes from the page anyway, so only a saved media URL could
exploit the gap — which describes the exploit rather than removing it. A saved
`/p/media/<id>` is exactly what somebody keeps, and for a minute after a person
withdrew a photograph, or after the platform delisted their profile, a cache
would still be serving it. **Withdrawal that is "immediate except for a minute"
is not immediate.** Every response is now `no-store`, refusals included — a
cached 404 is the same bug pointing the other way.

**3. The public door was far wider than one signed URL.** This one took two
corrections, and both are recorded in the contract because the second reverses
the first.

The exposure probe was written asserting that an anonymous caller could enumerate
nothing and read nothing directly. **Both assertions failed.** A SELECT policy in
Supabase Storage is consulted by every read-shaped operation, so the policy
intended to let the media route mint one signed URL also permitted bucket
LISTING, a direct unsigned GET, and a HEAD disclosing size and type.

The first conclusion was that this could not be narrowed — "may sign object X"
and "may list objects" looked like one permission. **That was also wrong.**
Storage publishes the operation being performed. A temporary logging predicate
was added to the live policy and each request shape driven against the real API:

```
sign → storage.object.sign          list → storage.object.list
GET  → storage.object.get_authenticated
HEAD → object.head_authenticated_info
GET /object/sign/…?token=… → THE POLICY IS NOT EVALUATED AT ALL
```

That last line is what made the fix possible: fetching a signed URL consults no
policy, because the token is the authorization. So `20260908090001` adds one
clause — `storage.allow_only_operation('storage.object.sign')` — and the door is
now one operation wide. Listing returns empty while published objects exist,
direct GET and HEAD are refused, signing still works, and byte delivery is
untouched.

It **fails closed**: `storage.operation()` reads a GUC with the missing-ok flag,
so outside a Storage request the predicate is false. A direct SQL caller matches
nothing, and a future Storage rename would make published images go missing —
visible, and caught by the probe — never silently readable. pgTAP asserts the
false-outside-a-request behaviour directly.

### What is public, and what the public test actually is

An item is public when it is **explicitly public AND ready AND its owner's
profile is currently listed** — the third read by joining
`profile_public_directory`, the same projection the profile page itself is built
on, so publication cannot mean one thing to a page and another to a photo.
Unlisting withdraws a whole portfolio instantly without rewriting a single saved
visibility, and relisting restores exactly what the owner chose.

The browser-facing contract is `/p/media/<itemId>` and nothing else. The route
proxies bytes, so no key, no signed URL, no token and no owner id reaches the
page. The key is a **separate random uuid** — measured at chance-level hex
agreement with the item id, which matters because item ids are public by
necessity: they are the `<img src>`.

Certificates are the mirror image, and the important assertions are about things
that do not exist: no verification column, no approval state, no reviewer, no
public projection, no anon grant, no publish control in the UI. The platform
stores what a person says they hold and vouches for none of it (S2).

### Composition

`04-account-overview.jpeg` supplied the module shape — icon, title, one line of
explanation, a large number, a supporting line, one enter action — and the two
hub cards adopt it with real data: a real published photograph, and the person's
own certificate names in the place the reference puts a label row. Its stat rail,
learning card, rewards card and network card remain later increments. This is not
the Account Overview redesign; that is Increment 14.

Two visual defects were found in the browser and both fixes landed where the
cause was. The status badge fills at 15% alpha, which is right on a card and
unreadable on a photograph — it now sits on the product's own surface. And the
reorder chevrons did not mirror in RTL, because an SVG does not flip with `dir`;
`rtl:-scale-x-100` is the pattern `supply-boards` already documents as "logical,
not physical".

### Validation

Clean `supabase db reset`. **pgTAP 49 files, 1825 tests, PASS** — new
`48_portfolio_certificates_test.sql` 91/91, `47_` rewritten to 77 as the boundary
moved. **Storage harness 59/59** and **exposure probe 53/53**, both with zero
objects and zero rows left behind — both fail if anything survives. `db lint`
three warnings, all pre-existing. Generated types **+173, no pgTAP pollution**.
`tsc` clean · `eslint` 0 errors (1 pre-existing) · `vitest` **1154/93** (was
1004/84 at Increment 9) · `next build` clean · `check_doc_links` 955 links, 0
broken.

Browser UAT as a real installer through the whole lifecycle: upload → private by
default → public profile hides it and the media route 404s → publish → public
shows it and an anonymous caller fetches the exact bytes → second item → reorder,
public order follows → edit → unpublish, immediate disappearance → delete,
converged with no orphan row and no orphan object. Certificates uploaded, opened
through a real signed read, isolated on four paths, edited, deleted. Persona
downgrade: creation refused, unpublish and delete still work, files still
readable. EN and AR, 1440px and 390px, light and dark.

Every fixture was removed through the product's own convergent sequence rather
than by deleting rows — the teardown was itself a test — leaving 0 rows and 0
objects. No binary fixture is committed anywhere: the probe images are generated
in the page, and the harnesses build their PNG and PDF in memory.

One environment note worth carrying: raw `psql` runs reinstall pgTAP into
`public`, which fails test 29's Advisor rule. Same trap as Increment 9, same fix —
`drop extension pgtap cascade; create extension pgtap with schema extensions;`.

`RUNTIME_STATE.md` is untouched and now twelve increments behind.

---

## Session — Two processes guard one file, and only one of them is Postgres

**Date:** 2026-09-06 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `09a52e4` (Increment 9)

Installer Increment 10: the storage foundation `installer-jobs.md` D5 required
before any Portfolio or Certificate UI. One migration, two private buckets, six
policies, three server helpers, and **no product surface at all** — deliberately.
It answers one question: may this person put this object here, read it back, and
remove it. What an object *means* is Increment 11.

### What was there before: nothing, and one dangerous default

`storage.buckets` held zero rows and `storage.objects` had RLS enabled with zero
policies. So there was no second architecture to avoid building. But the audit
turned up the condition that shaped everything after it: **`anon` and
`authenticated` hold full INSERT/SELECT/UPDATE/DELETE table grants on
`storage.objects`** — Supabase's own default, unchanged here.

That means RLS is the *entire* boundary. There is no narrow column grant behind
it the way `profiles_update_self` has one; every policy added to that table IS
the permission, in full. Which is why the pgTAP file asserts the exact policy set
and the two absences by name, rather than only asserting that the right things
work.

### Two buckets, because the limits are enforced somewhere RLS cannot see

Portfolio and certificates want different rules — 5 MiB of image versus 10 MiB
of PDF. Supabase enforces `allowed_mime_types` and `file_size_limit` **per
bucket, in the Storage service, before Postgres is consulted**, and that point is
unreachable from a policy: `storage.objects.metadata` is NULL at INSERT time
because the row is created before the bytes land.

So in one shared bucket, "certificates may be PDFs and portfolio may not" could
only ever be stated by the application — a rule a caller can skip. Two buckets
put it where the caller cannot reach it. The six policies are also written out
one bucket at a time rather than as three policies matching `bucket_id in (...)`:
widening portfolio reads should take a second edit, in a diff that says the word
certificates.

### A key with no caller-controlled bytes in it

`<owner-uuid>/<object-uuid>.<ext>`. Both middle segments from the specified
sketch are gone — the namespace because the bucket already is one, and the
filename because a name that only ever gets displayed has no business being
load-bearing in a security check.

What is left contains nothing the caller chose. That is what turns the attack
list from things to sanitize into things that cannot be expressed: `../`,
`%2e%2e`, an empty name, an extra segment, `.jpg.html`, uppercase hex, a trailing
newline, and `<uid>9/…` are each refused by the shape or by the equality, never
by a filter someone has to remember to run. The predicate is mirrored in
TypeScript for pre-flight only, and both sides run the same table of attacks so a
divergence surfaces as a confusing failure rather than a dangerous one.

### The gate was wrapped, not widened

`app.is_professional_persona(uuid)` is revoked from every client role, and a
policy expression evaluates as the querying role — so the obvious move was to
grant it to `authenticated`. That would have handed the whole signed-in
population a persona oracle to walk over arbitrary user ids.

`app.can_create_professional_asset()` takes no argument and reads `auth.uid()`
itself, so the only question it can answer is "may I", which the caller already
knows. The predicate stays revoked, and test 47 asserts that it stayed revoked —
the assertion exists because the shortcut is the kind that looks harmless in a
diff.

### The downgrade contract, copied from availability on purpose

INSERT consults the gate. SELECT and DELETE never do. Someone who stops being a
professional keeps every file and keeps the ability to remove it — the same
asymmetry `trg_stamp_availability` already has, where claiming needs the persona
and withdrawing never does. Personal data is not held hostage to a persona value.

It is asserted structurally as well as observed: no read or delete policy
mentions the gate, so there is no expression that *could* refuse them.

And the converse: possession is not identity. A consumer handed an object
directly, bypassing every policy, is still not a professional and is still
refused the next upload. Pinned now because the inference is tempting later.

### No UPDATE policy, and that absence is the overwrite rule

Upsert needs UPDATE on `storage.objects`. Not granting it makes `upsert: true`
fail structurally rather than depending on every future caller remembering to
pass `false` — and the refusal comes back as `AccessDenied` rather than
`KeyAlreadyExists`, which is the proof that it is the missing policy doing it.
The signed upload token carries `upsert:false` inside its own signature as well.

### What the HTTP harness caught that SQL introspection would have got wrong

§23 asked for real Storage API checks rather than policy introspection, and it
was right twice:

**Every Storage refusal is HTTP 400.** The meaning is in the body —
`{"statusCode":"403","code":"AccessDenied"}` — so the status is identical for a
policy denial, a rejected MIME type, an oversized body and a duplicate key. The
first draft of the harness asserted 403/415/413/409 and "failed" eleven times
against a system that was refusing every single attempt correctly. A suite
written from the documentation would have recorded the opposite mistake just as
easily.

**`storage.objects` refuses ALL direct SQL deletion**, for every role including
superuser, via `protect_objects_delete`. The pgTAP delete section was passing for
the wrong reason: it "proved" that another professional's delete removed nothing,
and it was right by accident, because nobody's delete removes anything through
SQL. That section now asserts the trigger and says where the real proof lives;
deletion authority is established over HTTP, which is the only path that exists.

Two smaller findings worth keeping. A refused *read* is indistinguishable from a
key that never existed — the SELECT policy hides the row so completely that
Storage answers `NoSuchKey` — so there is no existence oracle on that path. The
*delete* path does distinguish the two, which is recorded rather than glossed
over: reaching the distinction requires already knowing a full random object id.

### No metadata table, and a test that keeps it that way

Ownership is the key, namespace is the bucket, lookup is the immutable path,
lifecycle is Increment 11's. A registry would duplicate all four and then need
its own consistency rules to keep the duplicate honest. A test asserts the server
module exports exactly three helpers, so a title, caption, issuer or visibility
field cannot quietly arrive here first.

Nothing was added to `public`: the generated types diff is **zero lines**.

### Decisions closed at approval, recorded in §12.1

Four Increment 11 product decisions were taken when this was approved, and they
are written into the contract rather than left in a conversation:

* **S1** portfolio items are private by default and become public only through
  explicit metadata visibility — **the bucket stays private either way**, so
  "public" means a server mints a representation, never that a guessed URL works;
* **S2** certificates stay owner-private self-declared evidence for the Pilot,
  with no invented verification authority and no public read path;
* **S3** metadata is the product authority and deletion **converges** — Postgres
  and Storage are two systems, no transaction spans them, and the idempotent
  delete helper is what lets a retry finish instead of jam;
* **S4** public portfolio is JPEG/PNG/WebP only, and deeper byte/malware scanning
  is deferred as separate server hardening.

S1 and S2 required no change to anything built here, which was the point of
refusing to widen anything: the public path S1 wants is a new server helper over
an unchanged private bucket, and S2's rule is an absence that already exists.

The signature check in `lib/storage/professional-assets.ts` is described
consistently everywhere as what it is — a correctness net running in the caller's
own process, catching a script named `.png` that the bucket's type list cannot.
It is never called a boundary. S4 is what makes that honest rather than a gap.

### Validation

Clean `supabase db reset`. **pgTAP 48 files, 1724 tests, PASS** — new
`47_professional_asset_storage_test.sql` is 67/67. Storage API harness **43/43,
0 objects left behind** (it fails if any survive). `db lint public,app` three
warnings, all pre-existing. Generated types **0 lines changed**. `tsc --noEmit`
clean · `eslint src` 0 errors (1 pre-existing warning) · `vitest` **1061/86** (was
1004/84) · `next build` clean with no new routes · `check_doc_links` 955 links,
0 broken.

No binary fixture is committed: the PNG and PDF the harness uploads are generated
in memory, and the one persona it changes is restored in a `finally`. Nothing was
seeded — there are no fake portfolio items and no fake certificates, because
there is nothing yet for them to mean.

`docs/database/media-storage.md` **will not exist**. What shipped is deliberately
narrower than the name that section promised: chat attachments and job-progress
photos have different relationship semantics — a chat attachment is readable by a
conversation, not by an owner — and designing their authorization alongside this
one would have meant guessing at it. The three references that named that file
now say so.

`RUNTIME_STATE.md` is untouched and now eleven increments behind.

---

## Session — A hundred percent is a claim, and somebody else answers it

**Date:** 2026-09-05 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `4e5690b` (Increment 8)

Installer Increment 9: the work itself. Two routes for the professional, one
panel added to the poster's existing job detail, three notifications, and one
migration. No status was added, no lifecycle rule moved, and the four Increment 6
RPCs kept their signatures.

### Three policies, one projection

`job_assignments` was already readable: `job_assignments_select_installer` is a
flat column check, `installer_user_id = auth.uid()`, with **no status
predicate**. So was the progress history — `job_progress_select_parties` admits
both parties, which is why this increment added no seam for it and both sides
read the base table through one query function.

What was not readable was everything that makes an assignment a RECORD rather
than a pile of uuids, and three separate policies each withheld a different piece
of it:

* `organizations_select_member` — an installer is not a member of the
  organization that hired them, so "who am I doing this work for" was
  unanswerable on the very surface built to answer it;
* `trades_select_active` — a retired trade vanishes, and §24 needs the label the
  work was agreed under;
* `jobs_select_assigned_installer` — carries `and a.status <> 'cancelled'`, so
  the moment an engagement is cancelled the installer loses the job behind it,
  while §19 needs exactly the opposite.

Each of those is a rule worth keeping. Relaxing the trades one puts retired
trades back in the "post a job" dropdown, which is the defect Increment 7 fixed;
an installer policy on `organizations` would hand the whole pool every future
column of the tenancy root. So `my_job_assignments` answers past all three
without widening any, and a projection names its columns where a policy names
none and grants every column added after it.

`site_address` is the one column with a condition on it. §11 releases the address
to the professional who holds the work, which is what
`jobs_select_assigned_installer` already encodes, cancellation clause included.
The projection **reproduces** that clause rather than relaxing it — live, the
address is theirs; cancelled, it is withheld again and the rule is stated on
screen instead of leaving a blank. The projection is never wider than the policy
it reads past.

### The line this increment exists to draw

The installer reports; the organization confirms. Everything else is arrangement
around that one fact.

At 100 percent the assignment stays `in_progress`, the job stays `awarded`,
`completed_at` stays null, and the installer's page says *"You reported this work
as finished — there is nothing further for you to do here."* It is derived
presentation, not a fifth `job_assignment_status` and not a persisted
`waiting_review`: the moment a claim is stored as a state, it starts looking like
a state its author had the authority to set.

And the absence of a completion control is **structural rather than rendered**.
`assignment-forms.ts` exports four actions and none of them completes for an
installer; there is no RPC an installer surface could call if it tried. That is
why the §16 test can pass — it asserts a capability that does not exist, not a
button that is merely hidden. pgTAP asserts the other half: the installer is
refused with 42501 at 100 percent, twice.

### An organization recipient that is not a coin flip

Increment 8 RESERVED `job.application.submitted` → the poster, because
`app.notify_org` needs a capability and the domain offered two equally plausible
ones. That reservation still stands, and test 42 now asserts it by name.

The three events wired here are different, and the reason is structural rather
than editorial: **`job.post` has no role anywhere in the assignment lifecycle.**
`app.can_post_job` is consulted by `job_create`, `job_update`, `job_publish`,
`job_close` and `job_cancel` — and by none of the four assignment RPCs. Every
action a recipient could take in response to these notices requires `job.manage`
and refuses `job.post`. So the capability is read off the action the notice asks
somebody to take; a notice delivered anywhere else would be one its reader is
refused permission to act on.

`job.assignment.ready` fires on the **transition** to 100, not the value —
`job_progress_add` compares against the row it read before its own update, so an
installer correcting a note at 100 announces it once. `job.assignment.cancelled`
carries the same two params on both of its paths, because the organization's copy
cannot name the organization to itself and a body referencing `{org_name}` would
render a hole on one branch.

### What the guards found that review would not have

**`server-only` caught a client component reaching into database code.**
`readyForCompletion` and `featuredAssignment` had been filed under
`server/queries` beside the reads, and the import threw the moment
`/home` needed them. The guard was right and the fix was not to mock it away:
none of that is server code. Every consumer is a client component, so the state
model moved to `lib/work/assignment-state.ts` — the same split
`lib/nav/personal-modules.ts` already makes, and for the same stated reason.

**A browser found `1%` where the data said 100.** `formatPercent` already divides
by 100; four call sites divided again. No test looked at the rendered string —
they all asserted the aria value, which was correct. The regression tests now
assert the string, which is the thing a person reads.

**`table-layout: auto` meant `RecordCell` could never truncate.** The visual
review found the history list clipping its own action column: the table wanted
966px in a 785px container. `RecordCell` carries `truncate` by design, but a cell
sized to its content has nothing to truncate against, so a long title silently
pushed `Agreed`, `Assigned` and `View` into the horizontal scroller — the reader
had to scroll sideways to discover an action existed. `DataTable` gained an
opt-in `grow` column flag (`w-full max-w-0`), which is what makes that existing
`truncate` fire. No existing table changes shape.

The same review found an English job title rendering as `…aircase cladding -
Fifth Settlement` in the Arabic workspace. An LTR string inside an RTL container
inherits RTL, so `text-overflow` clips the front and the reader loses precisely
the words that identify the record. `dir="auto"` on user-entered text resolves
direction per value from its first strong character — verified in the browser as
`englishTitle: ltr, arabicTitle: rtl, pageDir: rtl`, in the same node. It is
deliberately not conditional on locale; a component branching on locale would be
the Arabic-only rule the UI contract forbids.

### Composition, and what the reference could not have

`03-my-work.jpeg` supplied the skeleton and the weighting: header, status strip,
one dominant current-work block, the historical list, a context column. What it
also supplied — a project photograph, a documents-and-files panel, a quick-tools
rail, client star ratings, "completed this month", and four tabs with no
`job_assignment_status` behind them — has no authority anywhere in this product,
so it is absent rather than postponed.

The photo slot is not left empty, because an empty designed slot is worse than
none: it carries `Monogram`, which is the answer this codebase already gives to
"there is no image pipeline yet". The list shows **one** status chip per row like
the reference does; the readiness marker lives on the featured block, the detail,
the poster's panel and `/home`, and repeating it in the history list was what
cost the row its action column. The organization folded into the identity cell
because the monogram beside it was already the organization — a column naming the
same thing twice.

The page hierarchy survives empty data, which was the point of §22: with no
assignments at all it still renders its header, its tabs, a designed featured
empty state and a summary reading honest zeros. Content disappears; structure
does not.

### Validation

Clean `supabase db reset`. **pgTAP 47 files, 1657 tests, PASS** — new
`46_job_assignment_work_test.sql` is 65/65. The full-suite run earned its keep
again: it caught test 29's Advisor rule (pgTAP recreated in `public` rather than
`extensions` by raw psql runs) and test 42's notification claim, now an
allow-list that fails the moment a sixth event appears without anybody deciding
it should. Neither was reachable from the files this increment added.

`db lint public,app` three warnings, all pre-existing. Generated types **+32
lines, 0 deletions**. `tsc --noEmit` clean · `eslint src` 0 errors (1 pre-existing
warning) · `vitest` **1004/84** (was 898/78) · `next build` clean ·
`check_doc_links` 950 links, 0 broken.

Browser UAT as both parties, every state through a real RPC: apply → award →
bridge into My Work → start → 25 → 60 → 100 → verified against the database that
the assignment was still `in_progress` with the job still `awarded` → poster
confirmed, completing assignment and job in one transaction → a second engagement
cancelled by the installer, returning the job to `open` and notifying the
organization with the reason. Arabic RTL and 390px verified on every surface;
light and dark on three. Two visual defects were found this way and fixed, and
both fixes landed in the Foundation rather than on the page.

Every fixture either run created was removed afterwards — five jobs, five
applications, five assignments, seven progress reports and thirteen
notifications — and the append-only audit rows were left where they are.
`public.job_progress_updates`' delete guard was lifted explicitly for each
teardown and restored immediately; `public.audit_log` was never touched, and
**29 job audit rows remain**.

`RUNTIME_STATE.md` is untouched and now ten increments behind.

---

## Session — An application outlives the opening it was for

**Date:** 2026-09-03 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `db1d983` (Increment 7)

Installer Increment 8: the other side of Jobs. Three routes — discovery, one
opening, and the caller's own candidacies — plus apply, withdraw, re-apply, the
two applicant-facing decision notices, and one entry point on `/home`. Two
migrations, both additive, and no lifecycle rule changed anywhere.

### What the read model already answered, and what it did not

Increment 6 shipped both installer-facing seams, and they were better than
expected. `open_job_opportunities` already carries `poster_org_name`, so §19's
"safe posting identity" needed no new projection at all. Both seams join
`public.trades` **inside** a definer, so `trades_select_active` never sees them
and a retired trade keeps its historical label on this side for free — §20 was
satisfied before the increment started.

What was missing was smaller and sharper. `my_job_applications` carried the LIST
half of a job: title, trade, amount, city, status, poster. Not the description,
the duration, the dates or the publication time. Those are exactly what somebody
re-reading their own candidacy needs — *what did I say I would do, and by when* —
and without them the installer's detail route would have had to render two
different pages depending on whether the opening happened to still be
discoverable today.

So the projection gained five columns, every one of them ALREADY public in
`open_job_opportunities` to any authenticated caller, and here narrower still:
only on the caller's own application, resolved from `auth.uid()` inside the
definer with no parameter to point elsewhere. Still no `site_address`, no
competing application, no poster-side management column. DROP + CREATE rather
than CREATE OR REPLACE, because the reader's `RETURNS TABLE` signature changed —
which destroys the ACL, so every grant is reasserted verbatim and test 45 asserts
that no client role can write through the view.

### The two ways a job stops being readable, and only one of them is right

An opening leaves discovery five ways: awarded elsewhere, closed, cancelled,
completed, or its poster's verification lapsing. The last of those rewrites no
row at all — the live join simply stops matching — which is why it is the one the
test uses. In every case the OPENING should disappear from the board and the
APPLICATION should not, and the detail route makes that structural: it reads
discovery first and falls back to the caller's own record, so a job somebody
applied to never 404s on them, while a job they never applied to and which has
left discovery is an ordinary not-found. Which of the two seams answers IS the
state.

### O5, on the side where it would have been easiest to lose

The reference board leads with "96% matched to your skills" on every card. The
temptation on this surface is not a policy — it is a default: show me jobs in my
trades first, and the restriction the database refuses to make arrives as a
convenience.

So the trade filter is unset by default, nothing on the route reads
`user_trades`, and the note under the toolbar says so in the reader's own words —
placed there because the trade dropdown is the one control a professional could
reasonably mistake for a rule about who is allowed to apply. Asserted three ways:
structurally (neither installer-facing projection mentions `user_trades`), at the
query layer (no trade filter unless the reader picked one), and behaviourally —
Mahmoud, whose only declared trade is `electrical`, sees a `marble_granite` job
and applies to it successfully. The browser pass ran the mirror image: Sayed,
marble only, applied to an electrical villa job and was accepted into it.

### Re-applying is the same call, not a second one

`job_application_submit` returns a caller's own `withdrawn` row to `submitted` on
the SAME id. So there is one wrapper, one action and one dialog for both, and a
test asserts the second call is the first one. A separate "reapply" path would
have been a second writer of one row, kept in step by hand.

The UI offers it only where the RPC would allow it, which needs a fact the
application row does not hold: `job_status = 'open'` is visible there, the
poster's CURRENT verification is not. So the tracking page asks discovery which
of its jobs are still live — one small read for the whole page — and the
withdrawn-and-no-longer-reapplicable case gets its own sentence rather than
sharing a grey badge with rejection. "You withdrew this" and "you were not
selected" are different facts about the same person.

### Telling somebody a decision was made about them

Two events, `job.application.accepted` and `job.application.rejected`, through
`app.notify` rather than `app.notify_org` — every recipient is named by
`job_applications.applicant_user_id`, so there is no fan-out, no capability
lookup and no owner fallback, because there is no set to choose from.

**The award notifies the losers too.** `job_application_accept` auto-rejects
every other live candidacy in the same statement; those people were rejected as
surely as one rejected by hand. The bare `UPDATE` became a `FOR ... RETURNING`
loop so the recipients come from the write itself rather than from a second query
that could disagree with it. Telling the winner and silently closing four other
applications is the partial state this architecture exists to prevent.

**`job.application.submitted` → the poster stays RESERVED.** `app.notify_org`
delivers against a capability and this domain has two plausible answers —
`job.post`, whoever authored the opening, and `job.manage`, whoever decides its
applications — with nothing in the approved contract choosing between them.
Guessing would install a recipient rule by accident. Test 42's old blanket "this
increment emits NO notification" was superseded by two stronger claims: the only
Jobs notifications are the two applicant-facing decisions, and every one of them
reached the applicant it was about.

### One English sentence that had to stop being one

The auto-rejection writes `decision_reason = 'the job was awarded to another
applicant'` — our sentence, not the poster's, stored in a column the applicant
reads. Rendering it raw shows an Arabic reader English, and makes it look like
the organization typed it. The status layer now swaps that one constant for a
translated line, as a named export rather than a literal buried in a component,
so the day the database sentence changes there is one place to change with it.
Storing a key instead would be better and is an Increment 6 authority change, not
this increment's.

### An Arabic label that was right on one surface and wrong on the other

The four `applicationStatus` labels are the single status layer §22 asks for, and
Increment 8 is the first time they appear on both sides. The Arabic ones had been
written for the poster's queue, describing somebody else: `سحب طلبه` — *he
withdrew his application* — read as a sentence about a third party the moment it
sat on the reader's own row. Found in the browser, in Arabic, not by a test. They
are now states named as states, which is correct from either side.

### Foundation

No gap. `ButtonLink`, `BriefcaseIcon` and the shared status badges arrived in
Increment 7; `FilterBar` was already the canonical list toolbar and took search
plus the three selects unchanged; `ConfirmDialog`'s `formAction` render-prop
carried both the apply dialog with its note field and the withdrawal. The one
composition decision worth recording is that the trade filter offers the ACTIVE
catalog while the governorate filter offers the values that actually exist —
`jobs.governorate` is free text a poster typed, not a key from the onboarding
location catalog, so labelling it through `t()` would have printed the message
path.

### Validation

Clean `supabase db reset`. **pgTAP 46 files, 1591 tests, PASS** — new
`45_installer_job_experience_test.sql` is 33/33, and 1591 − 1557 is that file
plus the one assertion test 42 gained. The full-suite run is what caught both
regressions this increment produced: test 29's Advisor rule, failing because I
had recreated pgTAP in `public` rather than `extensions` while regenerating
types, and test 42's superseded notification claim. Neither was reachable from
the three files the increment added.

`db lint public,app` reports three warnings, all pre-existing. Generated types
**+5 lines, 0 deletions**. `tsc --noEmit` clean · `eslint src` 0 errors (1
pre-existing warning) · `vitest` **898/78** (was 809/73) · `next build` clean ·
`check_doc_links` 950 links, 0 broken.

Browser UAT as Sayed, every state through a real RPC: apply off-trade with a
note → withdraw → re-apply, verified against the database as the SAME row id and
the SAME `created_at` → declined with a reason on one job → awarded on another,
with the auto-closed rival notified in the same transaction. Arabic RTL with no
raw enum, key or message path; 390px with no overflow and the parent Jobs entry
lit on a nested route in the bottom rail; dark with zero inline colours in
`main`. Every fixture the run created was deleted afterwards — two jobs, three
applications, one assignment and three notifications — and the append-only audit
rows were left where they are.

`RUNTIME_STATE.md` is untouched and now nine increments behind.

---

## Session — Whoever applied has already told you who they are

**Date:** 2026-09-03 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `f5f2878` (Increment 6)

Installer Increment 7: the organization's side of Jobs, end to end — list,
create, edit, publish, applicants, award, decline, close, cancel. Five routes on
the Increment 6 authority, and three migrations that exist because building the
screens found three things the database could not answer.

### The read model had no poster in it

Increment 6 shipped `open_job_opportunities` and `my_job_applications` — both
installer-facing — and nothing for the party who actually has to decide.
`installer-jobs.md` §11 already named the fix: *"application views join
`profile_public_directory` and read nothing else."* That instruction cannot be
implemented. The projection exposes `profiles.id` and deliberately never
`user_id`, so there is **no key** to join an application to it; and the join it
describes is an INNER one against `public_profile_status = 'listed'`, a column
whose default is `hidden` — 17 of 26 profiles today. A poster-side queue built
that way renders most applicants anonymous, and the poster chooses who to hand
work to from a list of blanks.

`job_applicants` returns identity for **every** applicant instead. The argument
is not convenience: somebody who applies to your job has, by that act, told you
who they are, which is a party-to-a-transaction fact rather than a directory
lookup. It still returns no contact channel, no address, no travel radius, no
private lead-time preference, no `consumer_*` column and no `applicant_user_id`
— those are what §11 protects, and each remains unreachable. Recorded as §3.6
departure 10, and it is the milestone's **only widening**; the other nine narrow.

### Retirement kept the row and lost the word

`jobs.trade_id` is `not null references public.trades on delete restrict`, so
retiring a trade is designed to leave every historical job intact. It does — in
the table. What it did not leave intact was the poster's ability to **read** the
label: `trades_select_active` withholds inactive rows, so the embed the list page
uses returns null and a job the organization posted itself, in a trade it chose
itself, shows a dash.

The one-line fix would have been another permissive policy on `public.trades`,
and it is the wrong line. **A policy widens the table; it does not answer the
question.** Every `from("trades")` in the product would start returning that row,
`loadTradeCatalog()` included — which is the vocabulary the "post a job" dropdown
renders. The retired trade would come back as a *selectable option*, the exact
outcome `trades_select_active` exists to prevent, leaving only the RPC's refusal
between a poster and picking it.

So `job_trade_labels` answers one question and no other: for jobs the caller's
organization posted, which trade were they posted in, and is it still active.
`44_job_trade_labels_test.sql` asserts the non-widening **in the same session
that successfully reads the historical label** — the same caller still sees zero
retired rows in `public.trades`, and `job_create` still refuses one.

### Reading a retired label is not permission to post in one

Restoring the label exposed the second half: `job_update` resolved `p_trade_key`
against `is_active` and refused anything else, so a poster whose job sat under a
retired trade could not fix a typo in the title. The whole edit was refused
because of the value it was *retaining*.

Retirement must stop a trade being **chosen**, not freeze the job that already
holds one. Resolution now happens in two steps — resolve the key at all, then
accept an inactive one **only when it is the id this job already holds**. Another
job's retired trade, even one the same caller can read a label for, is still
refused. `job_create` gets no exception because there is nothing to retain, and
`job_publish` keeps refusing: editing is private housekeeping, publishing is the
moment the job enters the installer pool, and the platform's decision to withdraw
a trade has to bite somewhere.

The post-application freeze survives untouched, and by construction rather than
by care: its check compares the **resolved id** against the **stored** one, so
retaining a retired trade is not a change and passes, while switching off one on
a job with applications is refused exactly as before. §C3 asserts both halves.

In the form this is one option outside the catalog — the trade *this* job holds,
when retired, labelled as no longer offered. The catalog stays active-only, so
creating still cannot reach a retired trade. Without the option the select had
nothing matching its own value, submitted blank, and the edit was refused for a
field the poster never touched.

### Where affordance stops and authority starts

Three places the UI declines to offer something the server would refuse: the
offer and trade freeze on the form once applications exist; the edit route
renders a notice rather than a form past `open`; and **an awarded job has no
Cancel button at all**, because Increment 6's review removed `awarded → cancelled`
and the two-step rule is stated instead. None of the three is a check. The server
decides all of them, and a test asserts the button's absence rather than the
refusal's presence.

Capabilities are honoured separately even though the nav gate is their union:
`job.post OR job.manage` is what makes the module reachable — either alone is a
reason to be there, and gating on `job.post` would hide the queue from the person
whose whole job is working it — but a `job.post` holder sees Publish and Edit and
no Award, and a `job.manage` holder the reverse. Verified live as Laila, who
holds `job.post` and not `job.manage`.

Nothing invents data. No fit score, no ranking, no recommendation, no match
count, no contact detail — none has any backing in this repository, and a number
the product invented is one the poster would then trust. A test asserts their
absence.

### Two Foundation gaps, closed in the Foundation

No briefcase glyph existed; reusing the wrench would have made "people we could
hire" and "work we are hiring for" the same icon on a collapsed rail. And there
was no canonical link-styled-as-button, because until now no surface had a
primary *go and do this* destination — `<button onClick={router.push}>` would
have cost middle-click, open-in-new-tab and the correct role. `ButtonLink` shares
one `controlClass` with `Button` so the two cannot drift, and is written up as
`UI_CONTRACT.md`'s R6 worked example.

### Three things found by running something other than the unit tests

**The browser found `EGP 22,500.00 EGP`.** `formatMoney` already emits the
currency and the code appended it again, at three sites. No test looked at the
rendered money string. There is one now.

**Raw `psql` found that `43` never ran to completion.** Its `results_eq` compares
`column_name` — collation `C` — against a bare literal under this database's ICU
default, which raises *"could not determine which collation to use"* and **aborts
the transaction** rather than failing one assertion. It had been validated by
grepping for `not ok`, which an aborted run never prints. Two real defects were
hiding behind that: `plan(21)` for a file with 22 assertions, and a grant
assertion counting the view *owner's* privileges, which could never have passed.
The same discovery caught ~147 lines of pgTAP function/view pollution baked into
`database.types.ts`, because `create extension` commits outside the test
transaction — regenerated with it dropped, and the diff is now the two views and
nothing else.

**The full suite found an O5 guard the three new files could not.**
`41_trade_taxonomy_test.sql` asserts that the only functions mentioning
`user_trades` are its writer and the public projection — and `app._job_applicants`
reads it to put trades on an applicant card. The allow-list gained that one name,
with the reason: it projects trades for **display** and filters nothing by them,
and `43` §C asserts the absence of a trade filter separately. The guard still
bites — writing a name into that list is a deliberate act someone has to defend
in review, which is exactly what it is for.

### Validation

Clean `supabase db reset`. **pgTAP 45 files, 1557 tests, PASS** — new
`43_job_applicants_projection_test.sql` 22/22 and `44_job_trade_labels_test.sql`
30/30, and 1557 − 1505 is exactly those two files, so no existing count moved.
`db lint public,app` reports three warnings, all pre-existing and none from these
migrations. Generated types **+28 lines, 0 deletions** — the two views, nothing
else. `tsc --noEmit` clean · `eslint src` 0 errors (1 pre-existing warning) ·
`vitest` **809/73** (was 713/67) · `next build` clean · `check_doc_links` 950
links, 0 broken.

Browser UAT against the real RPCs, twice. The lifecycle: draft → publish → two
real applications → decline with a required reason → award, with the DB
confirming the job awarded, one scheduled assignment at the frozen amount, and
the declined applicant's own reason preserved. Then retirement: the label
surviving on list and detail, the create dropdown excluding it, an edit saving
while retaining it, and Publish still refusing with *"That trade is not
available."* Arabic RTL clean with no raw enum, key or message path; 390px with
no overflow; dark with zero inline colours in `main`. Every fixture the runs
created was removed afterwards — the database is back to two seeded jobs and no
applications, because a state that arrives by INSERT proves nothing about the
authority meant to produce it.

`RUNTIME_STATE.md` is untouched and now eight increments behind.

---

## Session — One organization, one person, and no client allowed to write it

**Date:** 2026-09-02 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `4df3e64` (Increment 5)

Installer Increment 6: the Jobs domain, database only. Four tables, three enums,
thirteen RPCs, two read projections, no UI. It is the authority Increments 7, 8
and 9 will sit on, built ahead of them so the interfaces have nothing to decide.

### Why it does not reuse the commerce domain next to it

An RFQ, a quotation and an order are all **organization ↔ organization**: two
tenants, two capability sets, and every policy is a pair of org predicates. A job
is **organization → PERSON**, and the person's authority is `auth.uid()` and
nothing else.

Reusing `orders` would have given the installer an org-shaped seat at a table
where they have no organization, and the first refactor that noticed the symmetry
would have collapsed the installer's read of their own work onto an org-membership
check — silently handing installers tenant reads. `job_assignments` carries
`installer_user_id` and `poster_org_id` as flat denormalised columns for exactly
that reason: every installer-side policy is a column check against `auth.uid()`,
and none of them can be rewritten into an org predicate without the rewrite being
obvious.

### Four rules made structural rather than conventional

**No client DML.** Not one `INSERT`/`UPDATE`/`DELETE` grant on any of the four
tables in any role, `service_role` included, and no non-`SELECT` policy. RLS
answers who may READ a row; the RPCs answer who may CHANGE it, and the two
questions never share a predicate.

**Verification suppression is derived.** Nothing caches `is_verified` onto a job.
Discovery and new applications join the live organizations row, so a lapse hides
a job with no row rewritten and a restore brings it back with no backfill. A
denormalised copy freezes the wrong answer in *both* directions — a suppressed
job staying visible, a re-verified org's jobs staying buried — and neither shows
up until somebody complains. The test revokes verification and watches discovery
change while `status` stays `open`.

**One active assignment, at the storage layer.**
`ux_job_assignments_active_job unique (job_id) where status <> 'cancelled'`. The
accept path locks the job, but the *guarantee* is the index: two concurrent
accepts collide on it and the second transaction rolls back whole. The test
attacks it with a raw INSERT rather than through the RPC, because an RPC-level
check is only as good as the next RPC.

**Trade is never authority (O5).** Asserted three ways structurally — no policy in
the domain mentions `user_trades`, no Jobs function reads it, no Jobs function
writes `public.trades`. This is the most likely regression in the whole milestone
*because it feels like a feature*: "only show matching jobs", then "only let
matching installers apply", and O5 is gone without a line of it being discussed.
By the time it fails behaviourally a real installer has already been refused work
they were allowed to take. Behaviourally too: Mahmoud, whose only declared trade
is `electrical`, applies to a `marble_granite` job and succeeds.

### The authority line that matters most

**The installer cannot complete their own work record.** They start, they report
progress, they reach 100 — and the assignment is still `in_progress` and the job
still `awarded`. 100% is a *claim of readiness*; the posting organization
confirms it. A rating anchored to work the rated party declared finished about
themselves is not evidence, and this is the increment where that becomes true
rather than intended.

### Nine departures from the approved spec, all deliberate

Recorded in a new §3.6 of `installer-jobs.md`. Seven are narrowings; two are the
review's own lifecycle corrections.

The one worth arguing about is **"active org"**. §10.3's table says `job_create`
requires an active organization, and read literally that means
`status = 'active'` — which would lock an organization in `pending_verification`
out of drafting, the exact line the same section says verification must never
cross. Everywhere else in this repository `status = 'active'` is a
DISCOVERABILITY condition; the public directory and the catalog projection both
use it that way. So drafting is gated on *not suspended, not archived*, and
publishing keeps `is_verified AND status = 'active'`, because that IS the
discoverability gate. The document now says so.

The others: no client write grant (narrows §10.4); the offer freeze extended to
`trade_id`, because an applicant consented to an amount FOR A TRADE; three
lifecycle guards as triggers, which catch us rather than a browser; the agreed
compensation snapshotted onto the assignment; two extra audit actions; and a
second read seam, `my_job_applications` — needed because the `jobs` policy
deliberately excludes applicants (the base row carries `site_address`, withheld
until assignment), which leaves an applicant's own candidacy as a `job_id` and a
status rather than a record a person can read.

### The two corrections review asked for

**`awarded → cancelled` is gone.** An awarded job has somebody holding live work
on it. Cancelling the opening in one step ended that engagement as an *unnamed
side effect* — closed by a path the poster never aimed at the installer, and the
reason left on the record was the one written about the job, not about the work.
Now `job_cancel` takes `draft` and `open` only, the trigger refuses the edge, and
the block inside `job_cancel` that used to cancel the live assignment is gone
because it became unreachable. The poster ends the engagement first, with its own
required reason, which returns the job to `open`; the opening is cancelled from
there. Two acts, two reasons, in the order the installer experiences them.

**A withdrawal is reversible; a decision is not.** `job_application_submit`
returns a caller's own `withdrawn` row to `submitted` on the **same id**,
atomically under the job lock — but only after passing the same two gates a
first-time applicant passes, so withdrawing is never a door back in that a
newcomer does not have. `created_at` survives, because it is the honest record of
when this person first put their name forward. `accepted` and `rejected` return
**unchanged**, not one column touched: both are the poster's decisions, and
reversing either from the applicant's side would let someone re-enter a
competition they had already been told they lost.
`app.job_applications_status_guard()` permits exactly one edge out of a
non-`submitted` state, so a future write path cannot widen it by accident.

### A deadlock caught by reading rather than by testing

`job_cancel` locked jobs → assignment; `job_assignment_cancel` locked assignment
→ jobs. A cycle, and two concurrent cancels would have deadlocked. No test would
have found it — pgTAP runs one transaction. Every write path that touches two
rows now takes `jobs` first, and the ones that need the child's `job_id` read it
unlocked, take the job lock, then re-read the child `for update`.

### Validation

Clean `supabase db reset`. **pgTAP 43 files, 1505 tests, PASS** — new
`42_jobs_domain_test.sql` is **162/162**, and 1505 − 1343 is exactly the new file,
so no existing count moved. Generated types **+464 lines, 0 deletions**, and
byte-identical after the two corrections (no signature or enum drift).
`tsc --noEmit` clean · `eslint src` 0 errors (1 pre-existing warning) ·
`vitest` 713/67 unchanged · `check_doc_links` 950 links, 0 broken.

Fixtures are two jobs and one capability grant, and deliberately no applications,
assignments or progress: those are LIFECYCLE, and a state that arrives by INSERT
proves nothing about the authority meant to produce it. Laila holds `job.post`
and NOT `job.manage`, so the difference between the two keys is testable rather
than assumed.

### One trap worth knowing

`create extension if not exists pgtap` sits **before** `begin;` in every test
file, so it commits. Running a single test manually with `psql -f` therefore
leaves pgTAP's own `tap_funky` and `pg_all_foreign_keys` views in `public` — and
test 29's "no SECURITY DEFINER view in public" sweep then flags them. It cost a
real investigation into a failure this increment had not caused. **The suite is
only trustworthy from a clean reset.**

### Unfinished work, explicitly

- **`NAV_CAPS` does not yet list `job.post` / `job.manage`**
  (`frontend/src/lib/nav/modules.ts`). Correct for a database-only increment, and
  Increment 7 needs it or the poster module dead-ends.
- **Reviews (§6) are not implemented** — Increment 12. The seam is
  `job_reviews.assignment_id → job_assignments.id` and needed no column here.
- **No notifications.** `ck_notifications_event_type_known` is untouched and a
  test asserts zero `job%` notification rows. The seams a later increment would
  wire are `job.application.submitted` to the poster and `accepted`/`rejected` to
  the applicant.
- **The Installer aftercare pass and the site-wide UI consistency audit remain
  deferred**, unchanged from the previous entry. `UI_CONTRACT.md` stays in force
  for new UI; this increment had none.
- **`RUNTIME_STATE.md` is still not refreshed**, now seven increments behind.
  Untouched here by instruction.

### Two things worth knowing next time

- **A lock cycle is invisible to a test suite that runs one transaction.** The
  only way it was going to be found was by reading the four write paths together
  and asking which order each took its locks in.
- **A literal reading of a spec can contradict the spec.** `status = 'active'`
  appears in §10.3 and would have broken the rule stated two paragraphs above it.
  The fix was to look at what that literal means everywhere else in the
  repository — discoverability, every time — rather than to implement the
  sentence.

---

## Session — Two vocabularies for one claim, and only one of them was authority

**Date:** 2026-09-01 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `143229f` (UI Foundation v1)

Installer Increment 5: the trade taxonomy moves out of free text and into the
database. Reference data, a join table, one atomic writer, and the three surfaces
that already showed a specialty now show the canonical one. No Jobs.

### The model

`public.trades` is a vocabulary: `id` (the future `jobs.trade_id` target), a
`key` shaped by a check constraint, `is_active`, `sort_order`. **No `name_en` /
`name_ar`** — labels stay in the i18n catalogs keyed by `key`, so a translation
fix is a frontend change and not a migration. `public.user_trades` is
`(user_id, trade_id)` with `is_primary`, and no `organization_id`: a trade is a
person's practice, and hanging it off a membership would delete it the day an
employment ended.

Seven seeded keys — `kitchens_doors`, `plumbing`, `electrical`, `hvac`,
`gypsum_paint`, `tiling`, `marble_granite`. The first five are
`SPECIALIZATIONS.installer_technician` verbatim. The last two exist because the
demo world already contains them and the five cannot express them.

### The write path is narrower than the approved spec, deliberately

§4.3 of `installer-jobs.md` specified "a user reads and writes their own rows".
What shipped grants **no client write at all**, in any role, with no write policy:
`public.user_trades_set` is the only writer.

A client able to write directly would perform one user gesture as three
statements, and between any two of them the selection is a state nobody asked for
— zero primaries mid-swap, or two if the calls landed out of order. Removing the
grant makes that unreachable rather than merely unlikely.
`ux_user_trades_one_primary unique (user_id) where is_primary` is the backstop
underneath it. The doc is reconciled to what shipped, with the reasoning, rather
than left describing a design that was reconsidered.

The RPC takes **no user id**: acting on someone else is not a refused request,
it is an unexpressible one. Authority is `app.is_professional_persona` —
Increment 2's predicate, unchanged — which reads `users` and
`individual_onboarding` and **never `user_trades`**, so holding a trade can never
be what proves you were allowed to hold it.

It is also narrower than `individual_save_professional`, which additionally admits
a caller mid-onboarding on the strength of their selected TRACK. A track carries no
concrete type, so there is no answer yet to which trades apply.

### One primary, and a rule for every case

Exactly one primary whenever the selection is non-empty, none when it is empty.
A null `p_primary_key` means "you choose", and the choice is the FIRST submitted
key — an order the caller controls and can therefore predict.

| Case | Result |
|---|---|
| first trade selected | it becomes primary |
| primary changed | named key is primary; the previous one stays selected |
| primary removed | the first REMAINING key becomes primary |
| non-primary removed | the primary is untouched |
| duplicates submitted | deduplicated; converges rather than erroring |
| empty or null set | every row deleted; no primary |
| unknown key | `22023`, whole call refused |
| inactive key, not held | `22023` — cannot be NEWLY selected |
| inactive key, already held | **accepted** |

The last row is the one worth arguing about. Refusing every inactive key reads as
stricter and is worse: a trade retired under someone's feet would make every future
save of their profile fail, for a choice they made before the retirement existed.

Because the call is a complete DESCRIPTION rather than a delta, two submissions in
flight converge on whichever lands last. The selector posts the same way, and
applies the same promote-a-survivor rule on screen, so the page after a save is
the page before it.

**Stricter than the product contract in one place:** the contract says one of the
selected trades *may* be primary. The implementation requires one whenever the
selection is non-empty. Optional would have made four of the rows above ambiguous.

### It does not guess

`individual_onboarding.prof_specialization` holds two conventions: a vocabulary key
where the onboarding chips wrote it, and free prose in every seeded and staging
professional. The migration's backfill matches **by exact key equality only**. It
parses nothing.

Mapping "Plumbing and sanitary fitting" onto `plumbing` looks obvious and is a
guess; the next sentence is "Plumbing and gypsum", and a guess that is right four
times and wrong once has published a false claim on somebody's public profile.

The demo world is resolved instead **explicitly, by user id**, in `seed-pilot.sql`
§10.3b, where a human wrote each pair down and a reviewer can check them line by
line. Heba Kamal (interior designer) and the site engineer are left **unmapped** —
the Pilot vocabulary is installer trades, and covering them means modelling two
more professions to decorate a demo.

### A latent defect the taxonomy work surfaced

Because `prof_specialization` holds prose, and all three surfaces rendered it
through the message catalog, a stranger reading Sayed's public profile saw

    onboarding.professional.specializations.Marble and granite fixing

`t()` returns the KEY PATH when nothing resolves — the same failure mode as the
stored-language defect fixed one increment ago, one column over.
`specializationLabel()` translates a key and prints prose as prose. It never
infers a trade. `tradeLabel()` does the same for canonical keys, falling back to
the key rather than a path, because a path tells a visitor nothing except that
something is broken and not whose fault it is.

Where a canonical trade exists it **supersedes** the free text on `/home`, the hub
and the public page; where none does, the free text is still the only answer.
Nothing was deleted, and nothing is required.

### UI, under the contract

The first surfaces built entirely under `UI_CONTRACT.md`. No new primitive, no
persona-local component, one icon added to the canonical set. `/home/profile/edit`
gains a trade card above the form; `/home/profile` a read-only summary;
`/home` reads the primary trade through the specialty row **that was already
there** — a dashboard card announcing "you have declared trades" would be a card
about the platform's data model rather than about the person's work. The public
page still ships **143 B** of client JS.

The trade card saves itself rather than riding the profile form's button. One
button driving two RPCs is two transactions that can disagree, leaving the page to
explain a half-saved profile; availability set this precedent on the hub.

**`TradeSummary` had to be split into its own module.** It shared a file with
`TradeSelector`, so a display-only consumer imported the server action and through
it `server-only`, which fails at runtime rather than at build. Display and write
now live apart.

### The browser found what the tests could not, again

`data-testid="trade-selector"` was placed on `<Card>`. `data-*` props typecheck on
any React component and are silently dropped unless it forwards them, and `Card`
takes `className`, `pad`, `children`. It compiled, it passed review, and it never
reached the DOM — the **exact** Increment 4 trap, repeated. Moved to a real
element, and the test that would have caught it is now in the file, with the
reason written above it.

### Validation

Clean `supabase db reset`. pgTAP **42 files, 1343 tests, PASS**; new
`41_trade_taxonomy_test.sql` is **73/73**; the three public-projection allow-lists
(08, 17, 38) were widened **deliberately**, not weakened. Two of the new
assertions are structural rather than behavioural — that no RLS policy anywhere
references `user_trades`, and that the only functions mentioning it are its writer
and the projection reader — because by the time O5 shows up in behaviour, an
installer has already been refused a job they were allowed to apply for.

`vitest` **713 passed / 67 files** · `tsc --noEmit` clean · `eslint src` 0 errors
(1 pre-existing warning) · `next build` clean · `check_doc_links.py` 950 links, 0
broken.

Live UAT as Sayed, driving the real RPC: selected a second trade, promoted it,
saved, verified in psql that exactly one primary existed; cleared everything and
confirmed the empty state; read the public page as a visitor. AR RTL showed all
seven trades in Arabic, and **zero raw keys and zero message paths** on any
surface in either locale. Seeded state restored afterwards.

### Unfinished work, explicitly

- **The Installer aftercare pass is deferred to its own phase, by instruction.**
  It was started and stopped after the read-only survey; no file was edited. Its
  scope — information hierarchy across `/home`, the hub, the editor and Points;
  the `/home/points` identity band; density and repeated "Not specified"; 390px
  composition — is unchanged and unaddressed here.
- **The site-wide UI consistency audit is likewise deferred**, together with the
  §11 Global Consistency Milestone (Admin shell, Business/Onboarding headers,
  card-vocabulary collapse, deleting `Band`). `UI_CONTRACT.md` remains in force
  for all new UI in the meantime, which is what this increment was built under.
- **`/home/points` still renders `HomeHeader`'s identity band** — "Points" as both
  eyebrow and title, over a monogram derived from the page name. Pre-existing from
  Increment 3, in scope for the aftercare pass, out of scope here.
- Trade labels reuse the `onboarding.professional.specializations.*` namespace per
  the approved spec. Inherited transitional debt; `tradeLabel()` is the one line
  that moves when `prof_specialization` retires.
- `kitchens_doors` and `hvac` are seeded but held by nobody. Correct for a
  vocabulary, worth confirming.
- **`RUNTIME_STATE.md` is still not refreshed**, now six increments behind.
  Untouched here by instruction.
- `.claude/launch.json` is still gitignored, so the next session writes it again.

### Two things worth knowing next time

- **A column that holds two conventions holds neither.** `prof_specialization` was
  a key sometimes and a sentence otherwise, and every reader had to guess. The
  canonical table exists so that the question "what does this person do" has one
  kind of answer.
- **Declared trades are a discovery signal, not a permission.** Asserted
  structurally in pgTAP and stated on the selector itself, because a tester who
  reads a trade list as a permission list will not take work outside it — and the
  platform would have taught them a restriction it does not impose.

---

## Session — Five layouts wrote the same shell, and none of them named it

**Date:** 2026-09-01 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `8be3cdd` (Increment 4)

UI Foundation v1, from a read-only audit through implementation to a real-browser
UAT. Not a redesign: the approved B2B workspace is the reference, and everything
here is about giving the rest of the product access to it. No page composition
changed except one label.

### What the audit corrected about its own brief

Three of the premises were wrong, and saying so is the useful part.

**Token discipline was already clean** — zero raw hex, zero arbitrary colour
values, zero palette escapes across the app. The one real gap was narrower and
worse: `bg-accent-solid` was painted with `text-brand-basalt` in four places and
`text-brand-lumen-ink` in two. Two inks on one fill, a visible difference nobody
chose. That is the whole of the token work — `--on-accent`, defined once, shared
by both themes because Lumen is a bright amber on either ground.

**The Installer rail was not the worst offender.** Admin's bespoke aside and the
byte-identical Business/Onboarding headers are older and further out. The rail was
merely the newest, which is not the same thing.

**Forms were not a drift area** — one visible raw `<input>` in the whole
repository.

The actual root cause was structural: **five layouts each wrote
`flex min-h-dvh flex-col bg-canvas` by hand.** That string WAS the shell — an
unnamed one nobody could change centrally — and the approved ground (frame,
atmosphere, apertures) was welded inside `SidebarShell`, so reaching it required
adopting the B2B navigation wholesale. A personal account and a workspace read as
two products for that reason and no other.

### The split, which is the whole architecture

`AppShell` now owns the GROUND — frame, atmosphere, content measure, header
placement, mobile slot — and knows nothing about navigation. `WorkspaceShell`
(capabilities, commerce stance, branch scope, sales realtime) and `/home`'s layout
are two FILLS of it. `NavLink` moved out of `workspace-nav.tsx` into
`nav-item.tsx` so it stopped being structurally B2B property; `PersonalSidebar`
and `Sidebar` are now two information architectures in one visual language rather
than two navigations.

The B2B workspace migrated FIRST, deliberately: it is the reference, so any
regression there is a regression in the reference itself.

The horizontal personal rail is deleted. Its reasoning — four destinations do not
earn a 280px column — was sound and was about IA; answering it with a different
visual language was the mistake. Route count does not authorize a new shell.

`PageHeader`'s hand-styled primary action became the canonical `Button` **in the
foundation component**, not at the call sites: the duplicate lived inside the
foundation, so every workspace module inherited a second primary treatment and the
divergence was invisible page by page.

### The browser found a total outage that nothing else could

`SidebarShell` briefly took `nav: (state) => ReactNode`. It reads better than a
context and it is impossible: the shell is a Client Component, the layouts mounting
it are Server Components, and React cannot serialize a function across that
boundary. **Both `/home` and `/b2b` returned 500.**

`tsc` accepted it. `next build` compiled it. All 33 shell tests passed — a
client-side test render has no boundary to cross. The prior report's claim that
"B2B behaviour is unchanged, all tests pass unmodified" was true in tests and false
in the product.

Replaced with `SidebarDisplayContext` + `useSidebarDisplay()`, so layouts pass
plain elements (`<PersonalNavPanel/>`, `<WorkspaceNavPanel/>`) and the thin client
wrappers read display state once mounted.

### Two more the browser found on `/home`

**No carve.** `carved: true` tells `NavLink` to suppress its own 2px marker
BECAUSE a carve is drawing the active surface — and `PersonalSidebar` rendered
none. Measured: active row `background: transparent`, `box-shadow: none`. The only
cue was a marginally brighter glyph. Fixed with the callback-ref container and
`ActiveCarve` as a sibling of `<nav>`, exactly as `Sidebar` arranges them.

**Two `/b2b` links inside a personal sidebar.** The shell's fixed footer hardcoded
Settings and "Upgrade your plan", both pointing at `/b2b/settings` — a route an
org-less installer is redirected out of, plus a billing concept that does not apply
to a person. `footer` is now a slot; `/home` passes `"none"`.

### The rail geometry, and why it was never a carve bug

Review then reported an oversized/offset carve blob on the collapsed personal rail
and separator spacing that did not match. Both had **one cause**, and it was not in
the carve.

`PersonalSidebar`'s `<nav>` was missing `width: var(--shell-nav-w)`. The scrolling
panel spans the sidebar INCLUDING its 14px gutter — deliberately, because
`overflow-y: auto` clips both axes and a scroller sized to the navy alone would
sever the carve at the edge it exists to cross. Every nav inside it must therefore
clamp itself. The workspace one does; this one inherited the gutter.

Fourteen pixels, all of it visible at rail width: the row became 54×40 instead of
40×40, `navRowClass`'s `justify-center` centred the 36px tile in a 54px track
instead of a 40px one, and the glyph landed at x=17 instead of x=10. The carve is
pinned to `NAV_COLUMN_START` — a DERIVED number, correct for a 56px rail — so it
drew its tile **seven pixels behind the icon it was under**. Rows also carried
their hover surface and focus ring past the navy onto the frame. Expanded, rows
were 230px wide against a 220px carve.

One declaration fixes row height, hit area, vertical rhythm, icon centre line,
focus geometry and carve alignment together, because all six were derived from the
same width. **Nothing in `nav-carve.tsx` changed.**

Separator: `mx-3 my-1.5 border-t` on a bare `<div>` was a second answer to a
question the collapsed rail had already answered — different inset, different
rhythm, a rule stopping short of the column at both ends. Both lists now use
`NAV_GROUP_SEPARATOR_CLASS`, defined once in `nav-geometry` beside the padding it
derives from. The workspace's own inline literal is gone; this is a shared
constant, not persona-specific CSS.

### The UAT, measured rather than eyeballed

Signed into a real B2B workspace (`a-owner@example.test`) to measure the canonical
rail rather than infer it, then back into the installer persona, same collapsed
cookie, same viewport:

| | B2B | Personal |
|---|---|---|
| nav / scroller | 56 / 70 | 56 / 70 |
| row | 40×40 | 40×40 |
| icon x | 1384 | 1384 |
| carve | 36×36 @ 1384, y 74 | 36×36 @ 1384, y 74 |
| pitch — plain / across rule | 42 / 61 | 42 / 61 |
| separator | mt 8 · border 1 · pt 8 · ml 0 | identical |

Every number, not "close". Expanded preserved: band 220×40 at x=10, radius 10px,
0 fillets — matching B2B, and now correctly sized against a 216px row.

**AR RTL light:** nav 1374–1430, carve mirrored to 10px from the trailing edge.
**EN LTR dark:** nav x=0, icon x=10, exact mirror; body `rgb(17,26,36)`; separator
flips to `rgba(255,255,255,.071)`; carve `srgb(.204 .245 .282)`. **Focus:**
`:focus-visible` true, 1px shell offset + 2px `#855a15` ring, tile takes
`bg-surface-2`, row fully inside the plate with symmetric 8px gaps. **Zero raw
i18n keys** on any surface in either locale. Mobile bar at 375px pinned to the
bottom with 64px clearance at full scroll.

Pointer `:hover` could not be driven — the pane's screenshot frame is 800×500
against a 1440×900 emulated viewport, and synthetic moves produced no `:hover`
match at either scale. Hover paint is unchanged shared code; what this pass changed
about it — that the surface no longer overruns the navy — is settled by the 40px
row measurement.

### The one label change

`/home`'s dashboard called the onboarding LEAD TIME "Availability" while Increment
4's live availability badge sat in the same page's header. Two different facts
under one word, a few hundred pixels apart, one changeable and one not. Now
`profile.hub.leadTime` — the same key the hub already carries. The onboarding
label is left alone; in that flow there is nothing for it to collide with.

The stored-language defect in `professional-home.tsx` is also fixed (it printed
`onboarding.professional.languages.ar` verbatim to the account's own owner). The
two onboarding CHOICE-chip sites keep the catalog and are pinned as correct —
their keys come from the catalog itself and always resolve.

### Governance

`docs/frontend/UI_CONTRACT.md` states the rules and marks which are mechanically
enforceable. `src/lib/ui/foundation.test.ts` is the enforcement, and the bar for
an entry is deliberately high: **every check guards a failure that has already
happened once here.** A rule nobody has broken is a comment; a rule that caught
something is a test. Twelve currently — theme parity, single `--on-accent`, no
brand primitive on the accent fill, the hand-written shell held to a shrinking
legacy list, one frame painter, the foundation's primary action, stored-language
surfaces, the RSC boundary (both directions), nav width, and the shared separator.

The eslint additions are the smallest useful static guard, not a lint programme.

### Validation

`vitest` **658 passed / 62 files** · `tsc --noEmit` clean · `eslint src` 0 errors
(1 pre-existing warning, `sidebar-shell.tsx:160`) · `next build` clean. No database
work, no migrations, no `design.pen`.

### A correction to the previous entry

The Increment 4 entry records `40_professional_availability` as **38/38**. The
actual plan is **35/35**. The suite passed; the number was wrong.

### Three things worth knowing next time

- **A Client Component prop that typechecks can still be unserializable.** The RSC
  boundary is invisible to `tsc`, to `next build`, and to every client-side test
  render. If a Server Component hands a Client Component anything but data, only a
  browser will tell you.
- **A derived constant is only correct for the geometry it was derived from.**
  `NAV_COLUMN_START` is right for a 56px rail; the bug was 14px away, three levels
  up, in a width the component never mentions.
- **`carved` is a contract, not a flag.** Setting it tells the row to stop drawing
  its own active state. If nothing else draws one, the active row silently has none
  — and the tests still pass, because the rows are right.

### Unfinished work, explicitly

- **`RUNTIME_STATE.md` is still not refreshed** (checklist item 1), now five
  increments behind. Untouched here by instruction.
- **Admin, Business and Onboarding are deferred by design** and named in the
  contract under MIGRATE WHEN TOUCHED, with `no-org-notice.tsx`. The
  hand-written-shell test pins that list so it can only shrink.
- **`/home/points` still renders `HomeHeader`'s identity band** — a monogram tile
  of the first letter of the page title, and "Points" printed twice. Pre-existing
  from Increment 3; a composition choice, not foundation.
- The §11 Global Consistency Milestone (Admin shell, Business/Onboarding headers,
  card-vocabulary collapse, deleting `Band`) is unstarted.
- `.claude/launch.json` is now launchable rather than attach-only, which is what
  made any of this verification possible. It is gitignored, so it is in no commit
  and the next session will have to write it again.

---

## Session — A claim about yourself, and a date you are not allowed to write

**Date:** 2026-08-31 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `206f4d3` (Increment 3)

Increment 4: availability (D6/O3, §8). Two columns on `public.profiles`, one
trigger, one narrow grant, and the surfaces that read them. The interesting part
is not the boolean — it is the timestamp beside it, and who is allowed to write
it.

### The departure from §8.1, and why it is the same rule rather than a new one

§8.1 says both columns join the existing narrow `grant update` on `profiles`.
**Only `available_for_work` did.** `availability_updated_at` is stamped by
`app.stamp_availability()` and is in no client grant.

O3 forbids expiring the flag because that would be the platform asserting
something the person never said, and it KEEPS the timestamp so a reader can weigh
staleness themselves. A client-writable timestamp defeats exactly that: a
professional could re-stamp `now()` indefinitely without ever revisiting whether
the claim is still true, and the single signal a poster has for judging it becomes
the thing most worth faking. That is the same failure O3 guards against, read from
the other side — the platform would not be manufacturing state, but it would be
publishing a freshness claim nobody made.

So the value is derived from `now()` and any supplied value is discarded,
**including from the table owner**. `40_` asserts that with the strongest writer
there is. §8.1, the O3 invariant row and §8.3 were reconciled to say so; the model
now reads the same in all three places instead of only one.

### The guard is on claiming it, not on every change

First draft refused any availability change from a non-professional. That traps a
stale `true`: an identity that stops being a professional while marked available
could never turn it off, and the platform would go on publishing a claim the
person is no longer permitted to retract. **Withdrawing availability is always
allowed** — there is no state in which "I am not taking work" is worth refusing.
Claiming it still requires a professional identity, canonical or declared, through
`app.is_professional_persona`.

The check lives in the trigger rather than in the Server Action, for the reason
Increment 1 put the Sales guard on `app.membership_grant_sales`: a rule at the
chokepoint is structural, while a rule repeated at every entry point is a list
somebody must remember to keep adding to. `profiles_update_self` already restricts
the ROW to its owner; this restricts CLAIMING the column. A `WHEN` clause keeps it
inert for every other write, so `individual_save_professional` and every existing
writer are untouched.

### Two facts had been sharing one word

`individual_onboarding.prof_availability` already existed: a one-off LEAD TIME
(`within_week`/`within_month`/`flexible`) chosen during onboarding, and the
profile hub rendered it in a row labelled **"Availability"**. Adding a live
availability control to the same page would have put two different facts under one
word — and the failure is silent, because both render perfectly. The hub row is
now "How soon you can start"; the onboarding label was left alone, because in that
flow, in context, it is not ambiguous. `profile-hub.test.tsx` pins the pair.

The lead-time column also stayed OUT of the public projection. Publishing a
one-off onboarding answer as though it were a current claim is the same confusion
in the other direction; `38_` asserts its absence under both possible names.

### It gates nothing, and that is asserted rather than promised

Nothing reads `available_for_work` to decide what anybody may do — no route, RPC,
policy or capability. `40_` proves it structurally: no function in `app` or
`public` mentions the column except the trigger and the projection reader. The
listing predicate did not move either, so an **unavailable professional stays
listed and stays findable**. Hiding them would be the platform deciding that "not
right now" means "not at all".

The same reasoning drives the one styling decision worth recording: unavailable is
`neutral`, never `danger`. Nothing is wrong with a professional who is not taking
work, and painting it red would push everyone toward leaving the flag on — which
is how an availability signal stops meaning anything. "Never set" is a THIRD
state, not a synonym for unavailable.

### The control is a button, because it can be refused

A switch reads as instantly applied; this is a server round trip the database can
refuse, and a control that visibly moves and then snaps back explains nothing. The
button names the destination state and the current state is stated beside it. It
posts a VALUE rather than a flip, so a double-click converges instead of landing
the person on the opposite of what they clicked. No optimistic update: the
timestamp comes from the database, and inventing one client-side would be the same
lie the write path is shaped to prevent.

Placement: the control and the age on `/home/profile`; the state alone on `/home`,
beside the verification badge; state AND age on `/p/[profileId]`, because a
visitor deciding whether to make contact needs both. The public page still ships
143 B of client JS — the status components are server-rendered.

### Staging

`supabase/staging/demo-enrichment.sql` marks **only** Sayed Abdel-Rahman
(`sayed-marble-fixer`) available, so the reviewed installer persona exercises the
state. The other listed professionals stay at "never set" on purpose: the contrast
is the demo. The enrichment writes through the real trigger, guard included — it
is not a privileged bypass, and a future enrichment marking a non-professional
available will fail loudly at load. It cannot backdate the stamp either, which is
itself the property on display.

### Validation

Database, on a clean `supabase db reset`:

- `40_professional_availability` — **38/38** (new)
- `08_public_discovery` · `17_public_directory_hardening` ·
  `38_public_profile_professional_fields` — projection allow-lists updated in
  **three** places, because three tests guard the same view
- `01` · `09` · `10` · `11` · `14` · `21` · `25` · `28` · `39` — unchanged
- **13 files, 435 assertions, PASS**

Staging: `scripts/rehearse_staging_seed.py` — first apply loaded, 26 accounts
verified, second apply refused with zero rows written. `verify-staging-seed.sql`
predates availability, so the new state was checked separately in a rolled-back
transaction: Sayed available with a stamped age, seven others still never-set, and
the statement idempotent on re-run.

Frontend: `vitest` **637 passed / 61 files**; `tsc --noEmit` clean; `eslint` clean
on every changed path (the one warning in the tree is pre-existing, in
`sidebar-shell.tsx`); `next build` clean. `database.types.ts` regenerated: **+8
lines**, no unrelated churn. Docs: 947 internal links, 0 broken.

### Three things worth knowing next time

- **`data-*` props typecheck on any React component and are silently dropped**
  unless the component forwards them. A `data-testid` on `Card` compiled fine and
  never reached the DOM. Removed rather than left looking functional.
- **The projection has three allow-list guards** (`08_`, `17_`, `38_`). Defence in
  depth, but a projection change costs three edits and the first two passes will
  look like unrelated failures.
- **A test can pass for the wrong reason after a fixture reorder.** Adding the
  withdrawal section left the flag at `false`, so a later "set false" was no longer
  a change, the `WHEN` clause correctly skipped the trigger, and the bogus
  timestamp survived. The product was right; the test's assumed state was stale.

### Unfinished work, explicitly

- **Still no browser verification.** Nothing serves on `:3000` and
  `.claude/launch.json` remains attach-only. The hub's control row and the public
  page's badge-plus-age pair at 390px are what a human should look at.
- **`RUNTIME_STATE.md` is still not refreshed** (checklist item 1), now four
  increments behind. It needs its own pass.
- **`features/home/professional-home.tsx` still has the language-label defect.**
  Pre-existing; this increment touched only its header `meta` slot.
- Availability has no discovery FILTER yet. §8.4 says the projection enables one
  and that it is specified when built — the columns are there, the filter is not.

---

## Session — A ledger with a balance in it and no door to reach it

**Date:** 2026-08-31 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `ff859c0` (Increment 2)

Increment 3 of the Installer Pilot, and the smallest one so far: no schema, no
migration, no earning rule, no wallet, no tier, no redeem control. Points Core
shipped in `b25e249` and worked. The defect was that nobody it was built for could
get to it.

### The whole increment is one missing route

`/b2b/points` was the only Points destination, and `/b2b/layout.tsx` redirects an
organization-less caller to `/home` before any navigation is drawn. So an
`installer_technician` who earned the one approved award —
`referral.organization_approved`, +100, credited to a **person** — held a real
balance in a real ledger with no way to see it. The page was correct; it was
simply behind a door that persona cannot open.

`/home/points` is that route. It reuses the shipped queries, view model, history
paging, negative-balance behaviour, localization and non-monetary contract as
they are.

### Read authority did not change, and structurally cannot

`points_ledger` carries one owner policy (`user_id = auth.uid()`).
`points_balance()` is called with **no argument**, so it defaults to the caller.
The query layer accepts no user id at all. The personal route therefore gains no
read the workspace route did not already have, and neither route can be pointed at
someone else's ledger — not because a check refuses it, but because there is no
parameter through which to ask.

### One loader, two surfaces — the refactor was the point

`features/points/points-page.ts` now owns what the two surfaces must never
disagree about: which reads happen, the all-or-nothing failure contract, the view
mapping, and the "more" rule. Both routes call it. `/b2b/points` was refactored
onto it rather than left alone and copied from — a second copy of the failure
contract is exactly the thing that drifts, and the drift would be two pages
quoting different totals for the same ledger.

What stays per-route is **chrome only**. `/b2b/points` keeps `PageHeader` /
`Panel`; `/home/points` uses `HomeHeader` / `HomeSection` / `Card` so it sits with
`/home/profile` instead of importing the cockpit's density onto a surface that has
no sidebar to justify it. The one parameter that legitimately differs is
`basePath`: the pagination link must return to the surface it was rendered from.
Asserted in both directions.

`/b2b/points` behaviour is unchanged — same queries, same single try around both
reads, same cap arithmetic, same chrome.

### Points is not gated on having any

The rail entry appears for every professional personal account, on the same
eligibility as the profile hub. It is deliberately **not** conditioned on holding
a balance: a destination that appears only once you already have something is one
nobody finds the first time, and the first thing this page has to explain is *how*
the 100 points are earned. The guarantee is structural rather than remembered —
`PersonalNavInput` carries no balance, so no amount of one can change the answer.

### A comment that had gone stale

`lib/nav/modules.ts` still described Points as *"a UI shell in this sprint"* that
*"says plainly that there is nothing to show yet"*. Untrue since `b25e249`. It now
records what the module actually is: `points: null` because Points is the caller's
**own** standing and no capability could gate it, and — the part worth writing
down — that the workspace entry is the *secondary* copy. The primary home for a
user-owned ledger is the personal one, because that is the only surface an
organization-less professional can reach.

### Validation

Frontend only, as instructed — no `supabase db reset`, no pgTAP, no Playwright,
because nothing in this increment touches the database.

- `vitest` **603 passed / 57 files** (from 584 / 55)
- `tsc --noEmit` clean · `eslint` clean on every changed path
- `next build` clean, with `/home/points` and `/b2b/points` both building

New and extended coverage, 32 assertions:

- `features/points/points-page.test.ts` (new, 9) — **zero, positive and negative**
  balances; the balance is never summed from the capped rows; the more-link is
  per-surface; the cap ceiling; both halves of the failure contract
- `components/layout/personal-rail.test.tsx` (new, 4) — Points labelled and linked
  in **EN and AR**, `aria-current` only on the current route, and that the rail
  derives nothing itself
- `lib/nav/personal-modules.test.ts` (11 → 15) — an org-less professional gets
  Points, a consumer does not, and it is not gated on having a balance
- `features/points/points-ui.test.tsx` (42 → 45) — **Arabic negative and Arabic
  zero**

That last one is worth naming. The suite already pinned EN zero/positive/negative
and AR positive. Arabic is the **default** locale, so the Arabic negative
rendering is the one a Pilot user is most likely to meet, and it was the one case
nobody had asserted. It passes: the sign survives Arabic-Indic digits, and the
correction explanation renders.

### Unfinished work, explicitly

- **Still no browser verification.** Nothing serves on `:3000` and
  `.claude/launch.json` remains attach-only (a `url` with no command), so the
  preview tooling can attach but cannot start a server. The rail now carries four
  entries for a salesperson and three for an installer; how that row behaves at
  390px is the thing most worth a human look.
- **`RUNTIME_STATE.md` is still not refreshed** (checklist item 1) and now carries
  three increments of drift. Untouched here by instruction; it needs its own pass.
- **`features/home/professional-home.tsx` still has the language-label defect.**
  Pre-existing, authenticated surface, excluded by instruction.
- Points still has no Rewards, Wallet, tiers or redemption, and exactly one
  earning rule. That is the approved contract, not an omission.

---

## Session — A profile the Pilot could publish but nobody could edit

**Date:** 2026-08-31 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `52ed8dd` (Increment 1)

Increment 2 of the Installer Pilot: the personal shell, navigation, professional
profile hub, standalone editor and public profile route. It began as a no-schema
increment and ended with two migrations, both of which exist because building the
surfaces exposed rules that were asking the wrong question.

### Correction to the previous entry

The Increment 1 entry (`52ed8dd`) states *"Increment 2 (Storage) blocks portfolio
and certificates"*. **That is wrong.** Storage is **Increment 10**; Increment 2 is
this one — personal shell, nav and profile. The dependency claim itself holds —
portfolio and certificates are blocked on the media/storage foundation — but it is
Increment 10 that blocks them, not Increment 2. The work log is append-only, so
that entry stands as written and this paragraph is the correction.

### Navigation is derived from persona, not from capabilities

`lib/nav/personal-modules.ts` is a SIBLING of `modules.ts`, not an extension of
it. `modules.ts` answers a question a personal account cannot ask — *which modules
does this membership's capability set unlock* — and a person has no membership.
Reusing it would have meant inventing pseudo-capabilities for a human being, which
is the exact conflation the account model exists to prevent. The personal rule is
narrower and different in kind: a consumer has no professional profile because
there is none to show, not because it is withheld; a salesperson has the showroom
route because the database admits them to it; anyone may start a business, because
owning one is a relationship and never an account type.

The rail is HORIZONTAL, and deliberately. `SidebarShell` is a full-height panel
because a workspace has twenty-odd capability-gated modules and an entire
composition built around that panel being the outermost thing on its side. Four
destinations do not earn that; reproducing its display modes, hover reveal and
mobile sheet for four links is machinery with nothing to carry.

### The editor needed no new write path, and the public page needed one column

`individual_save_professional` was already re-entrant (`on conflict do update`) —
built that way so it could back something other than a wizard. The standalone
editor is the same data on one page with one Save, and every validation stayed in
the database. `/home/profile/edit` also replaced the wizard as the target of every
professional completeness item: sending an established professional back through a
six-step onboarding flow to fix one line is why Pilot UAT read `/home` as a review
queue.

### Two rules that were asking the wrong question

**The public projection was too thin to be honest.** `/p/[profileId]` could say a
professional's name, trade label, headline and languages — and nothing about what
they do. The `/b2b/technicians` directory that links to it showed more than the
profile it opened. `20260831090002` widened `profile_public_directory` with four
columns the professional had already written about their own practice in order to
be found: specialization, core services, years of experience, service areas. The
listing predicate did not move; the same rows return with more columns, and
`individual_onboarding` stays private behind unchanged RLS.

**The edit gate was asking how an identity was created, not what it is.**
`individual_save_professional` required `onboarding_progress.selected_track =
'professional'`. That was right while the wizard was its only caller. It is wrong
for an editor: **no seeded Pilot identity has a selected_track at all**, so every
professional the Pilot runs on — listed in the public directory, rendered a
professional home, given a public profile page by this very increment — was
refused their own edit. `20260831090003` made the gate ask about the professional
IDENTITY, canonical or declared, via `app.is_professional_persona` — the sibling
of Increment 1's `app.is_sales_persona`, same two sources, same reason. The track
branch was KEPT: a first-time caller has only a track, because this call is what
writes the declared type.

The frontend had briefly carried a read-only fallback for exactly that case. It is
gone. A frontend gate stricter than the write path is not caution, it is a second
rule to keep in step.

### Three defects the tests caught, not the review

**The LEFT JOIN.** Every listed profile in the Pilot seed has no
`individual_onboarding` row. An inner join in the widened projection would have
emptied the technicians directory, the consultants directory and every public
profile page at once — while every assertion *about the new columns* still passed
on the rows that survived. Guarded three ways in `38_`.

**Two conventions for one column.** `profiles.languages` holds `arabic`/`english`
from the onboarding flow and ISO `ar`/`en` in every seeded row. The public page
used the onboarding catalog and printed `onboarding.professional.languages.ar`
verbatim — on a page whose audience cannot tell whether the profile or the
platform is broken. `lib/i18n/language-label.ts` now resolves both conventions.

**A test that passed for the wrong reason.** In an early draft of `38_`, three
assertions ran under a role whose RLS hid the rows being compared, so an "is null"
check passed on a missing row rather than on a null column. Moved to the right
level.

### Validation

Database, on a clean `supabase db reset`:

- `38_public_profile_professional_fields` — **39/39** (new)
- `39_professional_profile_edit_authority` — **33/33** (new)
- `08_public_discovery` **14/14** · `17_public_directory_hardening` **29/29** — the
  projection allow-list guards, updated because the approved column set genuinely
  changed (the same guards that were updated when `persona` was added in Sprint 14)
- `01_identity_profiles` 9/9 · `10_account_type_eligibility` 12/12 ·
  `11_account_upgrade` 26/26 · `11_individual_persona_onboarding` 18/18 ·
  `21_shared_onboarding` 27/27 · `28_persona_sales_affiliation` 79/79 ·
  `37_sales_affiliation_persona_hardening` 43/43 — all unchanged

Frontend: `vitest` **584 passed / 55 files**; `tsc --noEmit` clean; `eslint` clean
on every changed path; `next build` clean, with `/home/profile`,
`/home/profile/edit` and `/p/[profileId]` all building.

Docs: `scripts/check_doc_links.py` — 947 internal links, 0 broken.

**AR/EN parity is compiler-enforced, not test-enforced**: `ar` is typed
`Messages = DeepStringShape<typeof en>`, so a missing or misshapen Arabic key is a
type error. `tsc` passing is the parity proof.

### Unfinished work, explicitly

- **No browser verification was possible in any session of this increment.**
  Nothing serves on `:3000` and `.claude/launch.json` is attach-only (a `url` with
  no command), so the preview tooling can attach but cannot start a server. Every
  visual and RTL claim here rests on the type system, unit tests and the build —
  **not** on a rendered page. The rail at 390px and the hub's two-column grid are
  the two things most worth a human look.
- **`features/home/professional-home.tsx` still has the language-label defect**
  fixed everywhere else in this increment. Left deliberately: it is pre-existing,
  on an authenticated surface, and outside the increment's scope.
- **`RUNTIME_STATE.md` is still not refreshed** (checklist item 1), and now carries
  two increments of drift on top of what it already had. It needs its own pass.
- **An organization-less installer still cannot reach their own Points.** That is
  Increment 3, unstarted.
- The public profile shows no availability, and no portfolio or certificates.
  Those are Increments 4, 10 and 11 — deferred by instruction, not overlooked.

---

## Session — An installer who knew a showroom could become its salesperson

**Date:** 2026-08-31 · **Branch:** `feature/installer-pilot` · **Base:** `main` @ `7e45e28` · **Prior:** `9d5b2e0` (Installer Pilot specification)

Increment 1 of the fourteen-increment Installer Pilot sequence, and deliberately
the one that ships no feature. The specification committed in `9d5b2e0` closed a
product decision (D3-residual) that only existed because the audit found a live
authority defect: the Sales-affiliation flow checked that the target was a
showroom and that the caller was verified, but never checked **who the caller
was**. An `installer_technician` could create a showroom join request, and its
approval granted the eleven `sales.*` capabilities. The referral path reached the
same place and awarded 100 Points on the way.

### The guard is on the grant, not on the doors

The specification anticipated gating each entry point. Building it exposed a
better shape: every route to `sales.*` — `org_join_request_approve`,
`showroom_referral_approve`, and anything added later — passes through
`app.membership_grant_sales`. Guarding the capability grant itself, before it
takes a lock or writes a row, makes the property structural instead of a list of
doors somebody must remember to keep adding to. The door-level checks stayed
anyway, so a non-Sales caller is refused at the moment they ask rather than at
the moment someone approves them; but the chokepoint is what makes the claim
true, and §7.2 of the specification was reconciled to say so.

`public.showroom_referral_approve` was deliberately **not** recreated. It carries
the frozen `referral.organization_approved` = +100 Points wiring, and
reproducing ~150 lines of it to insert one guard would risk an approved contract
for no additional protection: its refusal already arrives from the chokepoint
inside the same transaction, leaving no organization, membership, join request,
audit row or Points entry behind. A test asserts exactly that.

### Sales identity is canonical OR declared, in the database and in the UI

`users.primary_account_type` is written only by the applied upgrade, so a genuine
salesperson has null there for the whole review window while their account is
active and usable — activation is not verification. `app.is_sales_persona`
therefore accepts the canonical persona **or** the declared
`individual_onboarding.prof_concrete_type`, which is the resolution
`loadPersonalHome` already used. Reading the canonical column alone would have
been a regression wearing a security fix's clothes.

### Two existing test suites had encoded the vulnerability

`28_persona_sales_affiliation_test` and `36_referral_points_test` both failed
against the new guard, and both were right to. Each used fixture `70000009` — the
installer — as a stand-in labelled *"a second salesperson"*, and 36 literally
granted the installer a sales membership to produce a referral. The tests were
asserting that the hole worked. Fixed by **actor substitution only** (28 →
`70000005`, given a declared-sales row; 36 → `70000007`): every assertion,
ordering and plan count is unchanged, and `70000009` was kept in the two places
where being an unrelated third party is the point.

### The frontend was refused nothing, because it never asked

Increment 1 was database-only by contract, with a STOP condition for any
Installer-reachable surface that invokes the affiliation RPC. `/home/showroom`
and `/home/showroom/refer` were guarded on registration state and the existence
of a personal workspace and nothing else — the page's own comment read *"reachable
by any personal account, and reaching it grants nothing"*, which had been true
before the capability grant made it false. Reported rather than fixed, and then
fixed under separate approval: both routes now render a localized
*not-for-your-account* state (EN + AR) instead of a form the database was always
going to refuse with a bare `42501`.

Then the navigation link disagreed with the pages it led to. `my_workspaces()`
emits the Personal row on `app.has_personal_persona()` — three signals, including
a reached onboarding terminal — but fills the `persona` column from
`users.primary_account_type` alone. A salesperson mid-review therefore holds a
personal workspace whose persona is **null**: admitted by the page and by the
database, and silently never offered the link. The row-existence rule and the
row-content rule disagreed, and any UI reading the column inherited a stricter
test than the one that produced the row. The layout now uses the same shared
resolution as the pages, still gated on having a personal workspace at all,
because offering a link to a redirect is not navigation.

### Validation

Database (2026-08-31, clean local `supabase db reset` before each run, per the
project's pgTAP requirement):

- `37_sales_affiliation_persona_hardening_test` — **43/43** (new)
- `28_persona_sales_affiliation_test` — **79/79** (plan unchanged)
- `36_referral_points_test` — **52/52** (plan unchanged)

Frontend (2026-08-31): `vitest` **536 passed / 50 files**; `tsc --noEmit` clean;
`eslint` clean on every changed path; `next build` succeeds with `/home`,
`/home/showroom` and `/home/showroom/refer` all dynamic.

The database suites were run when the migration was written and were **not**
re-run at commit time; every file under `supabase/` is byte-identical to the
state that produced those results. No Playwright, E2E or backend suite was run —
none is affected, and the increment's contract excluded them.

### What this increment did NOT do

No table, column, type, policy, index, view, trigger or grant changed —
`create or replace` with identical signatures throughout, forward-only. No
Installer domain exists yet: `jobs`, `job_applications`, `job_assignments`,
`job_progress_updates`, `trades` and `job_reviews` are specified and unbuilt.
Notifications, Transactional Chat, Points Core and supply-side behaviour are
untouched, as is `UI-UX/design.pen`.

### Unfinished work, explicitly

- **Increments 2–14 are not started.** Increment 2 (Storage) blocks portfolio and
  certificates; it is a hard prerequisite, not a nicety — the repository has no
  `media` table, no bucket, and zero `.storage.from()` calls, while
  `avatar_media_id` / `logo_media_id` are bare uuid columns with no foreign key.
- **`RUNTIME_STATE.md` was not refreshed in this session** (checklist item 1). It
  carries pre-existing drift from before this branch — its Current Branch row
  still reads `chore/staging-demo-accounts` and its Sprint rows still read Sprint
  14 — and correcting that is a snapshot rewrite well outside an approved
  single-increment commit. It needs its own pass.
- **An organization-less installer cannot reach their own Points.** `/b2b/points`
  is the only Points surface and `/b2b/layout.tsx` redirects org-less callers to
  `/home`. Found during the audit, unresolved, and it will bite as soon as an
  installer earns anything.
- The frontend Sales predicate mirrors `app.is_sales_persona` in two places by
  hand. The unit tests deliberately assert the same cases as the pgTAP suite so
  the pair cannot drift silently, but nothing enforces it mechanically.

---

## Session — Points on screen: a balance that may be negative, and a history that never rewrites itself

**Date:** 2026-08-30 · **Branch:** `feature/points-core` · **Base:** `main` @ `2f81682` · **Prior:** `5ec9356` (referral wiring)

The `/b2b/points` shell had been standing since the shared-shell pass, holding a
route, a nav entry and an honest empty state ahead of the model. The model now
exists, so this replaces the BODY and nothing else — the route, the sidebar
entry, the section it sits in and the page header are untouched, exactly as that
shell predicted they would be.

### The page answers three questions and then stops

How many Points do I have, why did they change, and what does the programme mean
today. Everything a gamification dashboard would add — a tier, a level, a
streak, a progress bar, a leaderboard, a redeem button — is absent because no
model backs any of it and the approved specification excludes all of it. What is
on the page is a balance, one rule, and a history.

### "My Points" is structural, not a filter

The query layer accepts NO user id anywhere. `getPointsBalance(supabase)` takes
one argument and calls `points_balance` with **no** argument, so `p_user_id`
defaults to `auth.uid()` inside the database; a test asserts the function's
arity, because a second parameter is exactly what the regression would look
like. `listPointsEntries` adds no ownership filter of its own — RLS already
decided, and a duplicated check in TypeScript would only be a second place to
get it wrong. There is no user selector, no team view and no cross-user total,
and D3 stays unresolved with nothing on the page anticipating it.

Organization names resolve through a plain caller-scoped read of
`public.organizations`, whose own `organizations_select_member` policy decides
what comes back. A name that does not resolve is OMITTED, never invented, and no
policy was broadened to print a caption.

### The balance is read, never recomputed

The figure is `SUM(points_delta)` from the database, rendered unmodified — not
clamped, not made absolute, and not replaced by a dash when negative (D2). It is
deliberately NOT summed from the fetched rows: the history is capped at twenty,
so a client-side total would silently disagree with the ledger for anyone with
more entries than that. Which is the mutable-balance failure the whole model was
shaped to avoid, reintroduced at the read layer and much harder to notice there.

The sign comes from `Intl` with `signDisplay: "always"` rather than being glued
on by hand, because a hand-built minus carries the wrong bidirectional class and
can reflow to the wrong end of the number in an Arabic row.

### A correction is a second row, not an edited first one

A reversal renders in its own right, above the award it corrects, with the
original untouched. Collapsing the pair into one adjusted award would rewrite
history on screen while the database refused to rewrite it on disk — and the
person would never learn that something had been taken back. Positive
administrative entries read as "Points adjustment", negative ones and reversals
as "Points correction": calling the debit an adjustment while calling the credit
an award would imply the debit was something the reader did.

Nothing internal reaches the DOM. No UUIDs, no `source_id`, no audit id, no
admin user id, no raw reason code, no raw event key and no metadata — asserted
against `innerHTML`, not just against the view model. A reason the catalog has
no copy for is dropped rather than printed raw, because an unexplained
`event_invalidated` in the middle of an Arabic page is worse than no caption.

An event this build has no copy for still renders, under a real bilingual
fallback. Hiding it would make the page lie: the balance above it already counts
that entry, so a dropped row produces a total nobody can account for.

### Two mistakes the test suite could not have caught

**Seven invented class names.** The first draft styled both components with
`text-ink`, `text-subtle`, `bg-raised`, `border-line`, `divide-line`,
`outline-accent` and `gap-3xs` — none of which exists in this design system.
Tailwind compiles an unknown utility to NOTHING, so the page would have rendered
unstyled while typecheck and lint stayed green and every unit test passed.
Grepping the real vocabulary was what caught it; the components were rewritten
onto `text-fg` / `text-fg-muted` / `text-fg-secondary`, `bg-surface`, the plain
`border`, and the KPI number treatment (`font-display text-headline …
tabular-nums`) so the balance sits in the same typographic system as every other
headline figure in the workspace.

**A silently ignored test argument.** `renderWithI18n(ui, locale)` takes the
locale POSITIONALLY; the UI tests were passing `{ locale: "en" }`, which is
inert. They passed anyway, because these components take `locale` and `t` as
props rather than reading them from context — so the provider's only real effect,
`dir`, was wrong and nothing asserted on it. Fixed to positional.

Both are the class of failure that a green suite cannot see, and both were found
by reading the surrounding code rather than by running anything.

### Verification

Typecheck and lint clean (one pre-existing unrelated warning in
`sidebar-shell.tsx`). **67 targeted assertions** — 14 query-layer, 20 view-model,
13 UI, 20 i18n — and the **full unit suite at 518/518 across 48 files**, so the
replaced i18n block broke nothing elsewhere. Exact EN/AR key parity is covered by
the existing catalog test, which the new keys join automatically.

Reviewed in a real browser against a real signed-in session, using data created
ONLY through the approved RPCs (`showroom_referral_approve` for the +100 with
its organization context, `adjust_points` for a -140 correction, giving a
genuinely negative -40 total). Checked: English LTR and Arabic RTL, light and
dark, desktop and 393px, and persistence across a hard reload. At 393px
`scrollWidth === clientWidth === 393` in BOTH locales — no horizontal scroll —
and the rows switch to a column so the amount sits under the label instead of
colliding with a long Arabic title. Zero Points-related console errors; the 404s
in the log are Next dev-chunk artifacts that appear identically on untouched
routes such as `/b2b/customers`.

### Judgment calls, all four approved

Pagination is a bounded `?show=` LINK rather than a client "load more" —
server-first, works without JavaScript, keyboard-safe by default and survives a
reload, matching the `?period=` precedent; the value is clamped into
`[20, 100]`, so browser input may raise the bound in steps and can never unbound
the read. Both reads share ONE try/catch, because a confident balance above a
silently empty history would be a page that lies about the ledger. The
attach-only `.claude/launch.json` was temporarily given a run command to drive
the browser review and then restored (a dev server was already running). The
local dev database keeps the seeded review rows; they are not committed and any
`db reset` clears them.

### Scope

**No database change of any kind** — no migration, no earning rule, no change to
the 100-point value, and nothing touched in RLS, idempotency, reversal semantics
or the event allow-list. No Points notifications, no Realtime, no leaderboard,
challenges, badges, tiers, Sales Score, wallet, commissions, redemption, expiry,
manager or team visibility, and no consumer Points. `design.pen` untouched.
**D3, D4 and D5 remain unresolved**, and nothing on this page presumes an answer
to any of them.

---

## Session — The one approved earning event, and the approval path that must pay nothing

**Date:** 2026-08-30 · **Branch:** `feature/points-core` · **Base:** `main` @ `2f81682` · **Prior:** `82a3e3b` (Points foundation)

D1 closed: **`referral.organization_approved` = 100 Points**. This increment adds
a **call site and nothing else** — no table, column, policy, index or function.
That was the whole point of building the foundation first, and it held: the
diff is one migration that recreates one existing function, plus its test suite.

### Two outcomes hid behind one RPC

`public.showroom_referral_approve` is the authoritative Admin approval
transition — the sole writer of `organizations.referred_by_user_id` and the
emitter of `referral.approved`. Reading it closely turned up the fact that
shaped this increment: it has **two** outcomes, not one.

- It **creates** the referred business, writing
  `source = 'salesperson_referral'` and the referring salesperson into the
  write-once provenance columns.
- Or it **links** the candidate to a business that already existed, which keeps
  its own provenance (typically `self_created`) and gains no attribution.

So "approve a referral" and "a salesperson brought this business to Aladdin"
are not the same event. Awarding on the referral *request*
(`organization_referrals.referred_by`) would have paid a salesperson for
referring a showroom that was already on the platform — the obvious fraud route,
and one that would have looked correct in every test written from the request's
point of view.

The award therefore reads its recipient back from
`organizations.referred_by_user_id`, the **canonical write-once column**, in
both paths uniformly. On the linking path that column is null and **nothing is
awarded**. This is the first code in the product that actually depends on
`app.organizations_provenance_immutable()`, and it depends on it for exactly the
reason Sprint 13 created it: *"a reward paid on a mutable field is a reward paid
to whoever wrote last."* Both readings were put to product and approved.

### The function was extracted, not retyped

Editing a historical migration is forbidden, so the RPC is recreated
forward-only (`create or replace`, identical signature) in
`20260830090002_referral_points_wiring.sql`. Retyping 135 lines of working
approval logic to add six is a bad trade: the risk is not the new code, it is a
silent transcription error in the old code.

So the function was extracted from `20260815090002` programmatically, the two
insertions applied, and the result diffed against the original: **36 lines
added, 0 lines removed.** That diff is the evidence the pre-existing approval
behaviour is unchanged, and it is cheaper and stronger than any amount of
re-reading.

### Where the award sits, and why that is the whole safety argument

`perform app.award_points(...)` sits inside the function, immediately after the
existing `app.record_audit_event('referral.approved', …)` call — the placement
`notifications-core.md` established. One transaction, so approval and award
commit together or roll back together. Proven in **both** directions: a failed
approval leaves no ledger entry, and an award that cannot be written aborts the
whole approval, leaving no organization, no audit row, and the referral still
`submitted`.

Nothing is accepted from the browser — recipient, organization, source and
amount are all derived server-side, and `app.award_points` remains unreachable
by every client role. The **100 is a literal** in the RPC, deliberately not
configuration: a reward whose value lives in a mutable setting is a reward
decided by whoever can write that setting.

Idempotency has two independent guards. The RPC already returns early on an
already-approved referral, and beneath it the unique index on
`(user_id, event_type, 'organization', organization_id)` catches what the status
check cannot — two simultaneous approvals both reading `submitted` before either
commits. The suite proves both, plus that a replay through the trusted primitive
collapses to a no-op rather than raising.

### Validation

New `36_referral_points_test.sql` (**52 assertions**) drives the real flow —
save, submit, reject, approve — through the real RPCs rather than inserting
fixtures, so what it proves is the transition's behaviour and not a
reconstruction of it. It covers: +100 exactly, to the salesperson named by the
immutable provenance; correct `event_type`, `source_type`/`source_id` and
organization context; the approver, the organization owner and an unrelated
salesperson all receiving nothing; submission and rejection awarding nothing;
retry and concurrent-equivalent duplication; the linking path awarding zero; both
directions of transactional coupling; the derived balance rising by exactly 100;
and that attribution, membership shape, the "never Owner" rule and the
`referral.approved` audit row are all unchanged.

Two complete clean cycles — `db reset` → `db lint --schema public,app` →
`supabase test db` — both **1116/1116 PASS across 37 files**. Lint reports only
the two pre-existing unrelated warnings. Generated types are **byte-identical**:
the signature did not change, so the frontend sees nothing new. Not run, per
scope: Playwright, frontend tests, unrelated suites. No `.pen` file touched.

### Three small corrections the tests forced

`showroom_referral_reject` returns `void`, so `isnt()` could not wrap it
(`lives_ok`); `memberships` has no `is_owner` column, so "never Owner" is stated
as the absence of `org.manage`, the idiom `28_persona_sales_affiliation`
already uses; and the coupling test's temporary blocking constraint has to be
`NOT VALID`, or it fails against the award already sitting on the ledger instead
of against the one under test.

### Scope

`referral.organization_approved` is still the **only** earning event — the live
allow-list holds it and `admin.adjustment`, which is a correction primitive, and
the repository contains exactly two `app.award_points` call sites. No Tier B
commerce event was wired, no notification is emitted for an award, no frontend
Points behaviour was built, and Points remain user-owned. **D3** (manager
visibility), **D4** (expiry) and **D5** (relationship to Sales Score, still
undefined repo-wide) stay open and block nothing.

---

## Session — Points Core: the ledger, specified first and then built, with nothing wired to it

**Date:** 2026-08-30 · **Branch:** `feature/points-core` · **Base:** `main` @ `2f81682` · **Spec commit:** `79c3b92`

Two increments in one session, deliberately separated: the approved contract
(`docs/database/points-core.md`) and then the schema that implements it. The
second was not allowed to invent anything the first had not settled — which is
the only reason the ledger could ship while the product question that blocks
every award remains open.

### The pinned base was stale, not divergent

The task pinned `main` at `f975c38`. `main` was actually at `2f81682`.
`git merge-base --is-ancestor` settled it in one command: `f975c38` (PR #36,
the governance note) is an **ancestor**, and `main` had since taken two
unrelated UI/e2e merges (PR #37, #38). Ancestor means branching from `main` is a
strict superset; a non-ancestor would have meant a force-push and a stop.
Rewinding would have produced a branch that silently excluded two merged PRs.

### Ownership was not a judgment call

The temptation with a Points model is to make it organization-scoped, because
every other B2B table is. Two shipped artefacts had already decided otherwise:
`app/b2b/points/page.tsx` states that Points are *"the caller's own standing on
the platform, not an organization record"*, and `lib/nav/modules.test.ts`
**asserts** that `points` appears in the navigation of a member holding **zero
capabilities**. Re-deciding it would have contradicted merged, tested behaviour.
So `user_id` is the only authority column, and `organization_id` is context that
never reaches a `USING` clause — the rule `notifications-core.md` already
enforces for its own `organization_id`, adopted verbatim.

The direction guide supplied the other half: referral provenance is kept
write-once *"so a future rewards feature can credit the salesperson"* — a
**person**, not their employer. That sentence is the only statement in the
repository authorizing any Points award to exist, and it is why the approved
earning set has exactly one member.

### Enforcement was inherited, not invented

Three patterns already existed and all three were reused rather than rebuilt:
`app.forbid_mutation()` for append-only (as `audit_log` runs it), the
recipient-only SELECT policy shape from `notifications`, and awards emitted from
inside an existing transition beside its `app.record_audit_event` call. The
triggers are not redundant with the missing policies — policies bind
`authenticated`, the triggers bind **everyone**, including the security-definer
functions this migration itself introduces. The guarantee has to survive a
mistake in our own RPC, not only a hostile browser.

`app.forbid_mutation()` was generalized to name the table it fired on. It had
hard-coded "audit_log" and would have reported *"audit_log is append-only
(UPDATE points_ledger forbidden)"*. Same behaviour, same `P0001`; both audit
suites match on the code, not the text.

### Authority and idempotency turned out to be one property

Because awards fire from inside the business transaction rather than from an
award endpoint, *"can the browser award itself points?"* and *"can a retry
double-award?"* have the same answer: there is no separate write path.
`app.award_points` holds **no EXECUTE for any client role** (catalog-verified),
so there is nothing to forge a request to; and the identity is the deterministic
tuple `(user_id, event_type, source_type, source_id)` behind a **unique index**,
not a client token — a frontend key only protects a client from its own retry
and makes correctness depend on the least trusted participant. A duplicate
collapses to `null` via `ON CONFLICT … DO NOTHING`, so the surrounding
transaction still commits; the index (not an application `if not exists`, which
races between its SELECT and its INSERT) is what makes two concurrent writers
safe.

Two smaller decisions carried real weight. The **administrative adjustment's
`source_id` is its own audit row**, which gave every correction a unique,
auditable identity and let it flow through the same idempotency rule as
everything else — no special case, no second code path. And `points_balance` is
**SECURITY INVOKER** while every writer is DEFINER: a definer balance function
would have quietly become a read path around the policies, returning totals for
ledgers the caller cannot see.

### What the product decided, and what it did not

D6 closed to **no Tier B commerce events** — `quotation.accepted`,
`order.completed` and `project.completed` stay deferred candidates, not
flagged-off code, because a deferred candidate sitting in the allow-list is an
approved event with an extra step. D2 closed to **a negative balance displays
negative**: a floor at zero hides the correction a person would need in order to
dispute it, and is itself an invented balance. **D1 stayed open on purpose** —
`referral.organization_approved` is eligible, specified, in the allow-list, and
worth an amount nobody has set. It has **no call site**, and no numeric value
appears anywhere in the migration.

That separation is the point of the increment: the foundation is independently
complete and testable without choosing that number, and the wiring increment
adds a call site and nothing else.

### A guard that had encoded "not yet" as "never"

`28_persona_sales_affiliation_test.sql` asserted *"no wallet/points/rewards
table was introduced"* — a Sprint 13 guard that turned a temporary absence into
a permanent invariant. It was **narrowed, not deleted**: `%wallet%` and
`%reward%` still fail the build, `%points%` was dropped, and a comment records
why. Sprint 13's actual rule — attribution exists *without* a payout mechanism —
is unchanged and still enforced.

### Scope held

`points_ledger` has **no balance column, no `updated_at`, and no monetary
column**; the suite asserts all three absent. No Points UI, no Realtime, no
Notifications or Chat integration, no manager/team visibility, no leaderboard,
no expiry, no wallet, no commission. No historical migration was edited. The
referral approval RPC was not touched.

Colleagues, managers and owners read **nothing** — the assertion that matters
most proves that a user who is an *active `org.manage` member of the very
organization an entry carries* reads zero rows of it. Platform
support/administrator read-only is a deliberate, documented divergence from
Notifications: a points entry is a contested record, and a correction cannot be
issued responsibly by someone who cannot see what they are correcting.

### Validation

**Two complete clean cycles** — `db reset` → `db lint --schema public,app` →
`supabase test db` — both **1064/1064 PASS across 36 files**, including the new
`35_points_core_test.sql` (**60 assertions**: schema and the absence of a
balance, owner / colleague / org-owner / cross-tenant / non-member / platform
visibility, the four denied client write paths, retry and concurrent-duplicate
idempotency, reversal with the original provably unchanged, a negative derived
balance, and organization context retained without being promoted). `db lint`
reports only the two pre-existing warnings (`set_customer_ownership`,
`business_save`), both unrelated. `database.types.ts` regenerated: **+88 lines,
0 removed** — purely additive; `tsc --noEmit` clean. Catalog inspection
confirmed RLS enabled with two read-only policies and no write policy,
`authenticated` holding SELECT only, `anon`/`service_role` holding nothing,
`app.award_points` and `app.points_metadata_is_flat` unreachable by every client
role, and `search_path` pinned on every definer.

Deliberately **not** run, per scope: Playwright, persona UAT, frontend visual
tests, Lighthouse, backend suites. No `.pen` file was touched.

### Open, and blocking only the wiring increment

**D1** (point value for the one approved event) · **D3** (manager visibility) ·
**D4** (expiry) · **D5** (relationship to Sales Score, which remains **undefined
repo-wide** and so is not designed against). Only D1 is on the critical path,
and it blocks the call site alone — not the table, the RLS, the idempotency key
or the reversal path.

---

## Session — The approved visual direction stops being one account's prototype

**Date:** 2026-08-26 · **Branch:** `feature/supplier-dashboard-visual-refresh` · **Base:** `main` @ `f975c38` · **Checkpoint:** `d70ba3b`

The workspace visual system had been reviewed live, in the running application, behind a
gate: `user.email === "fady@example.test"`. It was approved. This session turns it into the
Aladdin design system — a productionization pass, not another visual exploration. No part of
the approved direction was redesigned.

### The shape of the thing being promoted

The gate was one boolean and one attribute, which is what made it removable. `designLabAtmosphere`
was computed in two places (`app/b2b/layout.tsx`, `server/queries/page-context.ts`) and threaded as a
prop through `AppShell` → `SidebarShell` → `Sidebar`, plus the supply dashboard. `AppShell` stamped
`data-design-lab="atmosphere"` on the shell root, and ~400 lines of unlayered CSS in `globals.css`
hung off that attribute.

Almost all of that CSS was **override-shaped** — it either re-declared a token or put `!important`
on a Tailwind utility. That is what decided the promotion strategy: the token re-declarations moved
into `tokens.css` and became *the* values rather than overrides, at which point most of the
`!important` rules had nothing left to fight and simply disappeared. What survived into
`globals.css` is only the genuinely structural part — material, elevation, stickiness — which no
token value can express.

### The trap this pass turned on, and it is worth remembering

`[data-design-lab="atmosphere"]` is an attribute selector with specificity (0,1,0) — **identical to
`.dark`** — declared later in the cascade. So every token the prototype's *light* block declared also
won **in dark mode**. Reading that block as "the light values" and re-deriving dark equivalents is
therefore wrong by construction, and it is exactly the mistake made here first: `--shell-active`
(white 14%), `--shell-gold` (0.5) and `--shell-gold-soft` (0.12) were "deliberately re-derived" for
dark at 9% / 0.4 / 0.1. The pixel diff caught it — the dark fold moved where light was byte-identical.
Restoring the three values brought dark back to `0.0000%` moved. **The percentages are theme-
independent because the tokens they mix FROM already carry the theme**; re-deriving on top of an
already-re-derived base double-counts it.

### One real bug fixed while promoting, and it had been invisible

The prototype's continuity rule read
`body:has([data-design-lab]) { background-color: var(--dlab-mesh-base, var(--frame)); }`.
`--dlab-mesh-base` was declared on a **descendant** of `<body>`, and custom properties inherit
downward only — so on `<body>` it was undefined and the `var(--frame)` fallback always won. In light
theme `--frame` (#e9ecf2) and the mesh base (#e6ebf2) are three units apart and nobody could see it.
In dark, `--frame` was #05070a against a #111a24 mesh, so every part of a long page below the first
viewport painted near-black instead of the field. The canonical rule keys off a token defined on
`:root`, which is what the prototype's own comment said it intended all along.

### Role-awareness is not what got globalized

The design LANGUAGE is global; navigation content and modules are not. Supplier-only modules stay
behind the capability that means "this workspace publishes products" (`catalog.write` /
`catalog.publish`) rather than behind an identity — which is what `designLabAtmosphere &&
managesCatalog` had been hiding: the second half was always the one doing real work.

Verified across the account matrix (`design-lab/matrix.spec.ts`, six identities, EN/AR, light/dark,
desktop + phone). The buyer-side showroom workspace renders the approved shell with **buyer** content
and no supplier modules. The personal `/home` surface and the Admin console are pixel-identical to
before — they are different shells with no atmosphere and no sidebar, and forcing B2B chrome into
them was explicitly not the task.

### Accessibility defects found in the approved prototype and fixed

Production is a higher bar than a review build, and two of these would have shipped:

- **Collapsed nav groups were clipped, not hidden.** A `0fr` grid track plus `overflow: hidden`
  removes rows visually and leaves them in the tab order and the accessibility tree — a keyboard user
  walked through ~12 invisible links on a rail with four closed groups. Now `inert`, which removes
  both without killing the height transition the collapse is built on.
- **The collapsed Settings and Upgrade rows had no accessible name at all** — icon-only, no
  `aria-label`, and both pointing at the same href, so a screen reader announced two identical
  unnamed links.
- The Upgrade label was an inline `locale === "ar" ? … : …` ternary, invisible to the AR/EN parity
  test; now `nav.upgrade` in both catalogues.
- The Arabic Reels title carried an untranslated `(Reels)`; the parity suite flagged it the moment
  the module stopped being gated.

### Removed, and why each was safe

The shell-palette A/B proposal (`data-shell-palette="ink"`) is **settled** — neither candidate won,
the adopted shell is a third value, and the block plus its comparison script are gone. The frame
family (`--frame`, `--frame-2`, `--frame-tint`, `--frame-tint-soft`, `--frame-warm`), the body alpha
ramp (`--body-veil*`, `--body-solid`), two of the three direction variables, the three dead navy
*surface* entries and the `frame` Tailwind colour group were all removed because nothing paints that
plane any more. `--navy-air` and `--navy-edge` survive as what they always were: tint sources, never
surfaces. Five one-off variant-exploration scripts (`fady-*-shell.mjs` and friends) went; the capture
harness stayed and gained `matrix.spec.ts`, `regress.mjs` and `where.mjs`.

### Validation

typecheck clean · `eslint .` clean (one pre-existing `exhaustive-deps` warning, untouched) ·
**448/448 unit** green, including a rewritten `sidebar-shell.test.tsx` — seven of its assertions
encoded the OLD footer control's contract (a click that opened a menu, a `px-3` full-width row, a
tile armed through an inner span) and were rewritten to the canonical control rather than patched
green.

**Visual regression, measured rather than eyeballed** (`design-lab/regress.mjs`, decoding both PNGs
in a browser canvas — no new image dependency): the approved reference is **0.0000% moved, max
channel Δ 0** at the fold in EN-light, AR-light and EN-dark. The two remaining deltas are both
deliberate and named: the Arabic full page moves 0.0144% (the `(Reels)` removal) and the dark full
page 17.4% at Δ≤26 (the `<body>` ground bug above, below the first viewport).

Reduced motion asserted, not photographed: the carve records exactly two positions under
`prefers-reduced-motion` and tweens without it. **Note for the next run** — the reduced-motion spec
reports a vacuous single-position pass when the dev server is cold, because the 900ms sample window
closes while Next is still compiling the route. It is a harness limit, not a defect; run it twice.

### What is NOT closed

The dashboard **period selector** was pulled from the page heading row on review (it competed with
"+ New product"). The period still resolves from `?period=` and every comparison still computes from
it, but there is now **no UI to change it** for any account. That wants a placement decision, not a
re-add of the rejected control.

`design/tokens/colors.json` gained the shell/workspace family and a `knownDrift` block. The drift is
**pre-existing and older than this session**: that file still names Basalt as the dark canvas ramp,
while the implementation moved the dark ground to Carbon several passes ago. Reconciling it is its
own task.

---

## Session — message.sent: telling the counterparty, without telling anyone who cannot look

**Date:** 2026-08-23 · **Branch:** `feature/engagement-notifications-points-core` · **Base:** `main` @ `34b06d4`

Chat became usable earlier the same day (`315296a`). This entry covers the one
seam that was deliberately left unwired then: a persisted Chat message now emits
a `message.sent` notification to the **opposite transaction party**, and to
nobody else.

### The event, and why its subject is not fixed

`message.sent` is the sixteenth value in `ck_notifications_event_type_known` and
the first whose `subject_type` varies per row. Every other event is emitted by an
RPC that owns exactly one kind of record; a conversation is a *property of a
transaction* (§4), so the notice inherits the conversation's own subject —
`rfq`, `quotation` or `order` — and deep-links to that record's existing route.

There is deliberately **no `/chat` route**, and none was invented for the notice
to point at. The recipient lands on the real transaction record and opens Chat
from the entry point already there, which keeps one navigation architecture
instead of two.

Emission is one `app.notify_org(...)` inside `send_message`, beside the existing
writes and **in the same transaction**. That coupling is the point, and the test
for it is not "both rows exist afterwards" — two separate transactions would
produce that too. It takes a savepoint, sends, asserts both the message and its
notification are present, rolls back, and asserts **both** are gone. Only shared
transaction scope produces that pair of outcomes; a background or deferred notify
would survive the rollback.

### No dedupe, decided rather than deferred

Q6 in `chat-core.md` had blocked this seam on notification volume, recommending
*at most one unread notice per recipient per subject*. Decided the other way for
the Pilot: **every persisted message is an independent notification event.** A
dedupe rule that suppresses a notice because an earlier one is still unread makes
the inbox lie about how much correspondence is waiting, and the failure it
prevents — a noisy badge — is more recoverable than the one it causes, which is a
message nobody was told about. The rule stays available as a purely additive
change, and `ix_notifications_subject` still supports it directly.

### The message body is not in the notification, and there is nowhere to put it

Params are `{"counterparty_name": …}` and nothing else. Notifications and Chat
have **different visibility rules**, so a preview would mirror private
correspondence past the narrower one. Asserted at both layers: pgTAP proves no
`body` / `message` / `excerpt` / `preview` key and no body text ever reaches a
row, and a frontend test feeds a row with a smuggled body and proves the rendered
sentence is byte-identical to the clean one — because the catalog sentence has
exactly one placeholder and it is not for content.

The copy stays generic about the record ("about this transaction") rather than
naming *this request* / *this order*. One event serves three subject types, so a
subject noun would have to arrive as a param — which would mean the database
persisting an English word into a row an Arabic reader may open, the exact leak
the keys-not-sentences rule exists to prevent. The deep link carries the
specificity.

### The defect this increment introduced, and then fixed

The first wiring inherited `app.notify_org`'s approved **`org.manage` owner
fallback**, which fires when the capability yields no holder so that a notice is
never silently dropped. That is right for all fifteen existing events and wrong
for this one, and the reason generalises cleanly:

> The owner fallback is safe **exactly when an owner could already read the
> record the notice is about.**

For commerce and verification they can — an owner can open the rfq, quotation,
order or verification, so the fallback only widens *who is told* about something
they were already entitled to see. Chat is the first event whose subject sits
behind a capability an owner may not hold: access is `active membership +
conversation.participate`, so `conversations_select_party` refuses an owner
holding only `org.manage`. In a counterparty organization with no capability
holder, the fallback would have told that owner a conversation exists, on which
record, and with which counterparty — every fact except the body — about a thread
the database would refuse to show them. **The notification would have become a
wider read path than the feature it describes.**

`20260823090003` gives `app.notify_org` a `p_allow_owner_fallback boolean default
true`; `send_message` passes `false`. The default preserves the fallback for all
thirteen existing call sites without touching one of them. Two notes on the shape:

- **DROP + CREATE, not CREATE OR REPLACE.** A ten-argument overload beside the
  nine-argument original makes every existing nine-argument call ambiguous
  (*"function is not unique"*). Dropping is safe because plpgsql resolves callees
  by name at execution time, so the thirteen callers rebind and pick up the
  default — but the drop takes the `revoke` with it, and internal-only status has
  to be re-established explicitly.
- **The flag is a call-site decision, not `p_event_type <> 'message.sent'` inside
  the helper.** Whether an owner may be told is a property of the emitting
  event's authorization model; hard-coding one event name into a generic
  mechanism would quietly mislead the next event with the same shape.

**When nobody qualifies, nobody is told, and the message still persists.** Silence
is the correct outcome: a dropped notice is strictly safer than a disclosed one,
and the counterparty sees the conversation the moment somebody there is granted
the capability, because Chat reads are live rather than replayed from an inbox.

### Two tests that were passing and wrong

Worth recording, because both are the same mistake in different clothes: a test
that agrees with itself proves nothing.

1. The new suite's recipient-authority assertions were verified **against a
   deliberately reverted `notify_org`** with the fallback forced back on. Two
   failed and the "fallback still works for other events" assertion still passed
   — which is what proves they discriminate the two cases rather than merely
   observing a green database.
2. One assertion checked a **live-capability property across historical rows**,
   and the suite itself falsifies it by revoking a capability mid-run. A
   capability revoked *after* a legitimate notice does not make that notice
   retroactively wrong. It is now asserted as a delta.

`33_chat_core_test.sql` also had two assertions that were correct for the
previous increment and are now false — it proved emission was *absent* and that
`message.sent` was *not* in the allow-list. Both were inverted rather than
deleted: the seam is exactly what they were watching.

### Validation

Clean `supabase db reset`, then the four directly affected suites: new
`34_chat_message_notifications_test.sql` **46/46**, `33_chat_core_test` 106/106,
`31_notifications_core_test` 38/38, `32_notifications_event_emission_test` 50/50
— **240 assertions, no failures**. Verified live afterwards that exactly one
`app.notify_org` exists (no ambiguous overload), that it grants EXECUTE to
neither `authenticated` nor `service_role`, and that `send_message` kept its
grant and its exact signature including parameter names — PostgREST calls it by
named argument, so a rename would break every caller as surely as a retype.

Frontend: 61 targeted notification/i18n tests, typecheck and `eslint .` all
clean. The recipient-authority fix is entirely database-side and changed no
frontend file.

Per instruction: no full Playwright, no E2E, no Lighthouse, no persona matrix,
and no Realtime or Points.

---

## Session — Transactional Chat: the application half, and a seam where two correct layers did not meet

**Date:** 2026-08-23 · **Branch:** `feature/engagement-notifications-points-core` · **Base:** `main` @ `34b06d4`

The Chat Core database foundation landed earlier the same day (`b2854b2` specification, `5953233`
tables + RLS + the three RPCs). This entry covers the **application and UI half** — the read layer, the
mutation layer, the view model, the conversation list, the thread, and the three transactional entry
points that reach them.

### The thread lives in the header panel, because inventing a route was not this increment's decision

`docs/database/chat-core.md` §3.5 records that **there is no `/chat` route** anywhere under
`frontend/src/app`, and the specification establishes no canonical thread destination. So none was
invented. A conversation opens **inside the existing header Chat panel**: the list is the panel body,
and selecting a row replaces that body with the thread. The panel's geometry, width, anchoring,
viewport clamp, Escape and outside-click behaviour are untouched — the change is exactly what
`header-panels.tsx` predicted it would be when Notifications went through the same transition: a body
swapped in behind the same heading, and a badge passed in. This placement is now approved for the Pilot.

The seam from a record page to the panel is a `window` CustomEvent (`aladdin:chat-open`). The panel
lives in the shared LAYOUT, which never sees `searchParams`, and which conversation is open is
ephemeral UI state rather than a preference worth persisting. The event carries only a conversation id
the server action just returned **for this caller**, so it grants nothing and can open nothing RLS
would refuse.

### The frontend re-implements no part of the authorization decision

Access is already settled by the database: an active membership holding `conversation.participate` in
one of the transaction's two organizations. So `server/queries/chat.ts` runs on the caller-scoped
client and adds **no ownership predicate of its own**, and — unlike Notifications, which takes an
optional `organization_id` as UX scope — **no organization id is an argument anywhere in the module**.
A notification row carries one org column; a conversation carries TWO parties and neither is "the" org
of the thread, so filtering on either here would re-implement half the database's party test in a
second, divergenceable place. The active-workspace org enters only at the VIEW MODEL, where it decides
which of two already-visible names to call the counterparty.

The same rule governs the write path. All three mutations forward the caller's JWT to the approved
`security definer` RPCs and pass **nothing else**: `open_conversation` derives both parties from the
authoritative subject row, and `send_message` resolves sender user and sender organization from
`auth.uid()` plus the conversation's own columns. Neither identity is a parameter, and there is no prop
for one in either direction. A `42501` — suspended membership, withdrawn capability, changed context —
collapses to **one neutral translated string** that names nothing about whether the conversation
exists, because §7.6 makes "does not exist" and "exists but not yours" deliberately indistinguishable
and the error text must not undo that.

### Unread counts conversations, and never touches `public.messages`

The badge is `last_message_at` vs the caller's own `last_read_at`, exactly as §11 specifies — no
per-message receipts, and none may be added. Read state rides along as an RLS-gated embed, so a
conversation the caller can no longer reach drops out of the count on its own and the badge can never
count a thread the panel cannot open. Marking read fires only when a thread is **genuinely opened**
(opening the panel marks nothing), then `router.refresh()` re-renders the route and its layouts so the
badge reconciles without a browser reload.

### The defect: two correct layers, one key, two spellings of it

Found by looking at a screenshot, not by a failing test. Every conversation row rendered as bare
"Order" with no counterparty and no record title, and every counterparty message was attributed to
`· 05:18 PM` — a separator, a time, and no name.

`resolveConversationDisplayContext` keys its map by **subject id** (it queries the commerce `_list`
projections, which know nothing about conversations). `toConversationViews` looked that map up by
**conversation id**. Both halves had passing unit tests, because each test agreed with its own half's
idea of the key. Unit tests verify components; only a test that spans the boundary verifies that two
correct components fit together — and there was no such test, so the feature rendered every label blank
while the suite stayed green.

Both sides now build the key through one exported `conversationSubjectKey(subjectType, subjectId)`,
qualified by type because a bare subject id is ambiguous across three source tables. A new test drives
the real resolver into the real view model with a conversation id deliberately unequal to the subject
id, so the key can only be wrong in one place at a time again. The longer subject line this fix
restored then wrapped the thread's back control onto two lines; `shrink-0 whitespace-nowrap` makes the
subject truncate instead.

### Deliberately not built

No Realtime, no subscriptions, no presence, no typing — Chat works through persisted reads, sends and
router refresh, and the realtime publication is untouched. No `message.sent` notification wiring: that
is a separate increment after Chat is accepted, and the notifications CHECK constraint, event wiring
and UI are unchanged. No project Chat subject — `projects` is 1:1 with `orders` and names the same two
organizations, so a project page uses its parent order's conversation (§4.3); the entry-point
component's type cannot even express `project`. No avatars, presence dots, message previews, tabs,
search, filters or archive controls, and no bulk mark-all-read.

### Validation

typecheck · `eslint .` both clean, zero warnings. **116 unit tests** green across the chat query,
action, view-model, panel and entry-point suites plus the directly affected notifications and i18n
parity suites — covering ordering and bounds, chronological messages, the unread model in all three
of its cases, that the actions call only the approved RPCs and never supply sender or organization
identity, the composer's whitespace and 4000-character boundaries with the database still final
authority, the pending-send gate, the zero-conversation empty state, unread carried without colour
alone, badge correctness and reconciliation, AR and EN copy, and the cross-layer seam above.

Real browser, real Email-OTP through Mailpit, production build, no auth bypass: **25 checks** across
both parties of one real persisted order conversation — send, persistence after a full reload,
mark-read with the badge reconciling without a reload, English LTR and Arabic RTL, light and dark, and
a 393px phone where the panel stays inside the viewport in both the list and the thread. The honest
ZERO state was verified as a user whose organization is party to no conversation, and the empty
thread on an RFQ that genuinely had none — both reached the way a real user reaches them, rather than
by deleting persisted rows to manufacture the state. Review harnesses and screenshots were temporary
and are not committed.

Per instruction: no full Playwright suite, no E2E matrix, no pgTAP re-run, no Lighthouse, no persona
matrix.

---

## Session — Notifications Core: the read/UI half, and a shared panel that did not fit a phone

**Date:** 2026-08-23 · **Branch:** `feature/engagement-notifications-points-core` · **Base:** `main` @ `34b06d4`

The database half of Notifications Core landed in three earlier commits on this branch (`8fe74df` spec, `7a6a154` table + RLS, `619c8f3` event wiring). This entry covers the **read and UI half** — the queries, the mutations, the view model, the one list, and the two surfaces that render it — plus one shared-shell defect that only became visible once the panel had real content in it.

### The read path adds no ownership check of its own, deliberately

`public.notifications` carries exactly one RLS policy, `recipient_user_id = auth.uid()`, and no org-wide read path. So `server/queries/notifications.ts` runs on the caller-scoped client and adds **nothing**: there is no ownership filter to add that RLS has not already decided, and a duplicated check in TypeScript would only be a second place to get it wrong.

`organization_id` appears in the query layer as an **optional UX argument**, never as authority. It scopes the list to the active work context; passing an org you do not belong to cannot widen an RLS-bounded result, only narrow it to zero rows. That is why the specification forbids the column from ever reaching a `USING` clause, and why the header passes it and a personal surface does not.

Two reads, split on purpose. `countUnread` uses `head: true` — Postgres counts and returns the number in a header, transferring no rows. This runs on **every authenticated page render** to decide whether the bell carries a badge, so fetching twenty rows to learn one integer would have been the most-repeated waste in the shell. `listNotifications` is capped at 20 by construction: both surfaces are RECENT lists, not archives, and a cap means a runaway inbox degrades into a shorter list rather than a slower page.

### Rows store i18n keys, and the badge counts the database

Two decisions that look like detail and are not:

- **A row stores `title_key` / `body_key` / `params`, never a rendered sentence.** Arabic is an MVP release language and a reader's locale can change *after* a row is written; storing "Nile Ceramics sent you a quotation" would freeze one language into a permanent record. `view-model.ts` builds the sentence at render time and never composes one of its own. It runs on the **server**, in the reader's locale, before the panel is ever opened — so the client receives finished strings and the i18n catalog stays out of the browser bundle for a panel most page views never open.
- **A row the UI has no copy for still renders**, under a neutral translated fallback title, still carrying its deep link. Dropping it would make the header lie: `countUnread` counts rows in the *database*, so a dropped unread row leaves a badge reading "2" over a panel showing one item. Missing copy is a translation gap, not a reason to withhold someone's mail.

The badge follows the same rule. `effectiveUnread` is the **server total minus what has been read since**, never a count of what happens to be on screen — a reader with thirty unread who opens one notice sees 29, not 19. Marking read fires the RPC and then `router.refresh()`, which re-renders the current route *and its layouts*, so the badge (which lives in the layout) updates with the list and without a browser reload. No `revalidatePath`: one broad enough to catch the header would expire the entire B2B subtree for a change that affects one number.

### One list, two densities, and no button inside a link

`notification-list.tsx` is **the** notification list. The header panel and the supply-dashboard block differ in DENSITY and in nothing else — same row, same unread cue, same deep link, same read-state behaviour. A dashboard block with its own row design would be a second thing to keep in step every time the shape of a notification changes.

A row is a link, and the **whole row** is the link — not a link with a "mark read" button inside it. Nesting a button in an anchor is invalid HTML that browsers resolve inconsistently and screen readers announce as two overlapping targets. Marking read is a side effect of opening the notice, which is also the honest model: you have read it because you went and looked. The unread cue is a dot **and** a visually-hidden word, because colour alone cannot carry the distinction (WCAG 1.4.1) and a screen reader gets no signal from a coloured span.

### The shared header panel did not fit a 393px phone, and the width cap could not have caught it

Found in real-browser smoke, not by reading: at 393px the Notifications panel ran off the far edge of the screen and **clipped the start of every row** — in Arabic, the first word of every sentence.

`headerPanelClass` is `absolute end-0 top-full mt-1 w-80`, which anchors the panel to its TRIGGER. That is the right relationship — a panel that detaches from the control that opened it reads as a different surface — but the trigger is not at the edge of the screen. Notifications sits fifth in a cluster of seven, roughly 130px in from the header's inline-end edge. A desktop header has room for the 320px panel to hang inward from there; a phone does not.

**`menuSurfaceClass` already carries `max-w-[calc(100vw-1.5rem)]`, and that cap is exactly why this survived the pass that introduced it.** A max-width can only rescue a surface that is too WIDE. This one was the approved width and in the wrong PLACE, and no max-width moves a box.

The fix is positioning only, in two files. The panel `<div>` moved out of `HeaderMenu` into a `HeaderPanelSurface` component — same markup, same classes, same z-layer — that corrects its own horizontal offset in `useLayoutEffect`: measure the natural box, and if either physical edge falls outside a 12px viewport gutter, `translateX` it back in by exactly that much. Three properties keep this a small fix rather than a positioning system:

- **It is PHYSICAL, so there is no direction branch.** `getBoundingClientRect` and `translateX` are both left-to-right whatever `dir` says, so RTL and LTR overflow — exact mirror images, off opposite edges — collapse into one subtraction. A logical fix would have needed two cases and could only ever have been half tested.
- **It is a no-op where it is not needed.** On a desktop header nothing falls outside the gutter, `dx` is 0, no transform is written, and the approved desktop geometry is not merely preserved but untouched.
- **It has no breakpoint**, so it cannot drift the next time the control cluster gains or loses an icon — which is the change that would silently re-break a `tablet:` override.

Rendered only while open, which is what lets it use `useLayoutEffect` with no isomorphic shim: `open` is false through SSR, so the measurement never runs on the server. All three panels (Notifications, Chat, Feedback) come from the one shell and are fixed together.

The accepted mobile result is that the panel **docks to the screen gutter** below the header rather than sitting directly beneath its bell. A caret or a full-bleed phone sheet was considered and explicitly declined — that is a design change, not a positioning fix.

### Validation

Frontend typecheck ✓ · `eslint .` ✓ (0 errors, 0 warnings) · unit **375/375** across 37 files, of which **35 are new here** (21 panel/list tests covering the optimistic decrement, the "mark all" snapshot expiry and the degraded row; 14 view-model tests covering key resolution, money interpolation, the protocol-relative `//evil.example` deep link and the fallback title).

Real browser, real Email-OTP through Mailpit, no auth bypass, against a production `next build` + `next start` — `rania@example.test` (Distributor):

- **The badge decrement, at 393px.** 23 unread seeded against the 20-row list cap — the only arrangement in which "the badge counts server rows" and "the badge counts visible rows" give different answers. Badge read 23 on arrival, panel showed 20 rows, opening one notice left **exactly one** row with `read_at` set in the database, and the badge read 22 after the navigation *and* again after a cold reload. 23 → 22, server-side, not an optimistic illusion.
- **The panel clamp, at 393px in both directions.** Notifications with 23 real rows in Arabic and English, plus a Chat and Feedback smoke in each: both physical edges inside `documentElement.clientWidth`, zero document overflow, every row measured individually (a legal panel box around still-spilling rows would pass a box-only check and look exactly as broken), and the panel still exactly 320px wide. At 1440 the assertion is the **absence** of an inline transform on all three panels, so "desktop anchoring preserved" is checked rather than intended.

**Not run, per the brief:** full E2E, pgTAP (no schema change in this increment), Lighthouse, the persona matrix.

### Unfinished / deliberately out of scope

- **The two verification specs are not in the suite.** Both drive a notification fixture through an env var pointing at a scratchpad SQL file, so committing them would break a plain `pnpm e2e`. The badge-decrement spec is worth keeping as a permanent regression guard, but that needs the notification fixture to move into `supabase/demo-seed.sql` first. Not done here.
- Realtime subscriptions, Chat, Points, notification preferences, digests, grouping, pagination and outbound delivery remain out of scope for this increment — see "Out of scope" in `docs/database/notifications-core.md`.
- **Local Supabase note for the next session:** `supabase_inbucket_aladdin` (Mailpit) was not running at the start of this session and had to be started for the OTP path. It was removed again afterwards, so the container set is back to db · pg_meta · rest · auth · kong. Run `supabase start` before any E2E that signs in.

---

## Session — Visual UAT fix round 1: Arabic numerals and the compact sidebar

**Date:** 2026-08-18 · **Branch:** `feature/supply-side-b2b-mvp` (PR #34) · **Base:** `main`

Two defects found in real-browser UAT. Both were fixed at the shared layer rather than at the surfaces where they were spotted, because each was the symptom of one missing rule.

### Arabic numerals: the bug was a missing formatter, not a wrong locale

The Arabic UI mixed numeral systems on the same screen — ١٢ in a panel that happened to route through `Intl`, `12` in the panel beside it. The cause was not that `ar-EG` was wrong; it was that **most numbers never reached a formatter at all**. A bare `{count}` in JSX stringifies through `Number.prototype.toString`, which is locale-blind.

There were three distinct leak paths, and all three are now closed:

1. **Shared primitives rendered raw numbers.** `KpiStrip`, `PageHead`/`PageHeader` (the count pill), `PanelRow`, `StatTiles`, `TabLinks`, `RankedBars`, `Funnel`, and the Admin console's `AdminHeader`/`StatTile`/`DistList` all printed `number` props directly. Each now takes a **required** `locale` and formats numeric values itself. Required, not optional-with-a-default: a default would be a silent wrong answer, and requiring it made the compiler enumerate all **88 call sites** rather than leaving the sweep to grep.
2. **`createTranslator` coerced numeric interpolation with `String(val)`.** This was the single largest source. `t("execution.order.itemCount", { count: items.length })` localised every word of the sentence and then printed `1 عنصر`. The translator now formats a `number` for its bound locale and substitutes a `string` verbatim — which is also what keeps identifiers safe.
3. **Duplicate formatter implementations.** `features/commerce/constants.ts` had its own `formatMoney`/`formatQuantity`, `products-table.tsx` built its own `Intl.NumberFormat`, and `supply-report.tsx` inlined a second copy of `orderCountLabel` with `String(c.orders)` — which is exactly where a Latin `2` survived into `2 طلبيات` on an otherwise fully-localized report. All now route through `lib/ui/format.ts`. **There is no `new Intl.` anywhere in `src/` outside that one file.**

`lib/ui/format.ts` is the single layer. Two decisions in it are worth keeping:

- **The locale tag is `ar-EG-u-nu-arab`, not `ar-EG`.** CLDR's default numbering system for Egypt has moved between `arab` and `latn` across ICU versions, and the server's Node, the browser's ICU and a CI container need not agree. Pinning the numbering system in the tag makes every runtime produce the same digits. The calendar is pinned to `gregory` for the same reason. Formatter instances are memoized per (tag, options) — a fifty-row table with four money columns would otherwise construct two hundred `Intl` objects per render.
- **Identifiers are the explicit exception.** `formatIdentifier()` passes `ORD-1256`, SKUs, UUIDs, emails and URLs through unchanged in every locale. It is a function rather than "just don't call a formatter" so the intent is greppable and a reviewer can tell a deliberate exemption from an oversight.

### The sidebar leaked its own mode name, and only during a hover

The compact rail's nav items were already icon-only. The defect was the **mode control at the foot**: its label was gated on `narrow`, which is momentary. In expand-on-hover the panel widens the instant the pointer crosses it, so reaching for the control made it print `التوسيع عند المرور` — the name of the mode you were already in.

The label is now gated on `mode === "expanded"` — the CHOSEN mode, not the current width. Collapsed and expand-on-hover keep the closed control icon-only through every phase of the reveal; the mode names still exist inside the menu the control opens, where the user is actually choosing between them. The accessible name gained the active mode (`"الشريط الجانبي: مصغّر"`), so a screen-reader user is told more than the sighted user sees, not less.

### Validation

Frontend typecheck ✓ · lint ✓ (0 errors, 0 warnings) · unit **295/295** ✓ (20 new formatter tests asserting digits rather than separators — pinning ICU's grouping marks would break the suite on a Node upgrade for no user-visible reason; 3 translator-interpolation tests; 6 sidebar tests covering the collapsed and mid-reveal control).

Real-browser UAT through the real Email-OTP path:

- **`rania@example.test`** (Distributor, Arabic) — dashboard, orders, order detail, reports, products, quotations, suppliers, organization, settings and catalog each scanned with a DOM probe for Latin digits in `#main`: **zero**, on every one. All three sidebar modes exercised; the hover reveal floats the panel to 240px while the spacer stays at 56px (no page reflow), shows 17–18 labels with **no duplicates**, no `role="tooltip"` and no `title` attributes.
- **`mahmoud@example.test`** (Manufacturer, English) — zero Arabic-Indic digits; `EGP 896.8K`, `Sep 24, 2026`, counts all Western.
- **`hana@example.test`** (Showroom) and **`admin@example.test`** (Admin console, both locales) — collapsed rail `innerText` is the empty string, aria-labels intact. The Admin console keeps its fixed labelled aside: it has no compact mode, so the icon-only contract does not apply to it.

The only Latin digits found anywhere in Arabic were **product names and seeded test-account display names** (`Porcelain Floor Tile 60×60`, `Sales Refers 1787049063346`) — content, correctly left alone.

**Not run, per the brief:** full E2E, pgTAP (no schema change), performance, the persona matrix. A hydration warning in the dev console is caused by a browser extension injecting `data-gr-ext-installed` onto `<body>`; it is not from this branch.

---

## Session — Distributor terminology closeout

**Date:** 2026-08-17 · **Branch:** `chore/distributor-terminology-closeout` · **Base:** `main` @ `474a6f0`

### Arabic Distributor terminology is now diacritic-free
The shipped Arabic labels carried `U+0651 ARABIC SHADDA` — `الموزّع` / `الموزّعون` / `الموزّعين`. Both spellings are correct Arabic, but the approved convention is diacritic-free, so the shadda was removed from the Distributor **noun** only.

The replacement matched the stem `م + و + ز + SHADDA + ع` rather than a word list. That skeleton is what makes it safe:

- **Grammar is preserved automatically.** Prefixes (`ال`, `لل`) and suffixes (`ون`, `ين`) ride along untouched, so definite/indefinite, singular/plural and nominative vs. accusative/genitive survive the edit — `الموزّعين` became `الموزعين`, **not** `الموزعون`.
- **Same-root verbs are structurally excluded.** `يوزّع` and `وزّع` ("distributes" / "distribute", `ar.ts:809, 815, 820`) have no meem before the waw, so the pattern cannot reach them. They keep their shadda deliberately — they are not the Distributor term.
- **Proof that nothing else moved:** for every file the drop in *total* `U+0651` count equals the number of Distributor replacements exactly (39/39, 2/2, 1/1, 2/2). Any unrelated Arabic word losing a shadda would have broken that equality and aborted the run.

**44 strings across 4 files.** The two E2E specs matter as much as the messages file: `showroom-mvp.spec.ts:425` asserts `toHaveText("الموزعون")` and `shared-onboarding.spec.ts:131` matches a button by `/موزع/` — changing `ar.ts` alone would have broken both. `RUNTIME_STATE.md` describes the live labels and was updated with them; `المورّد` there keeps its shadda because it is a *different word*, quoted as the term Distributor replaced.

`supplier` remains the internal identifier — enum, columns, message keys, `{supplier}` placeholders and route paths are all unchanged, and it is still never user-facing copy. The previous entry below quotes the old shadda-bearing strings; that record is accurate for the session it describes and was left alone.

### The archive branch is no longer load-bearing
`PRODUCT_DIRECTION_GUIDE.md` claimed the original wording was "preserved on the `archive/product-decisions-20260808` branch". That made canonical project memory depend on a temporary ref. Both references now state that the historical 2026-08-08 decisions were reconciled from commit `d7f947e` and that this guide holds the current decisions and supersession outcomes. **`archive/product-decisions-20260808` can be deleted once this merges.** No archived content was restored.

---

## Session — Reconciling the lost 2026-08-08 product decisions

**Date:** 2026-08-17 · **Branch:** `docs/reconcile-product-decisions` · **Base:** `main` @ `e914f88`

### What happened
Branch cleanup found that `docs/technical-finalization` carried **one local-only commit** (`d7f947e`, 2026-08-08) whose approved product decisions had never reached `main` — PR #1 merged on 2026-08-02, six days before that commit was written, so GitHub reported the remote branch as *Ahead 0* while the work sat only on a laptop. The commit was pushed to `archive/product-decisions-20260808` as a safety copy. PR #31, opened from that archival branch, was **closed unmerged** on purpose: it conflicts with `main` and predates the current Vercel Services architecture.

### Reconciled, not merged
Each 2026-08-08 decision was re-checked against the *implemented* product rather than cherry-picked. Sprints 9–14 had already built the B2B workflow differently, so most of the commit is obsolete:

| Decision | Outcome |
|---|---|
| Free Pilot / no payment collected | **Ported** — `mvp-scope.md`, `PRODUCT_DIRECTION_GUIDE.md` |
| Arabic default + exact English parity | **Ported** (matches `APP_DEFAULT_LOCALE = "ar"`, previously undocumented in product memory) |
| Progressive-disclosure need capture | **Ported** — surface not yet built, nothing contradicts it |
| Deferred advanced B2B administration | **Ported** — new *Deferred Scope* bullet |
| `needs_captured → products_shared → quote_sent` pipeline | **Superseded** by the implemented `lead_stage` / `transition_lead` (ADR-0008) |
| "Quote Comparison is not MVP" | **Superseded** — the buyer-first quotations surface compares received offers |
| Projects Lite + availability vocabularies | **Superseded** by `project_status` and `product_status` |
| "Admin activates accounts manually" | **Superseded** by *Activation vs. Verification* (2026-08-11) |
| B2B responsive contract · AI match/share rules | **Already represented**, in more depth, by the UI/UX guide and *AI Principles* |

The superseded set is recorded in a table in `PRODUCT_DIRECTION_GUIDE.md` — naming what replaced each one is what stops the next agent from re-importing the archive branch.

### Not done, deliberately
The commit's `design/CHANGELOG.md` and `design/COMPONENT_INVENTORY.md` edits claim fifteen Draft Pencil masters exist in `design.pen`. `.pen` files are gitignored and encrypted, so that claim is **unverifiable from the repository** and was not ported. Separately, both files still open with "No product components are implemented yet" while `frontend/src/components/` holds 26 files — a pre-existing staleness on `main`, left for a design-scoped session.

**Validation:** `python scripts/check_doc_links.py` → 898 internal links across 106 files, 0 broken. Documentation only: no code, config, migrations, Supabase, Vercel or `.pen` changes.

---

## Session — Making all 26 staging demo accounts usable

**Date:** 2026-08-16 · **Branch:** `chore/staging-demo-accounts` · **Base:** `chore/vercel-services-deploy` @ `44a4cdd`

### Objective
Before the one-time staging seed runs on Supabase Cloud, make **every one of the 26 seeded auth users** a usable client-demo account: a deliverable sign-in address, and demo data that matches its persona, organization, role and RLS scope. No migration edits, no seed-file edits, no raw seed run against Cloud, no weakened RLS, no passwords, no auth bypass, and no real mailbox in git.

### The audit came first, and it changed the scope
The 26 accounts were **not** all populated. That was established by impersonating each user under RLS — `set_config('request.jwt.claims', …)` with `role = authenticated` inside a rolled-back transaction, so the real policies and the real RPCs decided every count — against a database holding **only the bundled seeds**.

That last qualifier is the finding that mattered. `supabase/demo-seed.sql` had been applied to the local database by hand, and it is **not** in `config.toml [db.seed].sql_paths`, so it is **not** in the staging bundle. Locally, Org A looked populated. In the staging shape it was empty. Reading the SQL would have missed this entirely.

| Gap | Accounts | Evidence |
|---|---|---|
| Zero rows in every module | `a-owner`, `a-cairo`, `b-owner`, `sara` | rfq/quo/ord/prj/cust/lead/fup all `0` |
| Personal home is a blank profile | 14 accounts landing on `/home` | `onboarding_progress` **0 rows**, `individual_onboarding` **0 rows** repo-wide → ~8% completeness |
| Nav offers modules that return nothing | `a-cairo` | holds superseded `sales.opportunity.*`; the RLS policy requires `sales.read` |
| Empty salesperson affiliation panel | `a-cairo`, `laila` | `organization_join_requests` / `organization_referrals` both 0 rows |
| No account can receive a sign-in code | **all 26** | every address is `@example.test`, a reserved TLD (RFC 6761); auth is Email OTP only |

A second, non-obvious fact fell out of the same probe and is now recorded in the manifest: **14 of 26 accounts land on `/home`, not `/b2b`**, because `resolveWorkContext` prefers the Personal context whenever a personal persona exists. That is the documented model, not a defect — and it is the same behaviour a previous session recorded as the cause of the pre-existing `pilot-landing.spec.ts:65` failure.

### What was built
Everything is **staging-only and additive**. `config.toml [db.seed].sql_paths` is unchanged, so `supabase db reset`, the pgTAP snapshots and the Playwright fixtures see exactly what they saw before.

- **`supabase/staging/demo-accounts.toml`** — the 26 accounts as the single source of truth for the manifest, the remap and the validator. Holds **no email addresses**; the validator fails if this list and `auth.users` ever drift apart.
- **`supabase/staging/demo-enrichment.sql`** — the additive layer. Repairs three memberships' capabilities (granted the way the product's own people-ops UI grants them — no policy widened, and the legacy `sales.opportunity.*` rows are deliberately left in place as real history); gives Org A a supplier world split across its two branches so Karim's Cairo-only view is provably narrower than Amina's; gives Org B and Sara real commerce chains; writes the onboarding rows 14 personal accounts were missing; adds a four-outcome verification spread; and fills the two empty affiliation panels. New rows use a reserved `fa……` UUID prefix no seed file uses.
- **Configurable demo email, failing closed** — `scripts/staging_demo.py` composes one unique address per account from a mailbox the owner configures (`supabase/staging/demo-email.toml`, gitignored; template committed). Without one, the build **refuses to write the cloud artifact**. Reserved domains are rejected — including `example.com` *and its subdomains*, which a unit test caught slipping through. `--rehearsal` writes a separate, clearly-named artifact so a practice run can never be mistaken for the cloud one.
- **`supabase/staging/verify-staging-seed.sql`** — read-only, wrapped in a transaction that always rolls back. Population, address uniqueness/deliverability/GoTrue token columns, persona and tenancy linkage, commerce totals against their own line items — then all 26 accounts impersonated under RLS for landing route and non-emptiness.
- **`scripts/rehearse_staging_seed.py`** — the whole one-time load, rehearsed locally against `db reset --no-seed`.

### The one account left deliberately empty
**Nour Hegazy** resolves to `consent_pending` and lands on an actionable consent form, not a workspace. She is the pending invitation and the only demo of how an account comes into existence; a finished profile would delete that. The verifier knows her by name and fails if she gains data — or if any other account loses it.

### Passwordless was treated as a constraint, not an obstacle
No demo password, no shared credential, no `generate_link` service-role workaround in the happy path. The accounts sign in exactly as a real user does. The previous runbook's option B (minting an OTP with the service-role key) is removed from the main flow in favour of addresses that actually receive mail.

### Validation
- **Local rehearsal PASSED** end to end (`python scripts/rehearse_staging_seed.py --isolated`):
  - empty database + **28 migrations** replayed → `auth.users`/`organizations` = **0/0**
  - **first apply succeeded** — 26 auth users · 26 profiles · 26 primary contacts · 12 organizations · 13 branches · 17 memberships · 250 capabilities · 14 onboarding_progress · 14 individual_onboarding · 21 products · 21 RFQs · 17 quotations · 12 orders · 7 projects · 9 customers · 10 leads · 10 follow-ups · 11 saved products · 6 verifications · 1 invitation · 1 join request · 1 referral · 29 audit entries
  - **all 26 accounts verified** — every one resolved to the landing route the manifest claims, and every one had visible data. `a-owner` went from all-zeros to `rfq=1 quo=1 ord=1 prj=1 cust=4 lead=4`; `sara` from all-zeros to `rfq=2 quo=2 ord=1 prj=1`; all 14 `/home` accounts have their onboarding rows. Nour was correctly reported as the single exemption.
  - **second apply REFUSED**, and the row counts were **byte-identical before and after** — zero rows written, which is the property that actually matters
- **pgTAP 729/729 ✅ across 29 files, 0 failures**, on a clean `supabase start` (28 migrations + the three declared seeds). This is the number that proves the enrichment stayed out of the local reset path — it is identical to the Sprint 14 baseline, because `config.toml [db.seed].sql_paths` was not touched.
- Python unit tests **20/20** ✅ (`python -m unittest discover -s scripts`) — one of them found and fixed a real hole in the reserved-domain check
- frontend typecheck ✅ · lint ✅ (0 errors, 0 warnings) · unit **236/236** ✅
- `scripts/check_doc_links.py` ✅ — 893 links / 106 files / 0 broken
- E2E/Playwright, Lighthouse and the performance gate deliberately **not** run: no product code changed and no schema changed.

Three defects surfaced during the rehearsal and were fixed in the verifier itself, not worked around: a plpgsql loop record named `r` shadowed every `rfqs r` alias; the report's temporary table was written while still impersonating a demo user (`authenticated` has no rights there, and should not); and psql does not interpolate `:vars` inside dollar-quoted bodies, so the rehearsal flag had to travel as a GUC.

### Incident during this session
`supabase db reset` invoked from the rehearsal driver removed the local database container, and the subsequent restart stalled for a long stretch on `public.ecr.aws` (Docker-side; `curl` reached the registry throughout, and a Docker Hub pull succeeded). The pinned devDependency CLI (2.110.0) and the machine's global CLI (2.113.0) also want **different Postgres image tags**, and only the global one's tag was cached. The rehearsal driver now resolves whichever `supabase` is on `PATH` before falling back to the pinned binary, so it starts the stack the same way the machine already does.

### Not done, deliberately
Nothing was pushed to Supabase, no remote project was touched, the seed was not executed, and the PR was not merged.

---

## Session — Vercel Services deployment architecture (documentation reconciliation)

**Date:** 2026-08-16 · **Branch:** `chore/vercel-services-deploy` · **Base:** `main` @ `c1fbad1` (PR #25 merged)

### Objective
The owner decided that **both** `frontend/` (Next.js) and `backend/` (FastAPI) deploy through **Vercel Services**. Carry the already-validated working-tree changes onto a branch and reconcile the documentation, which still asserted three things that are now wrong. **No deployment, no push, no remote PR change.**

### What the previous session got right, and why it is now superseded
The preceding entry's conclusion — that nothing in `frontend/src` calls FastAPI at runtime — **still holds and was re-verified**; `backend/app` still registers exactly one router (`GET /health`). What changed is not the evidence but the **cost of acting on it.** That session reasoned inside a Vercel-project-per-service model, where deploying the backend meant a second platform account, a second secret store, a second rollback procedure, and cross-origin wiring. Under Vercel Services it costs **one entry in `vercel.json`**, and both services then share a deployment, a preview URL per PR, and a rollback. So the same facts now point the other way.

Three documented claims were therefore withdrawn: **FastAPI must go to Railway**, **FastAPI is not required for staging**, and **no `vercel.json` is needed**.

### Decision recorded as ADR-0009, not as an edit
Per the ADR governance rule (append-only; a decision changes only via a new ADR), this is [**ADR-0009**](../decisions/ADR-0009-vercel-services-deployment.md). **ADR-0004 was not rewritten** — its body is preserved verbatim and carries a superseded banner naming exactly which rows lost force (FastAPI + workers hosting) and which remain in effect (Supabase, OpenAI, Azure DI, Sentry, the Local→Staging→Production split, the portability requirement). `DECISION_LOG.md` reflects both.

### Two code facts the deployment depends on
Both were already in the working tree and are kept:
- **`middleware.ts` pins `runtime = "nodejs"`.** Vercel Services hosts no Edge Function output. The middleware never needed Edge — one Supabase auth round trip plus cookie reads/writes — and Node middleware is stable as of Next.js 15.5 (installed 15.5.22). Removing the export breaks the deploy.
- **`.vercel/` is gitignored** — `vercel link` writes the project link there and pulls a short-lived OIDC token into it.

### Two things deliberately left undecided rather than guessed
- **Worker host.** `backend/app/workers/` is interface-only. A persistent queue consumer is a different deployment shape from a request-driven function, so ADR-0009 **declines to assign a host** and gates the choice (Vercel Cron/Queues vs. a container host) on a new ADR when the first worker exists. `backend/Dockerfile` is retained as the exit path and its header now says so, so it is not deleted as "unused".
- **Backend `APP_ENV` stays unset for first staging.** `backend/app/config.py` fails fast at import when `APP_ENV` is `staging`/`production` and any of `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET`/`DATABASE_URL` is missing. Setting it today would force provisioning an **RLS-bypassing service-role key to serve a health check**. The runbook binds the flip to the same change that lands the first real endpoint.

### The one open question — now answered on the Preview deployment
Whether the `/api/backend(/.*)?` rewrite forwards the path **with or without** the prefix was not determinable from the repository, so rather than guess, the runbook's smoke check #0 listed **two distinct failure modes** and the one-place-only fix for each.

**Owner tested PR #28's Preview and it came back the second way:** `GET /api/health` → `200` frontend, `GET /api/backend/health` → FastAPI's own `{"detail":"Not Found"}`. That single response proves four things at once — the rewrite routes to the backend service, rewrite order is correct, **Vercel Services preserves the original request path**, and FastAPI was receiving `/api/backend/health` while declaring only `/health`.

**Fixed by mounting the app under the prefix, on one side only** (follow-up commit on the same branch):
- `app/main.py` declares **`API_PREFIX = "/api/backend"`** and applies it at its single `include_router(api_v1_router, prefix=API_PREFIX)` call, plus the OpenAPI/docs/redoc URLs — and `swagger_ui_oauth2_redirect_url`, which FastAPI does **not** derive from `docs_url` and which was the one route left sitting outside the prefix.
- **`app/api/v1/__init__.py`** (previously empty) is now the single aggregation point for v1 routers, so the prefix is structural rather than a convention each new router must remember.
- `health.py` keeps its **bare** `/health`. The prefix string appears once in the codebase.
- **`vercel.json` was not touched** — adding a strip there *and* mounting here would be two competing mechanisms.
- **`root_path` was deliberately rejected:** it is for proxies that *strip* the prefix, the opposite of the observed behavior; using it would have left the routes unreachable.

Tests grew 10 → 16 and pin the public contract rather than the internal one: `/api/backend/health` 200, bare `/health` **404** (proves one mechanism, not two), doubled `/api/backend/api/backend/health` 404, every OpenAPI path under the prefix, and **no app route at all** outside it (this last one is what caught the oauth2-redirect).

### Validation
`pnpm install --frozen-lockfile` ✓ · frontend typecheck ✓ · lint ✓ (0 errors / 0 warnings) · unit **236/236** ✓ (25 files) · production `next build` ✓ · backend `ruff check` ✓ · `pytest` **16/16** ✓ (10 before the routing fix) · `scripts/check_doc_links.py` ✓ (**888 internal links across 105 files, 0 broken** — the check that matters most for a documentation change) · `vercel.json` parses as valid JSON ✓.

**The middleware runtime change was verified at runtime, not just compiled.** `next build` emits `.next/server/middleware.js` + `middleware.js.nft.json` with an **empty `middleware-manifest.json`** — that is the Node-runtime artifact shape (an Edge middleware would instead appear in the manifest with `runtime: "edge"`), so the empty manifest is expected here and not a sign the middleware vanished. A `next start` smoke test confirms behavior is unchanged: `/api/health` 200, `/auth/sign-in` 200, and `/`·`/b2b`·`/b2b/rfqs`·`/admin`·`/home`·`/onboarding` all **307 to `/auth/sign-in`** with the `next=` parameter preserved and URL-encoded — identical to the pre-change results recorded in the previous session.

Documentation-and-config change only: no schema change, no product feature touched, no `.pen` file changed. E2E/Lighthouse/pgTAP deliberately not run for the same reason as the prior deployment-only session.

**Pushed with a PR to `main` open; NOT merged, nothing deployed manually, no Vercel/Supabase environment variable touched.** This PR **supersedes the two narrower open PRs #26** (`fix/vercel-backend-entrypoint`) **and #27** (`fix/vercel-frontend-node-middleware`) — both of their changes are contained here alongside the documentation reconciliation, and both were deliberately left open for the owner to close.

---

## Session — First cloud STAGING deployment readiness (deployment-only)

**Date:** 2026-08-16 · **Branch:** `chore/staging-deployment-readiness` · **Base:** `main` @ `944e954` (PR #23 merged)

### Objective
Prepare `main` for its first real cloud STAGING deployment. **No product feature added or changed, and nothing deployed remotely** — repository-side readiness only, ending in a PR the owner reviews before touching any cloud account.

### The audit answered one question that decided the whole shape
**Does the deployed Next.js app call FastAPI at runtime?** No — and three independent checks say so, which is why this is stated as a conclusion rather than a preference:
- `frontend/src` contains **no `fetch(` call at all**. The web app reaches data only through `@supabase/ssr`.
- `AI_SERVICE_URL` is declared in `lib/env/index.ts`, but `parseServerEnv()` — its only reader — is never called outside that module, so no code path resolves a backend base URL.
- `backend/app` registers exactly one router: `GET /health`. There is no AI, OCR, RAG or document endpoint yet.

So first staging is **two services: Vercel + Supabase Cloud.** `backend/` was **not refactored, not deleted, and keeps its CI job**; no Render/Railway/Fly configuration was added. ADR-0004 already fixes Railway as its target for when an endpoint gains a caller.

### Cloud URL / auth readiness needed no code change
The usual first-deployment breakages are all absent. `frontend/src` has no hardcoded `localhost`, no `NEXT_PUBLIC_SITE_URL` and no `window.location.origin`; `middleware.ts` builds every redirect from `request.nextUrl.clone()`, so the origin is whatever host served the request and localhost, the Vercel URL and a later custom domain all work unchanged. `server/actions/auth.ts` is pure OTP — `signInWithOtp` → `verifyOtp` with a typed six-digit code, **no `emailRedirectTo`, no `/auth/callback` route, no `exchangeCodeForSession`** — so a redirect-URL mistake cannot break sign-in at all. Mailpit appears only in `config.toml`.

That relocates the real risk to somewhere much easier to miss: **the Magic Link email template.** `config.toml` points it at `supabase/templates/magic_link.html`, which renders `{{ .Token }}`, but `content_path` is a **local-only** setting. A hosted project silently falls back to Supabase's stock template, which prints a **link, not a code** — and the sign-in screen asks for six digits. Staging sign-in would be impossible with no error to explain it, so replacing the template is a required step in the runbook. The same section documents **leaving CAPTCHA off**: `[auth.captcha]` is commented out and no client sends a `captchaToken`, so enabling it in the dashboard would fail every OTP request.

### Environment contract, enforced by a test rather than a convention
`publicEnvSchema` and `serverEnvSchema` are now exported, and `env.test.ts` **enumerates them** instead of checking a hand-maintained list: every public key must be `NEXT_PUBLIC_`-prefixed, no public key may match `SECRET_NAME_PATTERN` (`SERVICE_ROLE|SECRET|PASSWORD|PRIVATE|JWT|DATABASE_URL|DB_URL|ACCESS_KEY|TOKEN`), and no server key may be public. This matters because `NEXT_PUBLIC_*` is **inlined into the client bundle at build time** — a credential placed there is published, not merely misconfigured, and rotation is the only remedy. A variable added to the wrong schema now fails CI. Staging provisions only `NEXT_PUBLIC_APP_ENV=staging` plus the Supabase URL and anon key; **neither `SUPABASE_SERVICE_ROLE_KEY` nor `AI_SERVICE_URL` is set on Vercel** — nothing reads them, and the first is a full RLS bypass.

### Supabase: migrations verified, seeds made safe without editing them
All **28 migrations apply in order from an empty database** (`supabase db reset`, which drops and replays). No historical migration was edited for deployment convenience. Remote schema deployment is `supabase db push` only; `db reset` is documented as local-only, never a remote command.

The three seed files produce exactly the world worth inspecting in staging — Cairo Ceramics Showroom / `hana@example.test`, connected distributors, products, RFQs, quotations, orders, projects, technicians and professionals, people-ops with a pending invite, the Admin verification queue, and the sales analytics. But they are **not safe to hand to a hosted database as-is**: they run only under `db reset`, and every insert uses fixed UUIDs with no `ON CONFLICT` — including direct inserts into `auth.users` — so a second apply fails partway and leaves a half-built world.

Rather than edit files pinned by pgTAP and the E2E fixtures, `scripts/build_staging_seed.py` **generates** a one-time loader: it reads the seed list from `config.toml`'s own `[db.seed].sql_paths` (so it cannot drift), concatenates them in that order into **one transaction**, and fronts them with a guard that refuses when `auth.users`/`public.organizations` is non-empty or when migrations have not been pushed. The output is gitignored — it is a build artifact, not source.

**The guard ordering is deliberate:** existence (`to_regclass`) is checked *before* emptiness, because probing `select 1 from public.organizations` on an un-migrated database raises `relation does not exist`, which tells the operator nothing about what they actually did wrong.

Rehearsed end to end against local Supabase: `db reset --no-seed` → apply → **26 auth users, 12 organizations, 16 products, 17 RFQs, 14 quotations, 10 orders, 5 projects** with `hana@example.test` owning Cairo Ceramics Showroom (`showroom_dealer`); a **second apply refused with zero rows written**; and an apply to a scratch un-migrated database refused with the "push migrations first" message.

### Vercel
Root Directory `frontend` **with "include source files outside the Root Directory" enabled** — the pnpm lockfile and workspace manifest live at the repo root, so install must resolve there. Next.js is auto-detected; install, build and output stay default; `packageManager: pnpm@9.0.0` pins pnpm via corepack; Node 22 satisfies `engines.node: ">=20"`. **No `vercel.json` is needed and none was added** — every setting is a platform default or a project-settings toggle, and a config file would duplicate them in two places.

### Validation
`pnpm install --frozen-lockfile` ✓ · frontend typecheck ✓ · lint ✓ (0 errors, 0 warnings) · unit **236/236** ✓ (6 new exposure-contract assertions) · `supabase db reset` ✓ from empty, all 28 migrations + 3 seeds · production `next build` ✓ — every route reports `ƒ` (dynamic, server-rendered on demand), so the build needs env **values** to parse but no Supabase connectivity · `next start` smoke ✓: `/api/health` 200 with the expected body, `/auth/sign-in`·`/auth/sign-up`·`/auth/support` 200, and `/`·`/b2b`·`/b2b/rfqs`·`/admin`·`/home`·`/onboarding` all 307 to `/auth/sign-in?next=…` · targeted authenticated Playwright `pilot-landing` against a production build: **6 passed / 2 failed**.

**The two failures are pre-existing on `main` and not caused by this branch.** `pilot-landing.spec.ts:65` (en and ar) expects `youssef@example.test` to land on `/b2b`, but `resolveWorkContext` returns the Personal context whenever a personal persona exists and no workspace cookie is set, and the pilot seed gives Youssef `primary_account_type = 'sales'` **and** an active membership — so he lands `/home`. Two independent confirmations: this branch's entire diff is `.gitignore`, `frontend/.env.example`, `frontend/src/lib/env/{index,env.test}.ts`, `package.json` and documentation — it touches none of the landing, workspace, or seed code involved — and the pair reproduces identically after a canonical `supabase db reset`, so it is not an artefact of the staging-seed rehearsal either. Fixing it is a product decision (does a persona'd employee default to their business?) and is **out of scope for a deployment-only sprint** — recorded here so it is not rediscovered as a deployment problem.

Deliberately **not** run, per the brief: repository-wide E2E, the integration/performance gate, Lighthouse, and pgTAP (no schema change). No `.pen` file changed.

### Files touched
New: `docs/operations/staging-deployment-runbook.md`, `scripts/build_staging_seed.py`. Changed: `frontend/src/lib/env/index.ts` (exported the schemas + `SECRET_NAME_PATTERN`; documented `AI_SERVICE_URL` as unprovisioned), `frontend/src/lib/env/env.test.ts`, `frontend/.env.example`, `.gitignore`, `package.json` (`staging:seed:build`), `docs/operations/RUNTIME_STATE.md`, `docs/operations/deployment-overview.md`, `docs/README.md`, this log.

### What the owner must do next
Everything requiring an account, billing or a secret: create the Supabase staging project, push migrations, replace the Magic Link template, load the demo world, create the Vercel `aladdin-staging` project against `main`, enter three environment variables, and run the smoke sequence. Steps 1–8 of [`staging-deployment-runbook.md`](./staging-deployment-runbook.md). Custom SMTP and a custom domain remain before Client UAT; Production is untouched and must use separate infrastructure.

---

## Session — Showroom interaction refinement: sidebar display modes + horizontal card rails

**Date:** 2026-08-16 · **Branch:** `feature/showroom-mvp-completeness` (same PR #23, unmerged) · **Base:** `main` @ `678ba32` · **Branch HEAD at start:** `a7ee372`

### Objective
The final interaction/UI pass before manual UAT. Supabase's workspace chrome was supplied as **interaction** reference only — none of its colors, typography, border system or branding was copied, and the Aladdin tokens, themes, spacing, type scale, accent behavior and component language are untouched. **No data, seed, analytics, architecture or performance work was redone**; the acceptance account stays `hana@example.test` / Cairo Ceramics Showroom and the seeded connected showroom world is intact. No migration, no schema change, no `.pen` change.

### Sidebar: three display modes, one navigation
The desktop sidebar now offers **Expanded · Collapsed · Expand on hover**, chosen from a compact control in the sidebar footer whose menu exposes exactly those three, localized EN/AR, with no internal terminology. They are three presentations of **one** navigation: `allowedNavSections(capabilities)` still produces the item set, so the grouping, order, capability filtering, icons, active-route rule and RTL mirroring are identical in all three, and a collapsed rail renders exactly as many links as an expanded one. Collapsed hides labels and section headings — grouping is carried by a rule instead of a word — while each item keeps its localized label as its **accessible name** plus a visual tooltip on hover *and* keyboard focus.

**The structural decision** is the spacer/panel split in `sidebar-shell.tsx`: an outer flex child reserves the RESTING width, and an absolutely-positioned inner panel carries the VISUAL width. In expanded and collapsed they agree and nothing moves; in expand-on-hover they deliberately disagree, so the reveal floats **inward over the page** and the document does not reflow. Widening a flex child on hover instead would relayout the whole document on every pointer pass — that is both the "continuously resizing/shifting the body" the brief rules out and the usual source of hover flicker. Because the panel is `start-0` inside the spacer, the reveal direction falls out of writing direction for free: rightward in English, leftward in Arabic, inward in both. Hover/focus handlers live on the **panel**, not the spacer, so the pointer never crosses a seam between the thing that opened the reveal and the thing it opened into; `onFocusCapture`/`onBlurCapture` make the reveal reachable by keyboard alone, and an open control menu holds the reveal so it cannot collapse out from under a choice in progress.

**Persistence is a cookie, not `localStorage`, and that is not a style preference.** The mode decides a WIDTH. Read from `localStorage` it would only be known after hydration, so every load would paint 15rem and snap to 3.5rem — precisely the flash the brief rules out. The cookie travels with the document request, `AppShell` resolves it server-side, and the first HTML byte already carries the right width (asserted directly in E2E against the raw response). It is written client-side rather than through a server action: nothing the server computes depends on it except a width, so a `revalidatePath` round trip to move a border would be waste. Still per-browser; **no database persistence**. **Mobile is untouched** — the three modes are `tablet:`-and-up, and the bottom bar + More sheet are unchanged.

### Horizontal card rails
One reusable `CardRail` (`components/ui/card-rail.tsx`), no carousel dependency: `overflow-x: auto` already provides trackpad, wheel and touch swipe, CSS scroll-snap keeps every stop on a card boundary, and the buttons exist for mouse and keyboard. Controls render **only when the content actually overflows** — on a wide desktop where everything fits they are absent, not greyed out — disable at each end, and move by whole cards (as many as currently fit), with smooth scrolling that respects `prefers-reduced-motion`. An overflowing rail is a focusable region so it is keyboard-reachable; one that fits adds no dead tab stop.

**RTL is normalized explicitly rather than assumed.** `scrollLeft` is the one layout API that does not follow writing direction: in an RTL container it rests at 0 and travels **negative**. Every read goes through `Math.abs` so "distance travelled from the start" means the same in both directions, and every write flips its sign from the active direction. Nothing in the component assumes left means previous. Unit tests pin both signs, because getting this wrong makes the Arabic rail jump to the end on its first "next".

### Where rails were applied — and deliberately not
Applied to three dense **peer-card** groups: the dashboard KPI strip (a member who both buys and sells reaches **eight** tiles — two full grid rows before the first real panel), the dashboard "What do you want to do today?" action ramp (up to eight), and the Reports analytics summary strip. The Reports case also **retires a documented defect**: a comment there recorded that six tiles across truncated `EGP 1,103,100.00` at laptop width, which is why they were forced to four-plus-two. A railed card holds its width and scrolls instead of shrinking, so the figure now stays whole at every viewport. Module KPI strips of three or four tiles keep the grid — they already fit, and a rail there would add nothing while making a phone swipe for a number it could already see. **Not converted:** data tables, main report charts, forms, and the large operational lists (catalog grid, saved-products grid, the directories) — those are scanned and compared down the page, and hiding half of one behind a swipe is a regression, not a polish.

### Validation
Frontend typecheck ✓ · lint ✓ (0 errors, 0 warnings) · unit **230/230** ✓ (14 new: 6 `card-rail` covering fit/overflow/end-detection/both RTL signs/whole-card stepping, 8 `sidebar-shell` covering the three-mode menu, module survival across modes, accessible naming, active marking, hover vs collapsed distinctness, keyboard reveal, and cookie persistence) · targeted Playwright `showroom-interaction` **15 passed / 0 failed / 0 flaky** (7 declared `isMobile` skips) across chromium-desktop 1440x900 and Pixel 5 · regression `showroom-mvp` **24 passed / 0 failed** across both projects, English and Arabic · real-browser UAT as `hana@example.test` at 1440×900 through the real Email-OTP path — collapsed rail with working tooltips, Arabic RTL revealing inward from the right edge with the sidebar's outer edge pinned, the control menu showing exactly موسّع / مصغّر / التوسيع عند المرور with the active one checked, and both dashboard rails peeking their next card with correctly-mirrored arrows. Deliberately **not** run, per the brief: the broad audit, the full-repo integration/performance gate, Lighthouse, and pgTAP (no schema change). Pre-existing `sales.spec.ts` failures are unrelated and untouched.

### Three defects found and fixed during validation
1. **Rail arrows were wrong at rest.** The rail's `px-1` (shadow room) shifted the first scroll-snap position, so the first card parked at `scrollLeft: 4`, the rail never read as "at the start", and the previous arrow stayed enabled on a rail nobody had scrolled — a direct miss of the arrow-state-at-beginning requirement. Fixed with a matching `scroll-px-1`; scroll-padding is what declares the scrollport's optical edge when the container has padding.
2. **A collapsed-rail tooltip would have been sliced off.** `overflow-y: auto` also clips horizontally, so an absolutely-positioned tooltip could not escape the scrolling rail. The tooltip is `position: fixed` with measured coordinates instead — verified in a real browser, not just asserted.
3. **The rail scrollbar was visually wrong on Windows.** `scrollbar-width: thin` renders a CLASSIC, permanent grey bar in Windows Chrome — a horizontal rule under every rail that the design system never asked for. Only a real-browser pass surfaced this; headless never showed it. Now hidden, which costs nothing: the arrows appear on overflow, the next card peeks, and the region stays keyboard-scrollable.

Two E2E defects were also fixed rather than retried: a `walk` loop that clicked an arrow which disabled itself mid-animation (`disabled:pointer-events-none` then sent the click through to the card underneath, burning the full test timeout — now waits for `scrollLeft` to stop moving), and an `isVisible()` guard that **silently skipped** the Arabic desktop rail test by racing the effect that measures overflow. The second was the more dangerous of the two: the run stayed green while nothing was checked. Both now fail loudly instead.

### Files touched
New: `lib/ui/sidebar-mode.ts`, `components/layout/sidebar-shell.tsx` (+test), `components/ui/card-rail.tsx` (+test), `e2e/showroom-interaction.spec.ts`. Changed: `components/layout/app-shell.tsx`, `components/layout/workspace-nav.tsx`, `components/ui/icons.tsx` (3 glyphs), `components/ui/stat-tiles.tsx` (opt-in `layout="rail"`), `features/home/quick-actions.tsx`, `app/b2b/page.tsx`, `app/b2b/reports/page.tsx`, `lib/i18n/messages/{en,ar}.ts`, `UI_UX_SYSTEM_GUIDE.md`, `RUNTIME_STATE.md`, this log.

---

## Session — Pilot Account & Workspace Model (feature sprint)

**Date:** 2026-08-12 · **Branch:** `feature/pilot-account-workspace-model` · **Base:** `main` @ `a0ff5f6` (PR #20 merged)

### Objective
Make the approved account model real in schema and product: **one person = one user ID**, holding a personal identity, zero businesses, one, or many — all on the same login. A business is an **Organization**, a **Membership** links the two, and a **workspace is derived** (no `workspaces` table, no persona switcher).

### The coupling that was removed
`users.primary_account_type` was doing two incompatible jobs — *what kind of person are you* and *what kind of business do you run*. Being `not null default 'end_consumer'`, it could not even **represent** a business-only identity, so a showroom owner had to carry either a fake consumer persona or their organization's type copied onto their person. It is now **nullable with no default and means personal persona only**; `organizations.org_type` stays the sole business classification, is never mirrored onto a user, and `request_account_upgrade` rejects business values outright.

The backfill (`20260814090001`) only ever *clears* a mis-typed persona: where an **explicit** personal professional type was independently declared in the personal track it is restored, and everyone else becomes a valid **business-only identity**. No persona is guessed from `org_type`. User ids, auth identities, organizations, memberships, branches, capabilities and commercial history are untouched; re-running is a no-op. `app.has_personal_persona()` answers "is there a Personal workspace?" from explicit evidence only.

### Business creation made repeatable
`business_onboarding` was keyed `user_id primary key` — one draft per person, forever — which made the completion idempotency key the **user**, so a second business could only exist by destroying the record of the first. `business_creation_drafts` (`20260814090002`) holds one row per creation **attempt**: the draft id is both resume handle and idempotency key, `organization_id` is the canonical result behind a partial unique index, one open draft per user, unlimited completed ones. Submitting takes a row lock and short-circuits on the recorded organization, so retries return O1 while a different draft legitimately creates O2. Creation stays transactional (organization + owner membership + full owner capabilities + primary branch). The legacy table is copied forward and left intact.

### Product
Registration is now a **direct Personal-or-Business question** with concrete business types; *"Showroom"* means "create a business whose `org_type` is `showroom_dealer`". **"Organization owner / manager" is no longer offered** and the owner confirmation checkbox is gone — owner is the relationship creating a business produces, so the review step states it rather than asking. The type chosen at registration carries into the draft, so the type step is dropped from the wizard entirely. `/business/new` lets an existing account add a business with no second sign-up, repeatedly. A **workspace switcher** in both shells changes the active work context without touching persona or membership; selection is a preference, never authority, and a stale cookie resolves safely. Landing is deterministic, and merely belonging to an organization no longer evicts a person from `/home`. Admin distinguishes a business-only user instead of rendering a blank account type.

### Validation
Frontend typecheck ✓ · lint ✓ (0/0) · unit **204** ✓ · `supabase db reset` ✓ (24 migrations) · pgTAP **650 across 28 files** ✓ · targeted Playwright **17 passed** desktop (8 journeys + bilingual/RTL + the updated Pilot UAT round-1 spec) and **3 passed** mobile EN/AR. Repo-wide E2E, Lighthouse and the full persona matrix deliberately not run — Integration Gate work.

`27_account_workspace_model_test.sql` pins acceptance A–H. Three defects the tests caught, all fixed: recreating `profile_public_directory` would have silently reverted the `security_invoker` hardening from `20260805100000` (the eligibility filter belongs in the reader function behind the view); `request_account_upgrade` had been rebased on a superseded version, dropping the needs-more-info resubmission path; and splitting Engineer from Interior Designer left `interior_designer` absent from `PERSONA_BY_ACCOUNT_TYPE`, so choosing it bounced the user back to `/onboarding` — each now maps to its own persona with a fixed concrete type, which also removes the in-flow sub-question.

### Debt
**Removed:** business classification on the person; one-draft-per-user business onboarding; the generic owner/manager registration entry. **Remaining:** the `account_type` enum still contains the business members because `organizations.org_type` is typed with it — correct for the organization, unreachable for a person; splitting it is a separate mechanical migration. `business_onboarding` is retained read-only; `business_save`/`business_submit` remain transitional wrappers.

Build notes: [`docs/frontend/sprint-12-account-workspace-model.md`](../frontend/sprint-12-account-workspace-model.md). No `.pen` file changed.

---

## Session — Business classification belongs to the Organization (account-model clarification)

**Date:** 2026-08-12 · **Branch:** `fix/pilot-uat-round-1` (same PR #20, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Resolve the last account-model ambiguity before PR #20 merges: whether a concrete business type is the *person's* identity or the *organization's* classification. **Documentation only — no code, schema, enum, migration, or test change.**

### Canonical rule now recorded
**Concrete business classifications** — Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · contractor company · design/engineering office · future classifications — are canonically **`organizations.org_type`**, never a person's long-term personal identity. **`users.primary_account_type` is personal identity / persona state**, not the type of every business the user owns or joins. This is structural: *Ahmed Hassan* (persona **Engineer**) owns *AH Showroom* (`showroom_dealer`) and *AH Import* (`importer`) on **one user ID**, and a single `primary_account_type` cannot be both. **Registration UX is unchanged** — *"I am a Showroom"* stays, and architecturally means *"I am creating a business whose `org_type` is X"*, with the backend creating Organization + Owner Membership + Primary Branch in one transactional, idempotent operation for the existing user.

### Contradictions corrected
1. **`AccountType` (`02_domain_model`)** — described business classifications as canonical *primary account types*; now states the target semantics (persona state) and flags the business-valued members as transitional.
2. **`07_permissions_matrix` audience map** — "Exhibition → business **account type**", "Company → business **account types**" → corrected to **organization types** (`org_type`), with a note that business-audience access derives from *membership in an org of that type* + capabilities, never a business-valued `primary_account_type`.
3. **`mvp-scope`** — *"Roles (kept separate, **one account can hold several**)"* directly contradicted one-primary-account-type; rewritten, with business classifications attributed to `org_type`.
4. **`PRODUCT_DIRECTION_GUIDE` taxonomy + "Businesses" actor bullet** — listed business classifications among a *person's* capacities; now split into personal personas vs organization classifications.
5. **`03_database_design`** — the `account_type` enum row and the `organizations.org_type` column (`org_type account_type`) read as "a business type is an account type"; annotated as a **shared physical enum**, not a claim about identity, with the target semantics and the unchanged-here scope stated.
6. **`system-context` actor list** and **PRODUCT.md** businesses bullet — same person/organization conflation, corrected.
7. **`12_validation_rules`** — `org_type` clarified as a property of the organization, never of the creating user.
8. **ADR-0007 (highest authority on `primary_account_type`)** — added **D22** recording the target semantics + explicit transitional status, since D10/D11's "six concepts kept distinct" list was the top-authority definition and did not cover this.

### Transitional debt (explicitly recorded, not fixed here)
`TECHNICAL_DEBT.md` §2 now carries **business-valued `account_type` / `primary_account_type`**: the enum still contains `showroom_dealer`/`supplier`/`manufacturer`/`importer`/`wholesaler` and onboarding paths may still set them. They stay as **implementation compatibility only**; the upcoming **Account & Workspace Model** feature must audit every read/write and migrate behind a reviewed migration rather than create a second source of truth. Until then no path may mirror `org_type` into `users`. **The enum and migration behaviour are deliberately unchanged in PR #20.**

### Files touched
`PRODUCT_DIRECTION_GUIDE.md` (new *Business Classification Belongs to the Organization* section + taxonomy/actor fixes + NEVER rule + change history), `ADR-0007` (D22), `02_domain_model.md`, `03_database_design.md`, `07_permissions_matrix.md`, `12_validation_rules.md`, `TECHNICAL_DEBT.md`, `mvp-scope.md`, `ARCHITECTURE_GUIDE.md`, `system-context.md`, `PRODUCT.md`, `CLAUDE.md`, `RUNTIME_STATE.md`, this log.

### Validation
Documentation-consistency search across the canonical docs; `git diff` inspected. **No** schema, enum, migration, frontend, backend, or test change; no `.pen` file touched; no tests re-run (nothing executable changed).

---

## Session — Pilot UAT product-direction alignment (account / organization / workspace model)

**Date:** 2026-08-12 · **Branch:** `fix/pilot-uat-round-1` (same PR #20, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Align the canonical product documentation with the account/workspace model approved during the Pilot UAT discussion. **Documentation-only patch** — the workspace switcher and the account lifecycle are recorded as direction and are deliberately **not implemented**.

### What is now canonical (PRODUCT_DIRECTION_GUIDE)
**One person = one user ID** (another business never creates another user) · **personal identity is not a business**, and a personal professional may hold **zero** organizations · **a business is an Organization**, created **once** in the UX (backend transactionally creates organization + owner membership + primary branch) · **Membership** is the only user↔organization link and owns relationship, capabilities, branch scope, lifecycle · **zero/one/many organizations on one login** · **workspace is a derived UX concept** (Personal = User+Profile · Business = Organization+active Membership), **no `workspaces` table** · an **existing user can add a business later** with no second sign-up · **single-source-of-truth ownership table** (auth user · users/profiles · organizations · memberships · branches · org-owned business records) forbidding identity duplication in either direction · **duplicate-business protection** (transactional + idempotent; name alone is never the permanent identity) · **membership history survives leaving** (revoked stops access, retains attribution) · **approved future account lifecycle** (deactivate reversible; delete request → grace period → identity released, business/audit history retained; a reused email/phone gets a NEW user id inheriting nothing; muted non-clickable historical attribution; leaving an org ≠ deleting an account).

### Contradictions corrected
1. **"No profile switcher" read as banning all context switching** (PRODUCT_DIRECTION_GUIDE, ARCHITECTURE_GUIDE, `02_domain_model`, `07_permissions_matrix`, `14_future_extensions`, `mvp-scope`, BACKLOG, PRODUCT.md, DESIGN.md, UI_UX_SYSTEM_GUIDE, CLAUDE.md, `12_ai_agent_rules`) — split into **persona/account-identity switching (forbidden)** vs **active work-context switching across the user's own active memberships (allowed, not built)**.
2. **Owner/manager framed only as "not a business type"** — restated as **not an account type either**, a pure user↔organization relationship; the target *personal persona OR concrete business type* registration UX was recorded, and the generic entry demoted to **transitional backward-compatibility** (also noted in `sprint-8-business-readiness.md`).
3. **"Create an account, then create an organization" framing** — replaced with *create the business once* (transactional organization + owner membership + primary branch); added as a UI anti-pattern.
4. **`User` 0–\* `Membership` was ambiguous about zero** — `02_domain_model` now states an organization-less personal account is valid and fully usable.
5. **No stated rule against a second identity per business** — added to the identity model, the NEVER list, `12_ai_agent_rules`, `14_future_extensions`, and BACKLOG.
6. **No stated single-source-of-truth ownership rule** — added the ownership table plus the draft-until-commit exception; `Organization` is now explicitly the canonical business identity.
7. **Nothing forbade a generic `workspaces` table** — now explicitly forbidden; workspaces are derived.
8. **Membership lifecycle was not distinguished from account lifecycle** — separated, with history retained on revoke.
9. **No duplicate-business protection recorded** — transactional + idempotent creation documented for the upcoming implementation.
10. **No account-deletion rule existed anywhere** — recorded as approved future direction in PRODUCT_DIRECTION_GUIDE + `14_future_extensions`, explicitly not implemented.

### Files touched
`PRODUCT_DIRECTION_GUIDE.md` (anchor + change history), `ARCHITECTURE_GUIDE.md`, `02_domain_model.md`, `07_permissions_matrix.md`, `14_future_extensions.md`, `mvp-scope.md`, `BACKLOG.md`, `PRODUCT.md`, `DESIGN.md`, `UI_UX_SYSTEM_GUIDE.md`, `CLAUDE.md`, `12_ai_agent_rules.md`, `sprint-8-business-readiness.md`, `RUNTIME_STATE.md`, this log.

### Validation
Documentation-consistency search across the canonical docs; `git diff` inspected. **No** schema, frontend, backend, or test change — the PR-20 migration comments (`20260813090001`) were checked and are compatible with the new rules, so no code assertion needed correcting. No `.pen` file touched. No tests re-run (nothing executable changed).

### Notes / unfinished
- `frontend/src/lib/onboarding/account-types.ts` calls `BUSINESS_ORG_TYPES` "the BUSINESS account types" in a comment; the values are `org_type`s, not account types. Left unchanged — outside PR #20's diff and not factually load-bearing — but it should be reworded when that file is next edited.
- The target registration UX (*personal persona OR concrete business type* → business info → creator becomes Owner), the work-context switcher, "add a business" for an existing user, and the account lifecycle all remain **unimplemented, approved direction**.

---

## Session — Pilot UAT fix round 1

**Date:** 2026-08-11 · **Branch:** `fix/pilot-uat-round-1` (PR to `main`, unmerged) · **Base:** `main` @ `d595a6d`

### Objective
Fix the product defects found during manual Pilot testing before the full persona UAT continues. Not the final integration gate: only the affected flows were audited, then fixed.

### Product decisions taken (these change behaviour — see the notes added to `PRODUCT_DIRECTION_GUIDE.md`)
1. **Completing onboarding activates a personal account. Verification is an independent trust state.** Previously nothing ever set `public.users.status = 'active'` for an organization-less account, so `active_personal` was reachable only through an ACTIVE ORG MEMBERSHIP. A consumer who finished consumer onboarding, and a professional who submitted their profile, were stuck on a terminal screen forever — an Admin approval was the de-facto activation mechanism. `individual_complete_consumer` and `individual_submit_professional` now activate the account (new internal `app.activate_personal_account`, promotes `pending_verification` only, so a suspended identity is never revived). The professional submission still files the SAME `verifications` request; `users.primary_account_type` and `profiles.public_profile_status` are still written only by the approved+applied upgrade workflow, so an unapproved professional is usable but not publicly discoverable.
2. **"Organization owner / manager" is a relationship, not a business type.** `onboarding_select_account_type` demanded a concrete `account_type` for every non-consumer track, so the generic owner/manager entry — which deliberately carries none — always raised and surfaced as "We couldn't save that. Try again." The business track now accepts a null concrete type (exactly as the `onboarding_progress` table comment already documented) and still refuses a consumer or non-business type; the real organization type is chosen and validated during business onboarding.

### What shipped
- **DB** — `20260813090001_pilot_personal_account_activation.sql` (the two decisions above + a one-time backfill releasing accounts already trapped) and `20260813090002_organization_verification_apply.sql` (`apply_organization_verification`, the organization-subject counterpart of `apply_account_upgrade`, plus the `organization.verified` audit action).
- **Persona-aware `/home`** — ONE personal surface with a consumer variant (setup recap, interests, honest coming-soon discovery placeholders) and a professional variant (persona, professional profile, services, service location, next actions, no consumer copy). Guarded on the derived registration state and the derived landing, so a consumer never reaches `/b2b` and an unfinished account resumes at `/onboarding`. Both persona flows stay re-openable, so an active personal account can keep its profile current.
- **Derived profile completeness** — `lib/profile/completeness.ts`: computed on every read from the APPLICABLE fields for that persona (the travel radius drops out of the denominator for a remote-only professional). Never stored, and verification is deliberately not an item; the two are shown side by side and neither blocks usage.
- **Admin fixes found by real-browser QA** — approving an organization always requested a public professional listing, which `ck_verifications_listing_only_professional` rejects, so approving ANY organization failed; `review_approve` records the decision only and the apply step was never called (and did not exist for an organization); 19 audit actions had no translation so `/admin/audit` printed raw enum keys; audit entries showed only the subject discriminator, not the target; the pilot world seeded no audit rows so the surface opened empty; organization detail only showed a badge when verified; and the organization detail page overflowed horizontally on a narrow viewport (grid items default to `min-width:auto`).

### Validation
Frontend typecheck ✓ · lint ✓ (0) · unit **186/186** ✓. Supabase: `db reset` ✓ · `db lint` ✓ (only the pre-existing `set_customer_ownership` warning) · pgTAP **614/614** ✓ (two new files: `25_pilot_account_activation`, `26_organization_verification_apply`; `11_individual_persona_onboarding` updated where it pinned the superseded "completion never activates" behaviour; `07_audit` scoped its admin-read count to its own row now that the pilot world seeds an audit trail). Targeted production Playwright **57 passed / 1 skipped** across desktop + mobile (`pilot-uat-round-1`, `individual-onboarding`, `business-onboarding`, `pilot-landing`, `shared-onboarding`) — the skip is the destructive Admin-approval acceptance, pinned to one project because the seeded review queue is a one-shot resource. Repository-wide E2E deliberately not run. No `.pen` modified.

### Notes / unfinished
- `e2e/global-setup.ts` now restores the two pending pilot organization reviews, because an APPLIED verification is immutable by design and cannot be reset in place.
- `e2e/business-onboarding.spec.ts` carried a latent strict-mode selector failure (the workspace shell renders the organization name in more than one slot); fixed in passing, unrelated to this round.
- The `consumer_onboarding_complete` / `persona_review_pending` terminals remain in `my_registration_state` and still have their screens, but are now only reachable by a legacy row written before this migration.

---

## Session — Sprint 11 Pilot post-login landing hotfix

**Date:** 2026-08-11 · **Branch:** `hotfix/pilot-landing-routing` · **Base:** `main` @ `1b07cf5`

### Objective
Fix the manual-Pilot-UAT regression where successful Email-OTP sign-in sent every active account to `/b2b`, bypassing Sprint 11's canonical derived landing resolver.

### Root cause and fix
`verifyEmailOtp()` sanitized an absent/unsafe `next` to `/b2b`, checked only `my_registration_state`, and redirected that value directly. The Sprint 11 resolver was wired into root/onboarding routes but not the real post-OTP action. The action now preserves explicit onboarding/invitation continuations, sends every other non-active state to `/onboarding`, resolves active accounts through `resolveActiveLanding()`, and retains a deep link only inside the resolved `/admin`, `/b2b`, or `/home` surface. Platform authority remains exclusively `platform_role_grants`; organization membership remains the B2B boundary.

### Validation
Frontend typecheck ✓ · lint ✓ · targeted auth/landing Vitest **17/17** ✓ · targeted production Playwright Chromium **8/8** ✓ (`admin`, `consumer`, `a-owner`, `youssef` across EN/LTR + AR/RTL; consumer and ordinary B2B direct `/admin` denial included). No DB/schema change, so no reset/lint/pgTAP rerun. No `.pen` modified.

---

## Session — Sprint 11 (Pilot Personas, Admin Operations & Connected Demo World)

**Date:** 2026-08-10 · **Branch:** `feature/mvp-pilot-readiness` (PR to `main`, unmerged) · **Base:** `main` @ `2ef6205`

### Objective
Make the B2B Pilot usable as a CONNECTED multi-role product: every persona → account → correct landing → correct UI → correct capabilities → realistic data → interaction with other personas. Replace the developer-only Admin with a real in-product Admin console. Feature sprint; the repo-wide integration audit is deferred.

### What shipped
1. **Persona-aware landing** — `resolveActiveLanding()` (server): platform staff → `/admin`, active org member → `/b2b`, consumer/org-less individual → new non-B2B `/home`. Replaced every hardcoded `active_personal → /b2b` in the onboarding funnel + root page. Fixes a consumer landing in the B2B shell.
2. **Capability-aware nav** — `allowedNavKeys()` filters the workspace rail by membership capabilities (`org.manage` = blanket in-org unlock, matching the RPCs); people-ops gated on `org.members.manage`. Pinned by `src/lib/nav/modules.test.ts`.
3. **Organization people ops** — `/b2b/organization`: manager-gated roster via new trusted `org_members_list` read-model (masked identity — profiles/users aren't co-member readable), invite-by-email through the existing token `invitation_create`, capability-preset roles, branch assignment, suspend/reactivate/revoke.
4. **Admin console** — platform-staff-gated `/admin` (dashboard, users + detail, organizations + detail, verifications queue wired to `review_*`, audit log). Guard reads `platform_role_grants`; every query stays RLS-scoped by `is_platform()` (defense in depth). Dense Aladdin-branded shell.
5. **Connected Pilot world** — `supabase/seed-pilot.sql` (loaded by `db reset` after the pgTAP base seed): 10 identities across every persona, 5 business orgs + branches, capability-scoped memberships, a PENDING token invitation, one end-to-end commercial story (Cairo Ceramics products → Horizon Contracting RFQ → accepted quotation → in-progress order → active project), and two orgs queued for Admin verification.
6. **DB** — migration `20260812090001_pilot_people_ops.sql`: `org_members_list` + refreshed `membership_set_capabilities` allow-list (adds live `sales.*`/`order.*` keys that had drifted behind Sprints 3/10).

### Seed vs. pgTAP
Pilot data lives in a SEPARATE seed file so the pgTAP-pinned base (`seed.sql`) is untouched. Design keeps the suite green: nothing added to Org A/B, all new orgs `is_verified=false`, new profiles `hidden` — so only the two admin-context global counts move (reconciled in `06_admin_boundary`), and `14`'s org-verification lookup was made deterministic (it assumed exactly one org verification).

### Validation
Frontend typecheck ✓ · lint ✓ (0) · unit **163** ✓ · production build ✓ (all `/admin/*`, `/home`, `/b2b/organization` compile). Supabase: `db reset` (base + pilot) ✓ · `db lint` ✓ (only pre-existing `set_customer_ownership` warning) · pgTAP **579/579** ✓. Per sprint rules: targeted unit + DB validation only; no repeated full Playwright loops; no unrelated flakes touched. Browser persona-landing E2E left for the pre-audit gate.

### Docs
`docs/frontend/sprint-11-pilot-readiness.md` — full Pilot Account Matrix + connected story + validation.

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited or in the branch diff.

---

## Session — Phase 2: Sprint 6.2 (Final Realtime & QA Merge Gate)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (PR #9, continued) · **Base:** `main` @ `5a47011`

### Objective
Close the last confirmed Sprint 6.1 items on PR #9. No schema change.

### What changed
1. **Realtime timer teardown** — `SalesRealtime` clears the flash timer (not only the debounce) on unmount / org / branch change / sign-out, and guards all `setState` behind a mount ref (no post-unmount work). Component-tested.
2. **Dirty-form protection** — replaced focus-only detection with a persistent dirty-form guard (document-capture listener marks a modified B2B edit form; stays dirty after focus leaves; navigation resets; search/filter forms opt out via `data-no-dirty`). Realtime defers while any form is dirty. No global state, no new lib, no PII in the adapter.
3. **ConfirmDialog focus fix** — excluded hidden inputs from the focusables query (ownership dialogs lead with hidden inputs, so focus never entered the dialog / the trap broke).
4. **State coverage** — rep visual matrix now asserts the theme exactly like the manager matrix + an out-of-scope direct-URL check per cell; reconnecting status (deterministic hook), permission-denied panel (DB harness), and dialog focus-trap/Escape/restore are browser-asserted; stale-conflict rendering is a component test (React controls the token in-page).
5. **Exact perf console gate** — `perf.spec` asserts failed=0, page-errors=0, non-favicon 4xx/5xx=0, and only the documented `/favicon.ico` 404 is tolerated (no approved brand asset exists outside the encrypted `.pen`; kept as debt).
6. **Flake fully fixed** — the sign-in change-email flake (resurfaced by the new test files) is deterministic via `requestSubmit()` in `act`; 0 failures across 50+ full-suite runs.

### Validation
Frontend typecheck/lint/**130 tests** (0 flaky over 50+ runs)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **one** clean cycle (no SQL): reset + lint + **416 pgTAP** ✓ · **6** race scripts ✓ · Playwright: realtime-scope **9/9** (incl. reconnecting/permission/dirty-focus-off/terminal-dialog), visual-QA **4/4** (both roles full matrix + dialogs/states), perf + Lighthouse re-run ✓. No new dependency; no migration; no `.pen`.

### Commits
`fix: protect dirty forms and clean realtime teardown` · `test: complete visual and performance console gates` · `test: eliminate residual React-19 form-action flake in the suite` · `docs: finalize Sprint 6 merge evidence`

---

## Session — Phase 2: Sprint 6.1 (Realtime Scope & Performance Merge-Gate Closeout)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (PR #9, continued) · **Base:** `main` @ `5a47011`

### Objective
Close confirmed Realtime-scope, E2E, visual-QA, performance-gate, and CI-flake gaps on PR #9. Ownership RPCs accepted in principle; no schema change this sub-sprint.

### What changed
1. **Active-branch Realtime scope (fix)** — the subscription filtered only by `organization_id`, so an org-wide manager with one branch selected still refreshed on every branch. Now it matches the visible data: All Branches → `organization_id=eq.<orgId>`; a selected branch → `branch_id=eq.<branchId>` (excludes org-wide NULL-branch rows). Channel keyed by scope, rebuilt on branch change.
2. **Test-safe instrumentation** — `realtime-debug.ts` mirrors channel scope/count + refresh/deferred counts to `window.__salesRealtime` only when `NEXT_PUBLIC_REALTIME_DEBUG=1` (dev/E2E flag; production build never sets it; no secrets, not app state).
3. **Realtime E2E** — `realtime-scope.spec.ts` (6 scenarios, two real contexts): branch-scope narrowing + teardown + out-of-scope-no-refresh + single channel; follow-up cross-context; sign-out channel removal; revoked-membership no-leak; open-form deferral/focus safety; duplicate → one row.
4. **Visual QA** — both roles now run the **full** 4×{en,ar}×{light,dark} matrix + a dialogs/states pass (ownership dialogs, follow-up edit, validation/not-found/empty). **Fixed** a 42px customer-detail overflow at 360px (long email couldn't wrap → `[&>*]:min-w-0` + `break-words`). 64 screenshots.
5. **Lighthouse (actually run** via `pnpm dlx`, no permanent dep) — sign-in Desktop **100** / Mobile **98**; authenticated /b2b **98**, /b2b/leads **96** (session captured via `_lh-cookies.spec`). All targets met (LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms).
6. **Extended perf.spec** — cold + median-of-3 warm, slowest **actual** request (not TTFB), failed/console/page-error counts, request count/size, **Realtime channels = 1, duplicates = 0**. One benign `/favicon.ico` 404 console error (pre-existing).
7. **CI flake (fixed)** — `sign-in-form` test failed ~2/8 full-suite runs (React 19 form-action native-submit guard racing `preventDefault`); switched to `fireEvent.submit(form)` → **0/14** full-suite runs fail.

### Validation
Frontend typecheck/lint/**125 tests** (0/14 flaky)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **one** clean cycle (no SQL change): reset + lint + **416 pgTAP** ✓ · **6** race scripts ✓ · Playwright: full suite 20 passed / 28 skipped (project/env-gated) / 0 failed, realtime-scope 6/6, visual-QA 4/4, perf + Lighthouse executed ✓. No new dependency; no migration; no `.pen`.

### Commits
`fix: narrow realtime subscriptions to active branch scope` · `fix: remove confirmed sign-in test flake` · `test: prove realtime teardown, branch switching and form safety` · `test: complete visual QA matrix; fix customer-detail 360px overflow` · `test: add Lighthouse gate and extended production perf metrics` · `docs: correct Sprint 6 merge-gate evidence`

---

## Session — Phase 2: Sprint 6 (Sales Ownership, Realtime & Performance Hardening)

**Date:** 2026-08-05 · **Branch:** `feature/sales-ownership-realtime` (from `main` @ `5a47011`, PR #8 merged) · **Base:** `main`

### Objective
Close the remaining post-create **ownership** gaps, add **scoped Realtime**, and establish **executed** E2E / visual-QA / production-performance merge gates. RLS stays the boundary; trusted RPCs only; no service-role browser path.

### What shipped
1. **Ownership RPCs** (migration `20260806090001_sales_ownership_and_realtime.sql`, forward-only): `set_customer_ownership` (branch + assignee; `sales.assign`; `p_expected_updated_at`→40001; audit `customer.reassigned`) and `set_lead_source_branch` (source + branch + optional compatible reassignment; `sales.write`/`sales.assign`; `p_expected_version`→40001; audit `lead.details_changed`). Both derive the caller from `auth.uid()`, enforce active-org/branch scope, keep the assignee branch-compatible (a stranding move is rejected — never a silent unassign), reject cross-tenant branches, and audit old/new transactionally. **Lead lifecycle is structurally out of bounds** for the lead RPC. **`customer_type` kept IMMUTABLE** — no domain doc approves mutation.
2. **Scoped Realtime** — **Postgres Changes** chosen over Broadcast (RLS-native, zero extra schema for pilot volume). Publication = exactly `leads` + `follow_up_tasks`. Client boundary (`sales-realtime.tsx`, mounted once in the shell): anon browser client with `realtime.setAuth`, filtered to the server-derived active org, **refresh-only** (never renders a payload; RLS-scoped refetch is the source of truth → no leak, no duplicate/out-of-order corruption), rebuilds on org/branch change, tears down on unmount/SIGNED_OUT, and **defers refresh while a form is focused** (manual "Updated ↻" affordance).
3. **Ownership UI** — capability-gated cards on the customer/lead edit pages; controls inside the accessible `ConfirmDialog` with the branch-move visibility warning; controlled selects so values survive an expected error; actions send only changed axes.
4. **Perf** — de-duplicated the member lookup on the edit pages; bundle unchanged (~103 kB shared).

### Executed gates
- **E2E** (`playwright test`): 14 passed / 14 skipped (project-gated) / 0 failed. New `sales-ownership-realtime.spec.ts`: ownership edits, incompatible-assignment rejection, and **two real browser contexts** (a UI-created lead appears in another context — exactly one row; a Cairo rep never receives a Sheikh-Zayed lead).
- **Visual QA** (`VQA=1`): 4 viewports × {en,ar} × {light,dark} × {manager, branch rep} + sign-in — no horizontal overflow, correct dir/dark, screenshots. **Found & fixed** a ~64px cockpit overflow at 360px (`[&>*]:min-w-0`).
- **Production perf** (`PERF=1`, `next start`, median of 3): all routes LCP ≤ 2.5 s, CLS = 0; slowest `/b2b/leads` (LCP 1128 ms). Lighthouse score/TBT need the runner (not installable in-sandbox) — documented follow-up.

### Validation
Frontend typecheck/lint/**125 tests** (114→125)/build ✓ · backend ruff + pytest ✓ · Supabase **two** clean cycles (reset+lint+**416 pgTAP**, +34 in `19_sales_ownership_test`) ✓ · **6** race scripts (added `lead_ownership_concurrency_test.sh`) ✓ · dev + prod runtime smoke ✓. Note: `supabase db reset` was intermittently flaky on Windows (transient container bootstrap exit 1) and needed a retry twice — not a schema issue; the clean cycles complete on retry.

### Commits
`feat: add trusted customer and lead ownership update paths` · `test: prove ownership scope, concurrency and audit behavior` · `feat: add scoped sales realtime subscriptions` · `test: add realtime multi-context + ownership E2E; authenticate realtime socket` · `perf: de-duplicate member lookups on the sales edit pages` · `fix: eliminate 360px cockpit horizontal overflow` · `test: add executed visual-QA matrix and production perf gates` · `docs: record Sprint 6 ownership, realtime and performance`

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited or tracked; none in the branch diff.

---

## Session — Phase 2: Sprint 5.1 (Independent Sales UI Merge-Gate Hardening)

**Date:** 2026-08-04 · **Branch:** `feature/sales-ui-depth` (PR #8, unmerged) · **Base:** `main` @ `e949f2b`

### Objective
Independently harden the committed Sprint 5 UI for merge. Confirmed gaps addressed:

1. **Customer stale-write** — `update_customer` gained `p_expected_updated_at` (compared under `FOR UPDATE`, 40001 before any write/audit); customers have no `version`, so the trigger-maintained `updated_at` is the precondition. New migration `20260805110000`.
2. **Follow-up stale-write** — `update_follow_up` gained `p_expected_version`; `reassign_follow_up` gained an optional `p_expected_version`.
3. **Optional-field clearing** — explicit PATCH: absent=unchanged, blank=clear-to-NULL, value=update. Added `p_clear_phone/email/location` (customer) and `p_clear_description` (follow-up).
4. **Follow-up reassignment UI** — authorized reassign form on the edit route (capability-gated, version-guarded, RPC-enforced branch/active/same-org).
5. **Lead terminal confirmations** — Mark Won / Mark Lost / Archive behind the extended `ConfirmDialog`; the lost reason is controlled and survives validation/concurrency errors.
6. **Deterministic OTP** — the E2E helper snapshots existing Mailpit IDs and reads only a genuinely-new message (no bypass).
7. **Honest E2E** — the suite now asserts persisted results for every step; unique values via `randomUUID`.

### Migration + tests
`20260805110000_sales_edit_concurrency.sql` (forward-only; drops+recreates `update_customer`/`update_follow_up`/`reassign_follow_up` with the new trailing params + re-grants). Regenerated the three RPC arg types surgically. New pgTAP `18_sales_edit_concurrency_test.sql` (+16) and two new two-session race scripts (`customer_update_concurrency_test.sh`, `follow_up_update_concurrency_test.sh`).

### Validation
Frontend typecheck/lint/**114 tests** (104→114)/build ✓ · backend ruff + 10 pytest ✓ · Supabase **two** clean cycles (reset+lint+**382 pgTAP**) ✓ · **5** race scripts ✓ · **Playwright E2E executed and green** (9 scenarios; `PW_CHROMIUM` full-build launch) ✓ · dev-runtime smoke ✓.

### Commits
`fix: add customer and follow-up optimistic concurrency` · `fix: support explicit optional-field clearing` · `feat: add follow-up reassignment and lead terminal confirmations` · `test: make local OTP and sales E2E deterministic` · `docs: record Sprint 5.1 merge-gate hardening`

---

## Session — Phase 2: Sprint 5 (Sales UI Depth & Product QA)

**Date:** 2026-08-04 · **Branch:** `feature/sales-ui-depth` (from `main` @ `e949f2b`, PR #7 merged) · **Base:** `main`

### Objective
Deepen the Sprint-4 B2B sales UI so a salesperson can run the daily workflow end to end: real edit flows, richer detail, explicit confirmations, and a local E2E foundation. Real Supabase data + trusted RPCs only; RLS the boundary.

### Pre-edit review (trusted RPC contracts)
`update_customer` supports name/phone/email/preferred-language/location/source/archive (no type/branch/assignee, no version). `update_lead_details` supports title/priority/customer/next-follow-up with optimistic `expected_version` (source/branch not supported; assignment is the separate versioned `assign_lead`). `update_follow_up` supports title/description/due/priority under a `status='open'` guard (reassign/lifecycle are separate RPCs). → **No new migration required**; edit fields limited to what each RPC supports (no invented fields).

### Implemented
- **Routes:** `/b2b/customers/[id]/edit`, `/b2b/leads/[id]/edit`, `/b2b/follow-ups/[id]/edit` (each guards `canWrite`, localized not-found/permission).
- **Server actions:** `updateCustomerAction`, `updateLeadDetailsAction` (optimistic version → `leads.conflict` refresh), `updateFollowUpAction` (open-guard → `states.followUpNotOpen`); robust idempotent archive with flash.
- **Detail depth:** customer detail gains edit/add-activity/add-follow-up/follow-up lists + per-row actions + created/updated/archived flashes; lead detail gains an Edit-details link and per-follow-up row actions; follow-ups board gains Edit + a confirmed Cancel.
- **Accessibility:** shared `ConfirmDialog` (role=dialog, aria-modal, focus-in/trap/Escape/restore) for terminal actions (archive, cancel).
- **Query helpers:** `getFollowUp`, `listFollowUpsForCustomer`. Generalized the activity + inline-follow-up forms to accept a `customerId`.
- **Local E2E:** Playwright foundation (`frontend/playwright.config.ts`, `frontend/e2e/`), real Email-OTP via Mailpit (no bypass), seeded identities (`a-owner` manager / `a-cairo` branch-limited), 12 smoke scenarios; `pnpm e2e` script; artifacts gitignored.

### Validation
Frontend typecheck/lint/**104 tests** (92→104)/build ✓ · backend ruff + 10 pytest ✓ · Supabase db reset + lint + **366 pgTAP** (unchanged; no SQL change) ✓ · doc links 0 broken · dev-runtime smoke (fresh `.next`, routes 200/307, no module error) ✓ · structural QA (AR rtl / EN ltr / dark class / guarded edit routes) ✓.

### Not done in this sandbox (environmental)
- **Live 4-viewport × light/dark × ar/en visual QA** and **Playwright suite execution** could not run: the sandbox blocks launching a browser process (`spawn UNKNOWN`), the Playwright headless-shell download 400s, and the Chrome automation extension was disconnected. The E2E suite is authored and type-checks; a maintainer runs `pnpm e2e` + the visual pass. No schema/`.pen`/`main` change.

### Commits
`feat: add customer edit and detail improvements` · `feat: add lead edit and pipeline interaction improvements` · `feat: add follow-up edit and lifecycle feedback` · `test: add local sales E2E foundation and product QA coverage` · `docs: record Sprint 5 sales UI depth and QA`

---

## Session — Phase 2: Sprint 4.2 (Public Directory View Security Hardening)

**Date:** 2026-08-04 · **Branch:** `bugfix/public-directory-view-hardening` (from `main` @ `2b19fa7`, PR #6 merged) · **Base:** `main`

### Objective
Resolve two Supabase Security Advisor "Security Definer View" findings on `public.organization_public_directory` and `public.profile_public_directory` without weakening the public-discovery boundary.

### Pre-edit security report (live catalog)
Both views: `reloptions = {security_invoker=false}` (owner-rights → Advisor rule 0010), owner `postgres`. `anon` holds **zero** grant on the base `organizations`/`profiles`/`users` tables (only `authenticated`/`service_role` have RLS-restricted SELECT); RLS enabled, `force_rls` off (owner-exempt, so the definer view applies its own WHERE). Directory objects also carried stale default `TRUNCATE`/`REFERENCES`/`TRIGGER` grants. → A blind `security_invoker=true` would break discovery (no anon base-table access) and "fixing" it via anon base-table grants would broaden the sensitive-table surface (the documented trap).

### Design (evaluated A→B→C)
- **A (projection tables)** rejected — duplicates identity data/authority, maintenance/staleness burden.
- **B (invoker view over existing tables)** rejected — profiles needs the `users` join (would expose `users` to anon); organizations would require anon direct base-table SELECT + an anon RLS policy, broadening the anon surface.
- **C selected** — the privileged read moved into constrained `security definer` readers `app._organization_public_directory()` / `app._profile_public_directory()` (`search_path=''`, schema-qualified, non-exposed `app` schema, `PUBLIC` execute revoked, EXECUTE to anon/authenticated/service_role); the `public.*` relations stay VIEWS, now `security_invoker=true`, whose body only calls the reader. Advisor cleared; `anon` still needs no base-table grant; exact columns, eligibility, and the Data-API relation path preserved. Directory grants tightened to SELECT-only.

### Migration
`supabase/migrations/20260805100000_public_directory_invoker_hardening.sql` (forward-only; deterministic under clean reset).

### Public columns (unchanged)
Org: `id, name, slug, org_type, is_verified, primary_locale, locality_id, logo_media_id` (active + verified + not-deleted). Profile: `id, display_name, headline, bio, avatar_media_id, locality_id, languages` (listed + professional + active + not-deleted).

### Tests / validation
New `supabase/tests/17_public_directory_hardening_test.sql` (+29): both views are `security_invoker` (not definer), backing readers are `security definer` with pinned search_path in `app`, `PUBLIC` cannot execute them, directory grants are SELECT-only (no TRUNCATE/REFERENCES/TRIGGER), anon still cannot read base tables, and anon discovery still returns the right rows. pgTAP **337 → 366**. Two clean reset→lint→test cycles (lint clean), all three two-session concurrency scripts pass, frontend (typecheck/lint/92 tests/build) + backend (ruff/10 pytest) green. Advisor rule-0010 catalog query returns **0 flagged**.

### Advisor verification note
`supabase db lint` runs `plpgsql_check`, not the Security Advisor rules; the Studio Advisor UI was not exercised headlessly. Verified instead via the exact rule-0010 catalog query (0 rows) and per-object `reloptions` (both `security_invoker=true`) after a clean reset. A maintainer can confirm visually in Studio.

### Commits
`security: harden public directory read boundaries` · `test: prove public directory visibility and privilege isolation` · `docs: record public directory Advisor hardening`

---

## Session — Phase 2: Sprint 4.1 (Independent Frontend, Auth & UX Review)

**Date:** 2026-08-04 · **Branch:** `feature/b2b-sales-ui` (PR #6, unmerged) · **Base:** `main` @ `f9596a3`

### Objective
Independently review the committed Sprint 4 UI (not the prior completion report) and harden it: auth/registration boundary, nested forms, org/branch context consistency, branch-selection honesty, silent data loss, search injection, route-level error states, SSR cookie/cache accuracy, design-system/Arabic/accessibility, and responsive coverage.

### Confirmed findings & fixes (no schema change; 337 pgTAP unchanged; frontend tests 51 → 92)
1. **Nested `<form>`** at the OTP verify step → rewrote as sibling forms + `type="button"` change-email reset (refocuses email) + Resend-with-cooldown; DOM test asserts no `form form`.
2. **Sign In implicitly registered** unknown emails (`shouldCreateUser: true`) → `false`; unknown-identity rejection returns the same "code sent" result (no enumeration, no implicit sign-up). Tests prove the boundary.
3. **Cockpit widgets ignored active org/branch** → `myOpenLeads/overdueFollowUps/followUpsDueToday/recentActivities/stageCounts` now take `(orgId, branchId?)`; query tests cover org isolation + branch narrowing; `stageCounts` tallies the RLS-scoped base table so branch narrows honestly.
4. **Dishonest branch selector** → `resolveActiveOrg`/`resolveActiveBranch` pure resolvers (single→auto-select, in-scope-cookie-only, "All / All my branches" labels); single branch renders read-only. Pure-function tests (one/many/forged/removed).
5. **Silent lead-intent loss** (swallowed `try/catch`) → removed the field; intent is a real note from Lead details; test asserts no activity write on create.
6. **Customer search** raw-interpolated into `.or()` → `sanitizeSearchTerm` whitelist + metacharacter matrix test (incl. Arabic/phone).
7. **No route-level error/not-found** → `b2b/error.tsx` (self-contained bilingual, retry, no PII/raw-DB logging) + `b2b/not-found.tsx`.
8. **Inaccurate SSR cookie docs** (claimed HttpOnly) → corrected (shared, non-HttpOnly, per-request client, force-dynamic, no token logging).
9. **Awkward Arabic** (`تحديد كمكسوبة`) → `رابحة/كرابحة`.

### Validation
Frontend typecheck/lint/**92 tests**/build ✓ · backend ruff + 10 pytest ✓ · Supabase `db reset` + lint + **337 pgTAP** + all three two-session race scripts ✓ · 824 doc links/0 broken · workflow-YAML/secret/tracked-artifact/`.pen` audits clean.

### Not done this session
- **Live-browser responsive re-validation** — the Chrome automation extension was disconnected (after `/login`). Verified server-rendered structure via HTTP (Arabic `dir="rtl"`, single sign-in form, responsive classes, no inline hex) and the no-nested-form invariant via a real-DOM test; a maintainer should confirm the four breakpoints × light/dark × ar/en visually. No schema, `.pen`, or `main` changes.

### Commits
`fix: correct Email OTP form and pilot sign-in boundaries` · `fix: enforce organization and branch context across the sales UI` · `fix: remove silent lead-intent loss and harden customer search` · `feat: add localized route error and not-found states` · `test: expand frontend auth, context, and query coverage` · `docs: record the independent Sprint 4.1 review`

---

## Session — Phase 2: Sprint 4 (Authenticated B2B Sales Vertical Slice — first product UI)
**Date/time:** 2026-08-04
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-ui` (cut from `main` @ `f9596a3`, PR #5 merged; **not merged**)

### Objective
Ship the first usable end-to-end B2B Sales UI wired to the **real** Sprint-3 Supabase schema, RLS, RPCs, and server-only helpers (ADR-0008) — no mock data in core flows. Arabic-first (RTL), English switch, light/dark, responsive. Auth stays passwordless (Email OTP); authorization stays in the database.

### What shipped
- **Auth:** passwordless **Email-OTP** (`@supabase/ssr` cookie session) — `/auth/sign-in` (email → 6-digit code), `middleware.ts` refreshes the session and guards `/b2b/*` (redirect with `?next=`, open-redirect-guarded), sign-out. No passwords/SMS/WhatsApp.
- **Shell + context:** top bar (brand, org/branch selectors, language/theme, account), sprint-only nav (Home/Customers/Leads/Follow-ups) with a mobile bottom bar; org/branch context **derived from real memberships/capabilities/branch-access** (no role switcher; cookie is a preference only, RLS re-checks).
- **Routes (9):** `/b2b` cockpit (my open leads, leads-by-stage, overdue + due-today follow-ups, recent activity, quick actions); customers list/new/detail; leads list + **pipeline (kanban)**/new/detail (stage/won/lost/reopen/archive, assign/reassign, timeline note/call/meeting, inline follow-ups, **optimistic `version` concurrency** with a conflict-refresh); follow-ups (overdue/due-today/upcoming/completed + complete/reopen/cancel).
- **Data access:** Server Components read via a caller-scoped client (RLS-scoped); Server Actions wrap the `server-only` sales helpers; RPC errors map to translation **keys** (never raw DB text); dashboard uses the `security_invoker` views. No service-role in browser code.
- **i18n/theme:** custom cookie-based Arabic-first i18n (ar/en catalogs, key-parity-tested, `<html dir>` server-set) — locale not in the URL, preserving the flat routes; cookie light/dark via `.dark` on `<html>` (no flash), consuming design-system tokens.

### Dependencies added (justified)
`@supabase/ssr` (official cookie-session auth SDK — hard to get right; auth SDKs are on the AGENTS.md allow-list). Dev-only: `@testing-library/react`/`dom`/`jest-dom` + `happy-dom` for component tests.

### Bugs found & fixed during live validation
- **Org duplication / wrong capabilities:** `loadWorkspaceContext` queried `memberships` without a `user_id` filter; a manager sees other members' rows via RLS, so the org list duplicated and capability resolution could pick another member's row. Now scoped to `auth.getUser().id`.
- **Ambiguous embed (PGRST201):** `listOrgMembers` embedded `users` while `memberships` has two FKs to `users` (`user_id`, `invited_by`). Disambiguated to `users!memberships_user_id_fkey`.
- **Local auth "Database error finding user":** seeded `auth.users` rows had NULL GoTrue token columns (first sprint to use Auth). Normalized to `''` in `seed.sql` (auth-only; pgTAP stays 337/337).

### Local test setup (product owner)
Manual **demo seed** (`supabase/demo-seed.sql`, NOT part of `db reset` so the Phase-1 snapshot tests stay green): grants sales caps to the seeded members and adds 3 customers / 4 leads / 2 activities / 3 follow-ups. Sign in with `a-owner@example.test` (org manager) or `a-cairo@example.test` (Cairo branch-limited salesperson); read the 6-digit code from **Mailpit** (`:54324`). A local `magic_link.html` template shows `{{ .Token }}`. Full steps + identities in `docs/frontend/sprint-4-b2b-sales-ui.md`.

### Validation
Frontend typecheck · lint · **51 tests** (i18n parity, error-mapping, capability gates, auth + sales-forms actions, sign-in + customers-table component tests) · production build — all GREEN. Supabase `db reset`/lint/`test db` → **337/337** (unchanged; UI touches no schema). Backend unchanged. **Live browser validation:** real Email-OTP sign-in → Arabic RTL cockpit with RLS-scoped demo data (manager); English + dark leads pipeline; middleware redirect (307) for the unauthenticated `/b2b`; Arabic error state on a failed send. Repo: doc links, `git diff --check`, secret scan, `.pen` audit.

### `.pen` integrity
No Pencil tool invoked; no `.pen` edited; `.pen` files gitignored, none tracked, none in the branch diff.

### Remaining / deferred
WhatsApp OTP; notifications/reminders; products/inventory/RFQ/quotes/projects/ads/payments/OCR/AI/native mobile; bulk import/export UI; advanced team-permission UI. Session-refresh relies on middleware `getUser()` (adequate for the slice).

### Commits created (this sprint)
1. `feat: add passwordless auth and protected B2B shell`
2. `feat: add customer list, create, and detail flows`
3. `feat: add lead pipeline, create, and detail flows`
4. `feat: add activities and follow-up flows`
5. `test: cover the authenticated B2B sales vertical slice`
6. `docs: record Sprint 4 frontend implementation`

### Remaining (next)
Open PR `feature/b2b-sales-ui → main`; require `frontend`/`backend`/`docs`/`supabase-rls`. Do not merge from this task.

---

## Session — Phase 2: Sprint 3.1 (Independent B2B Sales Security & Correctness Review)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-workflow` (continued; **not merged** — PR #5)

### Objective
Independently review the committed Sprint 3 sales implementation against the live catalog and real behavior (not the prior completion report): tenant/branch isolation, capability boundaries, direct-DML boundaries, the customer/phone model, lead lifecycle + concurrency, activities/follow-ups, dashboard read-models, the server-only helper, and test quality.

### Independently verified (no defect)
- **Direct-DML boundary:** live catalog shows `anon` = no privilege; `authenticated`/`service_role` = SELECT only on `customers`/`leads`/`sales_activities`/`follow_up_tasks`; no column INSERT/UPDATE/DELETE grants; no TRUNCATE/REFERENCES/TRIGGER; RLS enabled on all four; only SELECT policies exist (writes are RPC-only).
- **Functions:** all 13 sales RPCs are postgres-owned, `security definer`, `search_path=""`, execute = `authenticated` only (PUBLIC/anon/`service_role` = none). Helpers pinned likewise; `normalize_phone` is INVOKER+immutable.
- **Structural tenancy:** every child link (`branch`/`customer`/`assignee`/`lead`) is a composite FK `(organization_id, child) → parent(organization_id, id)` — cross-tenant linkage impossible by construction. Empirically re-confirmed cross-tenant read = 0 and cross-tenant customer link on `create_lead` = `23503`.
- **Capabilities:** no sales RPC grants capabilities (no self-escalation path); assignment requires `sales.assign`/`sales.manage`; branch-compatible assignment blocks cross-branch escalation; inactive membership → denied; org-wide (null-branch) create requires `sales.manage`.
- **Phone normalization:** deterministic; Egyptian local/international/`00`/country-code forms all collapse to one `+20…` E.164 (correct dedup); empty/garbage → NULL (no false dedup).

### Findings

- **F1 (correctness, non-blocking — FIXED).** The RLS assignment-visibility subquery used `m.organization_id = organization_id`; the unqualified `organization_id` resolves to the subquery's `memberships` table, making the org predicate a **tautology** (dead code) in all four `*_select_scope` policies. Not exploitable — each policy is gated by `app.is_org_member(organization_id)` and membership ids are org-unique, so no cross-tenant/cross-branch leak occurs (re-proven empirically) — but the org-filter was a no-op relying on a second mechanism. **Fixed** by correlating to the row's org (`customers.organization_id`, `leads.organization_id`, `sales_activities.organization_id`, `follow_up_tasks.organization_id`). All 337 assertions still pass.
- **F2 (test coverage — ADDED).** Optimistic-version pgTAP alone proves the version comparison but not that `transition_lead`'s `FOR UPDATE` **serializes** genuinely concurrent transitions. Added a real two-session script `lead_transition_concurrency_test.sh` (wired into `supabase-rls`): T1 holds the row lock via the RPC's internal `UPDATE` then sleeps; T2's concurrent transition **blocks ≥2 s**, re-reads the committed version, and is rejected with `40001` — final state is only T1's change (no lost update). Self-contained (sets up its own active actor) so it is order-independent of the other concurrency scripts. Observed second-session waits: 2.80 s / 2.73 s across the two clean cycles.
- **F3 (data quality, non-blocking — documented).** `normalize_phone` on an extension-bearing / non-standard-length number (e.g. `0111-222-3333 x99`) yields a non-E.164 `+0111…` string. Deterministic, so intra-org dedup stays consistent and no isolation is affected; it is a documented pragmatic-MVP limitation, not a defect. A full libphonenumber normalizer remains deferred.

### Test-quality note
The sales pgTAP files use `reset role` (postgres) **only** for fixture setup (granting caps in-transaction, building temp-table id registries, reading `audit_log` counts) — never to make an unsafe production path look safe. Every security assertion (`throws_ok` on `42501`/`23503`/`23505`/`22023`/`40001`, cross-tenant counts, append-only denial) runs under the real `anon`/`authenticated`/`service_role` roles.

### Validation
Two clean cycles: `db reset` → `db lint public,app` (clean) → `supabase test db` (**337/337**) → all three concurrency scripts PASS (last-owner, approval, lead-transition). Frontend typecheck/lint/**12 tests**/build GREEN. Backend unchanged; `backend` check is **green on CI (Linux)** — the local Windows `cryptography` `_rust` DLL block is environmental. Repo: 822 doc links / 0 broken; `git diff --check` clean; YAML valid; no secrets/artifacts.

### `.pen` integrity (accurate)
No Pencil tool invoked; no `.pen` edited by this review; `.pen` files are gitignored, none tracked, none in the branch diff. Current on-disk `design.pen` SHA-256 = `965DB8D0434C0305E2C12C5E56DDB7F8629C0048B931E3C98648477C0B18D6EB`, **unchanged during this review** but **different from the Sprint 2.1 baseline `F1756CD3…`** — an external editor autosave that predates this task; not attributable to this review. Integrity is **not** claimed against the old baseline.

### Commits created (this review)
1. `fix: correlate sales RLS assignment-visibility to the row's organization`
2. `test: prove lead-transition serialization with a real two-session race`
3. `docs: record the independent Sprint 3.1 sales review`

### Remaining
PR #5 updates automatically; require `frontend`/`backend`/`docs`/`supabase-rls`; do not merge from this task.

---

## Session — Phase 2: Sprint 3 (B2B Sales Domain Foundation)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/b2b-sales-workflow` (cut from `main` @ `54792a4`, PR #4 merged; **not merged**)

### Objective
Build the secure B2B sales operating foundation (the Sales beachhead) on the Phase 1 identity/tenancy spine: tenant-owned customers, leads, sales activities, and follow-up tasks with scope-based RLS, constrained auditable write paths, and dashboard read-models. No orders/quotes/RFQ/products/inventory/projects/payments/OCR/WhatsApp/AI; no UI screens.

### Pre-implementation review (key decisions → ADR-0008)
Reviewed the existing spec rather than implementing it blindly. The spec's pipeline unit is `Opportunity` (stages incl. `matching`/`quoted`); Sprint 3 implements **`leads`** with in-scope stages only (`new→contacted→qualified→proposal_pending→decision_pending`) — the Match/RFQ/Quote-dependent stages stay deferred. Reconciled `leads`/`customers` as the concrete MVP entities; the richer Opportunity/Need/Match chain remains spec. Deliberate decisions: minimal caps `sales.read/write/assign/manage`; **no** platform cross-tenant read on customer PII (Customer Data Never Leaves the Platform); composite-FK structural tenant safety; denormalized `branch_id` on activities/follow-ups for scope-consistent RLS; phone normalization for intra-org dedup.

### Migrations added (schema source of truth)
- `20260805090001_sales_customers_leads.sql` — enums (`customer_type`, `customer_status`, `sales_source`, `sales_priority`, `lead_status`, `lead_stage`); `customers` + `leads`; capability-catalog + audit-action-allow-list extensions; `unique (organization_id, id)` on `branches`/`memberships` for composite FKs; `app.normalize_phone`/`can_manage_sales`/`membership_can_access_branch`; scope RLS; SELECT-only grants.
- `20260805090002_sales_activities_followups.sql` — enums (`sales_activity_type`, `follow_up_status`); append-only `sales_activities`; `follow_up_tasks`; scope RLS; SELECT-only grants.
- `20260805090003_sales_write_paths.sql` — `app.active_membership_id`/`can_act_on_follow_up`; 13 `security definer` workflow RPCs (create/update customer; create/update-details/assign/transition lead; add activity; create/update/complete/reopen/cancel/reassign follow-up); execute granted to `authenticated` only; 5 `security_invoker` dashboard views.

### Security model (reuses ADR-0007 pattern)
Base tables SELECT-only for `authenticated`/`service_role`; `anon` none; no write policies/grants — every mutation is a `public` `security definer` RPC (`search_path=''`) deriving the caller from `auth.uid()`, resolving active membership, enforcing org + branch scope + capability, rejecting cross-tenant ids, and emitting audit in the same transaction. Cross-tenant linkage is structurally impossible (composite FKs). Lead transitions are optimistic-locked (`version` + `FOR UPDATE`; stale → `40001`). Direct DML cannot bypass lifecycle/assignment/tenant/audit invariants.

### Tests / validation
New pgTAP `15_sales_customers_leads` (49) + `16_sales_activities_followups` (34); all existing **254** preserved → suite **337/337 PASS** across **two clean `db reset` cycles** (reset → `db lint public,app` clean → `test db`). Sales caps are granted in-transaction inside the sales tests (the shared seed and Phase-1 snapshot assertions are unchanged). Proven: tenant ownership, cross-tenant read/link denial, branch isolation, revoked-member denial, duplicate detection (same phone across tenants allowed), assignment rules, optimistic-concurrency rejection, won/lost/reopen audit, append-only tenant-private activities with unspoofable actors, follow-up lifecycle, scoped overdue/due-today read-models, and the direct-DML write boundary. Frontend: types regenerated; `server-only` `sales.ts` helper + 5 unit tests; typecheck/lint/**12 tests**/build GREEN. Optimistic concurrency is deterministic (expected-version), so no shell race script was needed.

### Backend note
No backend change (sales write paths are Next.js server actions, ADR-0001). `uv sync --frozen` + `ruff` pass; local `pytest` was blocked by a Windows Application Control policy denying the `cryptography` `_rust` DLL — an environment issue, not a code regression (backend unchanged; CI `backend` runs on Linux).

### `.pen` integrity
No Pencil tool was invoked and no `.pen` file was edited by this task; `.pen` files are gitignored and absent from the branch/PR. (Observed: the on-disk `design.pen` SHA differs from the Sprint 2.1 baseline with an mtime around session start — an external editor autosave outside this task's scope; not attributable to any action here.)

### Remaining technical debt
Sales UI (05C); RFQ/quotes/projects link from `leads`; notifications/reminders on `follow_up_tasks` (schema is reminder-ready); Excel import/export execution (schema is import-ready); org-customizable pipeline stages; platform governance path over sales data; scheduled overdue materialization; multi-contact-point table if needed.

### Rollback notes
Additive and branch-confined. The three sales migrations and the capability/audit-allow-list extensions can be reverted together (the `unique (organization_id, id)` additions on `branches`/`memberships` are harmless if retained). `main` is untouched.

### Commits created (this sprint)
1. `db: add tenant-scoped customer and lead schema`
2. `db: add sales activity and follow-up tables`
3. `db: add trusted sales workflow RPCs and read models`
4. `test: cover sales tenant isolation and lifecycle rules`
5. `feat: add server-only B2B sales workflow helpers`
6. `docs: record Sprint 3 B2B sales foundation`

### Remaining (next)
Open PR `feature/b2b-sales-workflow → main`; require `frontend`/`backend`/`docs`/`supabase-rls`; do not merge from this task. Recommend an independent security review of the sales tenancy/visibility model before merge.

---

## Session — Phase 1: Sprint 2.1 (Independent Trusted Write-Path Security Review)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/account-upgrade-verification` (continued; **not merged** — PR #4)

### Objective
Independently review the committed Sprint 2 write paths against the live catalog and real behavior (not the prior completion report), close any merge-blocking bypass, and prove the final state with clean resets and real two-session concurrency tests. No new feature; no `.pen` edit; nothing pushed to `main`.

### Original bypasses discovered (confirmed empirically, then fixed)
1. **Direct `service_role` privileged-identity bypass** — `service_role` held full DML on the identity/verification tables (a Sprint 1 "trusted-writer" grant), so `update public.users set primary_account_type=…` (and verification/audit writes) succeeded with **no** verification, approval, `applied_at`, listing check, concurrency lock, or audit — bypassing the entire account-upgrade workflow.
2. **Direct membership/capability/branch bypass** — `authenticated` and `service_role` could DML `memberships`/`membership_capabilities`/`membership_branch_access` directly, bypassing no-escalation, last-owner, lifecycle, tenant-match, and audit.
3. **Last-owner race** — protection locked only the changing membership/capability rows, so two transactions removing *different* owners could each pass its check and leave zero owners.
4. **Stale/concurrent verification decisions** — reviewer ownership was not sticky and only sequential behavior was tested; terminal decisions were not provably immutable.
5. **Unbounded decision reason** — reject/changes-requested reasons were unbounded and not preserved in audit across a resubmission.

### Exact fixes (migration `20260804090001_write_path_security_hardening.sql`)
- **Direct-DML boundary (D17).** `revoke insert,update,delete` from `service_role` on the ten reviewed tables and from `authenticated` on `memberships`/`membership_capabilities`/`membership_branch_access`/`branches`/`contacts`; dropped obsolete membership/branch write policies. Re-granted the minimum: `authenticated` self-service columns; the single non-privileged `users.locale` UPDATE for `authenticated` **and** `service_role` (asserted by test 14 as service_role's only column write — documented, not accidental). `anon` retains no privilege on any reviewed table.
- **Verification lifecycle hardening (D18).** `app.guard_verification_update` trigger makes subject/type/target/submission metadata and terminal/applied rows immutable; reviewer assignment is sticky; only the assigned reviewer may decide/confirm; listing eligibility changes only during approval. `request_account_upgrade` resubmits a `needs_more_info` target, clears the prior claim/reason, emits audit, and requires a fresh `review_start`. `apply_account_upgrade` gates on unexpired + approved + professional **user** subject, takes the target from the immutable row, and is idempotent (`applied_at`). Reasons bounded to 1–2000 chars, trimmed, and preserved in audit metadata.
- **Membership/capability hardening (D19).** The seven membership/branch RPCs are mandatory; each rechecks caller authority **after** taking the org lock, rejects invalid/duplicate capability keys, enforces no-escalation + last-owner + tenant match (a structural `enforce_membership_branch_tenant` trigger), rejects inactive membership/branch, and audits only real changes.
- **Stable-lock design.** Every protected membership/capability mutation `SELECT … FOR UPDATE`s the stable `organizations` row before rechecking authority/status and mutating the owner set; verification decisions/apply lock the `verifications` row. Two transactions can no longer each remove a different last owner.
- **Audit rollback.** `app.record_audit_event` stays internal-only (no role can execute; no direct `audit_log` INSERT for any app role); every allowed sensitive path emits its audit row **inside** the same transaction, so an audit failure rolls the business change back.

### Verified final state (live catalog + empirical)
- **Table privileges:** `anon` = none; `authenticated` = SELECT (+ self-service columns, + `contacts` delete); `service_role` = SELECT only, **plus `users.locale` UPDATE and nothing else**. No `TRUNCATE`/`REFERENCES`/`TRIGGER` for any app role. RLS enabled on all 12 tables.
- **Empirical service-role DML:** `update primary_account_type` / `update public_profile_status` / `insert audit_log` / `insert platform_role_grants` / `insert membership_capabilities` / `execute apply_account_upgrade` → **all denied**; `update users.locale` → allowed (the one grant).
- **Functions:** 14 `public` workflow RPCs — postgres-owned, `security definer`, `search_path=""`, volatile, **execute = `authenticated` only** (PUBLIC/anon/`service_role` = none), so `service_role` cannot invoke a caller-attributed workflow. Internal `app.record_audit_event`/`assert_not_last_owner` = executable by no role. App roles are not members of `postgres` and are not superusers → postgres ownership cannot be assumed. (`app.set_updated_at` is a Sprint 1 SECURITY INVOKER trigger without a pinned `search_path`; benign — INVOKER, references only `pg_catalog.now()` — noted, not changed.)

### Concurrency proof (real two-session `docker exec` scripts, in CI)
- `last_owner_concurrency_test.sh`: T1 holds the org row lock and revokes owner A; T2's revoke of owner B **blocks ≥2 s**, rechecks committed state, fails with `cannot remove the last active org.manage owner`, and exactly **one** active `org.manage` owner remains. Observed second-session waits: **2795 ms** and **2738 ms** across the two final cycles.
- `account_approval_concurrency_test.sh`: two conflicting listing flags through the same assigned reviewer serialize on the verification row; the second call is an idempotent no-op — final `approved | grants_public_listing=t | reviewer preserved | one `verification.approved` audit row`. Observed second-session waits: **2700 ms** and **2708 ms**.

### Tests / validation
- pgTAP reconciled to the authoritative **254** assertions across 14 files (suite 14 grew 83→85 for the bounded-reason + resubmission-audit fixes; earlier records of 246/252 were an intermediate run and the pre-fix plan sum, now superseded). **Two fully completed clean cycles** — `db reset` → `db lint --schema public,app` (no findings) → `supabase test db` (**254/254 PASS**) → both concurrency scripts (PASS) — plus a third confirming reset of the exact committed tree (254/254). An early Sprint 2.1 reset had timed out during container restart (246 assertions at that point); the required clean cycles now complete normally.
- Frontend: frozen install · typecheck · lint · **7 tests** · production build — GREEN. `account-upgrade.ts`/`membership.ts` import `server-only` (pinned `server-only@0.0.1`), take a caller-scoped client (no service-role client), reject malformed RPC UUID results, propagate errors, and hold no authorization logic. No client component imports them.
- Backend: `uv sync --frozen` · ruff (clean) · **pytest 10** — GREEN. No backend write path added (ADR-0001).
- Repo: `check_doc_links.py` → 805 links, 0 broken; `git diff --check` clean; no secrets/temp/test-output/Docker artifacts; workflow YAML valid; `supabase-rls` runs reset/lint/pgTAP + both races + repeat.

### `.pen` integrity
`UI-UX/design.pen` SHA-256 unchanged: `F1756CD38005F42C7A37EFE6E8ADB5FF4D92414F71D99AAF07B072C1168B7402`. No `.pen` file modified.

### Remaining technical debt
Platform-role grant/revoke remains a reviewed-migration/DBA owner transaction (constrained attributed RPC deferred — do **not** restore table DML); verification `expires_at` enforced at apply time but no scheduler materializes `expired`; verification document storage + OCR (placeholder table only); org-subject verification review UX; subscription/package gate before `apply_account_upgrade`; org-visible audit scope; JWT custom-claim optimization for RLS helpers; live backend RLS integration test; repo-wide default-privileges lint. `app.set_updated_at` pinned-`search_path` tidy-up (benign).

### Rollback notes
All Sprint 2.1 changes are additive and confined to this branch. Reverting migration `20260804090001` (and the two commits below) restores the Sprint 2 (pre-review) grants and behavior; no data migration is required — the reviewed tables carry no privileged rows written by the removed direct paths, and the RPCs are unchanged by rollback except for the reason bounds. `main` is untouched; PR #4 is the only integration path.

### Commits created (this review; prior Sprint 2 commits not squashed)
- `8e782e3` security: enforce constrained Phase 1 write boundaries (migration hardening: revokes, RPC-only, verification immutability, org-row locking)
- `abea371` test: gate adversarial and concurrent write paths (suite 14 + both concurrency scripts + CI wiring)
- `354cddd` security: harden trusted server action boundaries (`server-only`, caller-scoped clients, UUID guards)
- `7168a3f` security: bound verification decision reasons and document the service-role locale grant
- `0761f5f` test: assert bounded decision reasons and resubmission audit preservation
- `docs: record the independent Sprint 2.1 security review` (this entry + ADR-0007 D17–D20, DECISION_LOG, review §9, specs 02/03/06/07/10/11/12, TECHNICAL_DEBT, DOCUMENTATION_STATUS, RUNTIME_STATE)

### Remaining (next)
Await explicit merge authorization on PR #4 (do not merge from this task); require `frontend`/`backend`/`docs`/`supabase-rls` green. Do not begin another sprint from this review.

---

## Session — Phase 1: Sprint 2 (Account Upgrade, Verification & Membership Write Paths)
**Date/time:** 2026-08-03
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/account-upgrade-verification` (cut from merged `main` @ `a3d7526`; not merged)

### Objective
Implement the trusted write paths on top of the validated Sprint 1 identity/RLS foundation: account upgrade, professional verification, membership lifecycle, branch assignment, and constrained audit emission. No UI/OTP/products/sales; server-controlled fields stay server-controlled.

### Migrations added
- `20260803090001_verification_and_upgrade.sql` — `verification_subject`/`verification_type`/`verification_status` enums; `verifications` (+ minimal `verification_documents`); internal `app.record_audit_event()` (Sprint 1.1 H2 deferral resolved); widened audit action allow-list; account-upgrade RPCs: `request_account_upgrade` (self-service), `review_start`/`review_request_changes`/`review_reject`/`review_approve`, `apply_account_upgrade`, `set_profile_hidden`; RLS (RPC-only writes) + grants.
- `20260803090002_membership_branch_write_paths.sql` — `membership_invite`/`activate`/`set_capabilities`/`suspend`/`revoke` (+ `app.assert_not_last_owner`); `branch_assign`/`unassign`.

### Design (ADR-0007 §Amendments — Sprint 2, D12–D16)
Workflow split so submission ≠ approval; all state changes are `security definer` RPCs (`search_path=''`, schema-qualified) deriving authority from `auth.uid()` (no spoofable params). `apply_account_upgrade` is the only path that changes `primary_account_type`/`public_profile_status` (idempotent via `applied_at`+`FOR UPDATE`). Verification decisions platform-only (`app.is_platform`), no self-approval. Membership: no-escalation (grant only held caps) + last-owner protection (row-locked). Branch: cross-tenant impossible. `record_audit_event` internal-only, actor = `auth.uid()`. RPC placement in `public` (PostgREST-exposed) with internal gating.

### Data-access helpers
Frontend server-action wrappers only: `server/actions/account-upgrade.ts` + `membership.ts` (thin `.rpc()` calls over the caller-scoped server client; no privileged logic; no service-role). No backend helper — these are Next.js write paths, not the FastAPI AI service (ADR-0001). Regenerated `database.types.ts`.

### Tests / validation
pgTAP **112 → 169** (new `11_account_upgrade`, `12_membership_write_paths`, `13_audit_emission`). Two clean `db reset` + `test db` cycles → **169/169 PASS**; `db lint --schema public,app` clean. Catalog audit: 16 functions `security definer`+`search_path=""`; internal writers not client-executable; `verifications` SELECT-only for clients. Frontend typecheck/lint/test(6)/build GREEN; backend ruff + pytest(10). **No `.pen` modified.**

### Docs
ADR-0007 (Sprint 2 amendments D12–D16), DECISION_LOG, phase1 review §8, domain model §C, specs 03/06/10/11/12, TECHNICAL_DEBT (record_audit_event / account-upgrade / last-owner resolved), DOCUMENTATION_STATUS, RUNTIME_STATE, this log.

### Remaining (Sprint 3+)
Verification document storage upload + OCR (placeholder table only); org-subject verification UX; subscription/package gate before `apply_account_upgrade`; notification/Realtime fan-out; transactional outbox.

---

## Session — Phase 1: Sprint 1.2 (Account-Type & Public-Profile Authorization Fix)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (continued; not merged)

### Objective
Narrow merge-blocking correction to the identity model: make `primary_account_type` and public-profile eligibility server-controlled. No new feature; no auth UI; no upgrade workflow build.

### Vulnerability (confirmed empirically, then fixed)
The committed migration granted `authenticated` a column UPDATE on `users.primary_account_type`, and `profile_public_directory` treated any `primary_account_type <> 'end_consumer'` as public. Verified: the seeded consumer ran `update users set primary_account_type='engineer'` (succeeded) and then appeared in the public directory — bypassing the upgrade workflow, verification, and future subscription gates.

### Fix
- **`primary_account_type` server-controlled:** removed from the `authenticated` update grant (only `locale` self-editable now); `is_verified`/`status` were already withheld. `service_role` keeps full `users` DML for the future upgrade/admin RPC. No client write path exists (verified: none in `frontend/`/`backend/` app code).
- **Public eligibility field:** added `profiles.public_profile_status` enum (`hidden` default / `listed`), **not** in the `authenticated` update grant (server-controlled). `profile_public_directory` now requires `public_profile_status='listed'` AND professional account type AND active AND not deleted.
- **Six concepts kept distinct** (ADR-0007 D10/D11): identity · account type (server-controlled) · membership · platform role · professional verification (future `Verification` entity, drives `listed`) · public visibility (`public_profile_status`). `users.is_verified` (identity) not reused.
- Seed lists the two org owners (trusted path) and leaves the sales staff `hidden` as a negative fixture.

### Catalog verification
`role_column_grants`: `authenticated` UPDATE on `users` = `locale` only; on `profiles` = display columns only (no `public_profile_status`). `service_role` retains `users` UPDATE. Empirical consumer self-promote → **denied (42501)**.

### Tests / validation
New `10_account_type_eligibility` (12 assertions: self-promote denied, self-verify denied, self-list denied, locale still editable, hidden professional invisible, listed professional visible, service_role transition works); expanded `08` (listed-only discovery, hidden-professional negative, suspended-user exclusion). pgTAP **98 → 112**; two clean `db reset` + `test db` cycles → **112/112 PASS**; `db lint` clean. Frontend typecheck/lint/test(3)/build GREEN (types regenerated with `public_profile_status`); backend ruff + **pytest 10**. CI: existing `supabase-rls` runs the expanded suite (no duplicate workflow). **No `.pen` modified.**

### Docs
ADR-0007 Sprint 1.2 amendments (D10/D11); DECISION_LOG; phase1 review §7; domain model (User/Profile), 03/06/11/12 specs; TECHNICAL_DEBT (account-upgrade write path); DOCUMENTATION_STATUS; RUNTIME_STATE; this log.

### Remaining (Sprint 2)
Transactional, auditable account-upgrade write path (account-type transition + set `listed` on approval) driven by the professional `Verification` feature.

---

## Session — Phase 1: Sprint 1.1 (Independent Identity & RLS Security Review)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (continued; not merged)

### Objective
Independent security/correctness/schema audit of the unmerged Sprint 1 migrations, grants, policies, functions, triggers, clients, tests, and seeds — fixing findings in the still-unmerged migration set (no history rewrite). No new product feature.

### Two CRITICAL findings (fixed + verified)
- **CRIT-1 (data destruction):** Supabase's default privileges grant `anon`/`authenticated` **`TRUNCATE`** (+ REFERENCES/TRIGGER/MAINTAIN) on every new table; `TRUNCATE` bypasses RLS **and** the row-level immutability trigger, so a client could wipe any table incl. `audit_log`. Confirmed empirically (`anon TRUNCATE audit_log` → succeeded). Fixed: every migration now `revoke all … from anon, authenticated, service_role` then grants back only intended access. Re-verified: `anon TRUNCATE` → denied (42501).
- **CRIT-2 (broken trusted path):** `service_role` had **no DML** on the tables (this CLI version doesn't auto-grant it), so audit inserts / worker outputs would fail in production; local tests passed only as `postgres`. Confirmed (`service_role INSERT audit_log` → denied). Fixed: explicit `service_role` grants (`audit_log`: select+insert; others: full DML, never truncate). Re-verified: `service_role INSERT` → ok.

### Other findings fixed
- **B1** public discovery exposed whole tenant rows → curated `organization_public_directory` / `profile_public_directory` views (approved columns only); base tables private.
- **B2** all-column insert allowed self-verification → column-scoped inserts (status/is_verified/accepted_at withheld → safe defaults).
- **B3** `memberships.branch_id` silently granted access → renamed `primary_branch_id` (descriptive); branch authority solely from `membership_branch_access` + org-wide capability.
- **B4** `administrator` removed from `account_type`; platform authority only via `platform_role_grants`.
- **H1** `PUBLIC` execute revoked on all `app.*` helpers. **H2** audit metadata (object, ≤8KB) + subject_type bounds + trigger `search_path`; `record_audit_event()` RPC deferred. **H3** org-slug format CHECK. **H4** `SUPABASE_ANON_KEY` documented in `backend/.env.example`.

### Verified PASS (unchanged)
`handle_new_user` ignores hostile `raw_user_meta_data` (adversarial test: injected account_type/platform role/verification all ignored; locale validated; name truncated). Clients: fresh instance per call, user client uses anon key (asserted), **RLS proven end-to-end via signed-JWT REST round-trip**.

### CI
Added `.github/workflows/supabase-rls.yml` (stable check `supabase-rls`): start → `db reset` → `db lint --schema public,app` → `supabase test db` → repeat → always `stop`. Runs on PRs to `main`.

### Tests / validation
pgTAP **58 → 98** (added `08_public_discovery`, `09_privilege_hardening`; expanded `05`, `07`). Two clean `db reset` + `test db` cycles → **98/98 PASS**; `db lint` clean. Backend `ruff` clean + **pytest 10 passed**. Frontend typecheck/lint/test(3)/build GREEN; DB types regenerated. Catalog inspection (pg_class/pg_policy/role_table_grants/routine_privileges/pg_proc) confirms RLS on all tables, PUBLIC execute absent, definer search_path pinned. **No `.pen` modified.**

### Docs
ADR-0007 amendments (+ platform-admin provisioning procedure), DECISION_LOG, phase1 review §6, specs 03/06 banners + grant convention, TECHNICAL_DEBT, DOCUMENTATION_STATUS, RUNTIME_STATE, this log.

### Remaining (Sprint 2 / debt)
`record_audit_event()` RPC + automated audit emission; membership write-path invariants (last-owner, invitation flow, no-escalation); org-orphaning; live RLS backend integration test; repo-wide default-privilege CI check.

---

## Session — Phase 1: Identity & Multi-Tenancy (Sprint 1 — Tenant Isolation Foundation)
**Date/time:** 2026-08-02
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `feature/identity-multitenancy` (created from merged `main` @ `64e68d6`, tagged `v0.1.0-foundation`)

### Objectives
Implement the Phase 1 identity & multi-tenancy foundation only: canonical single identity, organizations/branches, memberships/capabilities/branch-access, platform-admin boundary, RLS spine + helpers, append-only audit, seed fixtures, tenant-isolation tests, and minimal tenant-aware data-access foundations. **No other product feature; no `.pen` edit; no direct push to `main`.**

### Repository state verified
- `main` @ `64e68d6` = merged PR #2 (foundation closeout); tag `v0.1.0-foundation` peels to that same commit. Working tree clean; no prior product feature. Cut `feature/identity-multitenancy` from `main`.

### Pre-implementation spec review
- Independent review of the Phase 0.7 spec (docs/technical/02–07, 11, 12) → [`../database/phase1-identity-tenancy-review.md`](../database/phase1-identity-tenancy-review.md). Findings resolved: table name `memberships` (not the charter's descriptive `organization_memberships`); branch access needs a set (added `membership_branch_access`, not a single `branch_id`); helper strategy (`security definer`, avoids RLS recursion); server-side profile bootstrap; platform-admin isolation; `org_type <> end_consumer`. **No blocking product decision.** Genuine architecture choices recorded in **[ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)**.

### Migrations added (schema is the only source of truth — ADR-0002)
- `20260802090001_identity_core.sql` — `app` schema + `set_updated_at`; enums; `users`/`profiles`/`contacts`; `app.handle_new_user()` bootstrap trigger on `auth.users`; identity RLS + column-scoped grants.
- `20260802090002_organizations_tenancy.sql` — `organizations`/`branches`/`memberships`/`membership_capabilities`/`membership_branch_access`/`platform_role_grants`; tenancy helpers `current_org_ids`/`is_org_member`/`has_capability`/`current_branch_ids`/`is_platform`; RLS + grants.
- `20260802090003_audit_foundation.sql` — append-only `audit_log` (immutability trigger; service-role insert; admin-only read).

### Data-access & types
- Frontend: `lib/supabase/server.ts` (caller-scoped client preserving JWT → RLS), typed `client.ts`, `server/queries/tenancy.ts` (org access derived from active memberships). Generated `types/database.types.ts`.
- Backend: `app/database` — `create_user_client` (preserves caller JWT) + `create_service_client` (trusted-path, bypasses RLS); added `supabase_anon_key` to config. New `tests/test_database_clients.py`.

### Seed & tests
- `supabase/seed.sql` — synthetic fixtures (Org A + 2 branches, Org B + 1 branch, 5 users incl. branch-limited member + platform admin). Clearly marked synthetic.
- `supabase/tests/01–07_*.sql` — **58 pgTAP tests**: profile uniqueness/bootstrap, cross-tenant isolation (all verbs), membership lifecycle, branch isolation, unauthorized (anon/non-member), platform-admin boundary, audit immutability.

### Validation
- Supabase: `db reset` (4 migrations + seed) clean; **repeated** (reset → tests → reset → tests); `db lint --schema public,app` → **No schema errors**; `supabase test db` → **58/58 pass** on both resets.
- Frontend **GREEN** (`install --frozen-lockfile`/`typecheck`/`lint`/`test` 3/`build`); Backend **GREEN** (`uv sync --frozen`/`ruff`/`pytest` **8 passed**).
- **No `.pen` modified.** No service-role in client code.

### Docs updated
- `RUNTIME_STATE.md` (Phase 1/Sprint 1 state), this log, `DECISION_LOG.md` (+ADR-0007), `DOCUMENTATION_STATUS.md`, `TECHNICAL_DEBT.md`; new `docs/database/phase1-identity-tenancy-review.md` + `docs/decisions/ADR-0007-…`.

### Known remaining work (Phase 1 follow-ups)
Membership/org **write-path** feature (creation, invites, capability no-escalation, last-owner protection) with authz tests; wire Docker/Supabase RLS CI jobs; JWT custom-claim helper optimization (ADR-0007 D1); org-visible audit scope; org-creation cap; storage buckets when a feature uploads.

---

## Session — Phase 0: Foundation Closeout
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/foundation-closeout` (created from merged `main` @ `68bb0a5`)

> **Supersession note (branch & version):** earlier entries below (Phase 0.8/0.9) reference `feat/identity-multitenancy` and `v0.7.0-foundation`. Those are **superseded**: the canonical branch prefix is `feature/` (so the next branch is **`feature/identity-multitenancy`**), and the first foundation tag is **`v0.1.0-foundation`** (repo `0.1.0`; the Design System stays independently at `1.0.0`). See ADR-0006's 2026-08-01 amendment + `DECISION_LOG.md`. Historical entries are preserved verbatim.

### Objectives
Resolve the remaining foundation-review items before Phase-1 implementation. **Documentation/governance + repo-hygiene only — no product feature/code/migration/table/UI; no `.pen` edit; no direct push to `main`; no premature tag.**

### Repository state verified
- `origin/main` @ `68bb0a5` = merged PR #1 (docs finalization through Phase 0.9); local `main` fast-forwarded to match; created `chore/foundation-closeout` from `main`. Working tree clean at start.

### Documents added
- `backend/.dockerignore` — shrinks the Docker build context (excludes `.venv`/caches/`.env`/tests/`.git`); image rebuild verified.
- `.github/CODEOWNERS` — default `* @hmohamed080` + per-area map; enforcement depends on branch-protection.
- `.github/workflows/ci.yml` — minimum PR-validation CI (`frontend`, `backend`, `docs` jobs; official actions + corepack/pipx only).
- `scripts/check_doc_links.py` — repo-owned internal-markdown-link checker (used by CI + humans).

### Files updated
- **Ignore hygiene:** `.gitignore` (added `.cache/`, `.eslintcache`, `/tmp/exports/`). Audit found **0** tracked dependency/build/secret/`.pen` files — nothing needed untracking.
- **Branch naming:** reconciled to canonical prefixes `feature/bugfix/hotfix/chore/docs/release` (dropped `feat/` as a branch prefix; it stays a commit-message type) in `git-workflow.md`, `ADR-0006` (transparent amendment), `DECISION_LOG.md`, `02_coding_standards.md`, `07_feature_workflow.md`, `ROADMAP.md` (7 branch names), `RUNTIME_STATE.md`.
- **Versioning:** foundation release clarified to `v0.1.0-foundation` (repo `0.1.0`, pre-MVP; phase numbers ≠ release versions; Design System independently `1.0.0`; tag created only on merged `main` after this PR) in `release-strategy.md`, `git-workflow.md`, `github-workflow.md`, `ADR-0006`, `README.md`, `RUNTIME_STATE.md`.
- **Trackers:** `TECHNICAL_DEBT.md` (`.dockerignore` + `CODEOWNERS` marked resolved; minimum CI added, Docker/Supabase CI + SHA-pinning deferred); `DOCUMENTATION_STATUS.md` (Development/Operations rows).
- **Runtime state:** Current Phase = *Phase 0 — Foundation Closeout*; Current Branch = `chore/foundation-closeout`; Next Phase = *Phase 1*; Recommended Next Branch = `feature/identity-multitenancy`; Implementation Status = *Not started*; Foundation Release = *pending tag v0.1.0-foundation after merge*.

### Validation
- Frontend: `install --frozen-lockfile` / `typecheck` / `lint` / `test` (3) / `build` — **GREEN**.
- Backend: `uv sync --frozen --python 3.12` / `ruff` / `pytest` (3) — **GREEN**.
- Docker: `docker build --no-cache ./backend` (with `.dockerignore`) — **succeeds**.
- Repo: `git diff --check` clean; **0** tracked deps/build/secret/`.pen`; internal doc links **755/0-broken**; `ci.yml` valid YAML; CODEOWNERS paths reviewed. Canonical `design.pen` untouched (gitignored).

### Known remaining work
Select `frontend`/`backend`/`docs` as required checks in `main` branch protection after CI's first run; add CD + Docker/Supabase CI jobs + SHA-pin actions (deferred, `TECHNICAL_DEBT.md`); create tag `v0.1.0-foundation` on merged `main`; apply GitHub labels/milestones/board; resolve `⚑ OPEN` product decisions.

### Next recommended phase
**Phase 1 — Identity & Multi-tenancy** on **`feature/identity-multitenancy`** (cut from `main` after the closeout PR merges).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction/UI change; **no `.pen` edit**; no direct push/force-push to `main`; **no tag created** (documented only); no GitHub settings changed.

---

## Session — Phase 0.9: Repository Governance & Planning
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (continued; no new branch)

### Objectives
Extend repository governance to production-grade and implementation-ready: add the missing governance/planning documents and connect them to the existing hierarchy, without duplicating or rewriting existing docs. **Documentation only — no product feature, code, migration, API, table, UI, architecture, product-direction, or `.pen` change.**

### Documents added
- [`decisions/ADR-0006-repository-governance.md`](../decisions/ADR-0006-repository-governance.md) — branch strategy/naming, protected branches, merge strategy, PR policy, SemVer, release workflow, GitHub flow, commit conventions, code & documentation ownership (cross-references the development docs).
- [`roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) — Phase 0 → 5 + future, each with objective/deliverables/dependencies/success-criteria/estimate; mapped to the Sales-first design roadmap and reconciled with MVP scope (no "marketplace/commerce" contradiction).
- [`product/BACKLOG.md`](../product/BACKLOG.md) — MoSCoW backlog (priority/phase/dependencies/status/owner/notes) sourced from MVP scope.
- [`technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) — deferred features, known compromises, performance/security/infra improvements, future refactoring, and consolidated `⚑ OPEN` decisions.
- [`DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md) — coverage by area (%/status/owner/last-updated/missing).
- [`decisions/DECISION_LOG.md`](../decisions/DECISION_LOG.md) — one-screen index of ADR-0001…0006 (title/status/date/summary/current-state).

### Files updated
- [`README.md`](../README.md) (docs index) — new **Planning & governance** section; ADR-0006 + DECISION_LOG added to Decisions; BACKLOG in Product; TECHNICAL_DEBT in Technical. No orphan documents.
- [`RUNTIME_STATE.md`](RUNTIME_STATE.md) — Current/Next Phase, Current/Recommended-Next Branch, Repository Status, Documentation Status, Implementation Status; live-state Epic + Documentation Version updated to Phase 0.9.
- This log.

### Validation
- Internal markdown links re-checked (see final report); no duplicated documentation (new docs cross-reference existing ones); no conflicts with ADRs, Product Direction, or MVP Scope (roadmap/backlog explicitly reconciled and preserve the "never build" list and Sales-first order); metadata blocks consistent; work log chronological (newest first).

### Known remaining work
`⚑ OPEN` product decisions (subscription tiers, verification doc sets, email/OCR/PDF providers, retention windows, product attribute schemas, media/OTP caps) — tracked in [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) §7; `CODEOWNERS` + CI branch-protection recommended (ADR-0006); tag `v0.7.0-foundation`; apply GitHub labels/milestones/board.

### Next recommended phase
**Phase 1 — Identity & Multi-tenancy** on `feat/identity-multitenancy` (cut from `main` after this branch merges).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction/UI change; no `.pen` edit; no GitHub resources auto-created (documented only); no history rewrite; existing documentation not rewritten (only extended/indexed).

---

## Session — Architecture-Review Resolution + Phase 0.8 Engineering Setup
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (continued; no new branch)

### Objective
Resolve the architecture-review comments on the documentation-finalization work, then create the Phase 0.8 engineering standards. **Documentation only — no feature implementation, no code/migration/API/table, no `.pen` edit, no GitHub resources auto-created.**

### Part 1 — Review comments resolved
- **Runtime State:** added a *Live engineering state* block — Current Sprint, Epic, Feature, UI Status, Backend Status, Database Status, Design System Version, Documentation Version, Deployment Status.
- **Repository standards:** [`docs/development/git-workflow.md`](../development/git-workflow.md) (branch/commit/merge/release/tagging conventions).
- **GitHub standards:** `.github/PULL_REQUEST_TEMPLATE.md` + `.github/ISSUE_TEMPLATE/{bug_report,feature_request,task}.md`.
- **Project management:** [`docs/development/github-workflow.md`](../development/github-workflow.md) — recommended labels, milestones, and project board (**documented, not created**).
- **Release strategy:** [`docs/development/release-strategy.md`](../development/release-strategy.md) — process + the `v0.7.0-foundation` first release (purpose/scope/contents/criteria; tag command documented, not executed).
- **Docs synchronized:** RUNTIME_STATE, this log, the documentation index, and the Architecture Guide (pointer to engineering standards). Previous history preserved.

### Part 2 — Phase 0.8 engineering standards
- Added [`docs/engineering/`](../engineering/README.md): a README index (topic→doc map for all 25 brief items) + 12 grouped standards docs: project structure & layers & DI · coding & naming · API + shared response/error models · error/logging/observability · validation + shared rules · testing · feature workflow (checklist + Definition of Done) · migration workflow · PR + code-review checklist · environment + CI/CD · performance + security · AI-agent rules.
- Standards **reuse and cross-reference** existing docs (ADRs, technical spec, scoped `AGENTS.md`, design GOVERNANCE, security/ops docs) — no duplication; every rule links its authoritative source.

### Validation
- All 25 brief topics covered (mapped in the engineering README). Internal markdown links re-checked (see final report); no duplicated or contradictory standards introduced; documentation hierarchy: `docs/development` (process), `docs/engineering` (how to build), `docs/technical` (what to build), `docs/decisions` (why).

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction change; no `.pen` edit; no GitHub labels/milestones/board/releases auto-created (documented only); no history rewrite.

---

## Session — Documentation & Repository Finalization
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `docs/technical-finalization` (created from `chore/repository-architecture-foundation` @ `7499ab1`; architecture branch left untouched)

### Objective
Finalize documentation before implementation and make this the canonical Git repository. **Documentation & repository finalization only — no feature implementation, no code/migration/API/table, no `.pen` edit.**

### Repository
- Created isolated branch `docs/technical-finalization` from the architecture branch; the previous branch is untouched.
- Added remote `origin` = `https://github.com/hmohamed080/aladdin.git`; verified.
- Pushed `main`, `chore/repository-architecture-foundation`, and `docs/technical-finalization` preserving full history — **no squash, no force, no history rewrite**. (See final report for the exact push result / any auth step required.)

### Documentation improvements
- Defined and applied a standard metadata block (**Status · Version · Owner · Last Updated · Depends On · Related**): full block on all 15 `docs/technical/*` docs; added `Version`/`Owner` to the three canonical guides (`PRODUCT_DIRECTION_GUIDE`, `ARCHITECTURE_GUIDE`, `UI_UX_SYSTEM_GUIDE`); documented the per-family convention (memory / technical / design / ADR) in the index.
- Improved [`docs/README.md`](../README.md) into the master, discoverable index with a **Documentation standard** section and the cross-family **sync rule**.

### Runtime state
- Added the required fields to `RUNTIME_STATE.md`: **Current Phase, Current Branch, Current Milestone, Current Remote Repository, Last Stable Commit, Last Stable Tag, Next Planned Phase, Next Planned Branch**.

### Validation
- Internal markdown links re-checked (see final report); working tree clean before/after commits; branch isolation and remote configuration verified.

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture/product-direction change (metadata-only additions to the guides); no `.pen` edit; no squash/force/history rewrite.

---

## Session — Phase 0.7: MVP Technical Specification & System Blueprint
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Produce the complete engineering blueprint for the MVP under `docs/technical/` — detailed enough for a senior engineer to build the MVP without further questions. **Specification only: no product feature, code, migration, API, table, UI, or architecture change; no `.pen` edit.**

### Deliverables (15 files under `docs/technical/`)
`README.md` (index + authority) · `01_system_overview` · `02_domain_model` · `03_database_design` · `04_relationships` (ERD) · `05_storage_design` · `06_rls_strategy` · `07_permissions_matrix` · `08_api_contracts` · `09_background_jobs` · `10_events` · `11_state_machines` · `12_validation_rules` · `13_integrations` · `14_future_extensions`. Linked from `docs/README.md`.

### Key reconciliations (authority hierarchy applied)
- **Integrations:** documented the **approved stack only** (Supabase Storage, OpenAI, Azure Document Intelligence [OCR candidate], WhatsApp Business API, Email provider [⚑ OPEN], Sentry, Excel/PDF libraries). The task's examples **Cloudinary / Firebase-push / Google Maps-Places / payments** are **not approved** → substitutes documented (Supabase Storage; Realtime+email+WhatsApp; internal localities + PostGIS; deferred) and flagged.
- **Roles:** used the canonical account-type + capability + platform-role model (no profile switcher); mapped the task's generic role names (Guest/Company/Exhibition/Support/Moderator/Super Admin) onto it.
- **Undecided items** (pricing/tiers, OCR provider finalization, email provider, retention windows, verification doc sets, product attribute schemas, media/OTP caps) recorded as `⚑ OPEN` inline, not invented.

### Validation
- 123 internal markdown links across `docs/technical/` checked, **0 broken**. Working tree otherwise clean before commit.

### Out of scope (confirmed not done)
No product feature/screen/table/API/migration; no architecture or UI change; no `.pen` edit. Specification documents only.

---

## Session — Final Network-Dependent Foundation Gate (Docker + Supabase)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Run the network-dependent pre-merge gate that prior sessions had to defer: Docker image build/inspection/run and the Supabase local stack (start / db reset ×2 / db lint / extension inspection). **No product feature, no product table, no `.pen` edit, no merge/push.**

### Baseline (re-run, GREEN)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen --python 3.12` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ (1 benign `StarletteDeprecationWarning`).

### Docker validation — PASSED
- `docker version` server **29.6.2**. Pulls: `python:3.12-slim` ✅ (Docker Hub); `ghcr.io/astral-sh/uv:latest` ✅ (after retries — intermittent `ghcr.io` TLS-handshake timeouts).
- `docker build --no-cache -t aladdin-backend-foundation ./backend` ✅ (multi-stage; `uv sync --frozen --no-dev` resolved 53 packages from PyPI).
- Inspect: runtime **Python 3.12.13**; user **appuser (uid 10001)** — non-root; **HEALTHCHECK** configured; `Cmd=uvicorn app.main:app`.
- No `.env`/`.pen`/PDF/customer-data/`.git`/app-logs in image (only base-image `apt/dpkg` logs). **No Alembic, no SQLAlchemy** (`find_spec` False; no site-packages).
- `docker run` + `curl --fail /health` → **HTTP 200 `{"status":"ok","service":"backend","env":"local"}`**; running process **uid 10001**; container **health=healthy**. Test container stopped and removed.
- Hygiene note (not a defect): no `.dockerignore` → the whole `backend/` context (incl. `.venv/`) is sent to the daemon, and 3 local `app/**/__pycache__` dirs are copied in. Selective `COPY` keeps the image itself clean.

### Supabase local stack — PASSED
- `supabase --version` 2.110.0. `supabase start` ✅ (exit 0) after several retries — Docker Hub and `public.ecr.aws` reachable; `ghcr.io` TLS-handshake timeouts repeatedly slowed the multi-image pull (Docker Desktop also flapped once and recovered). Migration `20260729000000_extensions.sql` applied; `seed.sql` applied.
- Services healthy: **db, kong (API), auth, storage, realtime, studio** (+ rest, analytics, inbucket, pg_meta, edge_runtime). `imgproxy` + `pooler` intentionally disabled in `config.toml`. `vector` (log router) flaps on restart — benign, unrelated to Postgres/schema.
- **First `db reset`** ✅ (exit 0). **First `db lint`** ✅ (exit 0) — all findings are inside bundled `extensions.*` PostGIS/pgcrypto functions; **zero** in our migration or `public`.
- Extensions (name | schema | version): **pgcrypto | extensions | 1.3**, **pg_trgm | extensions | 1.6**, **vector | extensions | 0.8.2**, **postgis | extensions | 3.3.7**. `extensions` schema present. **0 product tables in `public`.** Migration recorded: `20260729000000`.
- **Second `db reset`** ✅ (repeatable, no manual intervention) — identical extensions/versions, still 0 public tables, no drift, seed repeatable. **Second `db lint`** ✅ — 16 finding-groups, all in `extensions`, none in our code.
- Cleanup: `supabase stop` ✅.

### `.pen` integrity
- **This session modified no `.pen` file.** All 16 backup snapshots are byte-identical before/after. The canonical `UI-UX/design.pen` **changed on disk during this window** (`ca54598…d581c` → `f1756cd…b7402`, mtime 14:51) because a **concurrent design agent ("Pi")** flushed its "missing-variant completion" Pencil edits and wrote one new gitignored backup. `.pen` files are **gitignored**, so this is outside the git tree and does not affect the commit or merge — and it was not caused by this task.

### Result
**Full architecture and infrastructure foundation validation complete.** No product feature/table/screen; no `.pen` modified; no live cloud/production service used; Docker + Supabase ran locally only.

---

## Session — Design System Finalization & Hardening (v1.0.0)
**Date/time:** 2026-08-01
**Agent/tool:** Claude Code (Opus 4.8) with Impeccable
**Branch:** `chore/repository-architecture-foundation`

### Objective
Finalize and harden the Aladdin Design System before any product-feature work: audit, source-of-truth reconciliation, machine-readable token architecture, component governance, and implementation validation. **No product feature, no new screen, no journey redesign, no `.pen` edit.**

### Pre-edit audit — key findings
- **Defect (theme):** `frontend/src/styles/tokens.css` `.dark { --primary: var(--lime) }` referenced an **undefined** variable (primitive is `--on-dark`) — dark-theme primary action color broken at runtime; production build did not catch it.
- **Missing:** no canonical machine-readable tokens; no design-system versioning/changelog; no component inventory; no icon policy; no motion-duration/z-index tokens; no canonical named breakpoints; no `prefers-reduced-motion`.
- **Source-of-truth ambiguity:** color hex duplicated across `DESIGN.md` frontmatter, `tokens.css`, and the *gitignored* `.impeccable/design.json` with no documented canonical source or edit-order.
- **Accessibility:** measured 22 semantic pairs — one sub-AA pairing (`fg-muted` on Sand = 4.27:1); all others pass.
- **Breakpoint conflict:** UI guide (1440/768/390) vs sidecar (1080/1360) — reconciled to the guide.

### Changes
- **Fixed** the dark-theme `--primary` (`--lime` → `--on-dark`).
- **Added canonical machine tokens** `design/tokens/{colors,typography,spacing,radii,shadows,motion,breakpoints,z-index}.json` + README (manually maintained; documented sync edit-order).
- **Added** `design/GOVERNANCE.md` (source-of-truth hierarchy, semantic versioning, synchronization, new-component governance, component-state matrix, motion, measured-AA accessibility, responsive, RTL, light/dark, enforceable AI-agent rules), `design/COMPONENT_INVENTORY.md` (28 families, all `Proposed`/`Draft`), `design/icons/README.md` (Lucide default; custom-icon process), `design/CHANGELOG.md`, `design/README.md`.
- **DESIGN.md:** added versioning metadata, source-of-truth hierarchy, compatibility notes, honest font-license/PDF-strategy record, measured-contrast + Muted-On-Sand rule.
- **Frontend:** added motion (duration/easing) + z-index tokens to `tokens.css`; canonical `tablet/desktop/wide` screens, `transitionDuration`, `zIndex`, and CSS-var easings to `tailwind.config.ts`; `prefers-reduced-motion` to `globals.css`.
- **Memory reconciled:** `UI_UX_SYSTEM_GUIDE.md`, `ARCHITECTURE_GUIDE.md`, root/`frontend`/`UI-UX` `AGENTS.md`, `docs/README.md`, `RUNTIME_STATE.md`. **`PRODUCT_DIRECTION_GUIDE.md` untouched** (no product-direction change).

### Validation (commands + results)
- Frontend: `typecheck` ✅ · `lint` ✅ · `test` **3 passed** ✅ · `build` (Next 15.5.22) ✅ (`/`, `/_not-found`, `/api/health`).
- Tokens: all 9 JSON files parse ✅; 33/33 color primitive names unique ✅; **no dangling `var(--x)`** references in `tokens.css` ✅.
- Docs: **192 internal relative links, 0 broken** ✅; no duplicate H1/H2 headings in new design docs ✅.
- **`.pen` unchanged:** `UI-UX/design.pen` sha256 `ca54598…d581c` identical before/after ✅.

### Unverified / open items
- Formal OFL license-file audit of the four self-hosted fonts (marked pending, not claimed verified).
- PDF/Arabic document-font strategy (FastAPI quote/RFQ PDFs) — recorded as an open item.
- Component-level a11y (keyboard, focus-trap, SR labels, tab order, touch targets) — cannot be verified before components exist; gated in the inventory `Ready` criteria.
- Lucide icon library decided but **not installed** (deferred to first real need).

### Out of scope (confirmed not done)
No product feature, no product screen, no journey redesign, no `.pen` edit, no unapproved brand asset created, no auth/Sales/Catalog/RFQ/Projects/Admin/AI flow started.

---

## Session — Approved Aperture Brand Token Extraction
**Date/time:** 2026-08-01
**Agent/tool:** Codex with Impeccable (`extract` playbook)
**Branch:** `chore/repository-architecture-foundation`

### Objective
Turn the founder-approved Brand Toolkit v1 plate into a durable root design record and a production-ready frontend token foundation, while keeping the canonical UI/product memory consistent and without starting product workflows.

### Changes
- Added root `DESIGN.md` as the approved token/rule record for **The Aperture** identity: exact palette, bilingual typography, spacing, radii, component defaults, elevation, mark rules, and do/don't constraints.
- Added `frontend/src/styles/tokens.css` with fixed brand primitives and light/dark semantic aliases; components can consume semantic values without hardcoding hex.
- Mapped the complete approved foundation into `frontend/tailwind.config.ts`: semantic and brand colors, bilingual font families, typography roles, spacing, radii, shadows, and easing.
- Loaded Archivo, Reem Kufi, Readex Pro, and JetBrains Mono through `next/font/google` in the root layout; established Readex Pro and semantic canvas/foreground/focus defaults globally.
- Added accessible light-theme semantic tones from the approved tonal ramps. Brand primitives remain unchanged; normal-size text/focus/status tokens now clear WCAG AA rather than incorrectly treating every display primitive as text-safe.
- Reconciled `PRODUCT.md` and `UI_UX_SYSTEM_GUIDE.md`: removed the obsolete “brand not approved” state and documented the authority chain (`UI_UX_SYSTEM_GUIDE.md` policy → `DESIGN.md` approved token/rule record → `design.pen` visual source → frontend token mirror).
- Kept `.impeccable/design.json` as the existing ignored local tooling sidecar and synchronized its accessible semantic metadata; the committed durable record is `DESIGN.md`.

### Validation
- Impeccable detector on all changed frontend targets: `[]` (0 findings).
- Contrast calculation for semantic normal-size text: minimum light-theme ratio **4.76:1**; dark-theme semantic text/status ratios remain **≥5.40:1**. Primary action contrast is **15.64:1**.
- Frontend TypeScript: `tsc --noEmit` ✅.
- Frontend lint: `eslint .` ✅.
- Frontend tests: Vitest **3 passed** ✅.
- Frontend production build: Next.js **15.5.22** build ✅; `/`, `/_not-found`, and `/api/health` generated successfully.
- Repository checks: `git diff --check` ✅; **154** internal Markdown links checked, **0 broken** ✅.

### Environment note
The Codex pnpm wrapper repeatedly attempted a non-interactive dependency reinstall after its bundled runtime changed. A single approved `pnpm install --frozen-lockfile --ignore-scripts --child-concurrency=1` restored the locked workspace from cache (402 packages reused, 0 downloaded); validation then ran through the same local package binaries. No dependency or lockfile changed.

### Unfinished / intentionally out of scope
- Theme-selection UI/persistence is not wired yet; the token contract and `.dark` override are ready for it.
- Runtime logo/app-icon exports and reusable Aperture React components have not been created yet.
- No auth, database table, RLS policy, or B2B/B2C/Admin workflow was implemented. This session is frontend design-system foundation, not product-feature implementation.

---

## Session — Approved Missing Variant Completion Pass
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Complete faithfully derivable missing device/theme variants in the live `design.pen` using copied canonical screens and locked reusable components only; replace ambiguous missing placeholders with validated screens or precise decision blockers.

### Completed
- Added 87 product-screen variants, increasing the live product-screen count from 120 to 207.
- Completed Sign In Tablet Dark and the OTP main flow across Desktop Light/Dark, Tablet Light/Dark, and Mobile Dark.
- Completed Mobile Dark registration, Desktop Dark Basic Profile, Mobile Light Consent, Mobile Dark Basic Profile, Desktop/Mobile Dark Account Type, Mobile Dark Consumer Onboarding, Desktop/Mobile Dark Professional Onboarding, Mobile Dark Business Onboarding, Mobile Dark Verification, and faithful Dark mirrors of existing Subscription screens.
- Added workspace-only traceability notes recording source, reused hierarchy/components, target, content changes, and unresolved items.
- Replaced every generic `MISSING —` placeholder: current count is 0. Forty-eight remaining gaps are explicitly labelled Partial, Blocked, Responsive Decision, Unresolved Product Requirement, or Not Required.
- Updated `00I — Current Design Status Report` with actual per-device/theme completion, partial, blocked, needs-review, and not-required status.

### Validation
- 207 product screens; 8 top-level groups; 0 top-level overlaps; 0 organizational sibling overlaps.
- Representative new screens visually compared with their sources after each family pass.
- Existing source screens and component masters were not modified.
- Newly copied screens retain canonical dimensions, token bindings, RTL behavior, hierarchy, and component instances.
- Known layout warnings reproduced from locked source screens are documented as inherited and were not repaired inside product UI.

### Backup
`UI-UX/design.BACKUP-BEFORE-MISSING-VARIANT-COMPLETION-20260801-143042.pen`

### Remaining decisions
- Consumer Experience and Business Operations require approved workflow behavior before screen production.
- Admin Tablet/Mobile needs an approved responsive shell; Admin Light is not required in current scope.
- Tablet onboarding/profile variants require responsive composition approval despite the general responsive specification.
- Several Desktop onboarding sequences remain partial; Subscription pricing/payment and omitted product-step scope remain unresolved.

---

## Session — Permanent Device/Theme Canvas Governance
**Date/time:** 2026-08-01
**Agent/tool:** Pi design/coding agent
**Branch:** `chore/repository-architecture-foundation`

### Objective
Reorganize the live private `UI-UX/design.pen` workspace into a permanent Product Surface → Flow → Device → Theme → Sequence hierarchy without changing any existing product-screen internals, document missing coverage explicitly, add a device/theme status matrix, and make the rule durable in project policy.

### Changes
- Reparented 120 existing product-screen frames intact into eight top-level areas: Authentication, Consumer, Professional/Talent, B2B/Business, Admin, Shared/System, Foundation/Components/Documentation, and Archive.
- Added explicit Desktop → Tablet → Mobile and Light → Dark lanes, with separate Main Flow, Supporting States, Error States, Responsive Test Variants, and Specifications/Annotations lanes.
- Kept 360px/430px responsive tests separate from canonical Mobile 390px.
- Added 56 workspace-only missing-coverage placeholders; no missing UI was fabricated.
- Added `00I — Current Design Status Report` with per-flow Desktop Light/Desktop Dark/Tablet Light/Tablet Dark/Mobile Light/Mobile Dark status.
- Added the permanent policy to root `PRODUCT.md` and mirrored the operational UI rule into `UI-UX/UI_UX_SYSTEM_GUIDE.md`.

### Validation
- Live tree: 8 top-level groups, 120 product-screen frames, 56 missing-coverage placeholders.
- Variant ancestry audit: 0 device/theme/responsive-lane mismatches.
- Canvas audit: 0 top-level overlaps and 0 organizational sibling overlaps.
- Product screen internals, dimensions, names, content, components, and styling were not edited; only complete frames were repositioned/reparented.
- Existing inherited product-screen layout warnings remain intentionally untouched because those screens are locked.

### Backup
`UI-UX/design.BACKUP-BEFORE-PERMANENT-VARIANT-ORGANIZATION-20260801-104124.pen`

### Unfinished / blocked
None for workspace organization. Missing variants remain explicit placeholders and require separately approved screen-design tasks.

---

## Session — Foundation Review, Hardening & Pre-Merge Validation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Independently verify the architecture foundation is correct, clean, executable, internally consistent, and merge-ready — review generated docs, run full local validation (frontend/backend/Supabase), security + repo-quality review, and confirm the canonical memory system. **No product feature.**

### Starting state
HEAD `18dc7f5`, 14 commits ahead of `main`, working tree carried one pre-existing generated diff (`frontend/next-env.d.ts`).

### Findings & fixes
- **3 stale SQLAlchemy references (genuine defect):** `docs/database/migration-strategy.md`, `docs/database/naming-conventions.md`, `docs/guides/backend-setup.md` still described SQLAlchemy as the current data-access mechanism — contradicting ADR-0005. **Fixed** to `supabase-py` + PostgreSQL RPC (RLS/JWT preserved).
- **gitignore gap:** no generic `logs/`, `*.log`, `*.transcript`. **Added.**
- **Generated file drift:** committed the Next-regenerated `next-env.d.ts` (typed-routes reference) so the tree is clean.
- **CI readiness:** added a documented recommended CI command sequence to `README.md`.
- **No other defects:** no duplicate headings/paragraphs, no truncation/garble, no broken links (152 checked, 0 broken), no competing lockfiles, empty files are only legitimate `__init__.py`/`.gitkeep`.

### Stale-term classification (section 11)
- `active profile` / `Use As` / `Profile Switcher`: all remaining hits are **valid current rules** (the "no profile switcher" rule) or **intentional historical** (verbatim founder brief `design-idea.md`, covered by a supersession note). No stale conflicts.
- `SQLAlchemy` / `Alembic`: after the 3 fixes, remaining hits are **ADR/deferred/historical** (ADR-0005 defining the decision, "deferred" statements, append-only log, the non-authoritative `agents/commands/db-migrate.md` marked superseded). No stale current-tense claims.
- `WCAG 2.1`: only **supersession/log records** ("2.1 → 2.2"); active target is **WCAG 2.2 AA**.
- `product-direction.md` / `agent-work-log.md`: only in **historical log + change-history** entries (the `git mv` records). Valid.

### Tests & validation (commands + results)
- Frontend: `pnpm install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ · `test` 3 passed ✅ · `build` ✅ (production build; `/`, `/_not-found`, `/api/health`).
- Backend: `uv sync --frozen` ✅ · `ruff check .` ✅ · `pytest` 3 passed ✅ · fail-fast (staging+missing secrets → `ValidationError`) ✅ · `/health` → `200 {"status":"ok","service":"backend","env":"local"}` ✅.
- Backend **Docker build BLOCKED** — `ghcr.io` TLS handshake timeout / `tls: bad record MAC` (reproduced 3× incl. `docker pull`). Dockerfile statically correct (non-root uid 10001, healthcheck, minimal COPY).
- Supabase: `--version` 2.110.0 ✅ · `config.toml` valid TOML ✅ · **full stack BLOCKED** — required images (Postgres 17 etc.) uncached and unpullable in this environment. Partial state cleaned via `supabase stop`.
- Extensions migration reviewed ✅ (pgcrypto/pg_trgm/vector/postgis into `extensions` schema); seed empty; **no `CREATE TABLE` anywhere** ✅.
- Security: no `.env`/secrets tracked ✅ · `.env.example` placeholders only ✅ · no service-role in `frontend/src` ✅ · browser client uses anon key only ✅ · `.pen` untracked + hashes unchanged ✅ · tracked-file secret scan clean ✅.

### Commits
- `7d3c280` docs: correct three stale SQLAlchemy data-access references to supabase-py
- `f6ad9d6` chore: harden ignore rules for logs/transcripts; sync generated next-env.d.ts
- `adbea03` docs: add recommended CI command sequence to README
- (this entry) docs: refresh runtime state and record foundation-review session

### Unfinished / blocked
- **Environment-only:** backend Docker image build and Supabase local stack (`start`/`db reset`/`db lint`) not executable here (registry unreachable). Run in CI / stable network. No code change required.
- Git remote + push — none configured (branch stays local; not pushed).
- CI/CD pipeline — commands documented; not wired.
- First product migration + RLS + isolation tests — the next authorized step (not started).

### Blockers
Container registry unreachable in this sandbox (`ghcr.io` TLS timeout; `public.ecr.aws` Supabase images uncached). Not a foundation defect.

### Rollback notes
All on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` untouched. Revert a slice with `git revert <sha>`. No `.pen` modified; no live DB touched.

### Next recommended action
Foundation is verified merge-ready (with the two registry-dependent checks to be run in CI). Await explicit direction to merge or to begin the implementation roadmap (identity & multi-tenancy → orgs/memberships/branches → RLS + isolation tests → 05C Sales).

---

## Session — Core Project-Memory Consolidation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish four canonical persistent project-memory files + a live runtime-state file, reconcile all documentation/ADRs with them, defer the unused SQLAlchemy dependency, and add session-hygiene rules — **without** implementing any product feature, editing any `.pen` file, merging, or pushing.

### Starting state
10 commits ahead of `main`, working tree clean, HEAD `6f63867`. Existing memory docs: `product-direction.md`, `agent-work-log.md`. Contradictions present: profile-switching model in 6 files; WCAG 2.1; hardcoded component count; SQLAlchemy listed as a dependency but unused.

### Files moved (history preserved via `git mv`)
- `docs/product/product-direction.md` → `docs/product/PRODUCT_DIRECTION_GUIDE.md`
- `docs/operations/agent-work-log.md` → `docs/operations/AGENT_WORK_LOG.md`

### Files created
- `docs/architecture/ARCHITECTURE_GUIDE.md` (core memory — current-state architecture)
- `UI-UX/UI_UX_SYSTEM_GUIDE.md` (core memory — design system moved out of `UI-UX/AGENTS.md`)
- `docs/operations/RUNTIME_STATE.md` (core memory — mutable live snapshot)
- `docs/README.md` (documentation index)
- `docs/decisions/ADR-0005-python-data-access.md`

### Files modified
- Rewritten: `docs/product/PRODUCT_DIRECTION_GUIDE.md` (metadata, dual roadmap, decision process, change history, account-model correction); `UI-UX/AGENTS.md` (slimmed to operational).
- Reconciled: root `AGENTS.md` (reading order + persistent-memory policy + dependency policy), `CLAUDE.md`, `README.md`, `docs/AGENTS.md` (layout + end-of-session checklist), `docs/architecture/system-context.md`, `docs/product/mvp-scope.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/decisions/ADR-0002` (cross-ref) and `ADR-0003` (reading order).
- Backend (SQLAlchemy defer): `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/database/__init__.py`, `backend/.env.example`.

### Decisions made
- **Account/navigation model corrected** from "active-profile switching" to canonical **one current primary account type / no Profile Switcher / derived navigation** across all product, architecture, and UI docs. This is a wording/consistency correction of the identity model, **not** a product-strategy change.
- **ADR-0005:** Python data access uses **`supabase-py`**; **SQLAlchemy deferred** (was an unused scaffold dependency), **Alembic** stays excluded, complex ops via **PostgreSQL RPC**, user-facing ops preserve the caller JWT so **RLS applies**, service-role limited to trusted workers.
- **Accessibility target** raised WCAG 2.1 AA → **WCAG 2.2 AA**; removed the hardcoded "~127 components" count (design.pen is the source of truth).
- **Reading order** now mandates the four core-memory files + `RUNTIME_STATE.md` before scoped AGENTS/ADRs.

### Tests & validation
- `uv sync --python 3.12` → `sqlalchemy` removed, `supabase` 2.31.0 added, `uv.lock` regenerated. ✅
- `uv run ruff check .` → All checks passed. ✅
- `uv run pytest` → 3 passed, 1 benign warning. ✅
- Residual `sqlalchemy` in source: only the intentional "deferred" note in `app/database/__init__.py`. ✅
- Documentation-link validation and `.pen` hash re-check: run at session end (see final report). 
- Frontend suite **not** re-run — no frontend source changed (Markdown docs only).

### Commits
- `cf1e0cc` docs: establish canonical project-memory files
- `d4a52dc` docs: reconcile product, architecture, and UI guidance with core memory
- `da6c69a` refactor: defer unused SQLAlchemy; adopt supabase-py for Python data access
- (this entry) docs: add runtime state and session hygiene

### Unfinished work
- Supabase local stack + `db reset` + RLS/organization-isolation tests (needs Docker) — still pending.
- Git remote + push — none configured (branch is local-only; not pushed per task).
- CI/CD pipeline — deferred.
- design.pen → Tailwind token bridge — deferred to first UI feature.

### Blockers
None for documentation/memory work. Docker required for the full Supabase RLS test pass.

### Known warnings (benign)
Frontend pnpm peer-dep warning (`unrs-resolver`/`@emnapi`); backend `StarletteDeprecationWarning` under pytest. No functional impact.

### Rollback notes
All changes are on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is untouched. Revert a slice with `git revert <sha>` (commits are focused: memory files / reconciliation / SQLAlchemy / runtime+hygiene). `git mv` renames are reversible via `git mv` back. No `.pen` file was modified. No live DB/migration was applied.

### Next recommended action
Await explicit authorization to begin the implementation roadmap: **architecture hardening → identity & multi-tenancy → organizations/memberships/branches/permissions → RLS + tenant-isolation tests → 05C B2B Sales**. Do not start product implementation autonomously.

---

## Session — Repository Architecture Foundation
**Date:** 2026-07-29 → 2026-07-30
**Agent:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish the repository architecture foundation only — audit the repo, consolidate agent instructions, build the AGENTS hierarchy + ADRs + docs, and scaffold the approved stack (Next.js + Supabase + specialized FastAPI) — **without** implementing product features, connecting production services, or touching any `.pen` file. Two follow-on requests were completed in the same session: the UI-UX design-system guidelines and the product-direction guide.

### Changes Made
- **Git:** initialized the repo (`git init -b main`), committed the as-found baseline, branched. 10 commits, WHAT/WHY messages. Working tree clean.
- **Ignore/config:** authored `.gitignore` (secrets, `.claude/`, `*.pen`, node/python/supabase artifacts), `.gitattributes` (`*.pen binary`, LF normalization), `.editorconfig`.
- **Agent instructions:** rewrote root `AGENTS.md` (filled empty Stack section, added reading-order + composition rules, migrated the git-discipline rule in); added scoped `AGENTS.md` for `frontend`, `backend`, `supabase`, `docs`, `data`, `UI-UX`; added `agents/README.md` marking `agents/` as non-authoritative source material; recorded the source→destination map in `docs/decisions/agent-instruction-migration.md`.
- **Docs/ADRs:** ADR-0001..0004; architecture (×6), security (×3), database (×2), operations (×2), product (mvp-scope + moved design-idea/client-brief); rewrote the 3 setup guides. Later added `product-direction.md`.
- **Frontend:** Next.js 15 App Router scaffold (strict TS, Tailwind, ESLint flat config, Zod env module, Supabase browser factory, EN/AR i18n constants, `/api/health`, domain-oriented `features/lib/server` structure, one vitest test).
- **Backend:** specialized FastAPI scaffold (`aladdin-backend`) — app factory, Pydantic-Settings config (fail-fast in staging/prod), `/health`, capability-module boundaries, Dockerfile (non-root + healthcheck), health/config tests; removed stale Alembic/Vite-referencing artifacts.
- **Supabase:** kept `config.toml` (`project_id=aladdin`); added extensions migration (pgcrypto/pg_trgm/vector/postgis), `seed.sql`, functions/tests conventions.
- **Cleanup:** rewrote root `README.md`, `data/README.md`, `assets/brand/README.md` (canonical-source vs runtime-export rule); corrected `CLAUDE.md` stack (React+Vite → Next.js).
- **UI-UX:** appended a 24-section Design System & UX guideline to `UI-UX/AGENTS.md` (token-driven; consultation-first, passwordless, RTL, light/dark, anti-patterns).
- **Product:** added `docs/product/product-direction.md` (vision, positioning, philosophy, priority rules, "agents must never" guardrails).

### Files Modified
124 files changed vs baseline (`git diff --stat main..HEAD` → +8439 / −62). By area:
- Root: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `agents/README.md` (+ existing personas/commands retained)
- `frontend/**` (~49 files: configs, `src/app`, `src/lib`, `src/features/*`, `.env.example`)
- `backend/**` (~26 files: `app/*`, `tests/*`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `.env.example`)
- `supabase/**` (migrations, seed, functions, tests, `AGENTS.md`)
- `docs/**` (~26 files: AGENTS, ADRs, architecture, security, database, operations, product, guides) — incl. this file
- `assets/brand/README.md`, `data/**`, `UI-UX/AGENTS.md`
- Moved (history preserved): `docs/architecture.md`→`architecture/overview.md`; `docs/design_idea.txt`→`product/design-idea.md`; `docs/client-brief.md`→`product/client-brief.md`

### Architectural Decisions
- **ADR-0001** Approved architecture: modular monolith — Next.js App Router (no Vite/SPA) + Supabase + specialized FastAPI + workers.
- **ADR-0002** Supabase SQL migrations are the only schema source of truth; no Alembic; no `create_all()` in staging/prod; SQLAlchemy read-side only.
- **ADR-0003** Agent-instruction hierarchy + mandatory reading order.
- **ADR-0004** Deployment: Vercel (web) · Railway (FastAPI/workers, Docker) · Supabase (data) · Sentry.

### Remaining Work
- Stand up the local Supabase Docker stack; run `supabase db reset` + first RLS/organization-isolation tests (pending — needs Docker image pull).
- Add a git **remote** and push (currently local-only).
- Build CI/CD pipeline (deferred).
- Extract `design.pen` design tokens into `frontend/src/styles` + Tailwind theme (token bridge).
- Optional: `docs/README.md` index; persist a `runtime-state.md`.
- **Next feature phase:** 05C — B2B Sales operating workflow (start with the first authenticated tenant table migration + its RLS + isolation tests).

### Risks / Warnings
- **Toolchain:** `uv` installed via pip (at `…/pythoncore-3.14-64/Scripts/uv`; add to PATH). System Python is **3.14**; backend deliberately uses a uv-managed **3.12** (`uv sync --python 3.12`) to avoid missing 3.14 wheels.
- **No remote/push** yet; if this becomes a public repo, verify ignore rules still hold before first push (`.claude/`, `.env*`, `*.pen` are covered).
- **`.pen` files are gitignored** — ensure they are versioned in **private** storage (they are not in git).
- Benign only: pnpm peer-dep warning (`unrs-resolver`/`@emnapi`), pytest `StarletteDeprecationWarning`. No functional bugs.

### Testing Status
- Frontend: `tsc --noEmit` ✅ · `eslint .` ✅ · `vitest run` ✅ (3 passed)
- Backend: `uv run pytest` ✅ (3 passed) · `uv run ruff check .` ✅
- Supabase: `supabase --version` ✅ (2.110.0) · `config.toml` valid TOML ✅ (full `db reset`/RLS tests pending Docker)
- Repo: internal markdown links ✅ (0 broken) · secret scan ✅ (clean) · `.pen` sha256 ✅ (all 5 identical to baseline; none tracked)

### Rollback Notes
- All foundation work is on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is the repo **as-found**.
- Revert everything: `git checkout main` (or delete the branch). Revert a slice: `git revert <sha>` — commits are logically grouped (baseline / AGENTS / docs+ADRs / frontend / supabase / backend / cleanup / UI-UX / product).
- No `.pen` file was modified, so there is nothing to restore there; backups remain on disk.
- Deleting the whole scaffold is safe (nothing external was connected; no migrations were applied to any live DB).

---

## 2026-08-09 — Sprint 10: Orders → Projects → Completion (branch `feature/mvp-orders-projects`)

Completed the B2B execution workflow: **accepted quotation → order → start → project → activate → complete → PROJECT COMPLETED** (no invoice/payment — out of scope). Built on the Sprint 9 commerce spine reusing the ADR-0008 trusted-write-path architecture unchanged.

- **DB** (`20260811090001_orders_projects.sql`): `orders` (immutable commercial snapshot of an accepted quotation, one per quotation), `order_items` (frozen lines, no write path), `projects` (one per order). Enums `order_status` (confirmed→in_progress→completed/cancelled), `project_status` (planned→active→completed). New caps `order.create`/`order.manage` (project.* pre-existed). 6 security-definer RPCs (actor from `auth.uid()`, capability + scope + version + in-txn audit). `order_list`/`project_list` invoker views. Actor model: requester creates order; supplier starts + runs the project; completing the project completes its order.
- **Proof**: pgTAP `24_orders_projects_test.sql` (30 assertions) — full journey, RPC-only boundary, duplicate-order/duplicate-project denied, cross-tenant denial, invalid-quotation→no-order, lifecycle gates, audit. Test 23 updated (accept still creates no order). Full suite **25 files / 579 tests pass**. `supabase db lint`: no Sprint 10 findings.
- **Frontend**: routes `/b2b/orders`, `/b2b/orders/[orderId]`, `/b2b/projects`, `/b2b/projects/[projectId]`; Orders+Projects in nav; `server/{queries,actions}/execution*.ts`, `mapExecutionError`; `features/execution/*` (badges, lists, order detail w/ snapshot table + timeline + inline create-project, project detail w/ activity trail + PROJECT COMPLETED). Accepted-quotation view now has a live **Create order / View order** handoff. Full EN/AR, responsive, no overflow.
- **Validation**: typecheck ✅ · lint ✅ (0 errors) · vitest ✅ (157, +`execution.test.ts`) · build ✅ · pgTAP ✅ · targeted E2E `orders-projects.spec.ts` (pages/nav/bilingual/overflow/not-found).
- Docs: `docs/frontend/sprint-10-orders-projects.md`. PR to `main`, not merged.

---

## 2026-08-15 — Sprint 13: Personal Experience + Sales Affiliation + Type Separation (branch `feature/pilot-personal-sales-readiness`)

Three things: the person/business type separation became structural, a Salesperson gained a way to reach the Sales tools of a business they do not own, and personal `/home` stopped looking like a form under review.

### A — The shared enum is gone, not documented
`public.account_type` typed BOTH `users.primary_account_type` and `organizations.org_type`. Sprint 12 fixed the meaning in comments and RPC guards; a rule that lives only there is a rule a future `update` can violate. Migration `20260815090001` replaces it with two **disjoint** types — `public.persona_type` (a person: consumer, engineer, interior designer, installer/technician, contractor, salesperson, **trainer, trainee** — the legacy training personas are legitimate and preserved) and `public.organization_type` (a business: showroom/dealer, supplier, manufacturer, importer, wholesaler, contractor_company, design_office) — then **drops** `account_type`, which is also the completeness check: `DROP TYPE ... RESTRICT` fails and names anything still referencing it.

`users.primary_account_type = 'supplier'` and `organizations.org_type = 'engineer'` are now **22P02** in every path, including a direct statement by a superuser.

Two things the audit forced:
- **Two organizations legitimately carried a persona spelling as their classification** (a design studio typed `interior_designer`, a contracting company typed `contractor`). They are preserved under business-shaped names — `design_office`, `contractor_company` — inside the `USING` cast, since the new label is not a value of the old enum. An organization holding any *other* persona value stops the migration with an instruction rather than being assigned a guessed type.
- **`onboarding_progress.selected_account_type` held either taxonomy depending on the track** — the debt's last hiding place. Split into `selected_persona` + `selected_org_type`, mutually exclusive and track-consistent by CHECK. The union survives only as a TypeScript read-boundary type, because the registration *choice* genuinely spans both.

**Bug found and fixed en route:** `apply_account_upgrade` tested the persona VALUE for presence and raised *"verification subject has no identity row"*. Since Sprint 12 made the column nullable, a professional's persona is legitimately null until that function applies it — so Admin approval of every individual professional created after Sprint 12 was failing. It now locks and tests the ROW, as `request_account_upgrade` already did.

### B–G — Salesperson affiliation
Migration `20260815090002`. Canonical rule: **a Salesperson's personal account is usable immediately; a showroom's Sales tools need an ACTIVE affiliation with that showroom.** Account status, profile completeness, personal verification, showroom affiliation and showroom verification are five states that move independently and are never merged into one number or badge. Verification is not an activation gate anywhere.

- **Showroom on Aladdin** → `organization_join_requests`. Search returns only the approved public directory columns (min 2 chars, capped, includes `pending_verification` showrooms — hiding unverified ones would push their staff into referring duplicates of businesses already present). An Owner/Manager of *that* organization decides, on the existing People surface, under the existing `org.members.manage` capability. No second permission architecture.
- **Showroom not on Aladdin** → `organization_referrals`. Submitting creates nothing; an Admin reviews it on the existing verifications surface and prefers **linking** to an existing organization (exact case/whitespace-insensitive match auto-links; a trigram shortlist is shown for the human's judgement) over creating a duplicate. Company name stays non-unique — two real showrooms may share one.
- Both approvals converge on `app.membership_grant_sales`, so "approved" means one thing and a returning salesperson reactivates their existing membership row instead of accumulating duplicates.
- **The owner question, answered explicitly:** the model has no invariant requiring an organization to have an owner (`assert_not_last_owner` protects one that exists; nothing demands one exist). So a referred showroom is created with its primary branch and the referrer's **Sales** membership and **no owner membership at all** — a platform-managed business, claimable later. No ownership is faked, and `created_by` is the reviewing Admin rather than the referrer, because that column feeds the creator RLS policy and would read as ownership.
- **Attribution only** (part G): `organizations.source` + `organizations.referred_by_user_id`, write-once by trigger. No wallet, balance, leaderboard or reward calculation — a reward paid on a mutable field is paid to whoever wrote last.

### H–M — Personal home product pass
The UAT findings traced to two concrete facts: the shell capped content at 900px, and the `h1` used `text-title` (1.25rem, 1.4× body). Both were reaches for the wrong end of an existing scale rather than missing tokens.

- Content column 900px → **1120px**; page title `text-title` → **`text-headline`** (2rem); identity + real actions lead; completeness and verification become a compact secondary strip at the end, still separate from each other and never averaged into an "account health" figure.
- **Consumer** leads with the project brief — real data this account owns — and the three prominent "coming soon" cards collapse to one footnote. `Add a business` stays available: a consumer may own a business without becoming a second user.
- **One professional structure** serves all five personas with persona-aware content. The Salesperson variant adds the affiliation panel, which reports a *connection*, never an account state.

### Validation
- frontend typecheck ✅ · lint ✅ (0 errors, 0 warnings) · unit **204/204** ✅ · bilingual parity gate ✅
- `supabase db reset` ✅ from clean with both seeds · pgTAP **729/729** ✅ across 29 files (79 new in `28_persona_sales_affiliation_test.sql`, covering all fourteen required DB acceptances)
- Targeted production Playwright — see the Runtime State snapshot for the measured counts. Repo-wide E2E, Lighthouse and the full persona matrix deliberately **not** run; this is not the final Integration Gate.
- No `.pen` file touched.

### Rollback
Two migrations and three commits on `feature/pilot-personal-sales-readiness`; `main` @ `e7fc5e0` is untouched. Reverting the type-separation migration is **not** a simple `git revert` — it changed column types and dropped an enum, so a down-migration would have to recreate `account_type` and re-cast four columns. The safe rollback is `supabase db reset` to the previous migration set on a local/staging database; nothing has been applied to production.

---

## 2026-08-15 — Sprint 14: Showroom MVP Completeness

**Branch:** `feature/showroom-mvp-completeness` (from `main` @ `678ba32`) · **Migration:** `20260816090001` · No `.pen` change.

**Goal:** make the Showroom/Dealer the strongest, most complete MVP account — audit the implemented
surfaces against the supplied reference images, reorganize the IA, raise UI quality, add the missing
modules.

### Audit first (the required first step)
Full write-up: [`../frontend/sprint-14-showroom-mvp-completeness.md`](../frontend/sprint-14-showroom-mvp-completeness.md).

The reference images arrived as a loose `showroom/` folder at the repo root with no home; there was
no existing reference-asset convention under `UI-UX/`, so they moved unmodified to
**`UI-UX/references/showroom/`**.

Two findings shaped everything after:

1. **The "طلباتي / مشترياتي" confusion was not a labelling bug.** `/b2b/rfqs` and `/b2b/quotations`
   each rendered the buy side and the sell side stacked in one page, so *no* label could be correct
   for both halves. Renaming would have moved the ambiguity, not removed it.
2. **Several reference patterns contradict the approved product direction** and were deliberately
   NOT copied, with the reason recorded rather than left implicit: points/rewards tiers (no such
   model, and Sprint 13 kept referral attribution *without* rewards), add-to-cart on product cards
   (Aladdin is consultation-first, explicitly not a cart marketplace), supplier/technician star
   ratings (no ratings model), paid-membership card (no subscription model), and "add new
   supplier/technician/institution" buttons (these are directories of real registered organizations
   and people — creating one from the buyer side would fork business identity).

### What shipped
- **IA:** eleven flat nav peers → five capability-derived sections (Overview · Buying · Network ·
  Selling · Business); empty sections drop rather than render. Renamed `rfqs`→`purchaseRequests`,
  `quotations`→`offers`, `organization`→`team`. **Route paths unchanged** — the ambiguity was in
  structure and labels, and renaming paths would churn every detail route, back-link and spec for
  no user-visible gain.
- **Perspective separation** on RFQs, Quotations, Orders and Projects: one side leads, the other is
  a tab shown only to an organization that holds that role or has records on that side.
- **Six new modules:** Suppliers, Institutions (one component, two org-type slices), Technicians,
  Saved products, Reports & analytics, Settings. Dashboard rebuilt buyer-first with a
  "What do you want to do today?" ramp; Projects strengthened.
- **One canonical UI set** — `data-table` (semantic table ≥ tablet, stacked cards below, from the
  same column definitions), `stat-tiles` + `TabLinks`, `filter-bar`, `breakdown`. The per-feature
  list components were rewritten onto it rather than kept alongside it.

### Three defects the browser caught that the type system could not
- **Directory ACL destroyed.** Adding `persona` changes the function's return type, forcing
  DROP+CREATE — which drops the ACL. The first version reasserted only the REVOKE, so the
  `security_invoker` view had no executable reader and Suppliers/Technicians/Institutions returned
  **42501 for every caller**, anon and authenticated alike.
- **Mobile lost eleven modules.** Grouping the nav while keeping a five-item bottom bar silently
  made Projects, Team, Reports and Settings unreachable on a phone. Fixed with a **More sheet**
  carrying the same sections as the desktop rail — not by editing the test that caught it.
- **Self-listing dead end.** A business appeared in its own Suppliers directory, where the only
  action leads to "this is your own product".

### Validation
- frontend typecheck ✅ · lint ✅ (0/0) · unit **208/208** ✅ (incl. rewritten `nav/modules.test.ts`) ·
  bilingual parity gate ✅
- `supabase db reset` ✅ from clean, both seeds · pgTAP **729/729** ✅ across 29 files
- Playwright `showroom-mvp` + `orders-projects`: **21 passed / 0 failed / 0 retries**, desktop and
  Pixel 5, English and Arabic
- **Attribution done honestly:** two `sales.spec.ts` failures were verified **pre-existing on
  `main`** by checking out `678ba32` and re-running; a third is a cold-build flake in an untouched
  module. **pgTAP must run from a clean reset** — a preceding Playwright session leaves sales rows
  and capability grants behind that fail two unrelated files.

### Rollback
One migration and three commits; `main` @ `678ba32` untouched. Reverting `20260816090001` drops
`saved_products` and its RPCs and restores the seven-column profile directory — the two pgTAP
approved-column guards must be reverted with it.

---

## 2026-08-15 — Sprint 14 acceptance: Showroom workspace loading latency

Manual review reported the Showroom workspace loading "noticeably too slowly". Scoped to the
Sprint 14 routes only; **PR #23 not merged**.

### Measured first, so the fix aimed at the real cost

Local Supabase, seeded demo data, identical harness for every number (time to last byte, medians of
5–7 samples per route).

| Mode | Cold (first hit) | Warm (repeat) | In-app RSC nav |
| --- | --- | --- | --- |
| `next dev` | 1.0 s – 27 s, wildly variable | 458–715 ms | 282–486 ms |
| `next build && next start` | 150–340 ms | 160–221 ms | 156–221 ms |

The dev cold figures are **on-demand webpack compilation, not a product regression** — the same
route drops from 27 s to sub-second on its second hit, and production never pays it. Production warm
render was already ~185 ms.

**The real finding came from a decomposition, not from the route table.** A B2B page with ONE data
query cost 178 ms; the dashboard with NINE cost 195 ms; the framework floor is 15 ms. So ~160 ms of
every Showroom page was fixed identity/workspace-context cost and the page's own data was nearly
free. Counting Supabase round trips per render (Kong access log) showed why: `2x /auth/v1/user`,
`2x rpc/my_workspaces` — **the layout and the page each resolved the workspace context
independently**, in a five-deep sequential chain, on every navigation.

### Root causes and what changed

1. **Context resolved twice per navigation, five hops deep** — the dominant cost on EVERY route.
   `getServerSupabase`, `loadWorkspaces`, `loadWorkspaceContext` and `getPageContext` are now
   `cache()`d per render, so layout and page share one resolution; `getUser()` and `my_workspaces()`
   start together instead of chaining, as do the capability and branch reads. Request-scoped
   deduplication only — no cross-request or cross-user caching, and RLS still governs every read.
2. **Dashboard fetched record sets to read `.length` off them** — up to 100 RFQs, 100 quotations,
   100 orders and the whole joined shortlist, for four numbers and two five-row panels. Panels now
   ask for five rows *and* the exact count in one request; the tiles with no panel behind them are
   head-only counts. Lead labels read the customers those leads name, not the org's 500-row book.
3. **Reports read the same order set twice** — `topSuppliers` re-fetched what `purchaseSummary`
   already had; folded into one read (3 order reads → 2 across the page).
4. **Technicians ran the directory list three times**, one run byte-identical to the table's own
   query, purely for two tab counts; now two head counts.

### One optimization was measured and REVERTED

Replacing the directories' single two-column count query with per-tile `head` counts turned one
request into six and made `/b2b/suppliers` **slower** (167 ms → 209 ms). Round trips cost more here
than the columns they save. Reverted to the single narrow read, with the reasoning recorded in the
function; the scale answer is a `group by` aggregate in the database, which is a migration this page
does not need yet.

### `force-dynamic` kept

Every B2B route reads cookies for auth and org context, so Next.js requires dynamic rendering
regardless. The declarations were left in place (and the dashboard's now says why): they cost
nothing and they state that these panels must never be served from a shared cache.

### UX

Only `b2b/loading.tsx` existed, so every route flashed a dashboard-shaped skeleton before becoming a
table. Added `page-skeletons.tsx` (list / grid / panel archetypes, built from the existing
`Skeleton` primitive — no new design language) and a `loading.tsx` per Showroom route. Verified in
the browser: every route's prefetch payload carries its own `aria-busy` skeleton.

### Result

| Route | prod warm before | prod warm after |
| --- | --- | --- |
| median of all 11 | 185 ms | **168 ms** |
| `/b2b/reports` | 193 ms | 187 ms (14 → 12 round trips) |
| `/b2b/settings` | 178 ms | 168 ms |
| `/b2b/projects` | 185 ms (p95 460) | 161 ms (p95 173) |
| `/b2b` | 197 ms (p95 426) | 221 ms (p95 279) |

`/b2b`'s median is unchanged-to-slightly-worse **at seed scale** — with one record per table there
is no payload to save, so the count queries only add statements. The change is deliberate anyway:
it makes the dashboard's cost flat as a real showroom's records grow, where the old shape grew with
them. Real-browser production navigation measured 142–194 ms per route.

### Validation
- frontend typecheck ✅ · lint ✅ (0/0) · unit **208/208** ✅
- Playwright `showroom-mvp`: **7 passed / 1 skipped** desktop **and** **7 passed / 1 skipped**
  Pixel 5 (each project skips the other's viewport-specific test) — 0 failures
- Dashboard counts verified against the database with temporary fixtures (7 RFQs across four
  statuses, 3 shortlisted): tiles read 5 open / 3 saved, panel showed the 5 open rows and excluded
  draft and closed. Fixtures removed afterwards.
- Full-repo performance gate deliberately NOT run (out of scope for this acceptance).

### Rollback
One commit on `feature/showroom-mvp-completeness`, frontend-only, no migration. Reverting it
restores the duplicate context resolution and the list-for-count dashboard reads.

---

## Sprint 14 — Showroom product-completeness pass (2026-08-15)

Branch `feature/showroom-mvp-completeness` (PR #23). Not a new sprint: depth, usability, analytics
and client-presentable quality on top of the module structure Sprint 14 already established.
Reference set: `UI-UX/references/showroom/`. No `.pen` file touched.

### The finding that mattered

The Showroom modules were not sparse because of the components. `app._organization_public_directory()`
filters on `is_verified`, and **every** pilot organization was seeded `is_verified = false` (with every
pilot profile `hidden`) specifically so global `count(*)` assertions in pgTAP stayed frozen. Distributors,
Institutions and Technicians were therefore **structurally empty** for the acceptance account no matter
how good their UI was. Freezing global counts in tests had made the seed untouchable, which made the
product undemonstrable.

Fixed by scoping the two most brittle assertions to the record under test (`where id = …` /
`where display_name like 'Nadia%'`) instead of a global count. Those assertions now prove *more* — the
specific org/person leaves the directory — and stop blocking seed growth.

### Acceptance account

Switched from Delta Interiors Studio / Org A to the real Showroom/Dealer org, **Cairo Ceramics
Showroom** (`hana@example.test`), in both manual UAT and the e2e suite. Org A is a supplier and Org B a
design office; testing the buyer-first showroom IA through them only ever proved the pages render empty.

### Seed (deterministic, synthetic)

Extended `seed-pilot.sql`: 5 verified counterparties (3 distributors + 2 institutions) with owners,
branches and published catalogues; 7 listed professional profiles; 12 purchase requests, 10 offers,
7 orders (**EGP 1,103,100** over 6 months), 5 projects, 8 shortlisted products, and a sell-side chain.
Product imagery is 12 local SVG **material swatches** under `frontend/public/demo/products` — a
finishing catalogue is a catalogue of surfaces; no external host, no licensing question, deterministic.

The showroom's sales book was split into `seed-showroom-sales.sql` (also in `config.toml` sql_paths).
The e2e global setup truncates the four sales tables before every run; while that data lived inside
`seed-pilot.sql` the truncate silently deleted it for good, leaving the acceptance account with empty
pipeline panels after any e2e run. Global setup now re-applies that one file, from the same source of
truth as `db reset`.

### Terminology

User-facing **Supplier → Distributor / المورّد → الموزّع** across every surface, applied to message
VALUES only (keys, `{supplier}` placeholders, routes, columns and RPC identifiers are internal and
unchanged). `showroom_dealer`'s Arabic label moved to "معرض / تاجر" so it no longer collides with the
new meaning of موزّع. No schema terminology migration.

### Charts — hand-written, no new dependency

`components/ui/charts.tsx`: trend line, donut, ranked bars, funnel. Inline SVG renders on the server,
ships no JavaScript, and inherits the theme because its fills are token variables. Required a
categorical palette, added through governance as `--series-1…6` + `--chart-grid` in `tokens.css`
(both themes, every value an existing brand primitive) and exposed as `series-*` in Tailwind. Every
chart is `role="img"` with an `sr-only` transcript of its actual values; colour is always a second
channel behind a text label.

### Analytics data path

One additive migration (`20260817090001`): `order_category_spend` resolves order value to product
category through the quotation lines an order was created from — the only honest link, since an order
line is a frozen snapshot carrying no `product_id`. Verified exact: the category split sums to the
order total to the piastre. `order_list` and `project_list` gained appended columns (requester branch;
branch + order value) so branch filtering and project value are real rather than approximated.

### Defects found and fixed during browser review

- `DataTable` clipped columns wider than their container (`overflow-hidden` with no scroller) — inside
  a half-width dashboard card it hid the money column outright. Now scrolls within its own wrapper.
- Money in a `StatTile` overflowed the two-column mobile grid and pushed the page sideways (23px).
  Tiles now use the compact money format, with `truncate` as a guard.
- `Projects` showed a branch column that was always "—" on the executing tab (it is the *client's*
  branch, which this caller cannot name). Column is offered only where it resolves.
- Arabic mixed numeral systems in one row (Arabic-Indic money beside a Latin `57%`). Added
  `formatPercent`; shares now match the values beside them.
- Fixture labels ("Nadia (Org B Owner)", "Hana (Cairo Ceramics Owner)") were reaching the client as
  display copy. Replaced with plain synthetic names.
- Team rendered **raw capability keys** (`org.manage`, `sales.read`) as chips. Replaced with localized
  work groups via `capabilityGroups()` — a display mapping only; authorization is untouched.

### Deliberately NOT built

No ratings, no availability, no professional phone numbers, no geographic map, no project
percentage-complete, no product price, no company location — none of those exist in the model, and a
directory that invents them is worse than one that admits what it knows. No billing / notifications /
integrations in Settings.

### Validation
- frontend typecheck ✅ · lint ✅ (0 errors, 0 warnings) · unit **216/216** ✅ (incl. new
  `lib/org/roles.test.ts`, 8 tests, guarding that no raw capability key can reach the client)
- pgTAP **729/729** ✅ after a clean `db reset` (5 files reconciled to the enlarged pilot world)
- Playwright `showroom-mvp` **16 passed / 1 skipped** on chromium-desktop **and** chromium-mobile
- Real-browser UAT as Cairo Ceramics across all 13 acceptance routes, EN + AR

### Pre-existing failures, NOT caused by this pass (verified against a stashed baseline)
- `shared-onboarding.spec.ts:44` and `business-onboarding.spec.ts:56` — a chain of assertions left
  stale by an earlier sprint's onboarding copy rename. Three of them were repaired here (the specs had
  to be touched anyway); the remainder are further down the same flow and are out of this pass's scope.
- `pilot-uat-round-1.spec.ts:64` — two "Pending review" badges on the personal `/home` trip a
  strict-mode locator. Fails identically at HEAD.

---

## 2026-08-17 — Staging cloud audit & catalog view hardening

Short audit of the ACTUAL hosted staging state after the owner's manual Vercel / Supabase / Resend
changes. Scope was deliberately narrow: verify live state, fix only confirmed blockers.

### Verified as already correct (no change made)
- Hosted staging migration parity is **exact** — 28/28 local migrations applied remotely, zero drift.
- Vercel project `aladdin-staging` is `framework: services`, one root `vercel.json`, no per-service
  `vercel.json` and no `.vercel` overrides. Latest production deployment READY on `1c6b002`
  (`lambdaRuntimeStats: nodejs 4, python 1` — both services genuinely deployed).
- `/api/health`, `/api/backend/health`, `/auth/sign-in` and `/` all return 200 anonymously.
- Vercel holds **only three env vars**, all `NEXT_PUBLIC_*` (Production + Preview). No service-role
  key, no Resend key, no backend secret is stored on Vercel at all. `SUPABASE_SERVICE_ROLE_KEY` is
  `.optional()` in `frontend/src/lib/env` and referenced by zero runtime modules, so its absence is
  correct rather than an oversight.
- No secret-shaped value in the rendered HTML or any JS chunk; nothing secret-shaped in Git.
- Deployment Protection = Vercel Authentication, `all_except_custom_domains` (previews protected,
  production alias public). Left as-is.

### Fixed — `public.catalog_published_products` (Advisor rule 0010, CRITICAL)
Created `with (security_invoker = false)` in `20260810090001` (NOT edited — forward-only migration
`20260817100000_catalog_view_invoker_hardening.sql`).

The flag could not simply be flipped: the view joins `products` to `organizations`, and under invoker
rights the `organizations` half collapses to the caller's own orgs, silently emptying the cross-tenant
marketplace. But the definer rights were only ever buying the supplier's **public identity** columns —
policy `products_select_published` already grants every authenticated caller cross-tenant SELECT on
`status='published' and deleted_at is null`, byte-for-byte the view's own filter.

So the fix applies the established public-directory pattern (`20260805100000`) at the narrowest
possible scope: the view becomes `security_invoker = true` and reads `products` under the caller's own
RLS, and **only** the supplier-identity half moves into `app._catalog_supplier_identity()` — SECURITY
DEFINER, `search_path` pinned empty, four approved columns, PUBLIC execute revoked, EXECUTE granted to
`authenticated` only. An `exists (published, non-deleted product)` clause keeps the set of revealed
organizations exactly equal to what the old view revealed. Dependent `public.saved_product_list` was
dropped and recreated verbatim (explicit drop, not CASCADE).

Net effect: products RLS is now genuinely enforced instead of bypassed, so a future policy narrowing
product visibility is honoured here automatically.

### Validation
- clean `supabase db reset` ✅ · pgTAP **747/747** ✅ across 30 files, including the pre-existing
  catalog assertions in `23_catalog_rfq_quotation_test.sql` (cross-tenant published visible, draft
  hidden, supplier identity resolves) and new `29_catalog_view_invoker_hardening_test.sql` (18 tests)
- Advisor rule 0010 replicated as SQL over `pg_class.reloptions`: **zero** SECURITY DEFINER views
  remain in `public` / `graphql_public`
- `EXPLAIN ANALYZE` on the rebuilt view: hash join, function scanned once (not per-row), index scan on
  `ix_products_org_status` — no correlated-call pathology
- No frontend/backend code changed, so typecheck/lint/E2E were not rerun (view contract is identical)

### Flagged, not changed
- Backend health reports `"env":"local"` (APP_ENV unset on Vercel). Safe for a health-only service;
  clean up when the first real backend endpoint lands rather than provisioning secrets to change a
  string.
- FastAPI is currently request-driven only and appropriate as deployed. **Boundary to hold:** the
  planned AI/OCR/RAG/document work must not become blocking HTTP work inside these request handlers.
- Hosted Supabase SMTP/Resend settings and the hosted Magic Link template are dashboard-only state and
  cannot be read with the repo's authenticated tooling — listed as manual owner checks.

---

## 2026-08-17 — Sprint 15: shared SUPPLY-SIDE B2B workspace (Distributor · Manufacturer · Importer)

Branch `feature/supply-side-b2b-mvp`. Reference set: `UI-UX/references/Distributor/` (12 screens,
now tracked, matching the existing `references/showroom/` convention). No `.pen` file touched.

### The audit finding the sprint turned on
`listRfqs`, `listQuotations`, `listOrders` and `listProjects` have **always** taken a side parameter
(`"requester" | "supplier"`), and every commerce record names both parties. The supply side was never
missing from the backend — it was buried as a secondary tab behind a buyer-first IA built for the
Showroom. So this was not "build a second app"; it was "make the seat a first-class derived property".

Reference → Aladdin mapping: Dashboard/Products/Quotes+Orders/Analytics/Sales reps → REORGANIZE or
IMPLEMENT over existing modules · "New Opportunities" → the existing RFQ domain presented as incoming
demand, **no new marketplace domain invented** · customer network → new `/b2b/buyers` · Messages,
Reels, invoices/collections, wallet, commissions, carrier tracking, Egypt map → **DEFERRED, not faked**.

### What was built
- **`lib/workspace/supply-side.ts`** (pure, 11 unit tests) — `commerceStance(orgType)`, `supplyVoice()`.
  `OrgContext` gained `orgType` at **zero extra reads** (the workspace entries already select it).
  Stance is a PRESENTATION DEFAULT: it grants no authority, hides no module, never touches `users`.
- **One shared sidebar, two orderings.** `lib/nav/modules.ts` now returns stance-ordered sections;
  the commerce trio keeps the same hrefs/gates and swaps labels (Incoming demand / Quotations /
  Orders). `SidebarShell`, its three display modes, RTL geometry, the mode cookie, tooltips and the
  mobile sheet are **unchanged and shared** — no Showroom/Distributor split exists.
- **`CardRail` reused as-is** for the dashboard KPI group and quick actions. No second carousel.
- **Supply dashboard** (`features/home/supply-dashboard.tsx`), sibling to the extracted
  `buyer-dashboard.tsx`; `/b2b/page.tsx` is now a thin stance selector.
- **`supplySummary()`** — one call covering tiles, funnel, trend, top products and top customers from
  three list-view reads plus one conditional line-item pass. Deliberately NOT `purchaseSummary` with
  columns swapped; the seats are asymmetric (see the type's doc comment).
- **Products** rebuilt on shared `DataTable`: KPI rail, status tabs, search + category filter, media,
  and per-product **demand** (`productDemand`, counted per REQUEST not per line).
- **`/b2b/buyers`** — customer network from `customerOrganizations()`. Every figure counts records the
  caller is a party to; the only counterparty columns come from the hardened public directory.
  Unlisted customers are MARKED, never dropped.
- **`SupplyReport`** leads `/b2b/reports`; the purchasing report stays below in full.
- **Team page** gained an honest roster KPI strip (zero extra reads). The reference's per-rep sales
  TARGETS and leaderboard were refused — no quota/commission model exists, and a leaderboard built
  from fiction would be used to manage real people.

### Deliberate refusals (each has a concrete reason, not a scope preference)
No stock/warehouse/reorder/margin on Products · no Egypt sales map (`locality_id` has no locality
table and no coordinates) · no AI "smart insight" · no invoices/collections/wallet · no carrier
tracking on fulfilment (order + project state only) · no growth badges anywhere (no comparison period
exists) · supply-side report offers **no branch filter** because `requester_branch_id` is the BUYER's
branch and filtering by it would answer the question wrongly rather than not at all.

### Seed — `seed-pilot.sql` section 11
Sections 1-10 only ever reached the supply side as the far end of chains the showroom had already
FINISHED, so `submitted` RFQs, undecided quotations and in-progress orders were all unreachable and
each org had exactly one customer. Section 11 adds commerce **between businesses that already exist**
— no new orgs, people, branches or memberships — plus one published and one draft product each.
Result per acceptance account (published/draft/awaiting/undecided/active orders/completed/customers/projects):
Distributor 3/1/**3**/1/2/2/**3**/1 · Manufacturer 3/1/2/2/1/1/2/1 · Importer 3/1/2/2/1/1/2/1.

Acceptance accounts: `rania@example.test` (Suez Paints, Distributor) · `mahmoud@example.test`
(Alexandria Glass, Manufacturer) · `fady@example.test` (Cairo Sanitary Ware, Importer).

### Validation (feature-first, as scoped)
typecheck ✅ · lint ✅ · vitest **254/254** ✅ · clean `supabase db reset` + pgTAP **747/747** ✅
(seed change disturbed no fixture) · new `e2e/supply-side-mvp.spec.ts`: **31 desktop + 30 mobile** ✅
across all three org types, EN + AR, asserting real data, no console errors, no horizontal overflow,
all three sidebar modes with cookie persistence, the shared CardRail by test id, and that `Supplier`
never reaches user-facing copy · showroom regression `showroom-mvp` + `showroom-interaction`
**26/26** ✅ — the buyer seat is untouched.

Not run, per scope: full repository E2E, final cross-account integration gate, performance gate.

### One assertion corrected during validation, worth recording
The first spec demanded the purchasing trend CHART on a supply-side report. It failed for all three —
correctly: none of them has bought anything, so `TrendLine` renders its honest "no committed spend"
panel. The assertion was wrong, not the code, and was changed to assert the purchasing SECTION plus
that empty state. Demanding the chart would have been demanding the page draw data that does not exist.

### Unfinished / next
- Cross-account integration gate (Showroom publishes → RFQ → quote → accept → order → supply-side
  progresses → Showroom observes) is now manually testable end to end but was **not** run, per scope.
- `sellSummary()` is now redundant with `supplySummary()` on the seller path; it still backs the
  buyer-seat report's small sell-side card. Collapse the two when the buyer report is next revisited.

---

## 2026-08-18 — Pre-UAT shell + supply-side visual pass (`feature/supply-side-b2b-mvp`, PR #34)

One correction pass over the authenticated shell and the seller surfaces, on the same branch and the
same PR. **No migration, no schema change, no seed change, no RLS change.**

### Global shell
- **One shared `AppHeader`** replaces three drifting header bars (B2B · personal `/home` · Admin).
  Everything surface-specific arrives as a SLOT (`context`, `actions`), so there is no persona clone.
  It is deliberately NOT applied to sign-in / sign-up / OTP / onboarding — those keep their own
  minimal chrome and the standalone language/theme switches. **No notification bell**: no
  notification model exists, and a bell that opens nothing is a lie in the chrome.
- **Global search / command palette** (`Ctrl/Cmd+K`, click, Escape, ↑/↓, Enter). Two result families:
  navigation results are LOCAL (from the same `allowedNavSections` the sidebar draws from, so they
  are instant), record results are server-side, debounced 250 ms, request-id guarded, RLS-scoped,
  pinned to the active organization, and **capability-gated per entity group**. The gate is a pure
  module — `lib/search/scope.ts` — unit-tested against `lib/nav/modules` so search can never become a
  back door into a module the sidebar hides. Platform-admin destinations are gated by a
  SERVER-resolved role, never a client flag. A personal account issues no record query at all.
  Bounded: 6 rows per group, minimum 2-character query, `sanitizeSearchTerm` on every term.
- **Profile/account menu**: signed-in identity (display name + the ONE verified contact — the auth
  model verifies email OR WhatsApp, so an email row is not assumed), work context as read-only
  CONTEXT (not a second workspace switcher), profile + preferences links, AR/EN language,
  System/Light/Dark appearance, log out. Theme preference gained `system` with a blocking pre-paint
  script in `<head>` and a `ThemeSync` listener; one theme system, not two. Language and sign-out
  moved OUT of the header row into this menu on every authenticated surface.
- **Collapsed sidebar**: the floating hover caption is gone; hover/focus now lights the icon's own
  tile. `aria-label`, active state and every capability-derived module are unchanged. The caption was
  painting over page content and, in expand-on-hover mode, racing the reveal to show the same word twice.
- **CardRail**: one arrow click = exactly ONE card, measured from real adjacent-child geometry rather
  than `cardWidth × cardsPerView` (which on a wide desktop jumped to the end). RTL falls out of the
  same measurement; six unit tests cover both directions and a mid-rail position.
- **Scrollbars, globally**: stepper arrows removed, dark-mode track/thumb tokenised, Firefox served
  via `scrollbar-width`/`scrollbar-color`. **The trap:** Blink IGNORES every `::-webkit-scrollbar-*`
  rule the moment `scrollbar-width` or `scrollbar-color` matches the element — setting both, the
  obvious "belt and braces" version, silently disables the arrow removal. The standard properties are
  therefore fenced behind `@supports not selector(::-webkit-scrollbar)`.

### Supply-side visual fidelity (reference: `UI-UX/references/Distributor`, structure only)
New shared, server-safe `components/ui/workspace-layout.tsx`: `PageHead` (banded head + module
glyph), `KpiStrip` (ONE bordered instrument with hairline seams), `WorkPane` (wide working column +
narrow context column), `Panel`/`PanelRow`, `NextSteps`, `Band`. `PageHeader` is now a thin adapter
over `PageHead` and moved out of the `"use client"` module so pages can pass a glyph; `StatTiles`
gained `layout="strip"`. The supply dashboard was rebuilt to the reference SHAPE — banded head, five
KPIs (not nine railed tiles), a demand queue with a status/catalogue context column, a performance
band, and a real next-steps row. RFQs/quotations/orders gained a real status donut beside their
tables. Reports (both the buyer strip and `SupplyReport`) moved from the rail to the strip.

**Still deliberately absent, each because no model backs it:** wallet · invoices/collections · Reels ·
chat/messages · carrier tracking · maps · quotas · warehouse/ERP · growth badges (no comparison
period exists in the database).

### Two real defects found and fixed during validation
1. **The language switch never re-rendered the page.** `revalidatePath` clears the server cache but
   does not pull a fresh RSC payload for the ROOT layout, which owns `<html lang>`/`<html dir>` — so
   the cookie flipped, `dir` flipped imperatively, and every string stayed in the old language: an
   RTL shell full of English. Both language controls now reload the document. This was pre-existing
   (it is behind the long-standing `sales.spec` language-switch failure), not introduced here.
2. **`truncate` on a KPI value is a correctness bug, not a layout one.** `EGP 289,600.00` clipped
   mid-string renders as a perfectly plausible smaller number. The strip's value now wraps, and
   money on a KPI is formatted compact at the caller.

### Validation
typecheck ✅ · lint ✅ (0/0) · vitest **266/266** ✅ (new: `lib/search/scope`, rewritten `card-rail`,
extended `sidebar-shell`) · new `e2e/global-shell-uat.spec.ts` **16 passed** across desktop + Pixel 5
(Distributor AR, Manufacturer EN, Importer AR, collapsed-rail hover, one-card rail, header search +
account menu, locale switch, personal `/home` palette exposing no business records, Admin gating,
non-staff never offered Admin, mobile) · regression `supply-side-mvp` + `showroom-mvp` +
`showroom-interaction` **122 passed** after four assertions were updated to the intended new
behaviour (no collapsed tooltip, KPI strip instead of the dashboard rail, language control now in the
account menu, Reports money-figure check rewritten to assert the FIGURE rather than the container).
Real-browser review as `rania@example.test` in Arabic, light and dark.

Not run, per scope: full repository E2E, Lighthouse/performance, pgTAP (no schema or RLS change).

### Unfinished / next
- `/b2b/settings` still carries the binary `ThemeSwitch`, which cannot express "System". Harmless
  (same cookie, same action, and it now reads the live theme) but worth reconciling with the account
  menu's three-way control next time settings is touched.
- The reference's per-product media/thumbnails are placeholders; no image pipeline exists yet.

---

## Session · Visual UAT round 2 — global shell + Pilot scope
**Branch** `feature/supply-side-b2b-mvp` · **PR** #34 (updated, NOT merged)

Seven product-wide findings from UAT round 2. Discovery was deliberately scoped to the shared
components named in the brief — no second repository audit.

### Dark mode rebuilt on a neutral ground (the largest change)
The dark theme was painted on **Basalt**, which is a BRAND colour — a cool blue-black stone that is
right for the Aperture mark, the auth panel and every modal scrim, and wrong as a workspace ground.
At `#0e1113` it is close enough to pure black that a full-height sidebar and an empty table region
both read as dead space, while the jump up to `#1b2226` was large enough that every card looked like
it was floating in a hole.

A new **Carbon** primitive ramp is now the dark ground: neutral (no blue cast), starting at charcoal
rather than near-black, stepping a few points of lightness at a time. Borders sit only just above the
surface they divide — that is what removes the drawn-grid look — and contrast is carried by the TEXT,
where the ratios actually have to hold (`15.7 / 7.7 / 4.8 : 1` on both canvas and surface). Basalt is
untouched; the brand does not move.

**Shadows are now theme-aware tokens** (`--shadow-raised` / `--shadow-card` / `--shadow-overlay`,
mapped onto Tailwind's `sm` / `card` / `lg`). The old `shadow-card` was one fixed warm near-black at
4%, tuned against Limestone and invisible on a charcoal ground — which is the real reason dark cards
had no edge and dropdowns did not lift off the page. Overriding Tailwind's own `sm`/`lg` is
deliberate: every menu, popover and rail in the product already reaches for those names.

Light mode is unchanged (verified: `body` still resolves to `#f4f1ea`).

### CardRail — the defect was consecutive clicks, not the step size
One card per click was already correct **at rest** (a previous session replaced the pager arithmetic
with geometry). What was still broken was clicking faster than the smooth scroll animates: 150ms in,
the cards are at drifting intermediate positions, so a second click concluded that "the next card
from here" was the one the first click was already travelling to, and commanded a move that merely
finished it. **Three fast clicks advanced one card.**

The rail now holds the travel distance it COMMITTED to and reasons about which card is next from
where it is *headed*, while still measuring the distance it commands from live geometry (which is the
frame `scrollBy` works in). The commitment is released on arrival and on any user-driven scroll
(wheel / touch / pointer / keys), so an arrow can never fight a swipe. The rail's own scroll-padding
is now read rather than assumed, so a card lands on its snap position instead of 4px past it and
drifting further with every click.

### Invitations by EMAIL or PHONE (schema + RPC change)
The people a showroom or distributor needs in their workspace — a branch salesperson, a fitter, a
driver — are on WhatsApp and frequently have no work email. `organization_invitations` now carries a
`phone` column, `email` is nullable, and **exactly one** is set per row (`ck_invitation_contact`), so
acceptance always has one rule to check.

**Nothing claims a message was sent that was not.** Email invitations reuse the existing email path.
There is no SMS/WhatsApp sender configured here, so a phone invitation is created, tokenized, and the
link handed back with a one-press copy and copy that says plainly: *"we don't send text messages yet
— copy this link and send it on WhatsApp or however you normally reach them."* No new paid provider
was introduced, and tokens are never logged.

**The acceptance rule, stated honestly.** An email invitation stays bound to its verified address. A
phone invitation binds to a confirmed phone WHEN THE ACCEPTOR HAS ONE — which starts protecting these
invitations the day WhatsApp OTP is enabled, with no further migration — and otherwise rests on the
unguessable single-use token, with a verified contact of some kind still required. That second branch
is a bearer credential and is documented as one in the migration header and pinned by a pgTAP
assertion, so weakening or tightening it later is a conscious decision rather than a silent drift.

**A regression introduced and caught in validation:** the first version of `invitation_create` put
`p_phone` third, which silently rebound every existing POSITIONAL caller — a branch uuid arriving
where a phone was expected. `20_account_registration_test.sql` went from green to 10 failures. The
parameter now goes LAST, and the migration also drops the intermediate 4-arg signature so a database
that ran the earlier version does not keep both overloads and fail every named-argument call as
ambiguous.

### Finance / accounting in Pilot: there was none to remove
Audited and confirmed: **no** invoice, collection, payment, receivable, wallet, payout, commission,
settlement or accounting module exists in this repository — no route, no nav entry, no table, no
i18n block. The Arabic strings quoted in the brief appear nowhere in the codebase; they are in the
Distributor REFERENCE screenshots, which were never built.

Two real vocabulary problems did exist and are fixed:
- `WalletIcon` was the glyph beside **order value**, **quotation total** and **project value** — the
  commercial figures the brief explicitly says to KEEP. A purse next to "total order value" invites a
  manager to look for a balance, a top-up and a payout that do not exist. Replaced everywhere with a
  neutral `MoneyIcon` (banknotes), and `WalletIcon` deleted so it cannot drift back into a value slot.
- One string named a finance artefact even while denying it ("No invoice or payment is created") —
  reworded in both catalogs.

### Header, theme switch, sidebar
- A direct **Light/Dark** switch now sits in the shared header, immediately before the avatar, at
  every width. It is a pair of segments rather than one toggle because a lone moon icon cannot say
  whether it means "you are in dark" or "press for dark", and either reading is common enough that
  half the audience would read the current theme backwards. It owns **no state**: both it and the
  profile menu now write through one `applyThemePreference` helper and one cookie, and the menu keeps
  the full System/Light/Dark preference.
- The B2B header's workspace switcher now shows the organization's **user-facing type** under its
  name (*Distributor*, *Showroom / Dealer*, …) from the `orgType` catalog. Never the internal
  `supplier` identifier; an unrecognized type renders nothing rather than a raw key.
- **Sidebar bottom control.** Two defects. It sat 4px inboard of the navigation icons because its
  padding was set in `sidebar-shell` while the nav rows' was set in `workspace-nav`; both now derive
  from one `lib/ui/nav-geometry` module, so they cannot disagree by construction and Arabic is the
  mirror of English with no direction-specific rule. And per the round-2 follow-up it is now
  **icon-only in every mode, expanded included** — a control captioning a state the user can see is
  noise. The mode names live in the menu it opens; the `aria-label` still names the control AND the
  active mode.
  The trap worth remembering: icon-only must not become icon-CENTRED. An expanded panel is 15rem
  wide, so `justify-center` would have moved the glyph ~120px out of the column — trading a 4px
  misalignment for a far worse one. The row keeps its start inset and simply has nothing after the
  icon.

### Validation
typecheck OK · lint OK (0/0) · vitest **301/301** (4 new CardRail regressions incl. mid-animation
consecutive clicks, boundary, and manual-scroll release; 2 new sidebar assertions incl. the inverted
icon-only contract) · pgTAP `20_account_registration` and new `30_invitation_contact_channel`
**16/16**, both re-run on a **from-scratch database** (all migrations replayed in order + all three
seeds).

Real-browser acceptance (Chrome, local dev): Distributor `rania@example.test` AR+EN, dark and light —
header theme switch, org type in the header, invitation Email/Phone with a real phone invitation
created end-to-end (`+201002003040` stored normalized, no email, pending) and shown masked as
`+20•••40`; Showroom `hazem@example.test` — CardRail proven one-card-per-click **and** one-card-per-
click when clicked 90ms apart mid-animation, in BOTH directions, with the boundary arrow disabling
correctly and no page overflow; sidebar icon column measured at **33.5px for the control and all 17
nav icons** in LTR and **1444.5px** in RTL, in expanded, collapsed, and mid-hover-reveal.

**Environment notes for the next session:** `supabase db reset` fails on this machine — the CLI times
out reaching `127.0.0.1:54322` even though the container is healthy, and on one run it dropped the
database and left the `auth` schema a stub. Recovery: apply migrations via
`docker exec -i supabase_db_aladdin psql`, then `docker restart supabase_auth_aladdin` so GoTrue
re-runs its own auth migrations, then load the seeds. Also: `pnpm dev` and Playwright's `next build`
share `.next`, so running both concurrently poisons the build with a `Cannot find module './NNNN.js'`
— stop dev and `rm -rf .next` first.

### A third defect, found by the new e2e assertion
The e2e test written for "do the two theme controls agree" failed on its first run, and it was right
to. The header switch and the profile menu each seeded local state from `<html>` once, at mount —
fine while only one is mounted, wrong the moment both are: change the theme from the header, open the
account menu, and the menu still showed the previous choice. Neither component owns theme state now;
`lib/theme/use-theme` subscribes to `<html>` via `MutationObserver`, `applyThemePreference` is the
only writer, and every reader updates in the same microtask. Also fixed while there: under `system`
the OS could change with the app open and nothing re-applied it, so a workspace left open past sunset
stayed light.

Final e2e: `global-shell-uat` **21 passed / 0 failed** across desktop + Pixel 5 (9 skipped are the
pointer/tablet-only rail and sidebar cases on the mobile project).

### Unfinished / next
- `/b2b/settings` still carries the binary `ThemeSwitch` that cannot express "System" — now a THIRD
  theme control alongside the header switch and the account menu. All three share one cookie and one
  helper, so it is correct, but it should be reconciled to the three-way control next time settings
  is touched.
- Phone invitations are bearer-token invitations until phone identity exists. The matching branch is
  already written and tested; enabling WhatsApp OTP turns it on with no migration.

## Session · One icon hover state across all three sidebar modes
**Branch** `feature/supply-side-b2b-mvp` · frontend only, no schema change

The lit icon tile (`group-hover:bg-surface-2 group-hover:shadow-sm group-focus-visible:bg-surface-2`)
existed only behind a `narrow &&` guard, so it was a COLLAPSED-only affordance. Expanded answered a
pointer with a row tint alone, and expand-on-hover answered both ways inside one gesture — the panel
flips 3.5rem→15rem under a cursor that never left the icon, so the icon's own cue appeared and then
vanished mid-reveal. The brief was to reuse the existing state, not invent a second one.

- `lib/ui/nav-geometry` now exports **`NAV_ICON_HOVER_CLASS`** — the one definition of that state —
  and `navIconClass()` lost its `narrow` argument: the 36px tile is the icon's box in every mode,
  because the hover classes have nothing to paint without it.
- Both call sites (`workspace-nav` NavLink, `sidebar-shell` mode control) spread the same constant
  with no mode guard. The expanded row keeps its `hover:bg-surface-2/60` tint — the tile is additive.
- Consequence, deliberate: `navRowClass` expanded `py-2 → py-0.5` and `gap-3 → gap-1`. Height now
  comes from the tile in BOTH states (40px), which is what stops expand-on-hover jolting the list
  vertically as it opens; the tighter gap keeps the label's optical distance where the bare glyph put
  it, since the tile carries ~8.5px of its own side padding. Expanded rows 35px→40px, labels 9px
  inward. Per-mode column alignment is unchanged by construction — both call sites still ask the same
  functions. Cross-mode, the reveal now slides icons 14px instead of 5.5px (collapsed tile centre
  28px, expanded 42px); reducing it would need the expanded row's start inset, which
  `sidebar-shell.test.tsx` guards at `px-3`.
- Active items keep today's behaviour: the accent tile stays `narrow && active`, so an expanded
  active row still reads as a tinted row, not an accent tile.

**Validation:** `pnpm typecheck`, `pnpm lint`, `pnpm test` — 30 files / 307 tests green (three new
`sidebar-shell.test.tsx` cases assert the same class string reaches a nav icon and the mode control
in expanded, collapsed and hover, and survives a reveal). Not yet eyeballed in a real browser.

### Follow-up: the bottom control's tile was armed by the wrong element
Scoping the tile to the icon column was right; driving the CONTROL's tile from the row was not. The
mode control is `w-full` so its CLICK target matches a nav row, but unlike a nav row it has no label,
so `group-hover:` lit the 36px tile from anywhere along the footer — a pointer resting 200px away
over empty space made the bottom of the sidebar glow.

`lib/ui/nav-geometry` now exports the same paint under two triggers: **`NAV_ICON_HOVER_CLASS`**
(row-driven — correct for a nav link, whose label, icon and padding all navigate to one href) and
**`NAV_ICON_SELF_HOVER_CLASS`** (`hover:` on the tile itself). The control uses the self-scoped one in
all three modes; its icon colour moved from `group-hover:text-fg` to `hover:text-fg` for the same
reason. `group-focus-visible:` stays in BOTH constants on purpose: a span cannot take focus, so the
group it reads is the single focusable control that owns the tile — that is the control's own focus,
not an area-wide trigger, and dropping it would cost keyboard users a cue mouse users keep.

The button keeps `!narrow && hover:bg-surface-2/60`, so an expanded footer row still tints on hover.
That is the only feedback the full-width click target has left; if the target should shrink to the
tile, the tint goes with it. **Open decision, deliberately not taken here.**

**Validation:** typecheck, lint, 308 unit tests green — including a regression guard asserting the
control's icon carries no `group-hover:` in any mode, and an assertion that the two constants differ
only in trigger (identical declarations once the variant prefix is stripped). Tailwind emits
`.hover\:bg-surface-2:hover` and `.hover\:shadow-sm:hover` (verified against a real
`npx tailwindcss` compile of this config, not assumed). Still not eyeballed in a real browser.

### Follow-up 2: the control's ROW lost its hover state entirely
The open decision above was taken: `!narrow && "hover:bg-surface-2/60"` is gone, and so is the
button's base `hover:text-fg` (dead anyway — the control paints no text) and its now-purposeless
`transition-colors`. The button keeps `w-full`, so the CLICK target still matches a nav row; what it
no longer does is PAINT across that width. A nav row may tint on hover because its whole width is
label and icon; this row is a 36px tile followed by up to 200px of nothing, and tinting that emptiness
announced a control the pointer was nowhere near — the same defect as the group-driven tile, one
element out. All visible hover feedback now originates on the tile (`hover:` on the span). The
`focus-visible` ring stays: it is a keyboard affordance, not hover feedback, and it lands on the
button because the button is what takes focus.

**Validation:** typecheck, lint, **309** unit tests green. New guard asserts the control's own
className matches no `hover:`/`group-hover:` variant in expanded, collapsed or hover mode while still
carrying `focus-visible:ring-2`; the regex was checked against the removed rule so it fails if the
tint returns. Still not eyeballed in a real browser.

## Session · UAT round 3 — full-row nav hover + WhatsApp invitation hand-off
**Branch** `feature/supply-side-b2b-mvp` · **PR** #34 (updated, NOT merged) · frontend only

### 1. Navigation items highlight as a ROW again — and a dead opacity modifier is why they did not
A wide nav row now paints one subtle surface behind icon AND label, matching the supplied
references; the icon tile paints only on the COLLAPSED rail, where the 40px row IS the tile. Never
both — a tile inside an already-highlighted row draws a second box around the icon and splits one
target in two.

The row hover was not merely weak, it was ABSENT, and had been for a long time. `hover:bg-surface-2/60`
compiles to **nothing**: the semantic colours are `var(--…)` values with no `<alpha-value>` channel,
and Tailwind silently emits no rule for an opacity modifier on those. Verified twice — a real
`npx tailwindcss` compile of this config produces no `/60` utility at all, and in the running app a
CSSOM scan for `bg-surface-2\/60`, `bg-surface-2\/70` and `accent-solid\/15` returns **0 rules**. So
the fix is a real token: `--surface-hover` (light `#f1ede5`, dark `#1e2122`) sits one step short of
`surface-2`, mapped as `bg-surface-hover`, so hover whispers and the current row (`surface-2` + accent
marker + accent glyph) still reads clearly stronger.

**This is systemic and NOT fixed here (out of scope for this round).** Every `/xx` modifier on a
`var()` token across the app is dead in the same way — `admin-nav`, the sidebar mode MENU
(`hover:bg-surface-2/70`), profile menu, workspace switcher, tables, cards, and the collapsed ACTIVE
tile's `bg-accent-solid/15`. Each is an invisible state, not a broken build, which is why it survived
review. Fixing it properly means either more hover/active tokens or re-expressing the semantics as
channel triples so modifiers work — a design-system change that deserves its own pass.

The bottom mode control is unchanged and stays the exception: no row paint in any mode, hover only on
its own 36px tile (`NAV_ICON_SELF_HOVER_CLASS`), icon-only in all three modes.

### 2. Phone invitations: copy the link, or hand it to WhatsApp
The phone success state now offers exactly two actions — **Copy invitation link** and **Send via
WhatsApp** — over the honest hint ("nothing has been sent yet… you press Send there"). Email is
untouched, including its "Copy link" label, because its invitation really was dispatched.

`lib/contact/whatsapp.ts` builds a `wa.me` deep link and nothing more: no WhatsApp Business API, no
SMS gateway, no server call, no external service. It addresses the NORMALIZED number (E.164 with the
plus stripped — `inviteMemberAction` now echoes it back in its state) and carries a locale-aware
template with the REAL organization name and the ABSOLUTE invite URL, URL-encoded so the link's own
`?`/`&` and the newlines cannot become wa.me query structure. With no usable number it falls back to
WhatsApp's contact picker rather than erroring. The WhatsApp button is strictly a shortcut over the
copy path — the link stays selectable and copyable if WhatsApp will not open — and the token is
rendered, copied and drafted but never logged.

### Validation
`pnpm typecheck` · `pnpm lint` · targeted units (sidebar-shell 24, whatsapp 4, i18n 20, format) — all
green. Full E2E deliberately NOT re-run.

**Real browser (Chrome, local dev), confirmed visually:**
1. Expanded — hovering a nav item paints the whole row; active is clearly stronger. ✔
2. Expand-on-hover — after the reveal, same full-row highlight. ✔
3. Collapsed — icon tile lights, rail still coherent. ✔
4. Bottom control — pointer over empty footer paints NOTHING; pointer on the tile lights the tile. ✔
   (Verified in expanded/light; the collapsed re-check was blocked by the Next dev-overlay badge
   sitting over that corner, and the unit tests assert the wiring in all three modes.)
5. AR/RTL — mirrored, hover and active correct. ✔  6. Light + Dark — both. ✔
7. Phone invitation shows exactly "نسخ رابط الدعوة" + "الإرسال عبر واتساب". ✔
8. `wa.me/201002003040?text=…` — normalized number, real org name ("Zayed Home Showroom"), absolute
   `/auth/invite/…` URL, 3-line Arabic template, correctly encoded. ✔

**Environment note:** a `tailwind.config.ts` change needs a dev-server RESTART; touching
`globals.css` is not enough, and the utility silently stays missing until then.

### Follow-up: the scrollbar gutter is gone — thumb only
Global, both axes, both themes. The track was a permanent 10px stripe down the edge of EVERY scroll
container — the page, the sidebar, each table, dropdown and rail — and nested containers stacked
those stripes into seams that read as borders nobody drew. `::-webkit-scrollbar`,
`::-webkit-scrollbar-track` and `-track-piece` (Blink paints the piece above and below the thumb
separately, and omitting it puts the gutter back in some builds) are all transparent now, and
Firefox's `scrollbar-color` takes `transparent` as its track half. The `--scrollbar-track` tokens are
deleted rather than left unused, so nothing invites their return.

Unchanged on purpose: the 10px width (the bar still RESERVES its space, so nothing reflows when a
container becomes scrollable), the thumb colours and their hover/active step, the pill radius and the
2px transparent inset border, the hidden stepper arrows, and every scrolling behaviour.

Verified in Chrome: injected a deliberately over-flowing box and read it in both themes — horizontal
and vertical thumbs only, no track, no arrows, container surface showing through the gutter; plus the
real sidebar and page bars in light. typecheck, lint, 315 unit tests green.

## Session · One shell: full-width top header, sidebar beneath it
**Branch** `feature/supply-side-b2b-mvp` · **PR** #34 (updated, NOT merged) · frontend only

### The hierarchy was inverted, and the brand paid for it
The header used to be a child of the CONTENT column, so the sidebar was the page's top-level element
and the header a component of one region inside it. That is backwards — the header is global chrome,
the sidebar navigates the region below it — and it had consequences: the brand lived in the sidebar,
so a collapsed rail reduced the product's mark to a 26px glyph and a `brand` prop existed purely to
decide which component was drawing it.

Now, on **all three** authenticated surfaces (B2B workspace, personal `/home`, Admin console):
header → then a row of sidebar/rail + main. The header spans the viewport, always carries the mark
(a link to `/`), and `--app-header-h` (3rem) is a token because two things must agree on it — the
header's own height and the sticky offset/height of the rail beneath it.

### Supabase-direction density, Aladdin tokens
One 48px row; 28px controls; breadcrumb `/` separators (`HeaderSeparator`) between the mark, the
workspace and the branch — the branch is a scope INSIDE the organization, so it reads as the next
crumb, not a second unrelated chip. The workspace trigger lost its border and its second line (the
org type moved into `title`, still reachable, no longer costing a two-line control); the branch
control is a 28px select or a plain label; search is 28px and narrower. Their hover states now
actually paint, via `surface-hover` — every one of them was carrying a dead `/60` modifier.

### The theme control is one icon again
`ThemeSwitch` — the control the auth, onboarding, business-creation and settings surfaces already
used — is what the header carries, with a `compact` variant for the 48px row. The two-segment pill
(`theme-toggle.tsx`) is deleted. ThemeSwitch was rewired to `useThemeState` + `applyThemePreference`
first: its old local-state-at-mount is exactly the defect fixed in 742f599, and promoting it into the
header unfixed would have brought the disagreeing-controls bug back with it. e2e updated to press one
button twice rather than two segments.

### NOT built, because there is nothing real behind them
- **Chat** — no messaging model. No table, no query, no component, nothing in git history.
- **Notifications** — same. `src/features/notifications/` is an empty scaffold (a README only).
- **System Points** — no points model anywhere: not in `supabase/migrations` (33 tables, none), not
  in the frontend, not in history. The only "points" in the codebase are chart data points.
The brief itself said to use real data only and invent no counters, so each of these would have to be
a control that opens nothing. `actions` (header) and the nav module list (sidebar) are the slots they
belong in the moment the data exists. **Help** WAS added: it points at `/auth/support`, which exists,
stays reachable while signed in, and shows a real support contact or an honest unavailable state.
**Feedback** was not: there is no feedback destination to point at.

### Trade-off taken deliberately
`/home`'s header row was constrained to the 1120px content column (a fix from an earlier round, so the
avatar did not sit at the window edge while content started inboard). "Spans the full viewport width"
overrides that: one shell, one geometry, on every surface.

### Validation
typecheck · lint · 315 unit tests — green. Full E2E not run.
Real browser: **B2B** (light EN, dark AR/RTL) — header 49px full-bleed, sidebar top exactly 49px,
brand in the header, breadcrumb separators, mirrored correctly in RTL. **Admin** (light) and
**personal /home** (dark) — same shell, rail top at 49px, one-icon theme switch showing the theme you
would GET. Admin/home were driven headlessly against the running dev server in a throwaway context,
so the acceptance browser session was untouched.

### Follow-up: Chat, Notifications and Points as UI SHELLS (no backend, by instruction)
Scope decision taken by the product owner mid-round: build the three entry points now, attach data
next sprint. No migration, no table, no RPC, no realtime subscription, no local persistence, no
hardcoded demo record was added — and none may be until the persistence sprint.

- **Header** — `components/layout/header-panels.tsx` mounts `ChatMenu` and `NotificationsMenu` in the
  SHARED `AppHeader`, so every authenticated surface gets both and no persona has its own copy. One
  `HeaderMenu` primitive owns everything that is not content: trigger, panel, outside-click and
  Escape to close, `aria-haspopup`/`aria-expanded`, `role="dialog"` + accessible name, RTL anchoring
  (`end-0`), and a `max-w-[calc(100vw-1.5rem)]` clamp so a 320px panel cannot overflow a phone. Each
  opens a FINISHED empty state — "No conversations yet" / "No notifications yet" — and **no badge or
  count**, because every number available today would be invented.
- **Sidebar** — `points` is a real nav key (`nav.points` · "Points" / "النقاط", `GaugeIcon`) in the
  Business section of BOTH stances, ungated (`NAV_CAPS.points = null`): points are the caller's own
  standing, not an organization record, so no capability could sensibly decide who may look. It is
  also registered in the command palette, like every other module.
- **`/b2b/points`** — page shell with the same honest empty state. No balance, no tier, no rewards,
  no transactions, no leaderboard.
- **Next sprint attaches here:** replace `<EmptyPanel/>` with a list and pass a real count to
  `HeaderMenu`; fill the Points page body. Neither the trigger, the panel mechanics, the nav entry
  nor the route moves.

**Feedback** is still absent: unlike Help (`/auth/support`, a real destination), there is nothing for
it to open, and it was not among the three shells requested.

**Validation:** typecheck · lint · 315 unit tests green (the ungated-nav test now pins `points`).
Real browser: EN/light and AR/RTL/dark — both panels open with translated empty states, Escape closes,
the panel stays inside the viewport in both directions, the Points entry shows its active state, and
the page renders in both locales.

---

## Global shell closeout — Feedback, live opacity tokens, fluid content column (`349ad7f`)

Final pre-UAT pass on `feature/supply-side-b2b-mvp` (PR #34). Three items only; no supply-side
business logic, no schema, no migration, no RLS touched.

### Feedback — the shell of a COMPOSER (the note above is now superseded)
Mounted in the shared `AppHeader` beside Chat and Notifications, on the same `HeaderMenu` primitive,
so all three behave identically (Escape, outside click, `role="dialog"`, RTL anchoring, phone clamp).
Chat and Notifications are inboxes, so their honest shell is an empty state; Feedback has nothing to
be empty OF, so it shows the composer it will become — heading, field, submit — with sending plainly
marked as not open. **No counter, no history, no persistence, no claim of submission.**

Two deliberate a11y choices: the textarea is `readOnly`, NOT `disabled`, because a disabled control
leaves the tab order and takes its `aria-describedby` explanation with it — a keyboard or screen
reader user would meet an apparently empty panel. The BUTTON is genuinely `disabled`, which is what
a control that cannot act should be. The `/auth/support` link is included because it is the one path
that works today; a shell that only says "not yet" is a dead end.

**Next sprint attaches here:** a server action on the form plus dropping `readOnly`/`disabled`. No
header geometry moves.

### Opacity modifiers on token colours were DEAD — fixed at the root
`bg-surface-2/60`, `bg-accent-solid/15`, `bg-danger/10` and ~40 more **emitted no CSS rule at all**.
Tailwind cannot split `var(--surface-2)` into channels at build time, so it dropped each utility
SILENTLY — no warning, no error, just an element with no background. Proven by compiling a probe:
`.bg-surface-2` was emitted, `.bg-surface-2\/60` was not.

Fix is one helper in `tailwind.config.ts` — every token resolves through
`color-mix(in srgb, var(--t) calc(<alpha-value> * 100%), transparent)`, using Tailwind's own
`<alpha-value>` substitution (`/60` → `0.6`, absent → `1`). **46 dead utilities returned with the
alphas the code always intended: zero token edits, zero class rewrites.** `color-mix` composites
against the ACTIVE theme's token, so one rule is correct on Limestone and Carbon alike — which a
hardcoded rgba fallback could never be. Applied to semantic, series AND brand primitives so no
future `/NN` can quietly evaporate.

Restored: admin navigation · sidebar mode menu · profile menu (items + language/appearance
selection) · workspace switcher · table header and row hover · cards and every soft badge tone ·
collapsed active rail tile.

**A latent inversion surfaced once the rules compiled.** In the sidebar mode menu and the workspace
switcher, `hover:bg-*` sat alongside a conditional `selected && "bg-accent-solid/10"`. A hover
variant always outranks a base utility in the emitted sheet, so a selected row would have washed to
grey under the pointer — invisible before only because NEITHER rule existed. Both now branch on
`selected` and deepen the accent (`/10` → `/20`) instead. Profile-menu items moved to the named
`surface-hover` so all three menus agree on one hover ground.

> **Rule for future work:** never write an opacity modifier and a conditional base background for the
> same property on one element. Branch on the state instead.

### Content column — fluid, not a laptop-era literal
`<main>` carried three hardcoded caps (1200 / 1120 / 1200) in three files. On a 1874px display that
left ~600px of dead margin around the densest content in the product. New
`components/layout/content-column.ts` replaces all three with `contentColumnClass`: fluid between
sidebar and viewport edge, padding opening 16 → 24 → 32px, and a 1920px cap that engages only on
ultrawides. Measured: B2B main 1200 → **1808px**, `/home` 1120 → **1864px**, Admin fluid, with
**0px horizontal overflow** everywhere (tables already scroll inside their own container).

Forms do NOT inherit that width. `readableColumnClass` (768px) is for single-column data entry, and
the two in-shell forms that had no measure of their own — showroom referral, org invite — now take
it. The shell uses the display; the form stays fillable. The full-width `/home` header is unchanged.

**Validation:** typecheck · `eslint .` · 315/315 unit tests green. Real browser, real Email-OTP
sign-in (no bypass), three identities: B2B English Light + B2B Arabic Dark RTL (`rania@`), Admin
(`admin@`), personal `/home` (`consumer@`). Feedback opens/closes and anchors inward in RTL; admin
nav hover now paints and is clearly lighter than the active fill; selected rows keep their accent
under hover; dark tints stay subtle. Per instruction: no full E2E, no pgTAP, no perf, no persona
matrix. Only console error is a Grammarly extension hydration mismatch — environmental, pre-existing.

---

## Supply-side dashboard — visual fidelity against the Distributor reference

**Scope:** the shared Distributor / Manufacturer / Importer dashboard only. Global shell frozen — no
change to header, sidebar, scrollbars, CardRail, theme, search, profile menu, Chat/Notifications/
Feedback/Points shells, `contentColumnClass`, invitations or the Tailwind colour architecture.

### The problem, stated precisely
The page was functionally right and structurally a Showroom dashboard: it used the MODULE page's
shape — a wide list column with a fixed `18rem` context rail (`WorkPane`). Measured on a 1874px
display: the rail held **300px of content inside a 790px row**, so ~490px × 288px of the page was
blank from its last panel down. Nothing on the page was unavailable elsewhere, so nothing led.

### What changed
**Rows, not a column with a rail.** New `Row` + `Panel fill` in `workspace-layout.tsx`. `Row` takes
PROPORTIONS (`lead` 1.55:1, `wide-lead` 2.5:1, `even`, `thirds`) rather than a rem aside, so the
operational block absorbs a wide display and gives the room back on a laptop — a fixed rail can do
neither. `fill` makes panels in a row end level. Both are opt-in; `WorkPane` is untouched and the
rfqs / quotations / orders module pages are unchanged.

**The attention queue (`features/home/supply-attention.tsx`) — the one genuinely new block.** A
cross-stage triage list: requests nobody priced → prices nobody chased → accepted prices with no
order → orders nobody progressed. No module owns that list, which is why it belongs here and nowhere
else. Drawn as the reference's wide row cards (severity rail, labelled cells, per-row verb) rather
than a table, because a table forces ONE header per column and these four record types have four
different dates ("Required by" / "Valid until" / "Accepted on" / "Confirmed on") and four different
jobs. Ordered by STAGE — the order a seller works — because "soonest first" across a required-by, a
valid-until and a confirmed-on compares nothing. Three per stage, six total.

`quotationsWithOrders()` (execution queries) makes "ready for order" exact: accepted quotation ids
are asked about directly rather than inferred from a capped order page, where an old acceptance would
read as "ready" forever. On the seed data it correctly returns **empty** — all four acceptances have
orders.

**Pipeline panel** replaces two stub cards: demand / quotations / orders statuses grouped under stage
captions, each row carrying a proportion bar (`PanelRow share`) — share of its OWN stage, never of
the page. Catalogue state moved to the new `Panel foot`, because as a fourth bar group it made the
SUPPORTING panel taller than the operational queue beside it, inverting the row's whole point.
Measured after: queue 423px / pipeline 426px, row 709 → **568px**, so head + KPIs + the entire
attention band now fit the first viewport.

**Rows 2–4.** Incoming demand and latest quotations as peers side by side; trend (lead) beside the
funnel; top products / top customers / quotations-by-status three-up and level.

### Two real defects found by measuring, not by looking
1. **Columns did not line up.** The attribute block had no `min-w-0`, so a flex item defaulted to
   `min-width: auto` = its content's minimum: a row carrying "EGP 628,800.00" refused to shrink to
   its basis while a row without a money cell shrank freely. Rows landed on different vertical lines.
   Fixed; verified identical lefts across all six rows at 1440 / 1600 / 1920 in both locales.
2. **Arabic clipped the identifying half of every Latin name.** `text-overflow` clips at the end of
   the element's own direction, so in the RTL workspace "Cairo Ceramics Showroom" rendered as
   "…ics Showroom" and "Basins - New Cairo apartments" as "…sins - New Cairo apartments". Titles and
   counterparties now CLAMP (line box) instead of truncating, so the beginning survives in either
   script. Dates and money still truncate — a wrapped "EGP 132,000.00" reads as two numbers.

The counterparty also moved from its own column into the record's second line (as every other list in
the workspace already does via `RecordCell`): as a column it was the longest value in the row, so it
set the floor for every other cell. The single-line row now engages at `wide` only; below that it
uses the same stacked form the phone gets, which is readable at any container width.
`QuotationTable` gained `compact`, which drops the counterparty column that was ALREADY the record
cell's meta line — in a half-width panel that duplicate forced every cell to wrap over three lines.

### What was NOT added
No wallet, invoices, collections, payments, carrier tracking, maps, Reels, message or notification
counts, AI recommendations, rewards or commissions. **No comparison-period percentages** — nothing in
this database produces one, and the reference's "+18% from last month" badges have no honest
equivalent here. The page is denser because real records are organised better.

### Validation
typecheck · `eslint .` · 81/81 dashboard-related unit tests (includes exact EN/AR key parity, "no
Arabic in the English catalog", "no unintended English in the Arabic catalog"). Real browser, real
Email-OTP sign-in, no bypass: **`rania@` (Distributor) Arabic desktop Light AND Dark** as primary,
plus `mahmoud@` (Manufacturer) English and `fady@` (Importer) Arabic — all three inherit the same
composition, differing only in organization identity and org-type voice. Instrumented for truncation
and overflow at 1280 / 1440 / 1600 / 1920: **zero truncated elements, zero horizontal overflow**. One
mobile viewport (390px) checked for breakage only — stacks correctly, `scrollWidth === clientWidth`.
Per instruction: no full E2E, no pgTAP, no perf, no persona matrix.

## Supply dashboard — eight modules, a period scope, and the real logo

Branch `feature/supply-side-b2b-mvp`, PR #34, not merged. A focused refinement pass on the
Distributor / Manufacturer / Importer dashboard only — one shared implementation, no second surface,
no route deleted.

### The composition problem, stated honestly

The previous version answered five questions in sequence and gave each a full-width band. It was
correct and it was four screens long, which for a surface whose whole purpose is the morning glance
is a design failure that no amount of per-block polish fixes. It also **transcribed two modules onto
the home page**: the incoming-requests table and the quotations table repeated, in full, lists that
are one sidebar click away — while the attention queue directly above them had already named the rows
that needed work.

The page is now **eight modules on four rows**, and every one of them says something no module page
says: ROW 1 the period-scoped strip · ROW 2 `ينتظر تصرفك الآن` + `فرص جديدة مناسبة لك` · ROW 3
`حركة السوق` + `أحدث الإشعارات` + `مسار عملك` · ROW 4 `فيديوهات لمنتجاتك` + `أعلى منتجاتك` +
`أعلى عملائك`. The two duplicated tables, the value trend, the funnel, the quotations-by-status
breakdown, the fulfilment band and the next-steps row are gone from the DASHBOARD. **No route,
query or feature was removed.**

### The comparison percentages, which used to be refused

The last pass recorded "no comparison-period percentages — nothing in this database produces one".
That was true of the QUERY, not of the data. `supplySummary` already pulls every request, quotation
and order in order to tally them by status, and those rows carry `created_at` / `confirmed_at`. Two
windows over rows already in hand is arithmetic; adding one column to two `select` lists was the
entire cost. `compareDays` → `PeriodComparison`, and the strip renders `↑٤٠٪ من الشهر الماضي`.

The rule that keeps it honest is in `KpiDelta`: a delta renders **only** where a real previous window
with a **non-zero baseline** exists. First month of trading gets no percentage — not 0%, not ∞%, not
"new" dressed up as growth — and the tile silently falls back to its context line. Orders are dated by
`confirmed_at`, not `created_at`: confirmation is when the money became real, and dating won business
by creation would credit a deal to the month it was drafted.

Four cells are period-scoped FLOWS; the fifth (`طلبات تنتظر السعر`) is a live STATE and deliberately
carries no delta — it would be false to shrink an unanswered six-week-old request because the reader
chose a 30-day window. Period lives in the URL (`?period=`), so it survives a reload and is shareable.

### The four blocks whose honest form is an empty state

`supply-blocks.tsx`. The reference's opportunity feed is a cross-marketplace matching engine, its
market panel a regional demand index, plus a notification stream and a Reels rail with view counts.
This repository has **no matching engine, no market data provider, no `notifications` table and no
video model** (`products` carries one `image_ref`). Each block is therefore rebuilt on the one dataset
that is real — the requests buyers addressed to this org and the lines inside them — and where even
that does not exist it renders an empty state that says so. `حركة السوق` counts **distinct requests**
per product, never lines (a request itemising SPC twice is one business asking once), and its bars are
a share of the BUSIEST product rather than of the window's total, because one request naming four
products counts once for each and a "% of all demand" would exceed 100%. `مسار عملك` is explicitly
**not a funnel** — this month's orders came from last month's quotations — so each bar is a share of
the largest stage, never a conversion rate.

### Iris — a second accent, because one was measurably not enough

Lumen (amber) is the ACTION colour and earns that by being the only warm high-chroma note. Building a
real operational dashboard out of it made every icon tile, bar, ranking and panel glyph amber, so the
page read as one enormous call to action with no ranking inside it. `--iris` (#5b4ad9 / #9b8cf5 dark)
is a MEASUREMENT colour, not a second brand colour. The single largest lever was the nine
"more" links: as `text-accent` they were nine amber calls to action for what is navigation. Amber is
now spent only on the primary button and the warning/danger tones.

### Four defects found by measuring, not by looking

1. **Every date in the queue truncated** (`١٠ سبتم…`, `تاريخ الت…`). The queue switches to its
   single-line row form at the `wide` VIEWPORT breakpoint, but that form needs a CONTAINER of ~800px;
   a 3:2 track at 1440 gave it ~700px. Row 2 is now `wide-lead` (5:2) → ~820px, every cell whole.
2. **The RTL start-clip, again, in the new block.** `line-clamp-1` cuts at the end of the element's
   own direction, so in the Arabic workspace "New Cairo Design Studio" rendered as `…ew Cairo Design`
   — not a shortened name but a different one. Opportunity fields now wrap over two lines.
3. **Empty states left ~150px voids.** `StatePanel` is a fixed-height page-level box sitting at the
   top of a panel that stretches to match a taller neighbour. `BlockEmpty` fills and centres instead.
4. **The iris KPI tiles looked unrendered** beside their neighbours — 12% alpha where the others had
   15%. Raising everything to a single 18% removed EVERY tile background on the strip instead, because
   Tailwind's opacity scale runs in steps of five and an off-scale `/NN` emits no rule at all,
   silently. Sampling the rendered pixels found it; a grep then found **14 dead classes**, including
   the whole `Panel` header-wash feature (`/8`), which had never rendered since the day it was
   written — the tone prop was threaded through every panel and did nothing. All on-scale now, and
   `styles/opacity-scale.test.ts` fails the build on any future off-scale modifier. This trap has now
   cost this repository visible UI three separate times.

### Logo

`logo.png` (1254×700, gold lockup) → `frontend/public/brand/aladdin-logo.png` (384px lockup) and
`aladdin-mark.png` (192px emblem), both trimmed to their content box and downscaled with a
premultiplied-alpha box filter by a one-off pure-Node script (no dependency added; `zlib` is built
in). The emblem is cut at the lamp foot: below y≈576 the wordmark's letter apexes sit INSIDE the
emblem's x-range, so a naive alpha-bbox crop left specks. `Brand` now draws the emblem via
`next/image` beside the **localized** name — using the whole lockup would put a Latin wordmark in the
Arabic UI and print the name twice in the English one. The auth/onboarding `ApertureMark` panels are
out of this pass's scope and unchanged.

### Validation

typecheck · `eslint .` clean. Unit: **14 new** (`demand-signals.test.ts` proves distinct-request
counting, window splitting and the unpriced-only rule; `period.test.ts` proves the URL resolver
rejects junk and that "all time" yields no window; `opacity-scale.test.ts` guards the trap above) plus the i18n parity/《no Arabic in EN》suite green.
Real browser, real Email-OTP, no bypass: `rania@` Arabic Light **and** Dark, `mahmoud@` English,
`fady@` Arabic, and one 390px phone — all eight module headings asserted present per seat, Arabic-Indic
vs Western digits asserted per locale, `scrollWidth === clientWidth` at every stop.

**The one finding that is a real defect and is NOT fixed here.** Driving the period select or a stage
chip and waiting for the URL to change was never dependable — it failed at three different points
across three runs. The controls are not broken: instrumented directly, a chip click does land
`?stage=price` and the select does land `?period=90d`, each with a 200 RSC response. The problem is
HOW LONG it takes. Both navigate to the same route with a different query, which is a full server
render of a `force-dynamic` dashboard behind seven Supabase queries, and the URL does not move until
that render commits. To a user this reads as "I clicked and nothing happened".

Three attempted fixes were wrong and were reverted rather than left in the tree: re-firing the
interaction (it cancels the in-flight RSC request and restarts the clock — it turned an occasional
failure into three-out-of-three), removing `useSearchParams()` from `period-select.tsx` on a
Suspense-deopt theory (it broke that control the same way), and a hand-rolled `QueryLink` on the
theory that `<Link>` refuses query-only navigations (it does not). **The dashboard's render cost is
the actual bug**, and it wants a pass of its own — the seven queries, and ~30 prefetchable links each
pulling the whole page.

The acceptance test therefore asserts the CONTRACT — that the server reads both parameters, that they
compose, that a filtered queue really is filtered, and that every chip's `href` is exactly the URL
being driven — rather than the latency of a synthetic click. 5/5, no retries, twice consecutively.

Per instruction: no full E2E, no pgTAP, no Lighthouse, no persona matrix.
