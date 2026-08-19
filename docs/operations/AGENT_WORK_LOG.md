# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

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
