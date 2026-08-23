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

### Current logo lineage

| File | Size | Role |
|---|---|---|
| `source/aladdin-lockup-master.png` | 1254×700 | **Master lockup.** The full-resolution supplied artwork, and the source both runtime exports below are cut from. Not served. |
| `frontend/public/brand/aladdin-logo.png` | 684×643 | Runtime export: the master with its transparent padding trimmed. No resampling. |
| `frontend/public/brand/aladdin-mark.png` | 261×384 | Runtime export: the emblem alone, cut from the master above the wordmark's first scanline and box-filtered in premultiplied alpha. |

These are **not** duplicates: the master is the un-optimized original and lives
here because source files do not belong in `frontend/public`. The two exports are
the only brand images the web app serves; `frontend/src/components/layout/brand.tsx`
renders the mark.

## Approval status

**No final logo, font, or brand color has been approved yet** (per the founder brief). Do not invent or hardcode a "final" brand identity. Placeholder/working assets must be clearly labeled as such until the brand is approved.
