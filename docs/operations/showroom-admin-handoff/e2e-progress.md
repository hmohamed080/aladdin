# E2E matrix progress (PR #88 / PR #89) — checkpoint 2026-10-19 00:30 UTC

Environment: local Supabase (project "aladdin", started WITH Mailpit — its image was already local),
`next build` + `next start :3100` per branch, Chromium 141 via PW_CHROMIUM=/opt/pw-browsers/chromium
(Playwright 1.62 wants build 1234, not installed). `E2E_STUB_TURNSTILE=1` (challenges.cloudflare.com is
blocked by the sandbox proxy). retries=0. Excluded: showroom-auth (needs its own :65521 stack),
auth-password-preview + recovery-replay (Create Account / Forgot Password need Cloudflare Siteverify,
blocked here; on PR88 desktop all 22 auth-password-preview tests failed on the captcha), audit/ and
regression/ (own configs + DB container).

## Done

| Branch | Run | Passed | Failed | Skipped | Not run |
|---|---|---|---|---|---|
| PR88 cc791ed (+2efb050) | desktop en/light, 42 specs | 171 | 125 | 16 | 5 |
| PR88 | mobile en/light, 42 specs | 133 | 105 | 79 | 0 |
| PR88 | pr88-admin-showroom alone, fresh DB, desktop | 10 | 0 | 0 | 0 |
| PR88 | desktop ar/dark, 19-spec subset (+VQA=1) | 123 | 18 | 2 | 0 |
| PR88 | mobile ar/dark, 19-spec subset | 87 | 10 | 46 | 0 |
| PR89 274a96e (+bc9d00c, 63bc661, 30ca9d9, 479b9b2) | desktop en/light, 43 specs | 171 | 127 | 16 | 5 |

PR89 vs PR88 desktop per-test delta: PR89 adds 2 passing pr89-media tests; PR89-only failures:
kpi-customize (team default / personal layout, 2), installer-my-work "Start work", supply-side Importer
route sweep (React #418, intermittent — Distributor/Manufacturer flipped the other way). Re-run in isolation pending.

Most failures are shared by both branches: stale selectors/flows (workspace-switcher, sidebar-control,
custom listbox replacing <select>, tabbed installer entry), sign-up blocked by Siteverify, data pollution
(pr88 admin-users importer count after business-registration creates importers).

## Bugs found on PR89 (fixed, committed locally on local/r2-rc2-snapshot, not pushed)
- 63bc661: product photo upload always failed — public.organization_media_resolve was STABLE, PostgREST ran it
  read-only, its upload branch reaches app.can_write_publisher's FOR SHARE (25006). New migration
  20261021090010 marks it VOLATILE; pgTAP 96 asserts it.
- 30ca9d9: next.config localPatterns omitted /images/** -> My Products hero 400 from /_next/image.

## Left
- PR89 mobile en/light (interrupted at test 18 by container restart), PR89 desktop+mobile ar/dark subset.
- Isolated re-runs of the PR89-only failures above.

## Update 00:55 UTC
Isolated re-runs (kpi-customize + installer-my-work, fresh DB, desktop): PR88 5 failed / 11 passed, PR89 4 failed / 12 passed —
the same KPI and "Start work" tests fail on BOTH branches in isolation, so the PR89-only deltas in the full run were
test-order/state dependence (KPI spec expects 8 default cards and "Show" buttons; the UI now has 5 and "+"), not PR89 regressions.
Next: PR89 mobile en/light, then PR89 ar/dark subset (desktop + mobile).
- PR89 mobile en/light: 132 passed / 108 failed / 79 skipped (done)

## Update — matrix complete
| PR89 | desktop ar/dark, 20-spec subset (+VQA=1) | 124 | 18 | 2 | 1 |
| PR89 | mobile ar/dark, 20-spec subset | 86 | 12 | 46 | 1 |
| PR89 | pr89-media alone, ar/dark desktop + mobile (after 7e94bde) | 4 | 0 | 0 | 0 |

PR89 vs PR88 ar/dark deltas: pr89-media avatar failed only because the spec's Save selector was English-only
(fixed in 7e94bde, re-run 2/2 on both devices); installer-my-work "Start work" (state-dependent, fails on both
branches in isolation); supply-side route sweep React #418 (intermittent on both branches, the failing role moves
between runs: Distributor/Manufacturer/Importer/showroom-mvp; one probe repro on PR89 mobile /b2b/saved, then 0/10;
cause not identified). All other ar/dark failures are shared with PR88 (stale selectors, branch-limited rep VQA).
PR89 visual-QA screenshots copied to pr89/visual-qa/ (49). Nothing pushed.
