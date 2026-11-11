# CI dependency pinning (no runtime apt)

Status: 2026-11-11, applied to `.github/workflows/ci.yml` in PR #179. Scope: the `CI` workflow only.

## Purpose

Stop the `CI` workflow from failing on a package-mirror outage instead of on the code under test.

## Root cause

Three steps installed system packages with `apt` while the job ran, and Playwright's `--with-deps` does the same:

- `frontend`: `playwright install --with-deps chromium` (apt for browser libraries and fonts).
- `backend`: `sudo apt-get install ffmpeg`.
- `backup-kit`: `sudo apt-get install age`.

On 2026-11-11 (about 14:35-15:00 UTC) hosted runners could not resolve `azure.archive.ubuntu.com`
(`Temporary failure resolving`), so `apt-get update/install` failed after long retries and the jobs failed across reruns while
every code check passed. Job logs showed no assertion failure. Pinning the runner image alone does not help: `ubuntu-latest` and
`ubuntu-24.04` use the same mirror.

## Current decision

| Dependency | Source now | Pin / verification |
|---|---|---|
| Runner OS | `ubuntu-24.04` on all jobs | explicit version instead of `ubuntu-latest` |
| Chromium + system libraries (frontend) | job `container:` = official Playwright image | digest `sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e` (tag `v1.62.1-noble`); a step fails the job if `playwright --version` is not `1.62.1` (the version in `pnpm-lock.yaml`) or the bundled Chromium is missing; no browser download, no apt |
| ffmpeg + ffprobe (backend) | static 7.1.1 build image `mwader/static-ffmpeg`, binaries copied out with `docker create` / `docker cp` | digest `sha256:11a44711684c0b9f754c047dcd64235b8b52deab251bd0e0a86f22faa160749c` (content-addressed, so the bytes are verified by the digest); a step fails the job unless `ffmpeg`, `ffprobe` and the encoders `libx264`, `libvpx-vp9`, `libopus`, `aac` exist |
| age + age-keygen (backup-kit) | `go install filippo.io/age/cmd/age@v1.1.1 filippo.io/age/cmd/age-keygen@v1.1.1` with the Go toolchain the job already installs | version pinned; the Go module proxy result is verified against the Go checksum database (sum.golang.org); v1.1.1 is the version Ubuntu 24.04 packages |

The `redis` service container is now reached by hostname (`redis://redis:6379`) in the frontend job, because the job itself runs in a
container.

## Why the ffmpeg check matters

`backend/tests/test_video_transcode.py` skips its real transcode tests when `ffmpeg` or `ffprobe` is not on `PATH`. A silently missing
binary would turn those tests into skips, so the workflow verifies the binaries and encoders and fails instead.

## What is not changed

No test, assertion or application code was changed or skipped, and there is no `continue-on-error`. Other workflows still run
`playwright install --with-deps chromium` (`auth-captcha-e2e.yml`, `showroom-rc2-e2e.yml`, `hosted-acceptance-e2e.yml`,
`phone-signup-security.yml`); they fall under the same risk and are a follow-up, kept out of this change to stay minimal.

## Local evidence before CI

- The backend transcode tests ran in a Python 3.12 container with the pinned static ffmpeg: 44 passed, 0 skipped.
- The pinned ffmpeg image provides `libx264`, `libvpx-vp9`, `libopus`, `aac`; `age` and `age-keygen` v1.1.1 build with `go install`.
- `actionlint` 1.7.7 reports no findings for `ci.yml`.

## Updating a pin

Playwright: change the lockfile version and the image digest together (the guard step enforces it). ffmpeg: pull the new tag, read
`docker image inspect --format '{{index .RepoDigests 0}}'`, update the digest and re-run the backend transcode tests. age: change the
module version in both `go install` arguments.

## Related files

`.github/workflows/ci.yml`, `backend/tests/test_video_transcode.py`, `frontend/playwright.access-routing.config.ts`, `docs/technical/TECHNICAL_DEBT.md`.
