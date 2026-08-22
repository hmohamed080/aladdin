---
name: Aladdin
description: The AI operating system that brings light to a decision — for Egypt's finishing, construction & design sector.
colors:
  basalt: "#0E1113"
  basalt-2: "#1B2226"
  basalt-3: "#232B30"
  limestone: "#F4F1EA"
  plaster: "#FBF9F4"
  sand: "#EAE5DB"
  ink: "#17191A"
  lumen: "#F3AB3E"
  lumen-deep: "#C77F1C"
  lumen-ink: "#855A15"
  lumen-soft: "#F7C674"
  bronze: "#C79A5E"
  bronze-deep: "#96703F"
  bronze-ink: "#6E5230"
  lapis: "#2F6088"
  lapis-bright: "#6FA8D2"
  verdigris: "#2F7D5B"
  verdigris-deep: "#205A42"
  ochre: "#B26B12"
  ochre-deep: "#6E4810"
  oxide: "#B23A22"
  stone: "#5C6066"
  stone-muted: "#676B70"
  graphite: "#39444B"
  line-dark: "#262E33"
  line-light: "#DED8CC"
  line-light-strong: "#C7BEAE"
  on-dark: "#F2EFE9"
  on-dark-secondary: "#B8BEC2"
  on-dark-muted: "#828A90"
  verdigris-bright: "#58C08E"
  ochre-bright: "#E0A54A"
  oxide-bright: "#E27159"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  display-arabic:
    fontFamily: "Reem Kufi, Readex Pro, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 300
    lineHeight: 1.5
    letterSpacing: "0"
  body-lg:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.02em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  xs: "8px"
  sm: "10px"
  md: "12px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "104px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.limestone}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.limestone}"
  button-primary-on-dark:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.stone}"
    rounded: "{rounded.sm}"
    padding: "11px 16px"
  card:
    backgroundColor: "{colors.plaster}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  card-on-dark:
    backgroundColor: "{colors.basalt-2}"
    textColor: "{colors.limestone}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input:
    backgroundColor: "{colors.basalt-2}"
    textColor: "{colors.limestone}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
  seal-verified:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.bronze-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  chip:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.stone}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
---

# Design System: Aladdin

<!-- Established with the founder from the "Brand Toolkit v1" plate and approved 2026-08-01. -->
<!-- Visual source of truth remains UI-UX/design.pen (Pencil); this file is the token/rule
     record the .pen file and the frontend Tailwind theme both extract from. Product truth
     lives in PRODUCT.md — do not duplicate it here. -->

## Design System Metadata

| | |
|---|---|
| **Design System** | Aladdin — "The Aperture" |
| **Version** | `1.0.0` |
| **Status** | Approved · foundation hardened (pre-feature). Ready to build product UI against. |
| **Last updated** | 2026-08-01 |
| **Maintainer** | Design-system foundation (agent-maintained under founder approval) |
| **Changelog** | [`design/CHANGELOG.md`](design/CHANGELOG.md) |
| **Governance** | [`design/GOVERNANCE.md`](design/GOVERNANCE.md) — source-of-truth, versioning, component & AI-agent rules |
| **Machine tokens** | [`design/tokens/`](design/tokens/) — canonical machine-readable values |
| **Component inventory** | [`design/COMPONENT_INVENTORY.md`](design/COMPONENT_INVENTORY.md) |
| **Icon policy** | [`design/icons/README.md`](design/icons/README.md) |

### Source-of-truth hierarchy

No lower source may contradict a higher one; on conflict, reconcile downward.

1. [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](docs/product/PRODUCT_DIRECTION_GUIDE.md) — product truth & constraints.
2. **`DESIGN.md`** (this file) — normative brand & visual-design language.
3. [`design/tokens/*.json`](design/tokens/) — canonical machine-readable token *values*.
4. [`UI-UX/UI_UX_SYSTEM_GUIDE.md`](UI-UX/UI_UX_SYSTEM_GUIDE.md) — UI behavior, UX rules, component usage, accessibility, responsive.
5. `UI-UX/design.pen` — canonical approved screens & component compositions (private/gitignored).
6. Frontend CSS variables (`frontend/src/styles/tokens.css`) + Tailwind config — implement the canonical tokens.

**Edit order when a token changes:** `design/tokens/*.json` → `DESIGN.md` frontmatter → `frontend/src/styles/tokens.css` → `frontend/tailwind.config.ts`, in one commit. The same hex intentionally appears in the token JSON, this frontmatter, and `tokens.css` — three mirrors of one value (documented duplication, not drift). `.impeccable/design.json` is a gitignored local sidecar and is never authoritative.

