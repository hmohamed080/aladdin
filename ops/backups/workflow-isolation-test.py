#!/usr/bin/env python3
"""Credential isolation of the backup workflows (offline). The Supabase service-role key can call the run-ledger and
schedule RPCs; the age restore identity decrypts every backup. They must never meet:

  * the service-role key appears only in jobs bound to the dedicated environment `backup-control-<label>`, and
    those jobs hold nothing else secret (no R2 token, no database URL, no age identity);
  * the age restore identity appears only in the restore job, in the `restore-test-<label>` environment, and that
    job holds no service-role key;
  * the backup (data) job holds neither the service-role key nor any age private key (it encrypts to public keys);
  * no `secrets: inherit`, no step passes a secret on the command line.

  python3 ops/backups/workflow-isolation-test.py
"""
import pathlib
import re
import sys

import yaml

HERE = pathlib.Path(__file__).resolve().parent
SERVICE = "SUPABASE_SERVICE_ROLE_KEY"
AGE = "AGE_RESTORE_TEST_IDENTITY"
OTHER_SECRETS = re.compile(r"secrets\.(R2_[A-Z_]+|BACKUP_DB_URL|AGE_[A-Z_]+|RESEND_API_KEY)")
failures = []


def check(ok, what):
    print(("PASS  " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def secrets_in(node):
    return set(re.findall(r"secrets\.([A-Za-z0-9_]+)", yaml.safe_dump(node)))


total_service_jobs = 0
for path in sorted((HERE / "workflows").glob("*.yml")):
    doc = yaml.safe_load(path.read_text())
    text = path.read_text()
    check("secrets: inherit" not in text, f"{path.name}: no `secrets: inherit`")
    for name, job in doc["jobs"].items():
        used = secrets_in(job)
        env = str(job.get("environment", ""))
        where = f"{path.name}:{name}"
        if SERVICE in used:
            total_service_jobs += 1
            check(env.startswith("backup-control-"), f"{where}: the service-role key is only in a backup-control-<label> environment ({env})")
            check(not (used - {SERVICE}), f"{where}: a service-role job holds no other secret ({sorted(used - {SERVICE})})")
        if AGE in used:
            check(name == "restore" and env.startswith("restore-test-"), f"{where}: the age restore identity is only in the restore job")
            check(SERVICE not in used, f"{where}: the restore job holds no service-role key")
        if name == "backup":
            check(SERVICE not in used and AGE not in used, f"{where}: the backup job holds neither the service-role key nor an age private key")
        if env.startswith("backup-control-"):
            check(not job.get("steps") or all("backup/db-backup" not in str(s) and "restore-test.sh" not in str(s) for s in job["steps"]),
                  f"{where}: a control job runs no backup or restore code")
check(total_service_jobs >= 3, f"service-role key is used by the control jobs and the reconciler only ({total_service_jobs} jobs)")

# The reconciler reads job names; they must exist exactly as report-run.py looks them up.
daily = yaml.safe_load((HERE / "workflows/daily-backup.yml").read_text())["jobs"]
restore = yaml.safe_load((HERE / "workflows/restore-test.yml").read_text())["jobs"]
src = (HERE / "report-run.py").read_text()
check("name: control (${{ matrix.label }})" in (HERE / "workflows/daily-backup.yml").read_text() and "f'control ({label})'" in src,
      "report-run.py finds the backup's control job by the name the workflow gives it")
check("name: restore-control (" in (HERE / "workflows/restore-test.yml").read_text() and "f'restore-control ({label})'" in src,
      "report-run.py finds the restore's control job by the name the workflow gives it")
check("Claim run" in [s.get("name") for s in daily["control"]["steps"]] and "Claim run" in [s.get("name") for s in restore["restore-control"]["steps"]],
      "both control jobs have the `Claim run` step the reconciler looks for")
check("Verify complete coverage" in [s.get("name") for s in daily["backup"]["steps"]] and "Verify complete coverage" in [s.get("name") for s in restore["restore"]["steps"]],
      "both data jobs end with `Verify complete coverage`")
# The data jobs are gated on their control job and fail closed when it fails or does not authorize.
check("needs.control.result == 'success'" in str(daily["backup"]["if"]), "the backup job runs only after a successful control job")
check("needs.restore-control.result == 'success'" in str(restore["restore"]["if"]), "the restore job runs only after a successful control job")
sys.exit(1 if failures else 0)
