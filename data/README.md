# Data

Local, development-time data artifacts for Aladdin. See `data/AGENTS.md` for the rules.

## Layout

| Folder | Purpose | Tracked? |
|---|---|---|
| `templates/` | Blank import/export templates (e.g. catalog CSV/XLSX headers) | Yes |
| `seed/` | Small, synthetic, non-sensitive seed datasets for local dev | Yes |
| `samples/` | Example inputs for AI/OCR/import testing | Only `.gitkeep` (payloads gitignored) |
| `imports/` | Scratch space for local import runs | Only `.gitkeep` (payloads gitignored) |

## Rules

- **No real customer data, PII, or uploaded verification documents** here — ever.
- Seed/sample data must be **synthetic and safe to publish** (this repo may be public). Use realistic Egyptian conventions (localities, EGP) with invented entities.
- Structured seed that loads into the database belongs in `supabase/seed.sql`, not here.
- Large corpora are never committed; any fetch script downloads into a gitignored path.
