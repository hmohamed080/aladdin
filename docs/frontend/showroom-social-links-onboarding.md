# Showroom onboarding: social and website links — design

**Status:** Draft for owner approval · 2026-11-05 · no code, migration or hosted change exists yet.

## Purpose
Let a new Showroom add where customers can find it online (Facebook, Instagram, TikTok, website) during business onboarding, and require at least one of them.

## Current decision (owner, 2026-11-05)
- **Where:** inside step 1 of `/onboarding/business` ("Showroom details"), as one card of four toggle buttons (option A in the review). No new step.
- **Rule:** at least one of the four is required. Showroom (`showroom_dealer`) only, like the existing business phone and activity.
- **Existing showrooms** that registered without links keep working exactly as today: no blocking, no loss of selling. The profile-completion checklist gains one item ("add a link"), so their profile reads as incomplete until they add one, the same way the missing address does.
- Links are **unverified** business information, like the contact phone and email. They are not shown to customers in this change.

## Why
Customers and reviewers need a way to check that a showroom is real. A mandatory, cheap-to-fill link also gives the Admin verification screen something concrete to open.

## Goals
- One short card: pick the platforms you have, type or paste, done.
- Same rule enforced in the screen, in the server action and in the database.
- No extra request while typing; no change to the step's load time.

## Non-goals
- No proof that the person owns the page (no OAuth, no code-in-bio, no verification badge).
- The server never opens, fetches, previews or follows these links.
- No public display (customer-facing showroom page) yet.
- No gate on approval, activation or selling because of links.
- No other account types (supplier, manufacturer, importer) in this change.

## Anti-goals (would make this a failure even if it "works")
- A page that is visibly longer or more cluttered than today.
- A link that can run script, point at an internal address, or impersonate another host.
- Blocking an existing showroom from working.
- A requirement that only the screen enforces (a direct RPC call must fail the same way).

## The screen
Step 1 order: trading name, legal name, activity, phone, email (optional), **links card**, description (optional). Required fields come first, optional last; this reorders the existing optional description below the new card (small change, flagged here).

The card:
- Header "Showroom links" with a counter ("Pick at least one" until one is valid, then "1 added").
- A row of four toggle buttons: Facebook, Instagram, TikTok, Website. Pressing one reveals one input under the row and focuses it; pressing it again hides the input (the typed value is kept).
- A button shows a check once its link is valid and a danger border if not.
- Inputs are left-to-right (`dir="ltr"`) even in Arabic; messages follow the page direction.
- Under a valid input, show the link that will be saved (host and path) so the person sees what was understood.
- Pressing "Next" with none valid shows "Add at least one link to your social media or website" under the card and opens the Instagram input; a filled-but-invalid link shows its own message and blocks Next.
- Mobile: buttons wrap; one column; no horizontal scroll. Accessible: buttons are `aria-expanded` toggles tied to their input, messages are `role="alert"`, never colour-only. Copy goes through the existing en/ar catalogues (the AR/EN parity check applies).
- The review step lists the added links with an Edit action, like other fields.

## What is accepted and what is saved
Everything is normalized to one canonical `https` link, stored without tracking parameters or fragment.

| Field | Accepts | Rules |
|---|---|---|
| Facebook | `facebook.com/…`, `fb.com/…`, `fb.me/…`, or a page name | host in {facebook.com, fb.com, fb.me} (leading `www.`/`m.` ignored); name `[A-Za-z0-9.]{5,50}` |
| Instagram | `instagram.com/…` or `@name` | host instagram.com; name `[A-Za-z0-9._]{1,30}` |
| TikTok | `tiktok.com/@…` or `@name` | host tiktok.com; name `[A-Za-z0-9._]{2,24}` |
| Website | a domain or `http(s)://…` | host must contain a dot and a letter-bearing public suffix |

