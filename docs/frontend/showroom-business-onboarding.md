# Showroom business onboarding — local review

## Purpose and current decision
Extend the existing business wizard and draft RPCs. The product owner approved the UI and authorized final review/PR creation. The PR remains a draft because the security limitations below are unresolved.

Step 1 keeps trading name, legal name and optional description (maximum 250 characters). Showroom accounts additionally require a valid canonical E.164 business phone and one existing showroom activity; email is optional and normalized by trim/lowercase. The exact Arabic activities are معرض ديكور, معرض دهانات, معرض ديكور ودهانات and موان. The last option retains the existing building_and_finishing_supplies_retailer key.

Step 2 requires governorate and a catalogue city or valid custom city. The detailed address is optional at onboarding, limited to 250 whitespace-separated words, with a bounded 16,384-character payload. Missing showroom address remains an informational account-completion item linking to the existing branch editor in /b2b/settings. It does not block initial business creation or grant approval.

# Showroom links in step 1 — 2026-11-05

Step 1 of the showroom wizard now has a links card (Facebook, Instagram, TikTok, website) between the optional email and the optional description. A showroom must add at least one valid link and no invalid one to leave step 1; a missing link is also flagged on the type step and on submit. The rule applies to new showrooms only: existing showrooms keep working and see one profile-completion item.

Saving uses `business_draft_save_v3` and `business_draft_submit_v3`, which add the four link columns and enforce the rule for a showroom; the v2 RPCs stay for old clients. Each save sends all four links, because the v3 save replaces them. Settings edits go through `organization_social_links_set` (audited, count only). Full design, deviations and deploy order: [showroom-social-links-onboarding.md](showroom-social-links-onboarding.md).

## Rationale and scope
Business contacts belong to organizations, not the personal profile or Supabase login alias. They are unverified contacts. Reuse public.activities / public.organization_activities; do not introduce an enum or parallel activity taxonomy. Store the address in the primary branch's existing address_ar field. Preserve incomplete drafts; new draft fields are nullable and no historical data is invented or backfilled. Omitted new fields preserve saved values; explicitly empty email/address clears them.

The shared wizard keeps its existing default heading style. BusinessFlow selects the existing Readex font and Arabic display typography, removing negative tracking / cramped line-height and the decorative Kufi treatment from these two headings. Existing branch editing and account-completion UI are reused.

## Database and authorization
Forward-only migrations: 20261014123000_showroom_business_onboarding_details.sql and 20261014133000_showroom_optional_address_completion.sql. They extend existing draft save/submit, add unverified organization phone/email, preserve verified-caller and first-business type locks, retain atomic organization/owner/branch creation and pending_verification / is_verified=false. Contact data is available in existing authorized business settings/admin details. Existing RLS and client write grants remain unchanged.

The local test stack is aladdin_showroom_auth, API http://127.0.0.1:63321, database port 63322. Worktree frontend .env.local contains local-only configuration. No production database or deployment was modified.

## Earlier onboarding review verification
- TypeScript noEmit: passed.
- Scoped ESLint: passed.
- Latest focused onboarding / profile / Showroom and Installer auth run: 149 tests passed in 8 files.
- Full local pgTAP suite: 89 files, 3761 assertions passed. Legacy regression fixtures now provide the newly required creation inputs; separate direct RPC tests still reject missing/invalid inputs.
- Chromium desktop 1440x1000 and mobile 390x844: Steps 1 and 2 rendered, no horizontal overflow; business phone and selected location survived Back/Forward; Continue accepts a blank optional address after governorate/city selection.
- Original checkout: all 14 baseline modified files unchanged; branch feature/auth-password-preview preserved.

## Preview and related files
- http://localhost:3341/showroom/sign-in
- http://localhost:3341/showroom/sign-up
- http://localhost:3341/onboarding/business (authenticated; steps share this canonical URL)
- Screenshots: [Step 1 desktop](screenshots/showroom-onboarding/step-1-desktop.png), [Step 1 mobile](screenshots/showroom-onboarding/step-1-mobile.png), [Step 2 desktop](screenshots/showroom-onboarding/step-2-desktop.png), [Step 2 mobile](screenshots/showroom-onboarding/step-2-mobile.png).
- New contact validator: frontend/src/lib/onboarding/business-details.ts.
- New direct database tests: supabase/tests/91_showroom_business_details_test.sql.

