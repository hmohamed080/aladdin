# Overall Match and the scalable Jobs board

Status: implemented on `feature/installer-production-jobs-work`. The Batch 1B migrations are a clean, chronological set
with no create → replace → drop churn (`20261006090001`–`06` saved jobs, saved searches, the place catalogue, assignment
contacts, work contacts, My Work paging; `20261007090001`–`06` specialties, service areas, availability windows,
canonical job location, Overall Match, the paging functions). pgTAP `66`–`77`. Companion to
[`installer-jobs.md`](./installer-jobs.md).

## 1. Why the board was rebuilt

The board used to read `open_job_opportunities`, a view over `app._open_job_opportunities()` — a SQL function that is
`SECURITY DEFINER` and carries a `SET search_path`. Postgres never inlines such a function, so every request first
built the **whole** discoverable set (jobs ⨝ trades ⨝ verified organizations, plus a per-row `EXISTS`) and only then
applied the filter, the sort and the `LIMIT`. Keyset cursors made the result stable, not cheaper: page 20 cost exactly
what page 1 cost, and "Nearest" re-resolved free-text places for every row. Measured on an isolated stack:

| Open jobs | Newest page | Nearest page | Saved page | Filtered page |
|---|---|---|---|---|
| 5 k  | 18 ms | 333 ms | 28 ms | 149 ms |
| 25 k | 110 ms | 1 737 ms | 135 ms | 616 ms |
| 50 k | 215 ms | 3 293 ms | 295 ms | 1 279 ms |

## 2. The paging function

`public.job_opportunities_page(...)` is **one statement per page**: discoverability, filters, sort, the cursor and
`LIMIT` are all inside it, against the real `jobs` table, so the planner walks a **partial index in sort order** and
stops. `public.job_opportunities_total(...)` is a separate count, asked for once per question (first page, filter
change, sort change, Saved/All switch) and kept by the board while later pages append.

* **Identity** is `auth.uid()`; no user parameter exists.
* **Discoverability** is a separate, always-applied predicate (`status = 'open'`, poster verified, active, not
  deleted). A cursor only narrows the sort position.
* **Orderings** (all keyset, id last): `newest` · `oldest` · `highest` (pay) · `nearest` (location tier) · `best`
  (trade + specialty rank). `nearest` and `best` are **segmented by tier**: each tier is its own index-ordered scan with
  its own limit, and a later tier is only touched if the earlier ones did not fill the page.
* **The cursor is a ROW-VALUE comparison** (`(published_at, id) < ($17, $18)`), which Postgres can use as an index
  condition. The textbook `OR` expansion cannot — it is applied as a filter, so a deep page reads and discards
  everything before it. (Found by EXPLAIN during this work: 475 rows removed by filter at page 20.)
* **Saved** drives from the caller's own saved set (`id = any(array(select job_id from saved_jobs …))`), so its cost
  follows the size of that set, not of the board.

Indexes (all partial on open jobs): `ix_jobs_open_published`, `ix_jobs_open_amount`, `ix_jobs_open_gov`,
`ix_jobs_open_gov_city`; `ix_jobs_open_trade` already served trade filters.

Result (same stack, same data shape): every sort, filtered or deep, is **5–10 ms at 5 k, 25 k and 50 k** with ~250–330
buffers; only the once-per-question count grows (19 ms at 50 k).

### Cursor hardening

The cursor is **continuation state, never authority**. `server/pagination/cursor.ts` validates version, sort, every key's
type and range (Near me tier 0–3, amount a finite number), the id format, a 600-character cap and a hash of the filter
question, and the database re-validates its own parameters. It is not signed: authorization lives entirely in the
database (discoverability is applied to every page whatever the cursor says, pgTAP `75` §D), so a forged cursor can at
worst show the caller a different slice of rows they already may see. An HMAC would protect nothing that matters.

## 3. Canonical location

`jobs.governorate_key` / `jobs.city_key` store keys of the **existing** Egypt catalogue (`app.place_governorates` /
`place_cities`) — no second taxonomy. Backfill is deterministic (exact normalised match only); unresolved legacy rows keep
their raw text and have NULL keys. New and edited jobs choose a governorate then a city; `job_create` / `job_update`
refuse text the catalogue cannot resolve (`22023`). Sending **no** location on update leaves the existing one untouched
(so editing a legacy job never erases it). A `BEFORE INSERT/UPDATE` trigger derives keys for non-RPC writers (seeds,
psql) and never guesses.

