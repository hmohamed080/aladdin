#!/usr/bin/env python3
"""Offline test of final-acceptance-preflight.py with synthetic fixtures (no network, no secrets)."""
import copy, json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
B = {"production": ("aladdin-production-db-backups", "aladdin-media-private", "aladdin-site-media"),
     "acceptance": ("aladdin-acceptance-backups-weur", "aladdin-r2-acceptance-20261011-private", "aladdin-acceptance-site-media")}
def good(label):
    bk, md, st = B[label]
    var = lambda **k: [{"name": n, "value": v} for n, v in k.items()]
    return {
        "repo": {"variables": var(PRODUCTION_BACKUP_ENABLED="true", ACCEPTANCE_BACKUP_SCHEDULE="off"),
                 "environments": [f"{p}-{label}" for p in ("backup", "backup-check", "backup-control", "restore-test")]},
        f"backup-{label}": {"variables": var(BACKUP_BUCKET=bk, R2_ACCOUNT_ID="a", AGE_RECIPIENTS="k", R2_MEDIA_BACKUP="1", R2_MEDIA_SOURCE_BUCKET=md, R2_SITE_BACKUP="1", R2_SITE_SOURCE_BUCKET=st),
                            "secrets": ["BACKUP_DB_URL", "R2_BACKUP_WRITE_KEY_ID", "R2_BACKUP_WRITE_SECRET", "R2_MEDIA_READ_KEY_ID", "R2_MEDIA_READ_SECRET"]},
        f"backup-check-{label}": {"variables": var(BACKUP_BUCKET=bk, R2_ACCOUNT_ID="a", ALERT_EMAIL="e", R2_MEDIA_BACKUP="1", R2_SITE_BACKUP="1"),
                                  "secrets": ["R2_BACKUP_READ_KEY_ID", "R2_BACKUP_READ_SECRET", "RESEND_API_KEY"]},
        f"backup-control-{label}": {"variables": var(SUPABASE_URL="u"), "secrets": ["SUPABASE_SERVICE_ROLE_KEY"]},
        f"restore-test-{label}": {"variables": var(BACKUP_BUCKET=bk, R2_ACCOUNT_ID="a", R2_MEDIA_BACKUP="1", R2_SITE_BACKUP="1"),
                                  "secrets": ["R2_BACKUP_READ_KEY_ID", "R2_BACKUP_READ_SECRET", "AGE_RESTORE_TEST_IDENTITY"]},
    }
def run(label, fx):
    with tempfile.TemporaryDirectory() as d:
        json.dump(fx["repo"], open(f"{d}/repo.json", "w"))
        for k, v in fx.items():
            if k != "repo": json.dump(v, open(f"{d}/env-{k}.json", "w"))
        p = subprocess.run([sys.executable, f"{HERE}/final-acceptance-preflight.py", "--label", label, "--fixture", d], capture_output=True, text=True)
        return p.returncode, p.stdout
def setvar(fx, env, name, value):
    vs = fx[env]["variables"]; [vs.remove(v) for v in list(vs) if v["name"] == name]
    if value is not None: vs.append({"name": name, "value": value})
fails = 0
def check(name, cond):
    global fails
    print(("PASS  " if cond else "FAIL  ") + name); fails += 0 if cond else 1
for label in ("production", "acceptance"):
    rc, out = run(label, good(label)); check(f"{label}: a correct configuration passes and prints the runs", rc == 0 and "restore-test.yml" in out)
fx = good("production"); setvar(fx, "backup-production", "LEGACY_MEDIA_BACKUP", "1"); rc, out = run("production", fx)
check("LEGACY_MEDIA_BACKUP=1 fails (no service-role key in the backup job)", rc == 1 and "LEGACY_MEDIA_BACKUP=1 can never succeed" in out)
fx = good("production"); setvar(fx, "backup-production", "R2_SITE_BACKUP", None); rc, out = run("production", fx)
check("missing R2_SITE_BACKUP fails", rc == 1 and "R2_SITE_BACKUP" in out)
fx = good("production"); setvar(fx, "restore-test-production", "R2_SITE_BACKUP", "0"); rc, out = run("production", fx)
check("R2_SITE_BACKUP not 1 in the restore env fails", rc == 1 and "must be 1" in out)
fx = good("production"); setvar(fx, "backup-production", "R2_SITE_SOURCE_BUCKET", "aladdin-acceptance-site-media"); rc, out = run("production", fx)
check("another project's site bucket fails", rc == 1 and "not the production bucket" in out)
fx = good("production"); fx["backup-control-production"]["secrets"].append("R2_BACKUP_READ_SECRET"); rc, out = run("production", fx)
check("extra secret in the control environment fails (credential isolation)", rc == 1 and "must hold exactly" in out)
fx = good("production"); fx["restore-test-production"]["secrets"].remove("AGE_RESTORE_TEST_IDENTITY"); rc, out = run("production", fx)
check("missing restore identity fails", rc == 1 and "AGE_RESTORE_TEST_IDENTITY" in out)
fx = good("production"); fx["repo"]["environments"].remove("backup-check-production"); rc, out = run("production", fx)
check("missing environment fails", rc == 1 and "backup-check-production is missing" in out)
fx = good("production"); fx["repo"]["variables"].append({"name": "PRODUCTION_RESTORE_SCHEDULE_ENABLED", "value": "true"}); rc, out = run("production", fx)
check("scheduled Production restore enabled before the exercise fails", rc == 1 and "PRODUCTION_RESTORE_SCHEDULE_ENABLED" in out)
fx = good("production"); setvar(fx, "backup-production", "BACKUP_BUCKET", "aladdin-acceptance-backups-weur"); rc, out = run("production", fx)
check("wrong backup bucket fails", rc == 1 and "not the production bucket" in out)
print(f"final-acceptance-preflight-test: {'ALL PASSED' if not fails else str(fails) + ' FAILED'}"); sys.exit(1 if fails else 0)
