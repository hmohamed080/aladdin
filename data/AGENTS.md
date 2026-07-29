---
description: Scoped agent instructions for Aladdin local data artifacts.
alwaysApply: true
---

# Data — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `data/`.

## Purpose & layout

Local, development-time data artifacts only — never production data.

```
data/
  templates/   # blank import/export templates (e.g. catalog CSV/XLSX headers) — TRACKED
  seed/        # small, synthetic, non-sensitive seed datasets for local dev — TRACKED
  samples/     # example inputs for AI/OCR/import testing — mostly gitignored
  imports/     # scratch space for local import runs — gitignored
```

## Hard rules

- **No real customer data, PII, uploaded verification documents, or private business data** in this folder — ever, tracked or untracked.
- `imports/` and `samples/` payloads are **gitignored** (kept out of history); only `.gitkeep` and documented templates are committed.
- Seed data must be **synthetic and safe to publish** (a public repo may include it). Use realistic Egyptian conventions (localities, EGP) but invented entities.
- Large corpora are never committed. If a fetch script is added, it downloads into a gitignored path.

## Relationship to Supabase

Structured seed that must load into the database belongs in `supabase/seed.sql` (applied by `supabase db reset`), not here. This folder is for file-based templates/samples and ad-hoc local inputs.
