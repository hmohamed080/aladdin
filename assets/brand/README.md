# Brand Assets

`assets/brand/` is the **canonical source** location for Aladdin brand and design assets.

## Structure

| Folder | Holds |
|---|---|
| `source/` | Editable source design files (master logos, layered/vector originals) |
| `logos/` | Exported logo lockups (approved variants) |
| `icons/` | Icon sources and exports |
| `guidelines/` | Brand guidelines (color, type, spacing, usage) once approved |

## Canonical source vs. runtime exports

- **`assets/brand/` is the source of truth.** Design/source files live here — they do **not** belong in `frontend/public`.
- **`frontend/public/brand/`** contains **only optimized, runtime-ready exports** the web app actually serves (e.g. compressed SVG/PNG/webp, favicon).
- Do **not** copy identical assets into both locations without documenting why here. When you add a runtime export, note the source file it derives from.

## Approval status

**No final logo, font, or brand color has been approved yet** (per the founder brief). Do not invent or hardcode a "final" brand identity. Placeholder/working assets must be clearly labeled as such until the brand is approved.