## 4. Overall Match — one authority

`app.job_match_rows(user, jobs[])` (single-job wrapper `app.job_match_for`) — executable by no client role; reached only
through `job_opportunities_page` (every card, the dashboard) and `job_matches` (job detail), both keyed by `auth.uid()`.

| Component | Points | Rule |
|---|---|---|
| Trade | 50 | the job's trade is one of the caller's trades |
| Specialty | 20 | **only when the trade matches**: required specialty held → 20, missing → 0, none required → 20 |
| Location | 15 | same declared city 15 · primary governorate 10 · another declared service area 5 · outside 0 |
| Availability | 15 | **Three-state** (below). Declared available: no job dates → 15 · a job window fully inside the union of declared windows → 15 · else 0. Declared unavailable → 0. **Not declared → no points, reported as "not specified".** |

Availability uses the job window `[coalesce(starts_on, ends_by), coalesce(ends_by, starts_on)]` — one boundary is a single
day, the same semantics My Work's planned-window filter uses. Overlapping or touching windows are merged (a
`datemultirange`). `expected_duration_days` is a length, not a position, and is not used.

### Availability is a three-state fact: unknown is not unavailable

`profiles.available_for_work` is `NOT NULL DEFAULT false`, so the boolean alone cannot tell "I said no" from "I never
said". The authority that can is `profiles.availability_updated_at`, which already existed for exactly this ("NULL
means the professional has never set availability") and is stamped by `app.stamp_availability()`:

| State | `available_for_work` | `availability_updated_at` |
|---|---|---|
| AVAILABLE | `true` (a true can only ever be a choice) | set |
| UNAVAILABLE | `false` | **set** (explicitly declared) |
| NOT DECLARED | `false` | `NULL` (the default nobody touched) |

Nothing is inferred from `false`. One gap was closed in `20261007090003`: the stamp trigger used to fire only when the
value *changed*, so the very first explicit "I am not available" (false → false) left the stamp NULL and was
indistinguishable from never answering. It is now `BEFORE UPDATE OF available_for_work … WHEN (value changed OR the row
has never declared)`, so declaring "unavailable" is recorded, while a headline edit or a re-assertion of an already
declared value is not. The stamp is still derived by the trigger, never accepted from a caller.

**Scoring of NOT DECLARED (provisional — awaiting product confirmation).** `availability_points` is `NULL` (not 0),
the reason is `availability_not_declared`, and `overall_percent` is the points actually earned out of 100, so a caller
who has not said whether they are available can reach at most **85** until they do. Nothing is invented and nothing is
normalised; the UI shows the line as **"Not specified"** (never "0/15", never worded as unavailable), explains that the
score counts only the points earned so far, and links to where availability is set. The alternative considered is to
re-scale over the 85 assessable points (`round(100 × earned / 85)`); it is a one-expression change in
`app.job_match_rows` if product prefers it, but it makes a percentage that no longer sums to its parts.

**Reason codes** (stable machine strings; the frontend localises them in `lib/installer/overall-match.ts`):
trade `trade_matches | trade_mismatch | no_declared_trade` · specialty `specialty_matches | specialty_missing |
no_specialty_required | trade_mismatch` · location `same_city | primary_governorate | other_service_area |
outside_service_area | no_service_area | job_location_unknown` · availability `not_available_for_work |
available_no_dates | window_covers | window_not_covering | no_window_declared`.

**Not authorization.** No policy, view, write path, gate or eligibility rule reads the match; a 0 % job stays
discoverable, openable and applicable (pgTAP `74` §G; `server/queries/match-non-authority.test.ts` on the application side).

### Two orderings that are deliberately NOT the Overall Match

* **Near me** — location only: tier 0 same city, 1 primary governorate, 2 another declared area, 3 the rest.
* **Best match** (the dashboard's "مناسب لمهاراتي") — trade + specialty only: rank 0 (trade + specialty, 70), 1 (trade
  only, 50), 2 (neither). Location and availability do not enter.