### Compatibility notes

- **Semantic versioning:** MAJOR = breaking visual/component-contract change · MINOR = new tokens/components/states/theme behavior · PATCH = non-breaking corrections, docs, contrast fixes. Policy in [`design/GOVERNANCE.md`](design/GOVERNANCE.md#versioning).
- `1.0.0` is the first approved, hardened foundation. **No product components are implemented yet** — the token contract and `.dark` override are ready for the first product feature to consume.
- Themes: Light + Dark are both first-class; `.dark` class on `<html>` (`darkMode: "class"`). Both AA-verified.

## Overview

**Creative North Star: "The Aperture — a point of intelligent light in precise architectural structure."**

Aladdin brings light to a decision. The whole system is built from one image: a precise architectural opening — nested chamfered facets focusing inward to a single warm point of light. It is the disciplined idea of the lamp, never its literal depiction; there is no genie, no ornament, no cartoon. The register is **calm authority**: a confident, expert, uncluttered professional tool for people who run real projects, not a flashy consumer marketplace.

Two structural stone grounds carry everything — deep **Basalt** and warm **Limestone** — and both are first-class, fully-designed themes, never one inverted into the other. Primary *actions* are calm ink (near-black on light, limestone on dark), which keeps the interface quiet and lets a single warm signal, **Lumen**, mean something: it is the brand's point of light and it marks every AI moment and every focus. Crafted **Bronze** is the metal of trust and verification; quiet **Lapis** is the color of data and technology. Whitespace and a precise structural grid do the work before color or decoration ever does.

The system is bilingual by construction: every layout, affordance, and component works identically in Arabic (RTL) and English (LTR), and color is always reinforced by icon, label, or shape — never carried alone.

**Key Characteristics:**
- One warm signal (Lumen) against architectural stone; ink carries the actions.
- The Aperture mark — a light-well seen in plan — is the recurring geometry, from app icon to verification seal to focus states.
- Light and Dark are both authored; Admin surfaces are intentionally Basalt-dark.
- Bilingual AR-RTL / EN-LTR parity and WCAG AA contrast are invariants, not options.
- Consultation-first: trust signals lead, never pricing pressure or commerce framing.

## Colors

Architectural stone grounds, one warm point of light, a crafted metal, and a quiet data blue — a restrained system where the accent's rarity is the point.

### Primary
- **Lumen** (#F3AB3E): The brand's point of light and the single AI/intelligence signal. Used for the mark's glowing core, the light-point on smart icons, focus rings, AI-consult moments, and small accents. It is warm on purpose — Aladdin's intelligence reads as guidance, not cold machinery.
- **Lumen Deep** (#C77F1C): A supporting shade for larger marks and fills on the light theme. **Lumen Ink** (#855A15) is the AA-safe semantic tone for normal-size text, thin marks, and focus indicators on Limestone/Plaster.
- **Ink** (#17191A): The primary *action* color on the light theme — buttons, primary controls. Near-black, calm, authoritative. On the dark theme, primary actions invert to Limestone.

### Secondary
- **Bronze** (#C79A5E): Crafted metal for trust and verification — the "Verified Provider" seal, premium hairlines, and detailing. Never a general-purpose accent; its meaning is provenance and craft.
- **Bronze Deep** (#96703F): Bronze for larger marks and decorative detail on light surfaces. **Bronze Ink** (#6E5230) is the AA-safe semantic tone for normal-size trust text and small seals.

### Tertiary
- **Lapis** (#2F6088): The quiet technology/data color — links, informational states, technical figures. Used sparingly, the "modern technology" note beneath the architecture.
- **Lapis Bright** (#6FA8D2): Lapis on the Basalt dark theme.

### Neutral
- **Basalt** (#0E1113): The dark canvas and Admin default; deep, warm-neutral graphite-black stone.
- **Basalt 2** (#1B2226) / **Basalt 3** (#232B30): Raised surfaces, cards, and sidebars on dark.
- **Quartz** (#F4F3F0): The light canvas — warm off-white stone, deliberately low-chroma. **Quartz Raised** (#FDFCFB): raised cards and surfaces on light. **Quartz Sunk** (#ECEAE6): secondary fills, tags, and chips on light.
- **Limestone** (#F4F1EA) / **Plaster** (#FBF9F4) / **Sand** (#EAE5DB): brand stone, retained for the Aperture mark, the auth Brand Panel and the primary button's label — **not** the workspace ground. They previously served as both. The rule said "never cream-yellow"; measured as the spread between a colour's highest and lowest channel they ran 10 / 7 / 15, and on a border-dense operational surface that accumulated into exactly the cast the rule forbids. Quartz is the same stone with the chroma removed (spread 4 / 2 / 6) and is what the workspace stands on.
- **Stone** (#5C6066): Secondary text on light. **Stone Muted** (#676B70): the quietest light-theme text tone that still clears AA. **Graphite** (#39444B): strong borders on dark.
- On-dark text ramp: **On Dark** (#F2EFE9), **On Dark Secondary** (#B8BEC2), **On Dark Muted** (#828A90).
- Hairlines: **Line Dark** (#262E33) on Basalt, **Quartz Line** (#DBD8D5) and **Quartz Line Strong** (#C2BFBB) on Quartz. The light hairlines are **luminance-matched** to the Line Light (#DED8CC) / Line Light Strong (#C7BEAE) they replace — within 0.0003 — so they carry the same weight while dropping two-thirds of their chroma. De-yellowing a border is not the same operation as lightening one; lightening costs you the border.

### Status
- **Verdigris** (#2F7D5B) success · **Ochre** (#B26B12) warning · **Oxide** (#B23A22) danger · **Lapis** (#2F6088) info. Architectural, patina-derived hues — never default web red/green/yellow. Normal-size status text uses the accessible semantic tones **Verdigris Deep** (#205A42) and **Ochre Deep** (#6E4810) on light, and the bright status tones (#58C08E / #E0A54A / #E27159) on dark.

### Named Rules
**The One Light Rule.** Lumen is the brand's only signal color and is never used for a status. It marks intelligence, brand, and focus — nothing else. Its rarity is what makes it read as light.

**The Ink-Action Rule.** Primary actions are ink (Limestone on dark), not Lumen. The interface stays calm; the gold stays meaningful.

**The Both-Themes Rule.** A color token is incomplete until it is defined and AA-verified in *both* Basalt and Limestone. There is no "primary theme."

**The Reinforced-Signal Rule.** Color never carries meaning alone; pair it with an icon, label, or shape. Required for accessibility and for AR/EN parity.

**The Muted-On-Sunk Rule.** `fg-muted` clears AA on the canvas/surface (4.84:1 on Quartz) but **still not on the secondary fill** (4.47:1 on Quartz Sunk — up from 4.27:1 on Sand, and short of 4.5 by less than a thirtieth). On that fill (chips, tags, secondary fills) use `fg-secondary` or `fg` for any normal-size text — never `fg-muted`. The cleaner ground narrowed this gap; it did not close it, and a rule that is nearly unnecessary is still a rule.

### Contrast (measured 2026-08-01, WCAG 2.2 AA)

All semantic text/status tokens were computed against their real backgrounds. Minimum passing ratios: **light 4.84:1** (`fg-muted` on canvas), **dark 5.40:1** (`fg-muted` on canvas); primary-action text **15.90:1**. The one sub-AA pairing (`fg-muted` on Quartz Sunk, 4.47:1) is governed by the Muted-On-Sunk Rule above.

The light figures were re-measured on 2026-08-20 when the workspace ground moved from Limestone to Quartz. Every light pair improved and none regressed — `fg` on canvas 15.64 → 15.90, `fg-secondary` 5.61 → 5.70, `fg-muted` 4.76 → 4.84, `fg-muted` on surface 5.10 → 5.24 — because removing chroma from a near-white raises its luminance slightly. Dark is unchanged. Full per-pair table: [`design/GOVERNANCE.md`](design/GOVERNANCE.md#accessibility). UI-component/large-text pairs all clear the 3:1 threshold.

## Typography

**Display Font (Latin):** Archivo (with system-ui, sans-serif) — a geometric, architectural grotesque with a point of view.
**Display Font (Arabic):** Reem Kufi (with Readex Pro) — modern geometric Kufic; the natural architectural partner for Arabic brand and headlines.
**Body / UI Font:** Readex Pro (with system-ui) — one family covering **both** Arabic and Latin with matched metrics; carries every product screen.
**Figure / Mono Font:** JetBrains Mono — quotes, RFQ codes, quantities, and EGP.

**Character:** Architectural and precise up top (Archivo / Reem Kufi), calm and humanist in the body (Readex Pro), with an engineering-spec texture for figures (JetBrains Mono). The pairing feels like a considered drawing set, not a marketing deck.

### Hierarchy
- **Display** (Archivo 800–900, clamp(2rem, 4vw, 3.25rem), 1.02, -0.03em): Brand wordmark and hero headlines. Arabic uses `display-arabic` (Reem Kufi 600).
- **Headline** (Archivo 800, ~2rem, 1.1): Section titles.
- **Title** (Readex Pro 600, ~1.25rem): Card and screen titles; the `$h2` step (Opportunity → Need → Match).
- **Body Large** (Readex Pro 400, 1rem): Field values, lead paragraphs. Measure 65–75ch.
- **Body** (Readex Pro 300, 0.875rem, 1.5): Default UI text and supporting copy.
- **Label** (Readex Pro 500, 0.8125rem, +0.02em): Field labels, small headers (e.g. "PRIMARY CONTACT").
- **Mono** (JetBrains Mono 500, 0.8125rem): RFQ/quote codes, quantities, EGP figures, technical metadata.

### Named Rules
**The Matched-Script Rule.** Product UI is set in Readex Pro so Arabic and Latin share metrics and weight; the Archivo/Reem Kufi display pair is reserved for brand and headline moments. Never mix a Latin-only face into Arabic UI.
**The Figures-Are-Mono Rule.** Prices (EGP), RFQ/quote IDs, and quantities are JetBrains Mono — for alignment and legibility, not decoration. Prose is never set in mono.

### Loading, license & PDF strategy

- **Loading:** all four families are self-hosted via `next/font/google` (`display: "swap"`), exposed as CSS variables (`--font-readex`, `--font-archivo`, `--font-reem-kufi`, `--font-jetbrains-mono`). Arabic + Latin subsets are requested for Readex Pro and Reem Kufi. No runtime request to a font CDN.
- **License:** Archivo, Reem Kufi, Readex Pro, and JetBrains Mono are distributed on Google Fonts under the **SIL Open Font License 1.1**. **This is not yet a formal license-file audit** — treat OFL verification of the exact self-hosted files as a **pending, unverified** pre-ship item (do not claim "license verified").
- **PDF/document fonts (open item):** quote/RFQ PDFs are generated in the FastAPI service. The web font stack does **not** automatically apply there; a PDF font strategy with **first-class Arabic shaping** (embed Readex Pro + JetBrains Mono, or a shaping-capable engine) must be chosen when document generation is built. Recorded here so a later task does not silently fall back to a non-Arabic PDF default.
- **Assets not yet produced (do not fabricate):** finalized Reem Kufi Arabic wordmark lockup, the bespoke Latin "dd" aperture ligature, and the auth-panel 3D/WebGL Aperture artwork. These require approved source files that do not exist yet.

## Layout

A precise structural grid governs everything. Product surfaces use a **workspace shell** for B2B/Admin (persistent, collapsible sidebar; off-canvas drawer on mobile) and **discovery-style top navigation with prominent search** for B2C. Auth and marketing use a **split panel**: a Basalt Brand Panel (Aperture artwork, later 3D/WebGL) beside a Form Panel — never flattened into a single centered column.

Spacing is a 4-based token scale (`xs 4 · sm 8 · md 16 · lg 24 · xl 32`), with large `section` rhythm (104px) between major bands. Group related fields with tighter gaps and separate sections with larger ones — **spacing, not dividers, is the first grouping tool.** More space sits above a heading than below it. Content max-widths keep body measure at 65–75ch. Everything is fully RTL-mirrored in Arabic (leading/trailing, chevron direction, back gestures).

## Elevation & Depth

Primarily **tonal layering**, with restrained structural shadow. On Basalt, depth is built from layered surface steps (Basalt → Basalt 2 → Basalt 3) and border shifts toward Graphite, not from heavy shadow. On Limestone, raised cards use a soft, low, real shadow (offset + blur) plus a Line-Light hairline. The one luminous effect in the system is the **Lumen bloom** at the aperture's focal point and at AI moments — a soft radial glow, used sparingly and never as a flat zero-offset halo on generic elements.

### Shadow Vocabulary
- **Card (light)** (`box-shadow: 0 1px 2px rgba(20,16,10,.04), 0 8px 24px rgba(20,16,10,.05)`): Raised cards on Limestone/Plaster.
- **Lumen bloom** (`filter: drop-shadow(0 0 60px rgba(243,171,62,.18))` / radial-gradient): The mark's glow and AI focal moments only.

### Named Rules
**The Tonal-First Rule.** On dark, build depth with layered stone surfaces and border shifts before reaching for shadow. Reserve glow for Lumen focal moments.

## Shapes

The form language is **precise and chamfered**, echoing the Aperture: corners are gently rounded (radius scale `xs 8 · sm 10 · md 12 · lg 14`, pill 999 for seals/tags), not soft or pill-heavy. Icons are drawn on a 24px grid at 1.5px stroke with lightly **chamfered** corners (not fully rounded, not sharp) so they read as cut facets. The Aperture geometry — nested chamfered octagonal facets converging on a point — recurs as mark, app icon, favicon, and verification seal. Borders are 1px hairlines; a colored border heavier than 1px is not part of the language.

## Components

### Buttons
- **Shape:** Gently rounded (10px, `rounded.sm`).
- **Primary (light):** Ink (#17191A) fill, Limestone text, label type, 11px 16px padding. **Primary (dark):** inverts to Limestone fill, Basalt text.
- **Hover / Focus:** Primary lightens toward Graphite; focus ring is Lumen. Keep transitions ease-out from an already-visible default.
- **Ghost:** Transparent with a 1px border (Line/Border-strong) and Stone/Limestone text — for secondary actions ("Open quote", "View portfolio").

### Chips / Tags
- **Style:** Sand fill (#EAE5DB) on light / Basalt 3 on dark, Stone/Limestone text, mono type, 8px radius. Used for RFQ codes, categories, and metadata.

### Cards / Containers
- **Corner Style:** 14px (`rounded.lg`).
- **Background:** Plaster (#FBF9F4) on light, Basalt 2 (#1B2226) on dark.
- **Shadow Strategy:** Soft real shadow on light (see Elevation); tonal + Graphite border on dark.
- **Border:** 1px Line hairline.
- **Internal Padding:** 18px.

### Inputs / Fields
- **Style:** Basalt 2 fill on dark / Plaster on light, 1px border, 10px radius, ~14px vertical padding; label in `label` type above the value in `body-lg`.
- **Focus:** Border shifts and a Lumen focus ring; never a raw browser outline.
- Passwordless by design: phone (WhatsApp OTP) and email OTP entry only — **no password fields, ever.**

### Navigation
- **B2B/Admin:** Workspace sidebar reflecting *derived* capabilities (items the account type/membership/permissions don't grant are hidden, not disabled); active item uses a token-based state; collapses to icons; mirrors to the trailing edge in RTL.
- **B2C:** Top navigation exposing core journeys with prominent search.
- Navigation is **derived, never toggled** — there is no profile (persona) switcher or role-switching control. Selecting the active **work context** (personal surface ↔ an organization where the user has an active membership) is a separate, allowed concept and is not a persona switch.

### The Aperture Mark (signature)
Nested chamfered octagonal facets (bronze → bronze-deep → lumen strokes) converging on a Lumen-gradient core with a soft bloom. Primary form on Basalt; a single-color `currentColor` monochrome variant for favicon (down to 16px), bronze verification seal, and on-light use. It is the app icon, the auth brand-panel motif, and the trust seal.

### Verification Seal
Bronze concentric ring (one solid + one dashed) around the monochrome Aperture; pairs with a "Verified" pill (Bronze tint, mono label, shield-check glyph). The visual anchor of trust across the platform.

## Do's and Don'ts

### Do:
- **Do** reserve **Lumen (#F3AB3E)** for brand, AI, and focus — one signal, never a status (The One Light Rule).
- **Do** make primary *actions* Ink on light / Limestone on dark; keep the gold meaningful (The Ink-Action Rule).
- **Do** define and AA-verify every token in **both** Basalt and Limestone themes (The Both-Themes Rule).
- **Do** set product UI in **Readex Pro** for matched Arabic + Latin metrics; use Archivo/Reem Kufi only for brand and headlines.
- **Do** set EGP figures, RFQ/quote codes, and quantities in **JetBrains Mono**.
- **Do** reinforce every color signal with an icon, label, or shape, and mirror everything fully in RTL.
- **Do** use the Aperture geometry and Bronze seal wherever trust/verification is shown.

### Don't:
- **Don't** render the name literally — no lamp, genie, arabesque ornament, or gold-kitsch. The Aperture is the disciplined abstraction.
- **Don't** use Lumen as a button fill or a status color, and don't scatter it as a general accent.
- **Don't** introduce commerce/marketplace visual framing (add-to-cart, checkout, price-war) — this is consultation-first.
- **Don't** build a profile (persona) switcher, "Use As" mode, or account-identity-switching UI; navigation is derived. A **work-context/workspace** selector across the user's own memberships is a different, allowed concept.
- **Don't** surface technical/implementation copy ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", stack jargon) in the UI.
- **Don't** hardcode raw hex in components — add or adjust a token. Don't treat Dark as an inverted Light filter.
- **Don't** use cream/warm-white grounds with a serif-italic display — that default is explicitly not this brand; the ground is low-chroma Limestone stone.
