# Showroom Social Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Showroom adds Facebook / Instagram / TikTok / website links in step 1 of `/onboarding/business`, at least one required, enforced in the screen, the server action and the database; existing showrooms keep working and see a profile-completion item.

**Architecture:** One pure validator (`lib/onboarding/social-links.ts`) is the single source of the normalisation rules for the screen and the server action; a SQL function `app.social_link_valid` re-checks the stored canonical form. Expand-only database change: four nullable columns on drafts and organizations, new `_v3` save/submit RPCs that wrap the untouched `_v2` ones, one audited settings RPC. The card is plain client state inside the existing step component.

**Tech Stack:** Next.js App Router, TypeScript strict, zod (already in the bundle), Supabase SQL migrations + pgTAP, Vitest, Playwright.

**Spec:** `docs/frontend/showroom-social-links-onboarding.md` (approved by the owner 2026-11-05). Read it first; this plan argues from it.

## Global Constraints

- Showroom (`org_type = 'showroom_dealer'`) only; supplier, manufacturer, importer are untouched.
- At least one of the four links is required for a NEW showroom. A missing link never blocks approval, activation or selling; an old client calling `_v2` still creates a showroom without links.
- Stored form is canonical `https`, no query, no fragment, at most 300 characters, no whitespace or control characters, no `user:pass@`, no port, no non-ASCII or `xn--` host, no IP, no `localhost` / `.local` / `.internal` / `.localhost` / `.localdomain`.
- Platform hosts: Facebook `facebook.com|fb.com|fb.me`, Instagram `instagram.com`, TikTok `tiktok.com` (a leading `www.` / `m.` ignored on input); canonical stored forms `https://www.facebook.com/<path>`, `https://www.instagram.com/<name>`, `https://www.tiktok.com/@<name>`, `https://<host><path>` for websites. Handles: Facebook `[A-Za-z0-9.]{5,50}`, Instagram `[A-Za-z0-9._]{1,30}`, TikTok `[A-Za-z0-9._]{2,24}`.
- The server never fetches, previews or follows a link. Links render only as text or `<a target="_blank" rel="noopener noreferrer nofollow">`, never as HTML, and never appear in URLs, logs or analytics.
- No new dependency. No hard-coded colours (Aperture tokens only); AR/EN parity in `frontend/src/lib/i18n/messages/{en,ar}.ts`; RTL, Light/Dark; inputs `dir="ltr"`.
- Forward-only migrations, never applied to Acceptance/Production without the owner's approval. `_v2` RPCs are not modified.
- Commands: `npx -y pnpm@9.15.9 ...` (the global pnpm shim is broken here). If `frontend/node_modules` is missing in this worktree run `npx -y pnpm@9.15.9 install --frozen-lockfile` then `npx -y pnpm@9.15.9 install --frozen-lockfile --filter ./edge/media-worker`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `feat/showroom-social-links-20261105` in `D:\projects\aladdin-social-links`.
- Deploy order note (goes in the PR): the migration must be on a database before the frontend that calls `_v3` ships.

## Review Focus