pgTAP `75` §E proves both orderings agree with the canonical match per row.

## 5. The authorities the match reads

* `user_trades` — trades (existing).
* `trade_specialties` / `user_trade_specialties` / `jobs.required_specialty_id` — detailed specialties, strictly
  child-of-one-trade (composite FKs make "belongs to this trade" a property of the data). **The migration seeds no
  specialty names**; every surface stays hidden until a product-approved migration adds them.
* `user_service_areas` — canonical multi-governorate service areas (catalogue keys, one primary governorate row).
  Backfilled from `individual_onboarding`, and kept in step both ways (an onboarding save rebuilds only the primary
  governorate group; the canonical writer mirrors the primary group back).
* `user_availability_windows` — the caller's own date windows (own rows only under RLS; professional identity only).

## 6. Dynamic SQL — security review

`job_opportunities_page` and `job_opportunities_total` assemble their statement with `EXECUTE`, because optional
predicates written as `($3 is null or j.x = $3)` defeat the partial indexes. That is only acceptable if no
caller-supplied text can become SQL structure. Every interpolated or bound item, classified:

| Item | Reaches the statement as | Class |
|---|---|---|
| `p_sort` | never concatenated; validated against the fixed list `newest / oldest / highest / nearest / best` (else `22023`), then **selects** a fixed literal `ORDER BY`, cursor predicate and tier segment | strict allow-listed enum → fixed literal |
| the `ORDER BY` / direction / column names | fixed literals chosen by the allow-listed sort | generated internally |
| tier segment (`nearest`, `best`) | fixed literals chosen by the sort and an integer loop variable | generated internally |
| filter fragments | fixed literals from `app._job_opportunity_filter`, selected by booleans (`is X supplied`) | generated internally |
| `p_search` | `$1`, an escaped `ILIKE` pattern (`%`, `_` and `\` neutralised); length ≤ 200 | **bind parameter** |
| ids of organizations whose name matches the search | `$10`, a typed `uuid[]` computed first through organizations' own trigram index | **bind parameter** |
| `p_trade_keys` | resolved to trade ids, then `$2`; ≤ 50 keys | **bind parameter** |
| `p_governorate_key`, `p_city_key` | `$3`, `$4`; length ≤ 64 | **bind parameter** |
| `p_min_amount`, `p_max_amount` | `$5`, `$6`; typed `numeric` (text cannot be smuggled in) | **bind parameter** |
| `p_min_duration`, `p_max_duration` | `$7`, `$8`; typed `smallint` | **bind parameter** |
| `p_applied`, `p_saved` | choose a fixed fragment; the caller id is `$9` (`auth.uid()`) | typed boolean → fixed literal / bind |
| the cursor (`p_after_*`) | `$18`–`$20`; typed `uuid` / `timestamptz` / `numeric`; all-or-nothing; tier ranges checked | **bind parameter** |
| page size | `limit $21` (an integer, 1–101 validated first) | **bind parameter** |
| the caller | `auth.uid()` only; no user parameter exists | — |

**Zero** items are unsafe or untrusted interpolation. Nothing is passed through `format()` or `quote_*()` — there is
nothing to quote because nothing is interpolated. pgTAP `77_job_opportunities_injection_test.sql` (61 tests) enforces it
two ways: **structural guards** (no input parameter may appear inside a `||` concatenation; no `format`/`quote_*`; every
`EXECUTE` carries `USING`; the LIMIT is bound; the sort allow-list precedes any assembly; the functions pin an empty
`search_path`; only `authenticated` may call them) and **hostile values** (quotes, comment markers, semicolons, stacked
statements, `UNION` payloads, LIKE metacharacters and a lone backslash, oversized text, OR-tautologies in every key,
text in every numeric/boolean/uuid/timestamp parameter, injected `ORDER BY` expressions and real column names as the
sort, bad page sizes, malformed and half cursors, forged cursors aimed at hidden jobs, anonymous callers). The tables
are unchanged afterwards, and a hostile cursor never reveals a draft, closed or unverified-poster job.

The dynamic form is kept because it is what lets the planner walk a partial index in sort order and stop (5–7 ms per
page at 50 000 open jobs); a static `OR`-ed predicate cannot.

**What `supabase db lint` reports for these functions.** Exactly 30 `extra` warnings on `job_opportunities_page`, every
one of the form `OUT variable "<column>" is maybe unmodified`, and nothing on `job_opportunities_total`. They are not
security findings: `plpgsql_check` cannot see that `RETURN QUERY EXECUTE` fills the `RETURNS TABLE` columns, so it
reports each output column as never assigned. The linter raises no dynamic-SQL, injection or `format()` finding for
either function. (The only other warnings in `public` / `app` are on four older functions this work did not touch:
`business_save`, `job_cancel`, `organization_activities_set`, `set_customer_ownership`.) Returning a named composite type
instead of `RETURNS TABLE` would silence them, at the cost of a new public type; it was judged not worth it.

## 6a. Free-text search is indexed (pg_trgm)

The board's search is exactly `title ILIKE '%term%' OR description ILIKE '%term%' OR <poster organization name> ILIKE
'%term%'` (term bound, `%`/`_`/`\` escaped, ≤ 200 characters). A leading-wildcard `ILIKE` cannot use a btree, so every
rare or no-result search, and every exact total, read the whole open set — linear, ~415 ms at 50 000 jobs.

* `pg_trgm` was **already enabled** (`extensions` schema, base migration) and `organizations.name` already had a trigram
  GIN index. New: two **partial** trigram GIN indexes on open jobs, `ix_jobs_open_title_trgm` and
  `ix_jobs_open_description_trgm` (partial on `status = 'open'`, the only jobs the board searches).
* The organization-name branch used to read the JOINED table, which a `BitmapOr` over `jobs` cannot combine with the two
  job-column branches. It is now the same predicate expressed as the set of matching organization ids, resolved once through
  organizations' trigram index and bound as a typed `uuid[]` (`$10`), so the planner sees its real size (a subquery's size is
  a guess, and a wrong guess picked a scan). No denormalisation; semantics are unchanged and pgTAP proves equality with the
  original expression term for term (case, Arabic, mixed, `%` `_` quotes, description-only and organization-name matches).
* Arabic works: the trigram index serves Arabic text (an Arabic rare term is index-served at 0.6 ms at 50 000 jobs).

Measured on synthetic, rolled-back data (English + Arabic titles, ~300-character descriptions, ~400 organizations), the real
statement, `EXPLAIN (ANALYZE, BUFFERS)`, hot cache, local Docker:

| Term | Page / count | 5k before → after | 25k before → after | 50k before → after | 50k plan after |
|---|---|---|---|---|---|
| rare (`zx9q`) | page | 39 → 31 ms | 190 → **1.3 ms** | 408 → **0.9 ms** | BitmapOr (title, description, poster) |
| rare | count | 39 → 30 ms | 193 → **1.1 ms** | 428 → **0.6 ms** | same |
| no result | page / count | 43 / 47 → 38 / 32 ms | 219 / 214 → **1.7 / 1.6 ms** | 429 / 417 → **0.6 / 0.7 ms** | same, 119 buffers |
| Arabic rare (`كيرامكس`) | page / count | 46 / 43 → 35 / 34 ms | 231 / 215 → **1.5 / 1.4 ms** | 464 / 462 → **0.6 / 0.5 ms** | same, 112 buffers |
| common (`painting`, ~12 %) | page | 4.0 → 2.8 ms | 2.1 → 1.4 ms | 3.3 → 1.3 ms | newest-first walk (stops at 25) |
| common | count | 37 → 40 ms | 195 → 147 ms | 363 → **27 ms** | BitmapOr |
| Arabic common (`دهان`, ~12 %) | count | 42 → 34 ms | 213 → 180 ms | 428 → **46 ms** | BitmapOr |
| organization name (`Horizon`, ~1/3) | page / count | 1.0 / 40 → 0.7 / 33 ms | 0.8 / 195 → 1.5 / 175 ms | 0.9 / 406 → 0.7 / 329 ms | page: newest-first walk; count: seq scan |

End-to-end (the real `job_opportunities_page` / `_total`): rare, no-result and Arabic-rare terms cost 7.6–10 ms per page and
1.9–2.8 ms for the total at 50 000 jobs. Rows scanned for a rare term: before, the whole open set (50 000 removed by filter);
after, only the index's candidate rows (≈ 100 buffers). The 5 000-job row is the planner's own crossover: at that size it
keeps a sequential scan (bounded ~30–40 ms) and the index plan takes over from ~25 000 jobs.

Index sizes at 50 000 jobs with ~300-character descriptions: title 8 MB, description 40 MB. They are partial (open jobs only)
and add write cost proportional to the text indexed; that is the price of the index.

## 6b. "Newest" and the publication-time invariant

**Newest** is `published_at DESC, id DESC`: discoverability first, then the search and filters, then the real publication
time newest first, with the id as the deterministic tie-break. `updated_at` is never used, so editing an old job never makes it
look new. The keyset cursor is the row-value comparison `(published_at, id) < (cursor)`, so a "View more" page continues in the
exact same order. `published_at` is set by `job_publish` (draft → open) and nowhere else; `job_update` and every later status
move preserve it, and there is no reopen or republish action (a future Republish would be an explicit product decision).

**The invariant (`20261007090007_jobs_published_at_integrity.sql`).** Lifecycle, from `app.jobs_status_transition_guard`:
`draft → open | cancelled`, `open → awarded | closed | cancelled`, `awarded → completed | open`.

| State | Meaning | `published_at` |
|---|---|---|
| `draft` | never published | may be NULL |
| `open`, `awarded` | published now (awarded returns to open if its assignment is cancelled) | required |
| `closed`, `completed` | reachable only after publication | required |
| `cancelled` | legal before publication (from draft) **and** after it (from open) | not decidable from the status |

Two parts, because `cancelled` cannot be judged by its status:

1. `CHECK ck_jobs_published_at_after_publication (status NOT IN ('open','awarded','closed','completed') OR published_at IS NOT NULL)`.
2. Trigger `jobs_published_at_immutable` (`BEFORE UPDATE OF published_at`): once set, `published_at` is **immutable**. NULL → value is
   allowed (the initial publication), value → the same value is allowed, value → NULL and value → a different value are refused
   (`23514`). A published job that is later cancelled therefore keeps its exact time; a draft cancelled before publication legitimately
   has none. There is deliberately no escape hatch for a future Republish: that would be an explicit product feature with its own RPC
   and a deliberate change to this guard.

Neither depends on `job_publish` being the only writer: direct inserts, service-role scripts, imports and application bugs are all
covered. Legacy rows are repaired once, inline in the migration (no helper function is left in the runtime schema): post-publication
rows with no `published_at` get their `created_at` (never `now()`, never overwriting a value, `updated_at` not bumped). The isolated
database had **0** such rows. A legacy `cancelled` row with NULL cannot be told apart from a never-published one and is left alone.
Before this, a NULL on an open job sorted FIRST under Newest, vanished from the Oldest chain and could not anchor a cursor.
pgTAP `78` (Newest, ties, edited-old-job, full cursor walk) and `79` (the invariant, the backfill and the preserved semantics).

## 7. Known limitations

* The exact count is O(filtered set) — paid once per question, ~19 ms at 50 k; a per-user estimate or materialised count
  is the next step if boards grow past that.
* Best match for a caller holding many trades reads those trades' open jobs per tier segment (bounded by the trade's
  share of the board, not the whole board).
* `nearest` tier 3 ("the rest") scans the newest-first index and discards the earlier tiers' rows; fine while the earlier
  tiers are a minority, linear if one caller's areas cover nearly everything.
* My Work still reads one installer's own assignment history per page (linear in that history, ~40 ms at 5 000 rows).
* An EXACT count of a very broad search term is O(its matches): ~27–46 ms for a term in a sixth to an eighth of the
  board, ~330 ms when a term matches a third of all jobs (the planner correctly prefers a sequential scan there). Pages
  are never affected. Capping the count ("1 000+") would change the product's exact-total behaviour, so it was not done.
* Below roughly 10 000 open jobs the planner (correctly, at that size) keeps a sequential scan for rare terms: ~30–40 ms,
  bounded. The trigram plan takes over as the board grows.
* The specialty catalogue is empty by design: the schema is ready, the business catalogue needs product content
  approval. No placeholder names are seeded anywhere in the repository.