For all four: `https` only (`http://` is upgraded), at most 300 characters, no whitespace or control characters, no `user:pass@`, no non-ASCII host (shown as an error, not silently converted, to block look-alike hosts), no IP address, `localhost` or `.local`/`.internal`. Any other scheme (`javascript:`, `data:`, `file:`…) is rejected.

The one validator lives in a pure module (`lib/onboarding/social-links.ts`) used by the screen and the server action. The database re-checks shape and length and, for the three social columns, the platform host.

## Data
- Four nullable text columns on `business_creation_drafts` and on `organizations`: `facebook_url`, `instagram_url`, `tiktok_url`, `website_url` (names are the builder's call).
- Forward-only migration; no backfill; old rows stay null.
- **Expand/contract, like the earlier contact work:** the existing `business_draft_save_v2` / `business_draft_submit_v2` keep working untouched for old clients. New callers use new versions that take the four links and enforce "at least one" for a showroom. An old client can still create a pending incomplete business (no links); the profile checklist shows it.
- A showroom owner (`org.manage`) edits the links later from Settings through a new validated, audited RPC (the audit action list needs the new action added, as it did for `organization_legal_name_set`).
- Profile completion (`app.profile_completion`) gains one item for a showroom with no link; `ITEM_HREF` gets a matching entry that points to settings.
- Admin business-verification detail shows the four links as text and links marked "unverified".
- The new SQL function(s) need the permission manifest regenerated and the migration policy to pass.

## Security
- Authoritative check in the database; the screen and action only give early, friendly errors.
- Output is only ever rendered as text or as `<a href>` with `target="_blank"` and `rel="noopener noreferrer nofollow"`, never as HTML.
- No server-side fetch of any link (no SSRF, no link preview, no favicon fetch).
- Links are business information, not secrets, but are never placed in URLs, logs or analytics events.
- Reuses the existing auth FormData caps (8,192 bytes, 16 fields): four 300-character links fit.
- The unverified status is stated wherever a link is shown to Admin.

## Performance and requests
- Validation is local and synchronous: no request while typing, no debounce, no autosave per keystroke. Saving happens once, on "Next", in the request that already exists.
- The draft already loads with `select("*")`, so the new columns add no query. Admin detail reads one more column in its existing query.
- No new dependency; `zod` is already in the bundle. The card is plain client JS in the existing step component.
- Nothing is added to a layout or shell, so it does not touch load time of other pages.

## Constraints
- Next.js App Router, strict TypeScript, the Aperture design tokens (no hard-coded colours), Lucide/Tabler-free (existing icon set only), Arabic RTL and Light/Dark.
- Forward-only migrations; never applied to Acceptance or Production without the owner's approval.

## Tests
- Vitest: the validator (every row above, every rejection), the server action, the card (open/close, counter, error states, keyboard), review step.
- pgTAP: new file for the RPCs: accepts each platform, rejects wrong host, `http`, userinfo, IP, over-length, and "none" for a showroom; old v2 RPCs still work; settings RPC authorization and audit row; profile-completion item; direct call without the app.
- Playwright: desktop and mobile journey through step 1 with and without a link.
- Migration policy, permission-manifest comparison and the AR/EN parity check.

## Left to the builder
Column names, the exact audit action name, the precise copy, the settings screen layout, how the profile-completion item reads, and the host-suffix check for websites (must be tested directly against the RPC).

## Assumptions I made (please confirm or correct)
1. Showroom only, not the other business types.
2. A missing link does **not** block approval, activation or selling, for new or existing showrooms.
3. The description field moves below the links card (optional fields last).
4. Links are not shown to customers yet.

## Related
[Showroom business onboarding](showroom-business-onboarding.md) · [ADR-0016](../decisions/ADR-0016-business-phone-database-validation.md) · `frontend/src/lib/onboarding/business-details.ts` · `frontend/src/features/onboarding/business-flow.tsx` · `supabase/migrations/20261014133000_showroom_optional_address_completion.sql`
