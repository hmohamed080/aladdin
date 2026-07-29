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
# Replace with your actual build command
npm run build
# or
yarn build
# or
python -m build
```

---

## Deploy

```bash
# Replace with your deployment method

# Vercel
vercel --prod

# Netlify
netlify deploy --prod

# Railway / Render / Fly.io
railway up
# or
flyctl deploy

# Docker
docker build -t <image>:<tag> .
docker push <image>:<tag>

# SSH / Server
rsync -avz ./dist user@server:/var/www/app
```

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

# Or redeploy previous version
vercel rollback
# or re-deploy the previous Docker image tag
docker pull <image>:<previous_tag>
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