1. Look-alike and smuggled hosts: `https://facebook.com@evil.io/x`, `https://evilfacebook.com/x`, `https://facebook.com.evil.io/x`, a Cyrillic `а` in `fаcebook.com`, an `xn--` label → rejected by the validator **and** by `app.social_link_valid`.
2. Dangerous or malformed input: `javascript:alert(1)`, `data:text/html,x`, `file:///etc/passwd`, `http://127.0.0.1`, `localhost`, `[::1]`, a 301-character link, embedded newline or tab, `facebook.com:8080` → rejected with a message, never silently altered.
3. Pasted noise: surrounding spaces, `@Name` vs `name`, uppercase host, trailing slash, `?utm_source=x#top` → trimmed and normalised to one canonical link.
4. Hidden-but-invalid input: closing a platform's input while it holds an invalid value must not hide the error or let "Next" pass silently.
5. Retry and race safety: double-click on submit, submit retried after the owner already edited links in Settings, and an old-client `_v2` submit → exactly one organization; links are never overwritten after the organization exists.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/onboarding/social-links.ts` (new) | Pure validator / normaliser, platform constants |
| `frontend/src/features/onboarding/social-links-card.tsx` (new) | The four-toggle card (controlled; used by step 1 and Settings) |
| `frontend/src/features/onboarding/business-flow.tsx` | Mount the card, reorder description, review rows, `identityDone` |
| `frontend/src/server/actions/business-onboarding.ts` | Schema + `_v3` RPCs |
| `frontend/src/server/queries/onboarding.ts` | Hydrate links from the draft |
| `frontend/src/server/actions/organization-profile.ts` | `saveSocialLinksAction` |
| `frontend/src/features/organization/organization-social-links-field.tsx` (new) + `features/showroom-shell/settings/settings.tsx` | Settings edit |
| `frontend/src/features/profile/complete-profile-card.tsx`, `server/queries/profile-identity.ts` | `organization_links` item |
| `frontend/src/app/admin/business-verification/[id]/page.tsx`, `server/queries/business-verification.ts` | Admin sees links, marked unverified |
| `supabase/migrations/20261107090001_showroom_social_links.sql`, `20261107090002_showroom_social_links_settings.sql` (new) | Schema + RPCs |
| `supabase/permissions/20261107090001.json`, `20261107090002.json` (new) | Reviewed function contracts |
| `supabase/tests/116_showroom_social_links_test.sql`, `117_showroom_social_links_settings_test.sql` (new) | pgTAP |
| `frontend/e2e/showroom-social-links.spec.ts` (new) | Journey |

---

### Task 1: Pure link validator

**Files:**
- Create: `frontend/src/lib/onboarding/social-links.ts`
- Test: `frontend/src/lib/onboarding/social-links.test.ts`

**Interfaces:**
- Produces:
  - `export const SOCIAL_PLATFORMS = ["facebook", "instagram", "tiktok", "website"] as const; export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];`
  - `export type SocialLinkReason = "tooLong" | "invalid" | "unsafeScheme" | "wrongHost" | "badHost";`
  - `export type SocialLinkResult = { ok: true; url: string | null } | { ok: false; reason: SocialLinkReason };` (`url: null` for blank input)
  - `export function normalizeSocialLink(platform: SocialPlatform, raw: string | null | undefined): SocialLinkResult`
  - `export type SocialLinks = Record<SocialPlatform, string | null>;`
  - `export function normalizeSocialLinks(raw: Partial<Record<SocialPlatform, string | null | undefined>>): { ok: true; links: SocialLinks } | { ok: false; platform: SocialPlatform; reason: SocialLinkReason }` (first invalid platform in `SOCIAL_PLATFORMS` order)
  - `export function socialLinksError(raw: Partial<Record<SocialPlatform, string | null | undefined>>): "onboarding.error.linksRequired" | "onboarding.error.linkInvalid" | null` (invalid wins over missing; none valid and none typed → `linksRequired`)

- [ ] **Step 1: Write the failing tests** in `social-links.test.ts`, with the spec's exact values. Minimum cases (table-driven):
  - accepts → canonical: `("instagram","@Aladdin.Shop")` → `https://www.instagram.com/Aladdin.Shop`; `("instagram","instagram.com/aladdin.shop/?utm_source=x#top")` → `https://www.instagram.com/aladdin.shop`; `("tiktok","tiktok.com/@shop_1")` and `("tiktok","shop_1")` → `https://www.tiktok.com/@shop_1`; `("facebook","fb.me/aladdin.shop")`, `("facebook","aladdin.shop")`, `("facebook","http://m.facebook.com/aladdin.shop/")` → `https://www.facebook.com/aladdin.shop` (host normalised for `fb.*`); `("website","Example.COM/path/?a=1")` → `https://example.com/path`; blank / `"   "` / `null` → `{ ok: true, url: null }`.
  - rejects (`ok: false`, with `reason`): `javascript:alert(1)`, `data:text/html,x`, `file:///etc/passwd` → `unsafeScheme`; `https://facebook.com@evil.io/x`, `https://evilfacebook.com/x`, `https://facebook.com.evil.io/x` (platform facebook), `instagram.com/x` given to platform tiktok → `wrongHost`; `http://127.0.0.1`, `localhost`, `[::1]`, `shop.local`, `shop.internal`, `facebook.com:8080`, `fаcebook.com` (Cyrillic а) , `xn--fcebook-8va.com` as website → `badHost`; 301-character link → `tooLong`; `"a b"`, string containing `\n` or `\t` → `invalid`; Instagram handle of 31 chars, TikTok handle of 1 char, Facebook handle of 4 chars → `invalid`.
  - `socialLinksError`: all blank → `onboarding.error.linksRequired`; one valid → `null`; one valid + one invalid → `onboarding.error.linkInvalid`; only whitespace → `linksRequired`.

- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 --filter frontend exec vitest run src/lib/onboarding/social-links.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** the functions above in `social-links.ts`. Approach: trim → length/whitespace/control check → if a bare handle for the platform, build the canonical URL → otherwise add `https://` when no scheme, reject any scheme other than `http`/`https` (`unsafeScheme`) → reject any non-ASCII character in the authority (text before the first `/ ? #` after the scheme) and any `xn--` label → parse with `new URL`; reject userinfo and non-default port → compare hostname (minus `www.`/`m.`) with the platform allow-list, or for `website` require dot-separated ASCII labels (letters, digits, inner hyphens, 1-63 characters each) ending in an alphabetic TLD of 2+ letters, and none of the banned suffixes → rebuild canonical `https` string from hostname + pathname (trailing slash removed), dropping query and fragment.

- [ ] **Step 4: Run** the same command → PASS. Run `npx -y pnpm@9.15.9 --filter frontend lint` on the two files and `tsc --noEmit` → clean.

- [ ] **Step 5: Commit** `feat(onboarding): social link validator` with files `social-links.ts` and its test.

---

### Task 2: Columns, DB validator, `_v3` save/submit RPCs

**Files:**
- Create: `supabase/migrations/20261107090001_showroom_social_links.sql`, `supabase/permissions/20261107090001.json`, `supabase/tests/116_showroom_social_links_test.sql`
- Modify: `frontend/src/types/database.types.ts` (tables `business_creation_drafts`, `organizations`; Functions `business_draft_save_v3`, `business_draft_submit_v3`)

**Interfaces:**
- Consumes: `public.business_draft_save_v2(...)` and `public.business_draft_submit_v2(uuid)` from `20261014133000_showroom_optional_address_completion.sql` (unchanged).
- Produces (names are fixed; the frontend in Task 4 depends on them):
  - columns `facebook_url`, `instagram_url`, `tiktok_url`, `website_url` (`text null`) on `public.business_creation_drafts` and `public.organizations`, each with a CHECK `col is null or app.social_link_valid('<platform>', col)`
  - `app.social_link_valid(p_platform text, p_url text) returns boolean` (immutable, `search_path=''`, no API-role execute). Null → true; otherwise `^https://` + platform host + optional `/path` with no whitespace, no `?`/`#`, total length ≤ 300; website host = the Global Constraints host pattern minus the banned suffixes / `xn--` / IP.
  - `public.business_draft_save_v3(` the thirteen `_v2` parameters in the same order and defaults `, p_facebook_url text default null, p_instagram_url text default null, p_tiktok_url text default null, p_website_url text default null) returns uuid` — calls `business_draft_save_v2`, then replaces all four link columns on that draft (null clears); invalid link → `errcode '22023'`, message contains `social link`.
  - `public.business_draft_submit_v3(p_draft_id uuid default null) returns uuid` — loads the caller's draft the same way `_v2` does; if it is a not-yet-completed `showroom_dealer` draft with all four links null → `errcode '22023'`, message `at least one showroom link is required`; calls `business_draft_submit_v2`; then, only when the draft had no organization before the call, copies the four links to the new organization. Already-completed draft → returns the existing organization without touching its links.
  - Both new RPCs: `security definer`, `set search_path=''`, `revoke ... from public, anon`, `grant ... to authenticated`, then `notify pgrst,'reload schema'`.

