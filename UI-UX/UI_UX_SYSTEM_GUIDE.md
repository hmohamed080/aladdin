# UI/UX System Guide

<!-- CANONICAL PROJECT MEMORY — read before any UI or design change. -->

| | |
|---|---|
| **Status** | Living document (canonical project memory) |
| **Version** | Living (canonical) · rev 2026-08-26 |
| **Owner** | Design System / UX |
| **Last updated** | 2026-08-26 |
| **Scope** | The design system and UX rules that govern **both** design work in `design.pen` **and** its frontend implementation. |
| **Authority** | Authoritative for UI/UX policy. `UI-UX/design.pen` is the **visual source of truth** for screens/components; root [`DESIGN.md`](../DESIGN.md) is the approved brand-token and design-rule record; frontend semantic CSS variables and Tailwind mappings mirror those approved values. Operational rules for handling `.pen` files live in [`AGENTS.md`](./AGENTS.md). |
| **Update triggers** | Any change to approved tokens, component rules, accessibility target, navigation/account model, or the anti-patterns list. UI/UX changes are recorded here and in `docs/operations/AGENT_WORK_LOG.md`. |

This is **core architecture**, not optional documentation. Concrete brand values and named design rules are recorded in root [`DESIGN.md`](../DESIGN.md), visually embodied in `design.pen`, and mirrored into `frontend/src/styles/tokens.css` + the Tailwind theme. If those artifacts drift, stop and reconcile them here rather than silently choosing one.

> **Approval reality:** the founder approved **The Aperture** identity, type system, and palette on 2026-08-01 from the Brand Toolkit v1 plate. Product components still consume **semantic tokens**; raw brand values belong only in the canonical token definition, not scattered through components.

## Design System Authority (v1.0.0)

The design system is **finalized and versioned** (`1.0.0`, approved/hardened, pre-feature). This guide owns UI/UX *policy*; the token/brand *record* and *process* live in dedicated, versioned files:

- **Brand & token record:** root [`../DESIGN.md`](../DESIGN.md) (semantic version + source-of-truth hierarchy in its metadata block).
- **Canonical machine tokens:** [`../design/tokens/`](../design/tokens/) — colors, typography, spacing, radii, shadows, motion, breakpoints, z-index.
- **Governance:** [`../design/GOVERNANCE.md`](../design/GOVERNANCE.md) — source-of-truth hierarchy, versioning, synchronization edit-order, new-component governance, component-state matrix, motion, **measured AA contrast table**, responsive, RTL, themes, and enforceable **AI-agent design rules**.
- **Component inventory:** [`../design/COMPONENT_INVENTORY.md`](../design/COMPONENT_INVENTORY.md) — search before creating any component.
- **Icon policy:** [`../design/icons/README.md`](../design/icons/README.md) — Lucide default; one library; custom-icon process.
- **Changelog:** [`../design/CHANGELOG.md`](../design/CHANGELOG.md).

**Source-of-truth order:** `PRODUCT_DIRECTION_GUIDE.md` → `DESIGN.md` → `design/tokens/*.json` → **this guide** → `design.pen` → frontend code. No lower source may contradict a higher one. When a token changes, edit `design/tokens/*.json` first, then propagate (see governance edit-order). Any design-system addition must also update `DESIGN.md`, the token file, this guide, the component inventory, `CHANGELOG.md`, and the operations memory in the same change.

## Brand Vision
- Aladdin is a **premium, trustworthy, AI-first operating system** for Egypt's finishing, construction, interior design, furnishing, and supply sector — **B2B-first** with a connected B2C consultation layer.
- The feel is **calm authority**: confident, uncluttered, expert — a professional tool, not a flashy consumer marketplace.
- The approved creative north star is **“The Aperture — a point of intelligent light in precise architectural structure.”** Its chamfered opening and one warm Lumen core abstract guidance and mastery without depicting a lamp, genie, or ornamental heritage motif.
- The **canonical premium direction** is the phone/OTP verification screen family. The old flat "Basic Information / Contact Information" look is the **rejected** direction — do not reproduce it.

## Design Philosophy
- **Consultation-first, not commerce-first.** The product guides *Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up*. Never frame flows as add-to-cart/checkout.
- **Clarity over decoration.** Every element earns its place; whitespace and hierarchy do the work before color or ornament.
- **One system, three surfaces.** B2C (discovery), B2B workspace (Sales is the key daily user), Admin (intentionally darker/utilitarian) share tokens and components — they are skins of one system, not three designs.

## UX Principles
- **Show the next best action.** Screens lead to a real action (a cockpit tile leads to a workflow, not a dead end).
- **Progressive disclosure.** Ask for the minimum now; defer the rest to profile/settings (mirrors the passwordless one-primary-contact flow).
- **Trust signals over hype.** Verification, ratings, and provenance are surfaced; no pushy pricing pressure.
- **Bilingual by construction.** Every layout works identically in Arabic (RTL) and English (LTR).
- **No technical leakage in copy.** Never surface implementation terms ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", server notes).

## Information Hierarchy
- Each screen has **one primary object** and one primary action; everything else is secondary/tertiary and visually subordinated.
- Order of emphasis: **eyebrow/step → title → primary content → supporting → actions.** The `Progress Header` eyebrow ("Step X of Y") sets context on flow screens.
- Use size, weight, and `$text-secondary`/muted tokens to encode rank — **not** color alone.

