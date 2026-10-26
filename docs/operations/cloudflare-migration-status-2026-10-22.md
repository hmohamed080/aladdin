# Cloudflare migration status (2026-10-22, updated 2026-10-24)

The owner brief's section 14 report for the frontend, R2, credentials/CI, Redis, video, security, cost and cutover sections (PR #97, branch `claude/cloudflare-workers-2ibvgs`). DB baseline, the media edge Worker and Hyperdrive belong to the "Cloudflare acceptance test" thread; FastAPI on Containers belongs to PR #98. Updated in place as work lands.

**Production: NO-GO.** Nothing in Production, DNS, billing or Vercel has been changed.

## 1. Verified state

| Item | State | Evidence |
|---|---|---|
| Next.js | 16.4.2 (owner decision 2026-10-21), webpack build | [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md) "Next.js 16 upgrade" |
| Vercel build | still green on every push (rollback path intact) | Vercel check on PR #97 |
| Workers build | `pnpm cf:build` and `wrangler deploy --dry-run` pass on the current head | local, 2026-10-22 |
| Preview Worker | `aladdin-frontend-preview` deployed by the GitHub workflow and **reachable** since 2026-10-24 (the workers.dev certificate was issued; no support ticket needed). `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` return 200, `/showroom` 307 | workflow run 40077176318 |
| Workers Builds | a dashboard Git connection on the preview Worker fails every push in 0 s; not created by this PR. Owner decision 2026-10-24: GitHub Actions is the only deploy path, so the owner disconnects it | FastAPI thread report |
| Desktop E2E | Workers (Next 16) fails exactly the same 51 tests as Node (Next 15); no host regression | [triage](e2e-shared-failures-triage-2026-10-22.md) |
| Migrations | #97 contains #100's 180-migration baseline (PR-only migrations renamed to `20261021090001..15`); CI fails if a retired version returns (`supabase/permissions/retired-versions.json`) | fast-forward to #100 `a6dcf79` |
| Unit tests | frontend 4,069 pass; backend 104 pass, 3 skipped (real Redis) | agent runs and local re-run 2026-10-22 |

## 2. Completed

- Next.js 16 upgrade with OpenNext 1.20.13; ESLint flat config; React Compiler rules as warnings.
- Preview workflow: fails loudly on deploy errors, waits for the name, prints TLS diagnostics, fails on any 5xx and prints the Worker's exceptions from `wrangler tail`.
- Fixed the preview's 500s: an empty `NEXT_PUBLIC_TURNSTILE_SITE_KEY` variable was inlined as `""` and failed env validation; the build now leaves it unset.
- `TURNSTILE_ALLOWED_HOSTNAMES` for the preview pinned in `wrangler.jsonc`.
- pyjwt 2.15.1 and the audited backend dependency bumps ported from #98.
- Video originals larger than about 7.5 GB: segments upload while ffmpeg runs, and originals that don't fit on disk are read from R2 through a short-lived presigned URL (HTTPS only, demuxer whitelisted, URL redacted from logs). Not yet tested against real R2 or a real Container. [Evaluation](../architecture/video-transcode-cloudflare-containers.md).
- CAPTCHA-dependent E2E suites run on a GitHub runner with Cloudflare's public test keys (`.github/workflows/auth-captcha-e2e.yml`).
- E2E: stale installer, Country picker, avatar and recovery-replay specs fixed; all 51 shared failures classified.
- Security audit: 4 fixes (spoofable client IP for phone-auth throttling, spoofable host/proto, refresh-token cookie forwarded to FastAPI, missing frame/nosniff headers). [Report](security-audit-cloudflare-2026-10-22.md).
- Redis audit: backend `rediss://` only, shared `REDIS_CACHE_ENABLED` switch, fail-safe job lock, required `REDIS_KEY_ENV`, guard tests against permission or media caching. [ADR-0019 audit](../decisions/ADR-0019-redis-cache-and-rate-limits.md).
- Video: transcode on Cloudflare Containers evaluated, config written, not deployed. [Evaluation](../architecture/video-transcode-cloudflare-containers.md).
- R2 audit, CORS and lifecycle rules prepared (not applied). [R2](r2/README.md).
- DNS export with Zoho mail records. [DNS](dns-records-aladdindecore-2026-10-22.md).
- Cost at 1k/10k/100k DAU. [Cost](cloudflare-cost-scalability-2026-10-22.md).
- 15-stage cutover plan. [Plan](cloudflare-frontend-cutover-plan.md).

## 3. In progress

- Nothing running in this thread; waiting on the blockers below.

## 4. Blockers

| Blocker | Who | Unblocks |
|---|---|---|
| Workers Builds Git connection failing on every push | owner: disconnect (decided 2026-10-24) | clean PR checks |
| Sign In shows Turnstile; docs say it must not | owner decision | auth-password-preview :635 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is empty in the `cloudflare-preview` environment | owner | Turnstile on the preview |
| Worker runtime secrets (Supabase acceptance, R2, Upstash REST, media tickets) not set | owner, with the [checklist](cloudflare-credentials-checklist.md) | real E2E, Redis, media on the preview |
| Sandbox cannot reach Upstash, workers.dev or Turnstile | environment | real-provider checks run in CI (preview smoke, CAPTCHA E2E) or by the owner |

## 5. Dependencies on the DB / acceptance thread

- Acceptance project `nxossqhdfltcqdwvbewi` rebuilt to the current migrations, with test data.
- Hyperdrive config and the media edge Worker (needed for R2 edge delivery).

## 6. Credential checklist

See [cloudflare-credentials-checklist.md](cloudflare-credentials-checklist.md). No values in git.

## 7. PRs

- #97 (this, draft): frontend on Workers, audits, docs.
- #98 (draft, FastAPI thread): FastAPI on Containers, stacked on #97.
- #100 (draft, DB thread): brings main's `20261020090001_registration_data_sync` into the stack by renaming the 15 PR-only migrations to `20261021090001..15`. The stack must merge together; new migrations go after `20261021090015`. Details: `docs/operations/database-baseline-2026-10-22.md` on that branch.
- Earlier stack #88 → #89 → #91 → #92 → #94, plus #93 and #95: unchanged, not merged.

## 8. Test evidence

All local unless stated. The preview smoke check runs on every push. Full E2E and security regression on the preview wait for the Worker secrets.

## 9. Architecture

ADR-0021 (frontend on Workers), ADR-0022 in #98 (FastAPI on Containers), ADR-0019 (Redis), ADR-0020 plus the Containers evaluation (video).

## 10. Cost

≈ $38 / $202 / $2,026 a month at 1k / 10k / 100k DAU, vs ≈ $72 / $256 / $1,927 on Vercel Pro. Estimates with invented traffic; see the cost doc.

## 11. Cutover and rollback

15 stages with entry/exit criteria, approval gates and rollback in the [cutover plan](cloudflare-frontend-cutover-plan.md). Vercel stays deployable throughout.

## 12. GO / NO-GO

**NO-GO for Production.** Needed first: full E2E and security regression on it with real Turnstile, Supabase acceptance, R2 and Redis, real Workers performance numbers, and the owner approvals (Workers Paid, Images plan, DNS move, traffic switch).