- [ ] **Step 1: Write the failing pgTAP file** `116_showroom_social_links_test.sql` (copy the harness/user-setup style of `91_showroom_business_details_test.sql`). Assertions: `social_link_valid` true for each canonical form and null; false for each Review-Focus-1/2 host and a 301-char URL; save_v3 stores links and a second save with nulls clears them; save_v3 with `https://facebook.com@evil.io/x` raises 22023; submit_v3 for a showroom draft with no links raises 22023 and creates no organization; submit_v3 with one link creates one org carrying exactly that link; calling submit_v3 twice returns the same org id; editing the org's links directly then re-calling submit_v3 leaves the edited links; `_v2` save + submit with no links still creates a showroom (compat); a non-showroom draft submits through v3 without links; anon cannot execute either `_v3`.

- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 supabase test db` (needs Docker). Expected: FAIL (functions missing). If Docker is unavailable say so in the PR and rely on CI's `supabase-rls` job; do not claim it passed.

- [ ] **Step 3: Write the migration** per the Interfaces block. Header comment: purpose, expand-only, `_v2` untouched.

- [ ] **Step 4: Add `supabase/permissions/20261107090001.json`** = the latest contract (`20261026090001.json`) with `version` set to `20261107090001` plus entries for `public.business_draft_save_v3(...)`, `public.business_draft_submit_v3(uuid)` (copy the `_v2` entries' shape: authenticated yes, anon no) and `app.social_link_valid(text,text)` (copy the shape of another internal `app.` function with no API-role execute). Run `node scripts/migration-permission-gate.mjs <container> postgres check` against the local DB (or the repo's documented gate command) and fix until it passes.

- [ ] **Step 5: Run** the pgTAP suite again → PASS; run `npx -y pnpm@9.15.9 supabase db lint`.

- [ ] **Step 6: Update `database.types.ts`** with the new columns and the two functions (regenerate with `supabase gen types` if the stack is up, else edit by hand following the `_v2` entries).

- [ ] **Step 7: Commit** `feat(db): showroom social links columns and v3 draft RPCs`.

---

### Task 3: Settings RPC, audit action, profile completion, admin detail

**Files:**
- Create: `supabase/migrations/20261107090002_showroom_social_links_settings.sql`, `supabase/permissions/20261107090002.json`, `supabase/tests/117_showroom_social_links_settings_test.sql`

**Interfaces:**
- Produces:
  - `public.organization_social_links_set(p_org_id uuid, p_facebook_url text, p_instagram_url text, p_tiktok_url text, p_website_url text) returns jsonb` — `app.require_verified_caller()`; `app.has_capability(p_org_id,'org.manage')` else `42501`; org must exist and be `showroom_dealer` else `22023`; each non-null value must satisfy `app.social_link_valid` else `22023`; a showroom may not end with all four null → `22023`, `hint 'links_required'`; updates the four columns; `app.record_audit_event('organization.social_links_changed','organization',p_org_id,p_org_id, jsonb_build_object('count', <number of non-null links>))` (no URLs in metadata); returns `{facebook_url,instagram_url,tiktok_url,website_url}`. Not blocked by the verified-identity lock (links are not identity).
  - the action `organization.social_links_changed` added through `select app.audit_actions_add(array['organization.social_links_changed'])`.
  - `app.profile_completion(uuid)` re-created from the **latest** definition (`20261024090011_installer_profile_completion.sql`), unchanged except: for a caller who manages a `showroom_dealer` organization add `v_total + 1` and, when none of the four link columns is set on any such organization they manage, append `'organization_links'` to `missing`; otherwise count it done. Keep the `revoke execute ... from public,anon,authenticated,service_role` of that migration.
  - `public.business_verification_detail(uuid)` re-created from `20261021090002_business_verification.sql:591` with `'facebook_url', o.facebook_url, 'instagram_url', o.instagram_url, 'tiktok_url', o.tiktok_url, 'website_url', o.website_url` added next to `contact_email` in the `organization` object; everything else unchanged.

- [ ] **Step 1: Write the failing pgTAP file** `117_...`: owner sets one link → row updated and exactly one audit row with action `organization.social_links_changed` whose metadata has no URL text; a member without `org.manage` → 42501; a non-showroom org → 22023; clearing all four on a showroom → 22023 with hint `links_required`; invalid host → 22023; `profile_completion` lists `organization_links` for a legacy showroom owner with no links and not for one with a link, and the percentage changes accordingly; installer / non-showroom callers' results are unchanged (compare `missing` to a pre-migration snapshot in the test); `business_verification_detail` returns the four keys to a reviewer.

- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 supabase test db` → FAIL.