## Grid & Layout System
- **Mobile** flow-screen recipe (canonical): header row = **language switcher (leading)** + **back row (trailing:** "Back/رجوع" label + chevron pointing toward the back direction**)**, header padding `[16,20]`, **no border**; body gutters `[·,24]`, vertical gap `16`.
- **Desktop auth/marketing** = **split panel**: Brand Panel (3D-style artwork, later video/WebGL) + Form Panel. Do not flatten these into a single centered column.
- **Progress track widths:** mobile ≈ `342px`, desktop ≈ `960px`; bar width = `ratio × track`.
- Content max-widths keep line lengths readable; workspace/dashboard uses a consistent content column beside the sidebar.

## Typography
- Approved families: **Archivo** for Latin brand/display, **Reem Kufi** for Arabic brand/display, **Readex Pro** for bilingual product UI, and **JetBrains Mono** for EGP figures, RFQ/quote codes, and quantities.
- Type scale is **token-driven**: `$fs-label` (≈13), `$fs-body` (≈14), `$fs-body-lg` (≈16), plus heading steps — exact values are recorded in `DESIGN.md` and mirrored into the frontend theme.
- Field pattern: **label `$fs-label`**, **value `$fs-body-lg`**, leading icon `20`.
- Product UI stays in Readex Pro so Arabic and Latin share first-class coverage and matched metrics; Archivo/Reem Kufi are reserved for brand and headline moments.
- Never encode meaning with italics in Arabic; use weight/size/color tokens instead.

## Spacing Rules
- Spacing is a **token scale** (4-based); use tokens, never arbitrary pixel values.
- Canonical rhythm: screen gutters `24` (mobile body), header padding `[16,20]`, inter-field gap `16`, field height ≈ `64`.
- Group related fields with tighter gaps; separate sections with larger gaps — spacing, not dividers, is the first grouping tool.

## Color System
- **Semantic tokens only** in UI and code: `$text` / `$text-secondary`, surface/background, `$border` / `$border-strong`, primary/accent, and status (success/warning/danger/info). Concrete values are recorded in `DESIGN.md`, embodied in `design.pen`, and mapped to CSS variables + the Tailwind theme.
- Approved roles: Basalt/Limestone are authored grounds; Ink/Limestone carry primary actions; Lumen is reserved for brand, AI, and focus; Bronze means trust/verification; Lapis carries data/information. Normal-size text uses accessible semantic tones from their approved ramps rather than assuming every brand primitive is text-safe.
- **Every color exists in both light and dark** with adequate contrast in each — a token is incomplete if only one theme is defined.
- Color is a **reinforcement**, never the sole signal (pair with icon/label/shape) — required for accessibility and RTL parity.
- Do **not** introduce raw hex in components; add/adjust a token instead.
- **Data-visualisation series (added Sprint 14):** a single accent cannot express a categorical chart — a spend-by-category donut needs as many distinguishable fills as it has categories. `--series-1…6` (+ `--chart-grid`) are the approved categorical ramp, exposed in Tailwind as `series-1…6`. Every value is an **existing brand primitive**, ordered so adjacent series differ in lightness as well as hue, and defined in **both** themes with the same hue per index (a chart must not change meaning when the theme flips). Series colours are **non-semantic** — `series-5` is not "bad"; success/warning/danger keep their meaning. Charts must always label their series in text: colour stays a second channel.

## Charts
- Charts are **inline SVG rendered on the server** (`components/ui/charts.tsx`) — no charting library, no client component, no runtime dependency. The four shapes the product needs (trend, proportion, ranked comparison, funnel) are a path, a dashed circle, a flex row and a list.
- Every chart is `role="img"` with an `aria-label`, and carries an `sr-only` list of its **actual values** — a screen reader gets the data, not a description of a picture.
- **Direction:** value/time axes stay LTR in both locales (an Arabic dashboard still reads a Jan→Jun trend left to right, and digits are LTR anyway). Ranked bars, legends and funnels are text lists — they follow document direction and grow from the inline start.
- **Numerals:** see *Numerals and formatting* below. Mixing Arabic-Indic money with a Latin `57%` in one row is a defect, and so is a chart value or axis bound that skipped the shared formatter.
- **Empty is a first-class state**: a chart with nothing behind it renders a sentence, never an empty axis pretending to be a measurement. No targets, forecasts or growth percentages unless the database actually produces them.

## Numerals and Formatting

**Every user-facing number goes through the one shared formatter layer (`lib/ui/format.ts`).** Not "supply-side numbers" or "report numbers" — all of them: KPI counts, money, quantities, percentages, dates, times, relative time, pagination, badge counts, table cells, chart values and axis labels, dashboard statistics.

- **Arabic renders Arabic-Indic digits** (٠١٢٣٤٥٦٧٨٩); English renders Western digits. This is not decoration — a screen that shows ١٢ in one panel and `12` in the next reads as two products stitched together.
- **The locale tag names the numbering system explicitly** (`ar-EG-u-nu-arab`). `ar-EG` alone lets each runtime's ICU choose, and the server, the browser and CI need not agree. Format with `Intl`; never substitute digits by hand — hand substitution also mangles the grouping separator, the decimal mark, currency placement and the bidi marks `Intl` emits.
- **A bare `{value}` in JSX is the bug.** A `number` interpolated into JSX or into a message template stringifies through `Number.prototype.toString`, which is locale-blind. Shared primitives that render numeric props take a **required** `locale` so the compiler — not a later grep — proves the coverage.
- **Technical identifiers are the exception and stay Latin in every locale**: order/RFQ references (`ORD-1256`), SKUs, UUIDs, VAT numbers, emails, URLs, API strings. They are looked up, dictated down a phone and compared character for character; reshaping their digits produces a reference that does not match the record it names. Mark the intent with `formatIdentifier()` and render them `dir="ltr"` inside RTL text.
- **Content is not a number.** A product name (`Porcelain Floor Tile 60×60`) or a supplied description keeps whatever digits its author wrote.
- **No second copy.** There is exactly one `Intl` construction site in the codebase. A feature that formats its own numbers is how two numeral systems end up on one page.


