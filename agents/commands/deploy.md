# Command: deploy

Run this command when deploying to any environment (staging or production).

---

## Pre-Deploy Checklist

- [ ] All tests are passing locally
- [ ] Branch is up to date with main / master
- [ ] All changes are committed (no dirty working tree)
- [ ] Environment variables / secrets are set correctly for target env
- [ ] Database migrations (if any) are ready to run post-deploy
- [ ] Notify the team before deploying to production

---

## Build

```bash
cd frontend && pnpm cf:build   # OpenNext build of the Cloudflare Worker
```

---

## Deploy

Aladdin runs on Cloudflare (ADR-0021, ADR-0022, ADR-0024; Vercel is retired).

- **Preview** (Acceptance data): the `Cloudflare frontend preview` and `Cloudflare backend preview` workflows.
- **Production**: the manual `Cloudflare production` workflow from `main` (stage `check`, then `backend`, then
  `frontend`), behind the `cloudflare-production` environment's owner approval. See
  `docs/guides/cloudflare-frontend.md`.
- A variable added in the Cloudflare dashboard only uploads a new version: it goes live after **Promote version**.
  Mirror every dashboard variable in `frontend/wrangler.jsonc`, or the next workflow deploy drops it.

---

## Post-Deploy Validation

- [ ] Visit the live URL and verify the app loads
- [ ] Test the critical user flows (login, core feature, checkout, etc.)
- [ ] Check error monitoring (Sentry, Datadog, etc.) for new errors
- [ ] Confirm database migrations ran successfully (if applicable)
- [ ] Check server logs for warnings or errors

---

## Rollback Procedure

```bash
# Git revert to previous release tag
git revert HEAD
git push

# Or roll the Worker back to its previous version
cd frontend && pnpm exec wrangler rollback --env production
# (or Worker > Deployments in the Cloudflare dashboard)
```

---

## Git Discipline (MANDATORY)

Before deploying, tag the release:

```
git tag -a v<version> -m "Release v<version>: <what this release includes>"
git push origin v<version>
```

After deploy, commit any env / config changes:

```
git add .
git commit -m "deploy: release v<version> to <environment>

Why: <reason for this release — feature launch, hotfix, etc.>"
```

---

## Notes

- Never deploy on Fridays unless it is an emergency hotfix.
- Always deploy to staging before production.
- Keep a deployment log with version, date, and deployer name.