- [ ] **Step 3: Write the migration**; **Step 4: add `20261107090002.json`** (= `20261107090001.json` with `version` bumped plus `public.organization_social_links_set(uuid,text,text,text,text)`; contract entries for the two re-created functions are unchanged) and run the permission gate; **Step 5: run** pgTAP → PASS and `supabase db lint`.

- [ ] **Step 6: Update `database.types.ts`** (`organization_social_links_set`).

- [ ] **Step 7: Commit** `feat(db): organization links settings RPC, audit action, profile completion item`.

---

### Task 4: Server action and draft hydration

**Files:**
- Modify: `frontend/src/server/actions/business-onboarding.ts`, `frontend/src/server/queries/onboarding.ts`, `frontend/src/server/actions/business-onboarding.test.ts`

**Interfaces:**
- Consumes: `normalizeSocialLinks`, `socialLinksError`, `SocialPlatform` (Task 1); `business_draft_save_v3` / `business_draft_submit_v3` (Task 2).
- Produces: `BusinessInput` gains optional `facebookUrl | instagramUrl | tiktokUrl | websiteUrl: string | null`; `BusinessAnswers` (onboarding.ts) gains the same four as `string | null`.

- [ ] **Step 1: Write failing tests** in `business-onboarding.test.ts` (mock `supabase.rpc` as the existing tests do): `saveBusiness` on the identity step for a showroom with no links → `{ok:false, code:"onboarding.error.linksRequired"}` and **no rpc call**; an invalid link → `onboarding.error.linkInvalid`; a valid `"@Shop"` instagram → rpc `business_draft_save_v3` called with `p_instagram_url: "https://www.instagram.com/Shop"` and the other three `undefined`→ sent as `null` (a clear); a non-showroom org with no links saves normally; `submitBusiness` for a showroom with no links → `linksRequired` before any rpc; `submitBusiness` calls `business_draft_submit_v3`; a database `22023` whose message includes `showroom link` maps to `onboarding.error.linksRequired`, one including `social link` maps to `onboarding.error.linkInvalid`. Update the existing assertions that expect `_v2` rpc names.

- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 --filter frontend exec vitest run src/server/actions/business-onboarding.test.ts` → FAIL.

- [ ] **Step 3: Implement.** Extend `businessSchema` with the four `z.string().max(400).nullish()` fields; in `saveBusiness` (identity step, showroom only) and `submitBusiness` (showroom) call `socialLinksError` right after `showroomIdentityError`; replace both rpc names with the `_v3` ones and pass `p_facebook_url` … from `normalizeSocialLinks(...).links`; extend `failureCode` for the two message patterns. In `getBusinessOnboardingData` map `draft?.facebook_url` etc. into `BusinessAnswers`.

- [ ] **Step 4: Run** the test file plus `src/server/queries` tests → PASS; lint + `tsc --noEmit` clean.

- [ ] **Step 5: Commit** `feat(onboarding): save and submit showroom links through v3 RPCs`.

---

### Task 5: The links card in step 1

**Files:**
- Create: `frontend/src/features/onboarding/social-links-card.tsx`, `frontend/src/features/onboarding/social-links-card.test.tsx`
- Modify: `frontend/src/features/onboarding/business-flow.tsx`, `frontend/src/lib/i18n/messages/en.ts`, `frontend/src/lib/i18n/messages/ar.ts`; extend the existing business-flow test if one exists, else add `business-flow.links.test.tsx`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `export function SocialLinksCard(props: { values: Record<SocialPlatform, string>; onChange: (platform: SocialPlatform, value: string) => void; showErrors: boolean; focusPlatform?: SocialPlatform | null; idPrefix?: string }): JSX.Element` — controlled; owns only which inputs are open.
- i18n keys (both locales, same structure): `onboarding.business.links.{title,counterNone,counterSome,platform.facebook,platform.instagram,platform.tiktok,platform.website,placeholder.*,saved}`, `onboarding.error.linksRequired`, `onboarding.error.linkInvalid`, `onboarding.business.links.error.{tooLong,invalid,unsafeScheme,wrongHost,badHost}`, review label `onboarding.business.review.links`.

- [ ] **Step 1: Write failing component tests:** four buttons with `aria-expanded="false"` and no inputs initially; pressing Instagram shows one `dir="ltr"` input, focuses it and sets `aria-expanded="true"`; typing `@shop` shows the "will be saved as" preview `instagram.com/shop` and a check on the button and counter "1"; pressing again hides the input but the value and the check stay; **an invalid non-empty value cannot be collapsed** and keeps `role="alert"` visible (Review Focus 4); `showErrors` with all blank shows the required message under the card and opens Instagram; a filled-invalid link shows its own reason message; buttons are reachable and toggle with keyboard; no hard-coded colour classes (token classes only).

- [ ] **Step 2: Run** the test file → FAIL.

- [ ] **Step 3: Implement the card** (Aperture token classes, existing `Input` / `LabeledField` / `InlineError` primitives, icon set already in `components/ui/icons`; if no suitable brand icons exist use text labels only — do not add an icon library). Buttons wrap on mobile; counter text uses `aria-live="polite"`.

- [ ] **Step 4: Integrate in `business-flow.tsx`:** add the four link strings to `BState` (init from `answers`); render the card for `showroom` after the email field inside the contact section and move the optional description block to after the card; `identityDone` also requires `!socialLinksError(...)`; `toInput` sends the four raw strings; show errors after a failed Next (`showErrors` state set in `persistAdvance` when the identity step is blocked); add a review row `onboarding.business.review.links` (one line per added link, `ltr`, edit → identity). Add the i18n keys in AR and EN.

- [ ] **Step 5: Run** the new tests, the whole `src/features/onboarding` folder and the i18n parity test (`npx -y pnpm@9.15.9 --filter frontend exec vitest run src/features/onboarding src/lib/i18n`) → PASS; lint + `tsc --noEmit` clean.

- [ ] **Step 6: Commit** `feat(onboarding): showroom links card in step 1`.

---

### Task 6: Edit links from Settings

**Files:**
- Create: `frontend/src/features/organization/organization-social-links-field.tsx` and its test
- Modify: `frontend/src/server/actions/organization-profile.ts` (+ `organization-profile.test.ts`), `frontend/src/features/showroom-shell/settings/settings.tsx` (select the four columns where `record` is loaded; mount the field after the legal-name field for `org_type === "showroom_dealer"`), i18n AR/EN (`showroomSettings.links.*`)

**Interfaces:**
- Produces: `export type SocialLinksResult = { ok: true; links: SocialLinks } | { ok: false; code: "invalid" | "required" | "forbidden" | "failed" };` and `export async function saveSocialLinksAction(orgId: string, raw: Partial<Record<SocialPlatform, string>>): Promise<SocialLinksResult>` — validates with `normalizeSocialLinks` + at least one link, calls `organization_social_links_set`, maps `42501`→`forbidden`, `22023` with hint `links_required`→`required`, other `22023`→`invalid`, revalidates `SETTINGS_PATHS`.
- Produces: `export function OrganizationSocialLinksField(props: { orgId: string; links: SocialLinks; canManage: boolean }): JSX.Element` — reuses `SocialLinksCard`, a Save button disabled while unchanged / invalid / busy, read-only list of `<a target="_blank" rel="noopener noreferrer nofollow">` when `canManage` is false, success and error messages like the legal-name field.

- [ ] **Step 1: Failing tests:** action — blank-all → `required` with no rpc; bad host → `invalid` with no rpc; success returns the canonical links and calls revalidate; `42501` → `forbidden`. Field — Save disabled until a valid change; non-manager sees links as anchors with the exact `rel`; a showroom with no links shows an empty state, not an error.
- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 --filter frontend exec vitest run src/server/actions/organization-profile.test.ts src/features/organization` → FAIL.
- [ ] **Step 3: Implement**; **Step 4: Run** the same command plus `src/features/showroom-shell` → PASS; lint + `tsc` clean.
- [ ] **Step 5: Commit** `feat(settings): edit showroom links`.