## Deferred work and consequences
UI review is approved. Final packaging proceeds as a draft PR with the blockers below. No merge or deployment is authorized. Business contact verification remains deferred; these fields must never be treated as verified. The persistent local preview stays on port 3341. Temporary local Supabase and generated build configuration are restored before committing. New branding assets are derived rasters, not original vector masters.

## Final review — authentication architecture and security
Shared `frontend/src/server/auth/phone-password.ts` receives server-selected Installer/Showroom account types from thin actions. Existing internal identity mapping stays `p<e164digits>@craftsman-login.aladdin.invalid`, with global phone uniqueness. Reuse SSR sessions, consent recording, profile initialization and account-type route authorization. Registration creates only business/showroom intent; the existing transactional wizard creates pending-verification organizations and scoped ownership. Internal alias confirmation never marks a real phone/email verified. Business contacts never alter personal auth phone. Failed initialization signs out and deletes the new identity, with attempted ban if deletion fails; transport failure can still require operator cleanup.

Shared password policy: signup/change/reset minimum 10 Unicode code points, maximum 72 UTF-8 bytes; exact confirmation; no trimming, transformation or truncation. Sign-in accepts existing shorter passwords but enforces types/nonempty/maximum. Direct local GoTrue v2.193.0 tests verify minimum configuration 10, bcrypt storage and rejection of 73 ASCII bytes / 37 Arabic characters / 19 emoji. Hosted provider configuration is not independently verified. Existing libphonenumber-js/max validates all supported countries on client/server, normalizes E.164, handles Arabic digits/leading zeros and prevents duplicate country codes. Egypt is default; 245 local flags are licensed with provenance.

Auth FormData caps: 8,192 UTF-8 bytes, 16 fields, bounded keys; reject file and non-FormData input. Middleware rejects declared auth bodies above 65,536 bytes; existing Next limits bound other request bodies. Private HMAC-keyed atomic quotas cover app requests by IP/normalized phone, generic errors and safe throttling feedback. Turnstile protects applicable registration. Hosted cookies use Secure/SameSite Lax; existing browser SSR cookies remain client-readable. Next server-action origin checks preserve the existing CSRF boundary. No plaintext password/token logging or client service key is introduced. Direct tests cover private-table writes, unauthorized roles, cross-tenant updates and wrong-account-type login.