## Dark Mode Rules
- The **only** theme axis is `mode: light/dark`. Platform/device/language are naming lanes, **not** theme axes — never fork a component per language for theming.
- Dark is a **first-class, designed** theme (not an inverted filter): surfaces use layered elevation, borders shift to `$border-strong` equivalents, and contrast is re-verified against WCAG AA in dark.
- **Admin surfaces are intentionally dark** by default — keep that deliberate, don't "fix" it to light.
- Implement via a `dark` class on `<html>` (Tailwind `darkMode: "class"`); tokens resolve per theme.
- **The dark GROUND is the Carbon ramp, never Basalt.** Basalt is a brand colour — the Aperture mark,
  the auth brand panel, modal scrims. It is not a workspace ground: at `#0e1113` a full-height sidebar
  and an empty table region both read as dead space, and the jump from it to the card surface made
  every panel look like it was floating in a hole. Carbon is neutral (no blue cast), starts at
  charcoal rather than near-black, and steps a few points of lightness at a time:
  `--carbon` canvas → `--carbon-2` surface → `--carbon-3` state layer, with `--carbon-line` borders
  sitting only just above the surface they divide. **Contrast is carried by the TEXT**
  (15.7 / 7.7 / 4.8 : 1 on both canvas and surface), not by making surfaces lighter — a dark theme
  whose cards are obviously lighter than the page has drifted halfway to white by the fifth nesting.
- **Elevation is a LEVEL, not a colour.** `shadow-sm` / `shadow-card` / `shadow-lg` all resolve
  through `--shadow-raised` / `--shadow-card` / `--shadow-overlay`, which each theme defines for
  itself: a warm 4% wash on Limestone, a deeper and tighter black on Carbon. Never hardcode a shadow
  in a component — a single fixed shadow tuned for light is invisible on a dark ground, which is
  exactly how dark cards ended up with no edge and dropdowns that did not lift off the page.

## Navigation System
- **Surface-appropriate navigation:** B2C = discovery-style top navigation + prominent search; B2B/Admin = **workspace shell with a sidebar**.
- **Navigation is derived, not toggled.** There is no Profile Switcher and no "Use As" mode. What a user sees is derived from their **primary account type, organization membership, branch assignment, permission capabilities, verification state, and subscription state** — a user has one current primary account type at a time. Roles stay separate in the taxonomy; never build a persona/account-identity switching control.
- **Work context is not persona.** Selecting the active **workspace** — the user's personal surface, or an organization where the same user has an **active membership** — is an allowed, different concept from persona switching, and is how a user with several organizations moves between them on one login. Workspaces are derived (Personal = User+Profile · Business = Organization+active Membership). Copy must read as *changing where you are working*, never as *changing who you are*; never label it a profile/role switch. **Not yet built** — see PRODUCT_DIRECTION_GUIDE *Switching*.
- Primary nav exposes the core journeys, not an exhaustive site map. Keep depth shallow; provide breadcrumbs in deep workspace flows.
- Navigation is fully **RTL-mirrored** (leading/trailing, chevron direction, back gestures) in Arabic.

