# Admin "View as account": exact UI parity (amendment to the architecture)

**Status:** Proposed 2026-11-15 on owner instruction (PR #193). Phase 0 (the server read-only gate) and Phase 1 (the `/view-as/[id]` shell) are built; page bodies (Phase 2 onward) are NOT built. Owner decisions 2026-11-15: top-level `/view-as/[id]` tree; owner-only controls render DISABLED with a read-only indication (supersedes the "render live and refuse" recommendation in §7.3); the custom `/admin/users/[id]/view/*` view is **Interim** and labelled so; read-only is enforced at three boundaries (edge, server-action/client, database).

### Phase 1 checklist (built)

- [x] `/view-as/[id]` layout: `requireViewAs`, banner above the real `InstallerDashboardShell`, subject identity from `viewAsReader`, no Admin chrome
- [x] `LinkScope` (`lib/admin/view-as/link-scope.ts`, `components/navigation/scoped-link.tsx`); test fails on any rendered `/home` href
- [x] `AccountReader` (`server/view-as/account-reader.ts`): `selfReader` (used by `/home` layout) + `viewAsReader`; drift guard = both annotated `: AccountReader` (a new loader breaks both until implemented) + key-parity test + `@ts-expect-error` proof
- [x] Registry `parity: "interim" | "exact"`; eye opens `/view-as` only for `exact`
- [x] Read-only UI: disabled fieldset around page content, `OwnerOnly` around sign out, "Read only" badge
- [x] Boundary (b): trusted `x-view-as-context` (middleware strips client copy), `assertNotViewAsContext()`, default-deny read-only Supabase client in the exact tree
- [x] Interim banner label; start/exit mirrored under `/view-as/[id]/`
- [ ] Phase 2: page bodies via `AccountReader`; guard remaining Server Actions with `assertNotViewAsContext()`; service-role actions need an explicit guard
- [ ] Phase 3: media seam for the exact tree, 403 notice
- [ ] Phase 4: acceptance side-by-side, `craftsman = exact` Supersedes §6.4 ("read-only variants") and §7 points 1-2 ("no server actions in the tree") of [`ADMIN_VIEW_AS_ARCHITECTURE.md`](ADMIN_VIEW_AS_ARCHITECTURE.md). Every other decision there stands.

## 1. Purpose

Pressing the eye in Admin must show the **exact interface the account owner sees**: the same shell, sidebar, pages, components, styling, data and navigation, reused from the real application so a future UI change appears in View-As with no extra work. The current Craftsman sections (`craftsman-sections.tsx`) are custom, simplified screens. They are an interim and are **not** the intended experience.

## 2. Current decision

Unchanged from the approved design, because they are the owner's constraints:

1. The Admin stays the authenticated principal. No user credentials, session, JWT or impersonation token exists. No service-role client.
2. Data comes from **subject-scoped reads** behind `app.require_view_as(subject)` (permission `users.view_as`, rank rule, live audited session). Patterns A (admin SELECT policy) / C (`admin_view_*` STABLE function) only; `my_*` bodies are not rewritten.
3. Private media only through the dedicated view door (`admin_view_as_media_open`, opaque media ids, never storage keys).
4. Session TTL, Exit, sign-out, permission revocation, rank protection, audit rows: as built.

Changed by this amendment:

| Was | Now |
|---|---|
| Read-only **variants** of each section, no actions or editors in the tree | The **real page components** render, **including their buttons and forms**. Mutation is refused **on the server**, never by hiding or disabling a control. |
| Custom `/admin/users/[id]/view/*` pages inside the Admin chrome | A top-level `/view-as/[id]/*` tree that renders the account's **own shell** (e.g. `InstallerDashboardShell`) with a persistent banner, no Admin chrome |

## 3. Architecture

### 3.1 Read-only on the server (Phase 0, built)

Server Actions are POSTs to the URL of the page that rendered them and run as the Admin. Rendering the real components therefore means a click on "Save" would write the **Admin's own** data. Three layers, none of them a disabled button:

1. **Edge gate** (`server/view-as/read-only-gate.ts`, first statement of `middleware.ts`): any non-read request (not GET / HEAD / OPTIONS) addressed to the view tree is refused with a generic 403 before any session, action or route handler runs, except `.../start` and `.../exit`. Any non-read request made *by* a view page to another same-origin URL (a client component calling `/api/...`) is refused from its Referer. This covers uploads, deletes, saves, messages, submissions, sign-out and notifications-read posted from the real shell. 9 unit tests + a middleware integration test.
2. **Readers are default-deny** (Phase 2): the view tree reaches data only through `AccountReader.viewAs*` methods that call `admin_view_*` functions. There is no generic Supabase client in the tree, so an unlisted read or an automatic side effect has nowhere to go.
3. **Database**: every `admin_view_*` function is STABLE (cannot write); the only writes are the session functions. pgTAP `134_admin_view_as_strictly_read_only_test.sql`.

Automatic side effects (mark-as-read, last-seen, "viewed" counters, onboarding activation) must not be reachable from a reader. Each page extraction (§3.2) lists them in its parity checklist and the reader simply does not call them.

### 3.2 One page, two data sources (Phase 2, the drift guard)

For every real page `app/home/X/page.tsx`:

```
features/account-pages/x-page.tsx     // async server component: <XPage reader={reader} />  (ALL layout, copy, composition)
app/home/X/page.tsx                   // auth + redirects, then <XPage reader={selfReader} />
app/view-as/[id]/X/page.tsx           // requireViewAs(id), then <XPage reader={viewAsReader(id)} />
```

`AccountReader` is a TypeScript interface with one method per loader the page needs. **A loader added to a real page must be added to the interface, so both implementations stop compiling until the view-as one exists.** That is how a future UI update reaches View-As automatically, and how a new data need cannot silently diverge. The page body, shell and every presentational component are shared, never copied.

### 3.3 Shell, links, banner

* The view tree renders the real shell with the subject's identity (name, avatar, location, search jobs) supplied by the reader.
* `LinkScope` maps every `/home/...` href to `/view-as/<id>/...` so navigation never lands on the Admin's own data. A test fails if a view page renders an `href` starting with `/home`.
* A persistent **"Admin View - Read Only"** banner (subject name, expiry, Exit) sits above the shell. Controls that only make sense for the owner (sign out, switch workspace) are rendered as part of the same shell and refused by the gate; the plan is to show a clear "read-only" notice when the gate answers 403 (Phase 3), never a silent failure.

### 3.4 Media

Real components request `/api/media/...` for the owner. In the view tree the shared media URL builder resolves through the view door (`/view-as/<id>/media/<namespace>/<mediaId>`), so avatars, covers, portfolio images and videos show without storage keys and without weakening ownership authorization. Videos need the same door extended to ranged reads (Phase 3, with its own security review).

### 3.5 Account kinds

`AccountViewDefinition.parity` is `pending` until every page of that kind has a reader, an extracted page, a media path and a signed-off checklist; the eye opens the exact view **only for `exact` kinds**. Craftsman first. No other kind is claimed until its real UI is covered.

## 4. Craftsman parity inventory (from the code, 2026-11-15)

Query modules and embedded Server Actions each real page reaches (transitively). "Reader" = an `admin_view_*` function plus a `viewAs` reader method are needed. Nothing below is built yet.

| Real route | Query modules | Embedded actions | Size |
|---|---|---|---|
| `/home` layout (shell) | business-setup, chat, identity, job-assignments, job-opportunities, notifications, personal-home, profile-identity, sales-persona, workspace | auth, chat, context, notifications, preferences, search | L |
| `/home` dashboard | job-assignments, job-opportunities, network, personal-home, platform, points, profile-identity, registration, reviews, workspace | none | L |
| `/home/profile` | job-assignments, network, onboarding, personal-home, points, portfolio, portfolio-projects, professional-profile, profile-identity, registration, reviews, service-areas, trades, workspace | installer-profile, portfolio, portfolio-projects, profile-identity | L |
| `/home/profile/portfolio` | personal-home, portfolio, registration, videos | portfolio, sales-forms | M |
| `/home/profile/certificates` | personal-home, portfolio, registration | portfolio, sales-forms | M |
| `/home/profile/edit` | activities, onboarding, personal-home, registration, service-areas, trades, workspace | activities, individual-onboarding, service-areas, trades | M |
| `/home/work` (+ `[assignmentId]`) | job-assignments, personal-home, registration, saved-searches, work-board-page, workspace, reviews | saved-searches, work-board | L |
| `/home/jobs` (+ `[jobId]`, `applications`) | job-board-page, job-opportunities, job-assignments, job-match, saved-jobs, trades, personal-home, workspace | job-board, saved-jobs, application-forms, job-forms | L |
| `/home/offers` (+ `[offerId]`) | offers, personal-home, registration | offer-feed | S |
| `/home/network` (+ `[organizationId]`, `refer`) | network, network-referrals, points, personal-home, workspace | network-referrals, auth | M |
| `/home/points` (+ `history`) | points, personal-home, registration, workspace | points-history | S |
| `/home/reviews` (+ `history`) | reviews, personal-home, registration | auth, review-list | S |
| `/home/settings` | personal-home, profile-identity, service-areas, workspace | auth, availability, contact-email, preferences, profile-identity, secondary-phone, service-areas | M |
| `/home/showroom` (+ `refer`), `/home/independent-publishing` | affiliation, sales-persona, independent-publisher, personal-home | affiliation, independent-publisher, sales-forms | S (not Craftsman-primary) |

Existing from #193 and reusable as reader backends: `admin_view_*` functions for dashboard, profile, portfolio, work, points, reviews (migration `20261114090003`), the media door (`20261114090004`), `requireViewAs`, the banner. Not covered by any reader yet: shell data (workspaces, chat, notifications, search), jobs, offers, network, settings, certificates, edit.

## 5. Phases and exit criteria

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0 (done)** | Server read-only gate + tests | Any write into the view tree is refused at the edge |
| **1** | `/view-as/[id]` tree, real `InstallerDashboardShell`, banner, `LinkScope`, `AccountReader` skeleton, registry `parity` flag; the eye keeps the interim view until a kind is `exact` | Shell renders for a real subject; side-by-side shell screenshot matches |
| **2a** | Extract + reader: points, reviews (S) as the pattern proof | Side-by-side identical; compile-time drift guard proven by a deliberately missing reader |
| **2b** | Profile (+ portfolio, certificates, edit), dashboard | Same |
| **2c** | Work, jobs, offers, network, settings | Same |
| **3** | Media seam for every namespace incl. video ranged reads; 403 notice in the shell | No storage key in any response; all media shown |
| **4** | Acceptance side-by-side run, parity checklist signed, `craftsman = exact` | See §6 |

Each phase ships its own migration (`admin_view_*`, pattern A/C only), pgTAP, vitest and an Acceptance run. Phases 2a-2c are the bulk of the work.

## 6. Test protocol (Acceptance)

Same Acceptance Craftsman account, same viewport, same locale/theme, same data state. For every route in §4: (a) owner session screenshot, (b) Admin View-As screenshot, (c) pixel/DOM diff, expected difference = the banner only. Then, per route: every mutating control clicked in View-As must produce **no database change and no audit row for the subject or the Admin** and the gate's 403 (network log); a write attempted from a client component (`/api/...`) must be refused; the subject's private media must display; Exit, expiry, sign-out and permission revocation must cut the view. The checklist rows are the §4 table plus: shell, search overlay, notifications, theme/RTL, scrolling, tabs/filters, empty states.

## 7. Risks and decisions for the owner

1. **Scale.** About 25 query modules and 20 pages. Phase 2 is the work; the gate and seam make it safe, not small.
2. **Route move** to top-level `/view-as/[id]` (own shell, no Admin chrome). Approve or name another prefix. The gate already guards both.
3. **Owner-only shell controls** (sign out, switch workspace, chat send, notification read) render live and are refused by the gate. Alternative: render them disabled with a read-only tooltip. Recommendation: render as the owner sees them; the 403 notice explains.
4. **Videos** need ranged reads through the view door and a separate security review.
5. **Interim**: until `craftsman = exact`, the eye keeps opening the current custom sections. It should be labelled interim in the banner.
6. **Independence from #192 / #200 / #196**: this plan adds no code or migration dependency on them. #193 is stacked on #192's branch only because both edit the Admin Users page; before its merge it is rebased onto `main` (a small conflict set in `app/admin/users/*`) so it can release on its own.