**Critical merge/deployment blocker:** exhausting the app phone quota does not prevent a direct native GoTrue password request. Diagnostic result: `invalid_credentials`, HTTP 400, after application quota denial. No wrong-password login succeeded; this proves incomplete quota coverage. Native provider IP throttling is separate. The connected Supabase organization is on Free; password-verification hooks require Teams/Enterprise. No plan upgrade or hosted changes were performed. A reviewed provider-wide mitigation is required; the PR remains DRAFT. Sources: [native rate limits](https://supabase.com/docs/guides/auth/rate-limits), [hook availability](https://supabase.com/docs/guides/auth/auth-hooks).

## Approved address enforcement and legacy remediation
Registered account is identity plus intent. Onboarding completed is transactional business creation. Pending approval is pending_verification / is_verified=false. Approved business requires authorized review. Active showroom passes activation rules. Authorized seller additionally requires applicable unexpired applied approval and complete required business information. Completing an address alone does not grant approval.

The fourth migration, `20261014160000_showroom_activation_and_selling_address.sql`, enforces full new-business completion before approval/activation, publication, new submitted quotations and new orders/order progress. Draft products remain permitted under existing membership permissions. Published listing RLS integrates seller eligibility. Active complete showrooms cannot clear/remove/deactivate their primary address. Suspension and tenant checks remain in effect. Whitespace-only addresses do not count.

The approved backward-compatible rollout captures the historical active/approved cohort. Missing-address exceptions capture existing published product IDs and existing order IDs only. Existing products are not changed/unpublished, businesses are not deactivated, and captured order operations continue while the business remains active/approved. New publications and new selling require a valid address. Historical businesses retain their old information contract; all new businesses must meet the full new contract. Private records contain policy/reason/time and deny direct client/service-role table access. Owners see the existing business-profile completion item. Adding a valid primary address closes the exception with time/actor.

Read-only staging impact: **2 affected showrooms / 6 published products**:

| Organization ID | Published products |
| --- | ---: |
| `91000005-1111-4111-8111-000000000005` | 2 |
| `9c000000-cccc-4ccc-8ccc-000000000001` | 4 |

Production impact was not checked; staging is not evidence of production contents. Operations must review open exceptions through trusted DB access, request owner completion through separately authorized communication, then verify `/b2b/settings` saves and closed_at/eligibility. Track overdue records; review suspension separately. No automatic expiry is introduced, avoiding unattended order interruption. Do not reopen/extend snapshots through a client API. Existing products remain visible but creation of new orders is blocked until completion; existing orders continue. No outbound customer messages were sent. [ADR-0015](../decisions/ADR-0015-showroom-address-selling-rollout.md) records this trade-off.

## Final test evidence and limitations
Separate reruns overlap; do not sum their counts.

| Check | Result |
| --- | --- |
| Full frontend Vitest | 212 files passed / 2 skipped; 2,793 tests passed / 13 skipped |
| Final focused auth/input tests | 4 files / 232 tests passed |
| Focused onboarding/profile/auth | 8 files / 149 tests passed; later changed step/name checks 41 passed |
| Production build | Passed |
| Full DB run before browser business fixtures | 90 files / 3,794 assertions passed |
| Later full DB rerun with accumulated browser fixtures | Failed: 90 files / 3,615 executed assertions; 21 failed assertions, six affected files with early-aborted plans |
| Native endpoint per-account quota diagnostic | Failed coverage; merge/deployment blocker |

The later full DB rerun shared the preview database with browser-created fixtures. Historical suites assume exact seed-only org/membership/audit counts and no extra active Super Admin; retained synthetic business/reviewer fixtures violate those assumptions, with concurrent execution compounding the problem. New task suites 90/91/92 passed in that run. Do not present the previous full pass as a clean latest overall gate. No DB reset/audit deletion was used to manufacture a pass. Synthetic local identities with protected business history are quarantined/archived. A pristine disposable acceptance database is required for a repeatable full seed-only run.

An earlier browser run passed 22 and failed two journeys because the test reloaded before navigation after saving. Both desktop/mobile journeys passed after waiting for the next step. Final full browser rerun: **24 passed, 0 failed** (2.8 minutes). Final TypeScript check passed; ESLint had 0 errors / 1 pre-existing sidebar-shell hook warning. Sequential task database suites 90/91/92 originally **116 passed, 0 failed**; review added three quotation acceptance/RFQ-preservation/rejection tests, with suite92 **36 passed** and the complete three-suite rerun **119 passed / 0 failed**. Scenarios use genuine local auth, caller/admin RPCs, local verification and synthetic users. No production accounts are exercised. No formal axe audit was run.

## Independent review: Standards
One material finding: CTA cream/terracotta contrast is approximately3.19:1 and needs large bold text to meet AA. Fixed CTA weight from600 to700 at20px; retain the approved palette. One judgement-call finding: shared orchestration retained installer-only documentation. Corrected module/rollback/quota comments; historical exported Craftsman names remain for compatibility. No further actionable standards findings were reported in reviewed auth/selling SQL. Build/screenshots are refreshed after the CSS change.

## Independent review: Spec
Two new findings, separate from the previously known native quota blocker. Quotation eligibility was checked only at submission; fixed accepted transition too. Three local regression assertions verify denial after eligibility loss, RFQ remains quoted and rejection still succeeds.

**Remaining merge blocker: direct business-contact RPC metadata validation.** Next actions and UI enforce libphonenumber, but business_draft_save/submit enforce E.164 shape rather than full country numbering metadata. A rolled-back synthetic diagnostic saved/submitted `+201000000000`, which fails the application's Egyptian numbering validation. An invalid contact does not grant approval automatically, but this violates the direct-RPC valid-contact contract; it is not resolved by frontend restrictions. The authoritative database boundary needs equivalent metadata validation or a reviewed trusted validation contract before merge. Do not replace this with a fixed global length regex or claim all phone security checks passed. No extra dependency/service or hosted setting was introduced to conceal this issue.

Review totals: Standards1material+1maintainability finding, both addressed; Spec2newfindings, quotationfixed/contactvalidationopen, plus previously documented nativequota blocker. A clean full seed-only DB run and production impact/configuration review remain required.

Reviewed build passed; desktop/mobile layout rerun **2/2 passed**, verifying actual rendered CTA weight/size/contrast and refreshing all four authentication screenshots. Shared auth focused rerun **114/114 passed**. DB advisors/lint also surfaced pre-existing mutable-search-path warnings and PostGIS dynamic-SQL diagnostics; these are not represented as a clean global security scan, and unrelated database cleanup was not performed.

An additional post-review journey rerun was **aborted/incomplete** when Docker exec stopped responding; the diagnostic container query also stalled. Only the exact task's worker/acceptance server on3340 was stopped; no Docker restart or other Aladdin server interruption. This rerun is not counted as a pass. The prior full24/24browser run remains the executed complete run; the quotation change is independently covered by the119/119task database run. Final TypeScript rerun passed after correcting strict array indexing in the contrast test.

A separate untracked `frontend/e2e/auth-captcha.spec.ts` appeared during final checks. It was not created by this task, is preserved untouched and excluded from commits. The worktree therefore must not be called entirely clean or removed; task-related tracked changes are committed separately from this external file.

## Pull request and final Git evidence
[PR #84](https://github.com/hmohamed080/aladdin/pull/84) is OPEN/DRAFT, targeting main from feat/showroom-auth. Implementation commit05c4eec8 and review-fix commit4ae03891ac5b7f62dab653ff244218175cea4b44 are pushed; this final documentation update records the created PR. Main did not advance from c7963c9517cb412dde0a89090ab027712dbe403f. Original checkout stays on feature/auth-password-preview; all14baseline modified-file hashes remain identical. No merge, deployment or cleanup occurred. Preview sign-in/sign-up returned HTTP200 after push, connected only to local API63321. Final strict-type-safe rendered contrast/layout rerun2/2passed; screenshots updated. External untracked captcha test remains untouched/excluded.

## Migrations, files, references and operational limits
Four forward migrations: phone quota/account-type/rollback security (`20261014085731`), draft/business contacts and activity (`20261014123000`), optional-address bounds/completion (`20261014133000`), activation/selling/legacy snapshots (`20261014160000`). Applied only locally. Before deployment: resolve native-auth quota coverage; verify hosted password/cookie/provider settings; assess production legacy impact; review locks/backups; migrate before a compatible app. Snapshot historical sellers once, never recreate exceptions per deployment. Rollback requires reviewed forward corrective migration and compatible app; do not reset DB, erase audits or blindly deploy an app incompatible with creation rules.

Changed areas: shared auth/password/phone validators and quotas; canonical Showroom UI; Installer wrappers; applicable password change/reset flows; business wizard/actions/queries; authorized settings/admin details; branch editor; profile-completion copy/types; middleware/env validation/database types; migrations; scoped regression fixtures and tests; licensed flags, branded assets, references/screenshots and project memory. Git's committed path list is the complete manifest. No new runtime package was needed.

All four original PNG references and supplied README are preserved verbatim under `docs/design/references/showroom-auth/`, along with two rebrand source images. Original-reference SHA-256 values were checked. Auth screenshots are in `screenshots/showroom-auth/`; onboarding screenshots linked above. Functional HTML forms implement the UI; entire screenshots are not used as interface. Derived 2026 assets are raster edits, not original vector masters. ADR-0014 remains preserved and non-conflicting with origin/main.

Routes: `/showroom/sign-in`, `/showroom/sign-up`, `/onboarding/business`; later editing uses existing `/b2b/settings`. Preview uses isolated API63321 / DB63322 with local keys only and remains on3341. OAuth, real phone/contact verification, secure phone recovery, hosted settings and original brand vector assets are deferred.

Keep this worktree through PR review. Cleanup requires explicit approval, confirmed GitHub merge, implementation/references verified in origin/main and no tracked/untracked/ignored work to lose. Stop only this preview, then use ordinary non-force git worktree removal for this exact checkout. Stop if dirty/Git refuses; preserve all other worktrees and the original 14 changes. Do not force-delete a squash-merged branch. No cleanup/merge/deployment is performed during PR creation.

# PR #84 blocker corrections — 2026-10-14

The current follow-up preserves the old nine-argument `business_draft_save` and old `business_draft_submit` contracts. New callers use separately named `business_draft_save_v2` / `business_draft_submit_v2`; pending PR migrations add these without dropping deployed contracts. The original regression fixtures again exercise the old signatures. Old clients can create pending incomplete businesses during an expand/contract rollout; they cannot approve or sell until the new business-profile requirements are completed. Remediation of missing contact/activity fields in old-client drafts must be reviewed before promotion; this task does not add an unrestricted owner write API.

Private generated libphonenumber-js max metadata now validates canonical business contacts in PostgreSQL triggers on drafts and organizations. It uses the pinned application's 245 country plans, variable national lengths/types, shared calling-code resolution and an E.164 limit of 15 digits. No phone is marked verified by parsing. The generator and deterministic 9,058-case application/database parity check are committed sources; no additional runtime dependency is introduced. See [ADR-0016](../decisions/ADR-0016-business-phone-database-validation.md).

Correction to the earlier diagnostic: `+201000000000` is valid according to the pinned Egyptian numbering metadata. It was incorrectly described as invalid; it does not demonstrate that gap. The new direct-RPC regression uses `+201399999999`, whose Egyptian operator pattern is invalid, plus noncanonical trunk-prefix and unsupported calling-code cases. Parsing validity never establishes assignment or reachability.

Legacy address exceptions no longer override expiry, rejection, revocation or suspension. Current approval is checked before listing visibility or captured-order progress. The observed staging cohort has no verification records, so its narrowly captured historical active/verified status remains usable until a terminal decision exists. New organizations cannot create that private exception. No existing product is automatically unpublished or deleted.

Current executed validation: migration-policy has no failures or reviewed exemptions; frontend typecheck passed; focused business validation/actions/onboarding tests **59 passed, 0 failed**. Clean local migration and seed replay succeeded, but the full suite and updated parity acceptance remain pending: Docker's control API returns HTTP500 and the local CLI database connection timed out. Earlier CI success belongs to the previous commit and is not proof of these corrections. CI will exercise a fresh runner, full suite, concurrency checks and second reset. No service restart was attempted.

Concurrent CAPTCHA files are externally owned and excluded from this follow-up's edits and commit. Authentication browser acceptance against that changing local workspace is not evidence for a task-only snapshot. PR #84 remains Draft; no merge, hosted configuration changes or deployment is authorized. See the separate [provider security decision report](../security/showroom-auth-provider-security-options.md) for actual staging settings and unresolved direct-GoTrue/distributed-attack guarantees.
# Clean CI acceptance follow-up

On code commit `77dffb0d`, GitHub frontend passed typecheck, lint, build and **2864 tests /13 skipped** (215 files passed/2 skipped); backend, docs and migration-policy passed. The isolated DB run replayed all migrations/seeds, passed database lint, and executed **3845 tests /92 files** with **2 failed expectations** in test60. New direct-RPC compatibility/phone and expired/revoked legacy-approval suites passed. Test60's old completion expectations omitted the newly required address. Its follow-up now asserts the incomplete percentage and completes the address through the existing authorized branch RPC; no authorization rule or fixture privilege is relaxed. Full repeatability and metadata parity still require the corrected CI run.
# Verified independent-blocker acceptance

Corrected commit `0c348382` passed GitHub CI and Supabase RLS checks. Clean database acceptance: **92 files /3847 tests passed, zero failures**, repeated after a second clean reset with the same result. Metadata parity: **9058 cases /245 countries, zero mismatches**, pinned hash matched. Last-owner, concurrent approval and lead-transition concurrency checks passed. Typecheck, full lint, full frontend tests/build, backend and documentation/migration policy passed. Local scoped business tests remain59/59; local Docker failures remain infrastructure limitations and were not relabeled as passes.

Independent Spec review found no new actionable discrepancy. Standards review identified generator overwrite risk; corrected exclusive creation rejects existing migrations unchanged. Executed refusal/byte-preservation and `--stdout` exact snapshot reproduction checks passed. No phone/approval schema change accompanies that maintenance fix.

Only provider-level per-account authentication security remains an architectural merge blocker; native hosted CAPTCHA is currently off in staging and cannot independently guarantee an aggregate account budget. Local v2 preview database synchronization and new browser journeys remain deferred while Docker is unhealthy and parallel CAPTCHA work owns the authentication runtime. Auth-page HTTP200 checks passed without authentication/data writes. Seven external file hashes still match their preserved baseline; no external paths were staged. Keep PR84 Draft and the worktree/preview retained.
