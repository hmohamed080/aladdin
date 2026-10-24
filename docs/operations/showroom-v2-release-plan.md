# Showroom V2 - production release plan (release candidate, NOT deployed)

Closure plan, risk-based test policy and the remaining user decisions: [showroom-v2-closure-plan.md](showroom-v2-closure-plan.md).

Status: planning only. Nothing has been pushed, merged or deployed. The user must approve the screenshots and the decisions in section 8 first.

## 1. Baseline and size of the change

- Production baseline: `origin/main` @ `10014e3` (merge of PR #81), as of the last local fetch; **re-confirm against the hosted project before any step** (a later production merge changes the numbers below).
- Merge base with this branch: `a33aa018`. This branch is **80 commits ahead**: 392 files, +45.7k/-0.7k lines, **44 new migrations** (`20261007090001` ... `20261025090001`).
- `frontend/src/app/preview/showroom-suite-v2` and `features/showroom-shell` are **entirely new to production** (0 files on `origin/main`). The "Showroom V2" release therefore is not a Home/Settings patch: Home and Settings sit on top of the whole suite, offers, audiences, governance and publisher chain.

## 2. Why this must ship as one dependency-complete unit

- The 41 migrations are a single forward chain; later ones redefine functions, views and constraints created by earlier ones (for example `catalog_products` is dropped and recreated by `20261023090009`; `my_workspaces()` is redefined by three migrations; `own_product_validate` is replaced by `20261023090008`).
- Destructive statements exist: `drop column products.base_price` (data is first copied into `product_prices`), dropped functions/views the previous frontend calls (`own_product_create/update`, `own_offer_save`, `own_product_offers`, `saved_product_list`, `dashboard_kpi_layout_*`, `showroom_branches`, `my_workspaces`, `my_organization_applications`, `catalog_products(uuid)`), dropped old enum types. **A frontend rollback after the migrations is therefore not safe.** Cherry-picking single UI commits is not possible: Home reads `catalog_products` (exact-audience), `showroom_home_metrics`, `order_category_spend`, KPI layouts; Settings reads the governance RPCs.
- Conclusion: release the chain `20261007090001` -> `20261023090010` and the matching frontend together, in that order, behind the gates in section 4.

## 3. Migration order (apply exactly in file order)

| Group | Files | What they carry |
|---|---|---|
| Suite foundations | `20261007090001-03` | showroom_suite KPI layouts, `showroom_home_metrics` |
| Products | `20261008090001`, `20261009090001`, `20261010090001`, `20261011090001` | taxonomy+images, price/colors/description, private prices (copies then drops `base_price`), color items |
| Offers | `20261012090001`, `20261013090001`, `20261014090001`, `20261015090001`, `20261016090001-02`, `20261017090001-02` | Product Offers lifecycle, paging, color codes, description limits |
| Network/contact | `20261021090004-02` | contact visibility, refer candidates |
| Audiences | `20261019090001-02`, `20261021090002-03` | exact-only audiences, image grant revalidation, canonical offer audience, contractor audience |
| Shared Purchase Requests (backend only) | `20261020090001-02`, `20261021090004` | tables, RPCs, units; **no frontend ships** (Milestone D); tables stay empty |
| Account taxonomy | `20261021090001`, `20261021090005-06` | canonical nine accounts; drops old enum types |
| Governance (M2/M3) | `20261022090001-04`, `20261023090001-04`, `20261023090010` | applications, identity/branch/co-owner governance, B-1 fix |
| Publisher (M4a, gated) | `20261023090005-09` | independent publishers; flag `independent_commerce` inserted **disabled** |
| Business Description / 250-character rule | `20261025090001` | `organizations.description` + `organization_description_set` RPC; one counting rule (`app.description_text`); reject-not-truncate in the draft, bio and portfolio RPCs; legacy-safe direct-write trigger on six description columns; the draft description is copied to the organization on submit. Additive, nothing rewritten |
| Showroom V2 reference alignment | `20261024090001-02` | two Home KPI cards allowed in the saved layout; Showroom business profile image (private bucket `organization-images`, table, four storage policies, four RPCs, FK on `organizations.logo_media_id`, revoked client UPDATE of that column) |

Because of the destructive steps: take a verified backup / enable PITR immediately before applying, apply on a **copy of production first** (section 6), and record the pgTAP result there (local result: 81 files / 3632 tests pass on a fresh reset).

## 4. Gates that must stay closed

| Gate | State shipped | How it is enforced | How to verify on staging |
|---|---|---|---|
| Independent commerce (`platform_flags.independent_commerce`) | `false`, no client/API writer | read paths check `app.flag_enabled`, regression `i` I3 | `select enabled from platform_flags where key='independent_commerce'` = false; buyer cannot open an independent product |
| Contractor / Engineer public registration | Coming Soon (`account-types.ts` `comingSoon`) | UI + server | sign-up page shows Coming soon |
| Shared Purchase Requests | tables exist, no UI, nav entry hidden | `navigation.ts` `hidden` | no sidebar entry; `/preview/showroom-suite-v2/purchase-requests` shows the placeholder only if typed |
| Independent professional `/home` hub | M4a screens exist, unlinked | no navigation entry | unchanged from audit: reachable only by typed URL, requires approval + closed flag |

## 5. Routes that become available to Showroom users

`/preview/showroom-suite-v2/{home,catalog,offers,saved,my-products,my-offers,settings}` and, inside the same shell, the existing `/b2b/{rfqs,quotations,orders,projects,reports,organization,customers,leads,follow-ups,suppliers,technicians,jobs,points,activity}`. `/b2b` and `/b2b/settings` redirect for Showroom workspaces. Other organization types are unchanged. Canonical-URL proposal: `showroom-v2-release-inventory.md` section 7 (needs approval).

## 6. Pre-production validation (staging or an equivalent copy)

1. Restore a production backup into a scratch project; apply the 41 migrations in order; run the pgTAP suite and the `supabase/tests/*concurrency*.sh` scripts.
2. Verify the three gates above and run the data checks: every `products.base_price` value exists in `product_prices`; no organization lost a membership; `select count(*) from organizations where org_type is null`.
3. Deploy the frontend build to a preview pointing at the scratch project. Run the real-browser journeys against it: `frontend/e2e/regression/a..i` and `frontend/e2e/audit/v2-*.spec.ts`.
4. **Check the 40001 behaviour on the hosted PostgREST**: submit a quotation with a stale version; expect a conflict message in under 2 s (locally PostgREST hangs 60 s; see inventory finding 3).
5. Confirm storage: the product image buckets and signed-URL policies from `20261008090001`, `20261019090002` exist and the new private `organization-images` bucket with its four policies (`20261024090002`); upload, view, replace and remove one product image and one Showroom image.
6. Admin: see section 7.
7. Smoke on mobile 390/430 in Arabic dark and English light.

No new environment variables are introduced by this work.

## 7. Admin dependencies (release blockers for the governance features)

The separate Admin workstream must be able to action these review types, which Settings V2 now lets owners create: `organization_identity` (name change), `branch_location` (public branch verification), co-owner verification, and `organization` applications. The current Admin queue (audit screenshot 30) lists them with raw type strings, no evidence panel and no governance actions. Options: (a) ship Admin support first; (b) pilot with SQL/RPC review by the platform team and hide "Request a name change" and "Request verification" until the Admin UI lands. This is a product decision (section 8, item 3). Core commerce (catalog, offers, RFQs, quotations, orders) does not depend on it.

## 8. Rollback

- Frontend only (before migrations): redeploy the previous Vercel deployment. Safe.
- After migrations: do **not** roll back only the frontend. Roll back by restoring the pre-release backup (PITR) together with the previous deployment, accepting loss of data written since; or forward-fix with a new migration. Document the exact backup timestamp at release time.
- Gate rollback: flags and Coming Soon states are the instant levers; they are already closed.
- The new routes can be hidden without a deployment only by redeploying; there is no runtime switch for Showroom V2 itself. Proposal: add a single `platform_flags` switch for the `/b2b` -> V2 convergence if the user wants a no-redeploy kill switch (not built).

## 9. Test evidence (local, isolated database `aladdin_sr2`)

| Check | Result |
|---|---|
| Vitest (unit/component) | 219 files, 2673 tests pass |
| `tsc --noEmit`, eslint on touched areas | clean |
| pgTAP on a freshly reset database (all 44 migrations applied from scratch) | 85 files / 3732 tests pass (new: 81 KPI cards, 82 profile image, 83 personal-data privacy, 84 description 250; 47 storage-policy inventory updated for the four new policies). Run it only on a clean reset: a database that also holds e2e seed data fails 8 files on row-count assertions (12 organizations instead of 10, an extra seeded offer), which is test pollution and not a defect |
| Real-browser regression `e2e/regression/a..i` | a 5/5, b 7/7, c 7/7, d 7/7, e 8/8, f 5/5, g 5/5, h 8/8 (now through V2 Settings), i 7/7 |
| V2 specs `e2e/audit/v2-*.spec.ts` | Home with real data; every sidebar destination opens a finished page; Settings sections; staff scope; pending-org exclusion; empty org + multi-branch; chat from RFQ; Direct RFQ -> quotation -> order journey |

Not covered by a browser test in this session: order start/complete and project transitions, team invitations and join-request approval, personal profile saves (name/photo/phone), and the full legacy Playwright harness (different database container).

## 10. Go / no-go

**NO-GO for production today.** It is a valid release candidate for staging. Blocking items: user approval of the visuals; hosted-staging run of section 6 (migrations on a production copy, the 40001 check); decision on the Admin review path (section 7); browser coverage of the untested transitions above; approval of the canonical route plan.

## 11. Approvals needed from the user

1. Visual approval of Home, Settings and the converged pages (`docs/frontend/screenshots/v2-release/`).
2. Approval to run the release candidate on staging, and which staging project to use.
3. Admin path for identity/branch reviews: ship Admin support first, or hide the two request buttons for the pilot.
4. Canonical route plan (`/showroom/*` or keep current URLs).
5. Showroom rating and membership card: confirm they stay out of the release (or define the data source).
6. Whether to add a runtime kill switch for the converged shell.
7. Explicit go for deployment after staging results.