## Sidebar Behavior
- Persistent on desktop workspace; **collapsible** to icons; off-canvas drawer on mobile/tablet.
- Reflects the user's **derived capabilities** — items the current account type / membership / permissions don't grant are hidden, not shown-disabled (authorization is also enforced server-side; the UI never implies access it can't grant).
- Active item is unambiguous (token-based active state); collapsed state keeps icon + accessible label.
- Mirrors to the **trailing edge in RTL**.

### Desktop display modes (three, and only three)
The desktop sidebar offers **Expanded · Collapsed · Expand on hover**. These are **presentations of one navigation**, never different navigations: the capability-derived item set, the grouping and order, the active-route rule and the RTL mirroring are identical in all three. A mode that hid a module the user has the capability for would be a defect, not a density option.

- **Expanded** — icons + labels + group headings at full width. The brand lockup leads the top row and the mode control trails it.
- **Collapsed** — a narrow icon rail, and **icon-only means no painted text of any kind**. The mode control *replaces* the lockup and centres; it does not sit beside a shrunken copy of it. Every item keeps its localized label as its **accessible name** and nothing more: no visible caption, no floating tooltip, no `title` attribute, no duplicated route name.
- **Expand on hover** — rests collapsed and reveals on pointer entry or keyboard focus.

**The control lives at the TOP of the sidebar, and it answers two gestures.** A **click** is a binary Expanded ↔ Collapsed toggle — the one choice a reader makes most often. A **hover or keyboard focus** opens a menu naming all three modes, which is the rarer, deliberate choice. Collapsing both into one menu-behind-a-click makes the common case cost two clicks: open the menu, then pick the state you are already looking at. The menu is **portaled above all content**, because the control travels between the centre of a rail and the trailing edge of an expanded panel and a menu clipped by its own scroll container is a bug waiting on a narrow screen.

**The reveal PUSHES the workspace; it does not overlay it.** *(This reverses the earlier rule, deliberately — see Change History 2026-08-26.)* The sidebar widening **is** the application's own width changing, so the spacer that reserves its width animates on the same spring the panel does and the two stay in lockstep. The old rule forbade this because a hover-widened layout element reflows the page on every pointer pass; what makes it safe here is that both boxes are driven by **one** spring off **one** value, so there is no second element racing to catch up, and the width the server renders comes from the mode cookie so the first paint is never wrong.

### Sidebar hierarchy — quick access, then groups
The rail is **not** a flat list, and it is **not** entirely grouped. Both were tried:

- **Quick access** — the handful of modules a caller opens every day sit at the top with no heading and no collapse. Burying daily-use routes one hover-delay behind a heading to keep the rail tidy optimizes the wrong thing.
- **Secondary groups** — everything else lives under a collapsible heading (Network, Selling, Sourcing, Business). Groups start **closed**, except whichever one holds the current route. A rail that greets the reader with every group open buries the five items that matter under nine that do not.

**Collapsed groups keep their identity.** On the rail a closed group draws **one representative icon**, not its flattened children — a group the reader left closed must not spill four icons the moment the sidebar narrows, which would expose exactly the state the expanded rail had just hidden. Clicking that icon reveals the group's own child icons vertically beneath it, and **only one collapsed group may be open at a time**, or the rail grows without bound.

**A closed group is `inert`, not merely clipped.** Hiding rows with a zero-height track and `overflow: hidden` hides them *visually and nothing else*: the links stay in the tab order and in the accessibility tree, so a keyboard user walks through a dozen links they cannot see and a screen reader reads out a navigation the sighted user deliberately collapsed. Use `inert` on the collapsed subtree — it removes both at once without killing the height transition the collapse is built on.

### Active route
- A **rounded, calm band, inset on both sides.** Not a one-sided surface that touches the material's edge on one side and floats free on the other — that reads as cut off.
- The active surface is a **wash of the sidebar's own material** (a little white mixed into its lit tone), never the page's ground. A near-white pill on a saturated rail reads as an object pasted on top of it rather than a row lifted out of it — and it needs no cast shadow, because a dark shadow under a light-on-dark wash is a smudge, not a depth cue.
- The active label takes the rail's own **full-strength foreground**, not an inverted ink tuned for a light pill.
- **If the active route is inside a group:** the group opens automatically, the active *child* carries the stronger selected background, and the parent group gets only a subtle "open" indication. The two cues are different things — a group can be open with no active route inside it, and active without being open — so they must never be drawn with the same treatment or they will fight for the single travelling carve.

### Fixed bottom actions
- **Settings** and **Upgrade your plan**, pinned below the scrolling list as a sibling so they can never scroll under it. Both the top row and this block are `shrink-0`; the nav list between them is the only flex item allowed to grow *or* shrink, and it owns the overflow.
- **Exactly one Settings entry** in the whole rail. It is filtered out of the capability-derived list precisely so the fixed one is the only one — a Settings that appears both inside a group and at the foot is two answers to one question.
- **Upgrade is one unified button surface.** One fill on the row itself — never a tinted icon tile stacked on an identically tinted row, because two translucent fills of the same colour compound and the icon reads as a darker box nested in a lighter one.
- **No divider above this block.** A rule plus a fill there reads as a second component stitched onto the foot of the sidebar rather than the same sidebar continuing.
- Collapsed, both rows are icon-only and therefore **must** carry an `aria-label` — without one the link has no accessible name at all.

**The compact rail paints no text — including its own control.** Hover and keyboard focus light the **icon tile itself** (a subtle surface, a soft shadow, a short transition, and a focus-visible ring), and the active item stays visually stronger than any hover. Two rules follow, and both are things this rail got wrong before:

- **No floating caption beside an icon.** A caption over page content flickers a box in and out as the eye runs down the rail, and in expand-on-hover it races the reveal — printing the same label twice, in two places, at once.
- **The sidebar-mode control is icon-only whenever the chosen mode is not Expanded.** Its label must be gated on the **chosen mode**, never on the panel's current width: width is momentary, so a width-gated label appears the instant a pointer approaches in expand-on-hover and announces the mode the user is already in. The mode names belong **inside the menu the control opens**, where the user is choosing between them — not on the closed control.

Nothing is lost for assistive technology: the accessible name carries the localized label, and the control's accessible name also names the **active mode**, so a screen-reader user is told more than the sighted user sees, not less. Only the painted text is removed.

**Direction.** The reveal always grows *inward toward the content* — rightward in English, leftward in Arabic — and the control's glyph stays direction-neutral rather than implying a side.

**Persistence.** The chosen mode is a **per-browser** preference stored in a cookie, never in the database. A cookie (not `localStorage`) because the mode decides a **width**: read only after hydration it would paint the wrong layout first and snap. Nothing about this preference is account state.

**Mobile is out of scope for these modes** — the phone keeps its bottom bar + More sheet unchanged.

### Horizontal card rails
For **dense groups of peer cards** that would otherwise wrap into several rows and push the real work below the fold — KPI/summary strips, the dashboard's action ramp, analytics summary groups. One reusable component, not a carousel library.

- Cards stay side by side in one row and **hold their width instead of shrinking** — the reason a six-tile money strip no longer truncates its figures.
- Overflow is contained inside the rail; the **page itself must never scroll sideways**.
- Controls appear **only when the content actually overflows**, disable at each end, and move by a whole card group. Where everything fits on a wide desktop, no control is drawn at all.
- CSS scroll snapping, smooth scrolling (respecting reduced motion), native trackpad/wheel and touch swipe. Controls are real buttons; an overflowing rail is keyboard-reachable.
- **RTL is normalized explicitly.** `scrollLeft` does not follow writing direction — in RTL it rests at 0 and travels negative — so position is read as a distance (`Math.abs`) and every scroll flips its sign from the active direction. Never assume left means previous.
- **Do not** convert data tables, main report charts, forms, or large operational lists into rails. Those are scanned and compared down the page; hiding half of one behind a swipe is a regression.

## Workspace Shell & Surface Language
The canonical B2B composition. Approved 2026-08-26; it supersedes the earlier three-plane "frame" shell entirely (see Change History).

### Two materials and a field
- **The sidebar carries the saturated dark colour; the workspace is light.** Not the other way round. A large expanse of low-luminance colour was tried as the workspace ground twice and read as heavy both times — "atmospheric" is not a synonym for "dark".
- **The workspace is an ATMOSPHERE, not a fill:** a soft cool-mineral base with three restrained pools — a seam pool at the sidebar's own corner, a quieter mineral pool lower down, and one warm Lumen note. It is fixed to the **viewport**, never sized off the document, so it does not drift or re-tile as a long dashboard scrolls.
- **The seam pool is the sidebar's own hue, diluted by the room.** That single fact is the whole mechanism behind the sidebar reading as integrated with the environment rather than pasted beside it. Mix pools toward the mesh's own light tone, never toward white — mixing toward white produces a spotlight, and a room is not a spotlight.
- **Nothing between the field and the cards is a panel.** The shell root and the page body paint no fill, no border and no shadow; their transparency is what makes the atmosphere visible in every gutter. Any visible edge drawn around the whole dashboard reads as *"the dashboard sits inside a container"* — the one claim this composition must not make.
- The `<body>` ground must match the atmosphere's base, so overscroll at either end of a long page and any route too short to fill the viewport reveal **more of the same field**, never a mismatched flash.

### Surface hierarchy — and do not wrap everything in a card
Workspace background → page heading and content → operational surfaces (cards/boards) → contextual surfaces (menus, popovers) where genuinely needed. Content that is simply *on the page* stays on the page.

- **Cards are the only surfaces.** They carry the reader's attention precisely because the field behind them does not.
- **Elevation is a level, not a look.** Light: a tight contact shadow plus a soft diffuse one, tinted toward the shell's colour family rather than neutral grey — a neutral shadow on a blue field reads as dirt. Dark: a cast shadow barely registers on a dark ground, so the lift comes from a **highlight edge plus a stronger border** instead. Same grammar, roles swapped for what actually reads.
- **Board headers** carry a title, an optional count, and a control cluster (scope select · state toggle · overflow menu). **Board footers** carry one "view all" action out to the full list.
- **Filters and chips are flat and borderless** — a bordered filter competes with the page's primary action. Hierarchy: one solid primary, one outlined secondary, everything else a quiet chip.
- **Avoid:** nested cards everywhere, excessive pills, arbitrary icon boxes, stacked shadows, and generic SaaS gradients.

### The header
- **Sticky, with breathing room while stuck.** It stays in view as the workspace scrolls under it, and it sticks at the shell's gutter unit — never `top: 0`, which flattens a floating rounded card into a bar wedged into the viewport corner.
- **Translucent chrome the atmosphere shows through**, not a second opaque page layer. Equal leading/trailing margins; the leading side is supplied by the sidebar's own gutter, so the trailing padding must **match that gutter exactly** or the card sits closer to the sidebar than to the viewport edge.
- **Muted tokens inside it need a contrast nudge.** They are tuned against an opaque surface; composited over a translucent, lighter header they measure under their 4.5:1 target. Nudge toward the `-secondary` neighbour, not to full foreground — subordinate chrome must not become as loud as the context beside it.
- **Never style it with a bare `header` selector.** Boards render their own semantic `<header>`; a bare selector froze every card's title row to the viewport while its card scrolled underneath. Use an explicit component attribute, and put the **variant in its value** — the same header component also renders on shells that have no atmosphere behind them and must keep their opaque bar.

### Search
Visual promotion only — behaviour is unchanged.
- **Light:** a near-opaque Quartz surface, calm border, readable input text, muted placeholder, subtle shortcut badge. Not heavily translucent: stacked on the header's own translucency it reads as a grey smear rather than a surface.
- **Dark:** a **lifted** charcoal-mineral surface with a real border — visibly distinct from both the header and the page. Never near-black.

### Radius, spacing and motion
- **Radius scale:** nav row < button < card. A row and a button that share a radius stop announcing which is which.
- **Gutters are the composition, not spacing preferences** — they are the only apertures through which the field is visible. The sidebar owns the gutter between itself and the cards, because the active-route carve crosses it.
- **Motion only where it communicates state:** sidebar width change, group expand/collapse, active-route travel, hover reveal, popover appearance. Everything honours `prefers-reduced-motion` — under it the carve **jumps** between positions rather than tweening.

### What is global, and what is not
The **design language** is global. The **navigation content and the modules are not.**
- Role, organization type, capabilities, permissions and route visibility continue to decide what a rail contains and what a dashboard renders. Never achieve visual consistency by flattening role differences.
- Supplier-only modules (incoming demand, quotations to answer, product videos) must not appear on buyer, consumer or admin surfaces.
- Surfaces with a fundamentally different shell — the personal `/home` surface and the Admin console — keep that shell. Apply the canonical language to their own components where it fits; do not force B2B modules into them.

## Dashboard UX
- Dashboards/cockpits are **action surfaces, not vanity walls.** Every tile answers "what should I do next?" and links to a real workflow (Sales cockpit → Opportunity/Need/Match/Follow-up/Quote/Pipeline/Task).
- Lead with the operator's live pipeline/queue; summaries and charts support, they don't headline.
- Dashboards are built **after** the inner workflows they summarize exist (roadmap: 05E last).

## CRM Workflow UX
- Sales is the **key daily-active user**; optimize for speed and low friction: keyboard-friendly, minimal clicks from Opportunity → Quote.
- Model the pipeline as explicit **stages** with clear status, next-step, and owner; status changes stream live (see Notifications/Realtime).
- **Smart Share** and follow-up drafting are AI-assisted but always **human-reviewable** before send; never auto-send on the user's behalf silently.
- Keep record, activity timeline, and next action visible together — no hunting across tabs for context.

## Tables & Data Views
- Use a real data-grid pattern (TanStack Table) for sortable/filterable/paginated business data; not hand-rolled tables for anything non-trivial.
- **Server-side** sort/filter/paginate for large sets; never fetch unbounded rows.
- Column set is intentional: identity + status + key metric + action. Support row density appropriate to the surface; make row actions discoverable, not hover-only on touch.
- Empty leading/utility cells are **explicit, named** structure (not "broken"); every column has a header (even if visually empty by design).
- Numbers/dates/currency use locale + **EGP** formatting; align numerics; RTL tables mirror column order.

## Forms & Validation
- **React Hook Form + Zod**; the Zod schema is the single validation source shared client/server. Validate at boundaries, trust internal state.
- Field anatomy: label `$fs-label`, value `$fs-body-lg`, `20` icon, `$radius-md`, height ≈ `64`, `$border-strong` stroke; consistent across the app.
- **Inline, specific, non-blaming** errors next to the field; summarize only for long forms. Validate on blur/submit, not on every keystroke.
- **Passwordless:** no password/confirm-password/forgot-password fields anywhere. OTP/verification uses the approved verification-field component.
- Long flows support **autosave / save-and-continue** with a visible indicator; show a `Progress Header` with step count.

## Modals & Drawers
- Use sparingly for **focused, interruptive** tasks. Prefer a **drawer** for contextual side-tasks that keep the parent visible; a **modal** for a blocking decision.
- Never nest modals. One clear primary action; explicit dismiss; **Esc + backdrop** close (unless data-loss risk → confirm).
- Trap focus, restore focus to the trigger on close, and lock background scroll. Full-screen sheets on mobile instead of cramped centered modals.
- **Do not trigger native browser dialogs** (`alert`/`confirm`) — use in-app components.

## Notifications
- Real-time surfaces (via Supabase Realtime) for: notifications, opportunity status, task updates, verification status, project activity, inventory availability, quotation status.
- **Match urgency to mechanism:** toast for transient confirmations, inline banners for contextual state, a notification center for history. Don't toast critical, actionable items that need a decision.
- Toasts auto-dismiss (non-critical), are pausable on hover/focus, and are announced to assistive tech. Never convey a status by color alone.

## Empty States
- Every list/table/dashboard has a **designed** empty state — never a blank area. Explain what goes here and offer the **primary action** to fill it.
- Distinguish **empty** (nothing yet) from **no results** (filters too narrow → offer "clear filters") from **error** (something failed → offer retry).
- Keep tone helpful and specific to the surface; no generic "No data."

## Loading States
- Prefer **skeletons** that match final layout for content regions (reduces layout shift); use spinners only for small inline/button waits.
- **Optimistic UI** for quick, low-risk mutations with rollback on failure. Disable + show progress on submit buttons to prevent double submit.
- Never block the whole screen for a partial update. Long/expensive work (OCR, imports, embeddings) runs in the background with progress + Realtime status, not a frozen UI.

## Accessibility
- Target **WCAG 2.2 AA**. Contrast verified in **both** light and dark — semantic token pairs were **measured** (min light 4.84:1, min dark 5.40:1; primary-action 15.64:1). Full table: [`../design/GOVERNANCE.md`](../design/GOVERNANCE.md#accessibility).
- **Muted-On-Sunk exception:** `fg-muted` clears AA on the canvas/surface (4.84:1 on Quartz) but **not on the secondary fill** (4.47:1 on Quartz Sunk) — there use `fg-secondary`/`fg` for normal-size text. The Quartz ground narrowed this gap from 4.27:1; it did not close it.
- Component-level a11y (keyboard traversal, focus trapping, SR labels, tab order, touch targets) is **verified per component at implementation**, not claimed up front — it is a `Ready` gate in the component inventory.
- Full **keyboard** operability; visible focus states (token-based); logical tab order; focus management in modals/drawers/route changes.
- Semantic HTML + ARIA only where semantics fall short; all interactive controls have accessible names; icons-only buttons carry labels.
- Respect `prefers-reduced-motion`; never convey meaning by **color alone**; hit targets meet the WCAG 2.2 target-size guidance (≥ 24px minimum; ≥ 44px preferred on touch).
- **RTL is an accessibility requirement**, not a nicety: correct `dir`, mirrored layout/icons, and correct bidi handling of mixed AR/Latin/numeral content.

## Animation System
- Motion is **functional**: orient, show relationships, confirm actions — never decorative filler.
- Token-based durations/easing; keep UI transitions short (≈150–250ms) with standard easing; avoid long, blocking animations.
- Animate transform/opacity (cheap), not layout properties. Everything **honors `prefers-reduced-motion`** (reduce to instant/opacity).
- Ambitious visuals (auth Brand Panel 3D/WebGL/video) stay **isolated to their surface** and must degrade gracefully.

## Responsive Design Rules
- Design **Desktop + Tablet + Mobile** (PWA); the design lanes are naming lanes, not separate products.
- **Mobile-first tokens**, enhance up. Reflow, don't shrink: sidebar → drawer, table → stacked/prioritized columns, split-panel → stacked.
- Test every breakpoint in **both** LTR and RTL and **both** themes. Touch targets and gutters follow the spacing tokens.
- The page body never scrolls horizontally; wide content (tables, wide cards) scrolls within its own container.

## Canvas Screen Organization
- `design.pen` permanently follows **Product Surface → Flow → Device → Theme → Sequence**.
- Product-surface areas remain separate: Authentication, B2C/Consumer, Professional/Talent, B2B/Business, Admin, Shared/System, Foundation/Components/Documentation, and Archive.
- Device order is always **Desktop → Tablet → Mobile**. Theme order inside every device is always **Light → Dark**.
- Main-path screens follow screen-ID and user-flow order. Supporting states, errors/exceptions, responsive tests, and specifications use separate labelled lanes and never interrupt the happy path.
- Canonical viewport lanes are Desktop `1440 × 1024`, Tablet `768 × 1024`, and Mobile `390 × 844`. The `360px` and `430px` frames are responsive tests in a separate lane, never substitutes for Mobile 390px.
- Missing approved coverage remains visible through workspace-only placeholders in the correct device/theme lane. Coverage is tracked independently for Desktop Light, Desktop Dark, Tablet Light, Tablet Dark, Mobile Light, and Mobile Dark; one existing variant never implies full completion.
- Existing product screens are locked during organization work. Only complete screen frames may be repositioned or reparented; internal UI is not changed for canvas organization.
- Every design task must validate hierarchy, sequence, lane assignment, and independent-frame overlap before completion. New screens are placed directly in their permanent lane, never left in temporary nearby space.

## Component Consistency Rules
- **Reuse the component library first.** The canonical component library lives in `design.pen`; do not create a near-duplicate — extend or add a variant to the existing master. (Do not hardcode a component count here; the library in `design.pen` is the source of truth.)
- One canonical component per concept (one field, one button system, one alert, one progress header). Prefer instance overrides (`descendants`) over forked copies.
- Frontend components map 1:1 to design-system components and consume **tokens**, not literals. A visual change happens at the token/component level, propagating everywhere.
- Confirm a screen/component is **approved** (QA authority: board `00H`) before implementing — ignore historical QA boards and prior "complete/ready" labels.

## Anti-Patterns To Avoid
- **Commerce framing:** add-to-cart, checkout, buy-now — this is consultation-first.
- **Password UI:** sign-in-with-password, forgot/reset-password — the product is passwordless (WhatsApp/Email OTP).
- **Profile-switching UI:** a Profile Switcher, a "Use As" mode, or any control that swaps a user's persona/account identity — navigation is **derived**, not toggled; one current primary account type at a time. *(A **work-context / workspace** selector across the user's own personal surface and their active organization memberships is **not** this anti-pattern.)*
- **"Create an account, then create an organization" framing:** a business is created **once**; never make the user feel they are opening a second account, and never present owner/manager as a business type.
- **Technical copy in UI:** "WhatsApp Business API", "reCAPTCHA verified on server", "canonical account", schema/stack jargon.
- **Design-scaffolding in production:** QA labels, "SAMPLE/DEMO" ribbons, session/agent tags, placeholder lorem.
- **Merging roles** because they look similar — roles stay separate (End Consumer, Installer, Engineer, Interior Designer, Showroom, Supplier, Manufacturer, Importer, Wholesaler, Sales, Contractor, Trainer, Trainee, Admin).
- **Diverging from the approved Aperture identity** or scattering its raw logo/font/hex values through components instead of semantic tokens.
- **The rejected flat direction** ("Basic/Contact Information" old look) instead of the premium OTP direction.
- **The superseded three-plane "frame" shell** — a flat pale frame colour behind the chrome, a bordered/shadowed body panel wrapping the whole dashboard, and a near-black navy sidebar. It is not an alternative to the current direction; it is the thing the current direction replaced.
- **Identity-gated presentation** — branching any visual system on *who is signed in* (`user.email === …`) rather than on capability, org type or route. A design system is a property of the product, not of an account.
- **Anti-AI / visual-quality constraints:** generic SaaS gradients, glassmorphism-for-its-own-sake, an icon in a tinted box beside every label, a pill around every noun, a shadow on every element, and decorative illustration standing in for information. Every surface, tint and elevation must be answerable with what it distinguishes.
- **Color-only signaling**, single-theme tokens, non-mirrored RTL, dead-end dashboard tiles, hover-only actions on touch, native `alert/confirm` dialogs, unbounded tables, and full-screen blocking spinners for partial updates.
- **UI implying access it can't grant** — authorization is enforced server-side (RLS); never show data or actions a user isn't entitled to.

## Change History
Newest first.

### 2026-08-26 — The approved visual direction becomes the canonical design system
- **What:** Promoted the reviewed-and-approved workspace visual system out of a one-account prototype gate and into the shared design system. New **Workspace Shell & Surface Language** section (two materials and a field, surface hierarchy, header, search, radius/spacing/motion, and what is global vs role-specific). Rewrote **Desktop display modes**: the mode control moves to the **top** of the sidebar and answers a click (binary toggle) and a hover/focus (mode menu) differently; the hover reveal now **pushes** the workspace instead of overlaying it. Added **Sidebar hierarchy** (quick access + collapsible groups, one open collapsed group at a time, `inert` when closed), **Active route**, and **Fixed bottom actions** (one Settings, unified Upgrade, no divider). Added the superseded frame shell, identity-gated presentation, and the anti-AI constraints to *Anti-Patterns*.
- **Why:** The direction was approved in the running application, so the gate it was reviewed behind (`user.email === "fady@example.test"`) had to go — a design system that depends on who is signed in is not a design system. Two of the rules here **reverse** earlier ones and both reversals are deliberate. The hover reveal was forbidden from resizing the document because a hover-widened layout element reflows the page on every pointer pass; what makes pushing safe is that the panel and the spacer that reserves its width are driven by **one** spring off **one** value, with the server-rendered width coming from the mode cookie. And the mode control moved out of the footer because a click there opened a three-item menu to change a state the user could already see, making the common case cost two clicks.
- **Also corrected while promoting, because production is a higher bar than a prototype:** collapsed nav groups were clipped but still focusable and still announced (now `inert`); the collapsed Settings/Upgrade rows had **no accessible name at all**; the Upgrade label was an inline `locale === "ar" ? …` ternary the AR/EN parity check could not see; and the Arabic Reels title carried an untranslated "(Reels)". The shell-palette A/B proposal is **settled and removed** — neither candidate won; the adopted shell is a third value chosen against a light workspace.
- **Known gap, deliberately not closed here:** the dashboard period selector was pulled from the page heading row on review (it competed with the primary action). The period still resolves from the URL and every comparison still computes from it, but there is currently **no UI to change it**. That needs a placement decision, not a re-add of the rejected control.

### 2026-08-18 — Numerals-and-formatting rule; the compact rail paints no text
- **What:** Added *Numerals and Formatting* as a first-class section: every user-facing number goes through the one shared formatter layer, Arabic renders Arabic-Indic digits with the numbering system **named in the locale tag** (`ar-EG-u-nu-arab`), and technical identifiers (order refs, SKUs, UUIDs, emails, URLs) are the explicit exception that stays Latin in every locale. Rewrote the **Collapsed** and **Expand on hover** rules: icon-only now means *no painted text of any kind* — no caption, no tooltip, no `title`, and the sidebar-mode control itself is icon-only whenever the chosen mode is not Expanded. The chart *Numerals* bullet now points at the new section instead of restating half of it.
- **Why:** Both rules were written down only after real-browser UAT found them violated, and both violations came from a gap the old text left open. The numeral rule previously existed only as "anything beside money must match money", which said nothing about the ninety-odd places that rendered a bare count — so an Arabic dashboard showed ١٢ and `12` on one screen. The collapsed rule previously *required* a visual tooltip, which is what produced a caption racing the hover reveal and the same label painted twice; and it gated the mode control's label on the panel's momentary width rather than the chosen mode, so the rail announced the mode you were already in the instant you reached for it. Tokens, themes, spacing, typography and accent behavior are unchanged.

### 2026-08-16 — Workspace sidebar display modes + horizontal card rails
- **What:** Added two interaction rules to *Sidebar Behavior*. The desktop workspace sidebar now documents exactly three display modes (**Expanded · Collapsed · Expand on hover**) as presentations of ONE capability-derived navigation, with the hover reveal required to **overlay inward** rather than reflow the document, direction-neutral control iconography, and a **per-browser cookie** (not `localStorage`, not the database) because the preference decides a width. Added **Horizontal card rails** as an approved pattern for dense peer-card groups, including the explicit RTL `scrollLeft` normalization rule and the list of surfaces that must **never** become rails (data tables, main report charts, forms, large operational lists).
- **Why:** The workspace needed Supabase-level chrome behavior without importing Supabase's visual language. Writing the rules down here — rather than leaving them in one component — is what stops the next surface from inventing a fourth sidebar mode or turning an operational list into a carousel. Existing tokens, themes, spacing, typography and accent behavior are unchanged; this is behavior, not restyling.

### 2026-08-01 — Finalized & hardened the Design System (v1.0.0)
- **What:** Established the design system as a **versioned** system (`1.0.0`). Added canonical machine-readable tokens (`design/tokens/*.json`), `design/GOVERNANCE.md` (source-of-truth, versioning, component & AI-agent rules, measured AA contrast), `design/COMPONENT_INVENTORY.md`, `design/icons/README.md`, and `design/CHANGELOG.md`. Added the Design System Authority section and the measured-contrast + Muted-On-Sand accessibility notes here. Fixed a broken dark-theme primary token in the frontend and added motion/z-index/breakpoint tokens + `prefers-reduced-motion`.
- **Why:** Make the approved brand a governed, enforceable, versioned system before any product-feature work — one authority chain, no invented values.

### 2026-08-01 — Approved The Aperture identity and extracted frontend tokens
- **What:** Recorded the founder-approved Aperture mark, Basalt/Limestone/Lumen/Bronze/Lapis palette, Archivo/Reem Kufi/Readex Pro/JetBrains Mono type system, and the authority chain between `DESIGN.md`, `design.pen`, and frontend semantic tokens. Added accessible semantic tones for normal-size text without changing the approved brand primitives.
- **Why:** Turn the approved brand-world plate into one durable, bilingual, light/dark implementation contract and remove the former “brand not approved” placeholder.

### 2026-08-01 — Made device/theme canvas organization permanent
- **What:** Established Product Surface → Flow → Device → Theme → Sequence as the mandatory `design.pen` hierarchy, including explicit missing-coverage, responsive-test, supporting-state, and validation rules.
- **Why:** Prevent mixed device/theme rows, preserve readable user-flow order, and make variant coverage independently auditable.

### 2026-07-30 — Extracted into canonical guide; account model + a11y corrected
- **What:** Moved the Design System & UX rules out of `UI-UX/AGENTS.md` into this canonical guide. Corrected the navigation/account model from "active-profile switching" to the **derived-navigation / one-current-primary-account-type / no-profile-switcher** model. Updated the accessibility target from **WCAG 2.1 AA → WCAG 2.2 AA** (including target-size guidance). Removed the hardcoded component count; the canonical component library in `design.pen` is the source of truth.
- **Why:** Establish enforceable UI/UX project memory, keep `UI-UX/AGENTS.md` concise/operational, and remove contradictions with the canonical identity model.

## Related files
[`AGENTS.md`](./AGENTS.md) · [`../docs/product/PRODUCT_DIRECTION_GUIDE.md`](../docs/product/PRODUCT_DIRECTION_GUIDE.md) · [`../docs/architecture/ARCHITECTURE_GUIDE.md`](../docs/architecture/ARCHITECTURE_GUIDE.md) · [`../AGENTS.md`](../AGENTS.md)