---

### Task 7: Profile-completion item and admin display

**Files:**
- Modify: `frontend/src/server/queries/profile-identity.ts` (add `"organization_links"` to `PROFILE_COMPLETION_ITEMS`), `frontend/src/features/profile/complete-profile-card.tsx` (`ITEM_HREF.organization_links = "/b2b/settings"`), `frontend/src/server/queries/business-verification.ts` (+ its test), `frontend/src/app/admin/business-verification/[id]/page.tsx`, i18n AR/EN (`profile.completion.items.organization_links` in the same place as `organization_address`, `businessVerification.admin.links`, `businessVerification.admin.linksUnverified`)

- [ ] **Step 1: Failing tests:** `complete-profile-card.test.tsx` already iterates every item — it must fail until the href and both translations exist; add a case that `organization_links` renders its link to settings. `business-verification` query test: `organization.facebookUrl|instagramUrl|tiktokUrl|websiteUrl` map from the RPC payload (absent → `null`). Admin page: renders each present link as `<a target="_blank" rel="noopener noreferrer nofollow">` with a visible "unverified" label and nothing when none.
- [ ] **Step 2: Run** `npx -y pnpm@9.15.9 --filter frontend exec vitest run src/features/profile src/server/queries src/app/admin` → FAIL.
- [ ] **Step 3: Implement**; **Step 4: Run** same → PASS; lint + `tsc` clean.
- [ ] **Step 5: Commit** `feat(admin,profile): show showroom links and completion item`.

---

### Task 8: Journey test, docs and full verification

**Files:**
- Create: `frontend/e2e/showroom-social-links.spec.ts`
- Modify: `docs/frontend/showroom-social-links-onboarding.md` (status → Implemented, record any deviation), `docs/frontend/showroom-business-onboarding.md` (step 1 now has the links card), `docs/operations/AGENT_WORK_LOG.md`, `docs/operations/RUNTIME_STATE.md` (prepend entries, same style as the PR #138 entries)

- [ ] **Step 1: Write the Playwright spec** (helpers `IDENTITIES`, `signIn` as in `e2e/showroom-persistent-shell.spec.ts`): desktop and mobile (375px) journey through step 1 — Next is disabled with no link; pressing Instagram, typing `@shop` enables it; the page has no horizontal scroll at 375px; Arabic locale keeps inputs `ltr`. It needs the seeded stack; run it if available, otherwise say it was not run.
- [ ] **Step 2: Docs.** Update the files above; run `python scripts/check_doc_links.py` → 0 broken.
- [ ] **Step 3: Full verification** (report real output, no claims without it): `tsc --noEmit`; `eslint` on changed files; full `vitest run` (known unrelated failures: `redis-guards` ×2 on Windows, `public-image-variants` / `image-processing` timeouts under load — confirm they pass alone); `next build --webpack`; `supabase test db`; permission gate; migration policy script used by CI.
- [ ] **Step 4: Commit** `docs,test: showroom links journey and records`, push the branch and open a draft PR (separate from #138) whose body lists every file and decision, what was and was not run, the deploy-order note, and the rollback (revert the frontend; the migration is expand-only and may stay).
