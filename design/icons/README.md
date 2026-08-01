# Aladdin Icon System

Policy for icons across Aladdin. Concrete geometry and the brand mark live in [`../../DESIGN.md`](../../DESIGN.md) (Shapes, The Aperture Mark) and [`../COMPONENT_INVENTORY.md`](../COMPONENT_INVENTORY.md).

- **Version:** `1.0.0` · **Updated:** 2026-08-01

## Default library (decision)

**Lucide (`lucide-react`) is the single default UI icon library.** Rationale: it is the conventional icon set for the approved shadcn/Radix stack (`frontend/AGENTS.md`), it is outline-first with a **1.5px stroke on a 24px grid** — which matches Aladdin's geometric line-icon language — it has broad coverage, and it mirrors cleanly for RTL.

- **Not yet installed.** Adding `lucide-react` is deferred until the first UI feature genuinely needs icons (dependency policy: justify on first real use). Record the addition in `CHANGELOG.md` + `AGENT_WORK_LOG.md` when it happens.
- **One library only.** Introducing a second icon set (Heroicons, Font Awesome, Material Icons, an icon font) requires a documented exception approved and recorded here and in `CHANGELOG.md`.

## Usage rules

- **Stroke width:** 1.5px (Lucide default). Do not mix stroke weights.
- **Standard sizes:** 16px (inline/dense), 20px (field leading icon; the canonical form-field icon size), 24px (default/actions). Size via the box, not by re-scaling stroke.
- **Optical alignment:** align to text baseline/centerline; nudge for optical center, not geometric center. Keep icons on the pixel grid.
- **Outline vs filled:** outline by default. A filled/solid treatment is reserved for a **selected/active** state where outline is ambiguous — never decorative.
- **Status icons:** every status pairs an icon with color **and** text (never color alone). Map: success = check/shield-check, warning = triangle-alert, danger = octagon/x, info = info. Consistent across the app.
- **RTL mirroring:** mirror directional icons (chevrons, arrows, back/forward, breadcrumb separators, list-indent, send). **Do not mirror** direction-neutral icons (search, settings, user, verified seal, bell) or the brand mark.
- **AI/smart affordances:** intelligent actions may carry a single **Lumen light-point** accent (the brand signal), consistent with the mark. Used sparingly.

## Brand & custom icons

- **Brand mark (the Aperture):** the logo/app-icon/favicon/verification-seal geometry is **founder-approved** (Brand Toolkit v1 plate). Its authored geometry is recorded in the plate and the gitignored `.impeccable/design.json`. **Runtime SVG/asset exports are not yet produced** and are tracked as a pending asset in `COMPONENT_INVENTORY.md` — this folder holds **no** SVG files yet.
- **Custom domain icons** (drawn to the 24px / 1.5px / chamfered grid) are added only when a real need exists and no Lucide icon fits. Each custom icon must: match the grid and stroke, provide LTR + RTL forms where directional, and be listed in `COMPONENT_INVENTORY.md`.

## Custom-icon approval process

1. Confirm no Lucide icon and no existing custom icon fits.
2. Draw to the 24px grid, 1.5px stroke, chamfered corners; provide RTL form if directional.
3. Add an entry to [`../COMPONENT_INVENTORY.md`](../COMPONENT_INVENTORY.md) (name, purpose, status).
4. Store the **actual approved source SVG** here only once it exists — **never create empty or placeholder SVG files**, and never invent an unapproved brand asset.
5. Record the addition in [`../CHANGELOG.md`](../CHANGELOG.md).

## Do / Don't

- **Do** use Lucide for UI icons; reserve custom SVG for brand + genuine domain gaps.
- **Do** mirror directional icons in RTL; keep the brand mark unmirrored.
- **Don't** introduce a second icon library, mix stroke weights, use color-only status, or commit empty/placeholder SVGs.
