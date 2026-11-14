#!/usr/bin/env python3
"""Read-only preflight for the ONE final backup/restore acceptance exercise (run before it, never instead of it).

Checks the private repo's hosted configuration (variable VALUES of non-secret settings, secret NAMES only) against what
the kit requires for <label>, and prints the exact manual runs of the exercise. It starts nothing and changes nothing.

  python3 final-acceptance-preflight.py [--label production|acceptance] [--repo owner/aladdin-backups]
  python3 final-acceptance-preflight.py --fixture DIR     # offline: DIR holds repo.json and env-<name>.json (tests)

Exit 0 = every check passed, 1 = at least one FAIL. WARN lines do not fail the run.
"""
import argparse, json, subprocess, sys

EXPECT = {
    "production": {"backup": "aladdin-production-db-backups", "media": "aladdin-media-private", "site": "aladdin-site-media"},
    "acceptance": {"backup": "aladdin-acceptance-backups-weur", "media": "aladdin-r2-acceptance-20261011-private", "site": "aladdin-acceptance-site-media"},
}
READ = ["R2_BACKUP_READ_KEY_ID", "R2_BACKUP_READ_SECRET"]
SPEC = {  # env prefix -> (variables that must exist, secrets that must exist, exact secret set or None)
    "backup": (["BACKUP_BUCKET", "R2_ACCOUNT_ID", "AGE_RECIPIENTS", "R2_MEDIA_BACKUP", "R2_MEDIA_SOURCE_BUCKET", "R2_SITE_BACKUP", "R2_SITE_SOURCE_BUCKET"],
               ["BACKUP_DB_URL", "R2_BACKUP_WRITE_KEY_ID", "R2_BACKUP_WRITE_SECRET", "R2_MEDIA_READ_KEY_ID", "R2_MEDIA_READ_SECRET"], None),
    "backup-check": (["BACKUP_BUCKET", "R2_ACCOUNT_ID", "ALERT_EMAIL", "R2_MEDIA_BACKUP", "R2_SITE_BACKUP"], READ + ["RESEND_API_KEY"], None),
    "restore-test": (["BACKUP_BUCKET", "R2_ACCOUNT_ID", "R2_MEDIA_BACKUP", "R2_SITE_BACKUP"], READ + ["AGE_RESTORE_TEST_IDENTITY"], None),
    "backup-control": (["SUPABASE_URL"], ["SUPABASE_SERVICE_ROLE_KEY"], {"SUPABASE_SERVICE_ROLE_KEY"}),
}


def gh(repo, path):
    out = subprocess.run(["gh", "api", f"repos/{repo}/{path}", "--paginate"], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit("gh api failed: " + out.stderr.strip()[:200])
    return json.loads(out.stdout)


def load(args):
    if args.fixture:
        rd = lambda n: json.load(open(f"{args.fixture}/{n}.json"))
        return rd("repo"), lambda env: rd(f"env-{env}")
    repo = {"variables": gh(args.repo, "actions/variables")["variables"], "environments": [e["name"] for e in gh(args.repo, "environments")["environments"]]}

    def env(name):
        return {"variables": gh(args.repo, f"environments/{name}/variables")["variables"], "secrets": [s["name"] for s in gh(args.repo, f"environments/{name}/secrets")["secrets"]]}
    return repo, env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="production", choices=sorted(EXPECT))
    ap.add_argument("--repo", default="hmohamed080/aladdin-backups")
    ap.add_argument("--fixture")
    args = ap.parse_args()
    label, want = args.label, EXPECT[args.label]
    repo, getenv = load(args)
    fails, warns = [], []
    rv = {v["name"]: v["value"] for v in repo["variables"]}

    if label == "production" and rv.get("PRODUCTION_RESTORE_SCHEDULE_ENABLED") == "true":
        fails.append("PRODUCTION_RESTORE_SCHEDULE_ENABLED is true: no scheduled Production restore before this exercise has passed")
    if label == "production" and rv.get("PRODUCTION_BACKUP_ENABLED") != "true":
        warns.append("PRODUCTION_BACKUP_ENABLED is not 'true': the manual Production backup of the exercise needs it (set it only at the owner's GO; automation stays off until the console schedule is enabled)")
    if label == "acceptance" and rv.get("ACCEPTANCE_BACKUP_SCHEDULE", "off") != "off":
        warns.append("ACCEPTANCE_BACKUP_SCHEDULE is not off")

    for prefix, (vars_need, secrets_need, exact) in SPEC.items():
        name = f"{prefix}-{label}"
        if name not in repo["environments"]:
            fails.append(f"environment {name} is missing")
            continue
        e = getenv(name)
        v = {x["name"]: x["value"] for x in e["variables"]}
        for k in vars_need:
            if not v.get(k):
                fails.append(f"{name}: variable {k} is not set")
        for k in secrets_need:
            if k not in e["secrets"]:
                fails.append(f"{name}: secret {k} is not set")
        if exact is not None and set(e["secrets"]) != exact:
            fails.append(f"{name}: must hold exactly {sorted(exact)}, has {sorted(e['secrets'])}")
        for k, bucket in (("BACKUP_BUCKET", want["backup"]), ("R2_MEDIA_SOURCE_BUCKET", want["media"]), ("R2_SITE_SOURCE_BUCKET", want["site"])):
            if k in v and v[k] != bucket:
                fails.append(f"{name}: {k} is not the {label} bucket {bucket}")
        for k in ("R2_MEDIA_BACKUP", "R2_SITE_BACKUP"):
            if k in vars_need and v.get(k) != "1":
                fails.append(f"{name}: {k} must be 1 (a {label} snapshot that skips it is never complete)")
        # The backup job holds no service-role key and the legacy step needs one, so the switch can only fail the run.
        if v.get("LEGACY_MEDIA_BACKUP") == "1":
            fails.append(f"{name}: LEGACY_MEDIA_BACKUP=1 can never succeed here (the legacy step needs SUPABASE_SERVICE_ROLE_KEY, which only backup-control-{label} holds); remove it once the Supabase Storage cleanup has deleted the legacy objects")
        if "R2_SITE_BACKUP" not in v and "R2_SITE_BACKUP" in vars_need:
            pass  # already reported as not set above

    for line in fails:
        print("FAIL  " + line)
    for line in warns:
        print("WARN  " + line)
    if not fails:
        print(f"PASS  configuration for '{label}' matches the kit. The exercise (once, in this order, each its own owner GO):")
        print(f"  1. gh workflow run daily-backup.yml -R {args.repo} -f label={label}" + (' -f confirm="back up production"' if label == "production" else ""))
        print(f"  2. gh workflow run restore-test.yml -R {args.repo} -f label={label}   # newest snapshot; the data job must be 'success'")
        print("  3. record: run ids, RESULT line, counts (never names or keys); only then ask for the activation GO")
    print(f"RESULT: {'FAIL' if fails else 'PASS'} ({len(fails)} fail, {len(warns)} warn)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
