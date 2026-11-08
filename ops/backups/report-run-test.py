#!/usr/bin/env python3
"""Offline tests of the run-ledger bridge (report-run.py): what it records for a finished run, and when it stays silent.
No network: the GitHub and Supabase calls are replaced by canned answers.

  python3 ops/backups/report-run-test.py
"""
import importlib.util
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("report_run", HERE / "report-run.py")
rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)

fails = 0
def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1

def step(name, conclusion): return {"name": name, "conclusion": conclusion}
def job(name, conclusion, steps=()): return {"name": name, "conclusion": conclusion, "steps": list(steps)}

def run_case(kind="backup", label="production", run=None, jobs=None, argv=("report-run.py", "--complete"), env_extra=None):
    """Returns (ledger calls, exit_ok)."""
    run = {"event": "schedule", "head_branch": "main", "status": "completed", "conclusion": "success",
           "display_title": "Daily backup", "run_attempt": 1, **(run or {})}
    calls = []
    def fake(url, headers, payload=None):
        if url.endswith("/jobs?per_page=100"): return {"jobs": jobs or []}
        if "api.github.com" in url: return run
        calls.append(payload); return {}
    rr.call = fake
    sys.argv = list(argv)
    env = {"BACKUP_LABEL": label, "BACKUP_KIND": kind, "TARGET_RUN_ID": "42", "SUPABASE_SERVICE_ROLE_KEY": "k",
           "SUPABASE_URL": "https://%s.supabase.co" % rr.PROJECTS[label], "GITHUB_REPOSITORY": "hmohamed080/aladdin-backups",
           "GITHUB_TOKEN": "t", **(env_extra or {})}
    for k in list(os.environ):
        if k in ("BACKUP_LABEL", "BACKUP_KIND", "TARGET_RUN_ID", "REQUEST_ID", "SUPABASE_URL", "GITHUB_REPOSITORY"): del os.environ[k]
    os.environ.update(env)
    try:
        rr.main(); return calls, True
    except Exception:
        return calls, False

claimed = job("control (production)", "success", [step("Claim run", "success")])
good = job("backup (production)", "success", [step("Verify complete coverage", "success")])

c, ok = run_case(jobs=[claimed, good]); check("verified backup is recorded as succeeded", ok and len(c) == 1 and c[0]["p_status"] == "succeeded" and c[0]["p_summary"]["coverage_verified"] is True)
c, ok = run_case(jobs=[claimed, job("backup (production)", "success", [step("Verify complete coverage", "skipped")])]); check("a run with no new snapshot (coverage skipped) is recorded as skipped", ok and c[0]["p_status"] == "skipped")
c, ok = run_case(run={"conclusion": "failure"}, jobs=[claimed, job("backup (production)", "failure", [step("Verify complete coverage", "skipped")])]); check("a failed backup is recorded as failed with a code", ok and c[0]["p_status"] == "failed" and c[0]["p_code"] == "workflow_failed")
c, ok = run_case(run={"conclusion": "cancelled"}, jobs=[claimed, job("backup (production)", "cancelled", [step("Verify complete coverage", "skipped")])]); check("a cancelled run is recorded as failed, never as succeeded", ok and c[0]["p_status"] == "failed")
c, ok = run_case(run={"conclusion": "failure"}, jobs=[claimed, job("backup (production)", "success", [step("Verify complete coverage", "failure")])]); check("a coverage failure on an otherwise green job is failed", ok and c[0]["p_status"] == "failed")
c, ok = run_case(run={"conclusion": "failure"}, jobs=[claimed, job("backup (production)", "success", [step("Verify complete coverage", "success")])]); check("a green job in a failed run is not recorded as succeeded", ok and c[0]["p_status"] == "failed")
c, ok = run_case(jobs=[claimed, job("backup (production)", "skipped")]); check("a skipped data job records nothing", ok and c == [])
c, ok = run_case(jobs=[job("control (production)", "success", [step("Claim run", "skipped")]), good]); check("a run that was never claimed records nothing", ok and c == [])
c, ok = run_case(jobs=[good]); check("a run without a control job records nothing", ok and c == [])
c, ok = run_case(jobs=[job("control (acceptance)", "success", [step("Claim run", "success")]), good]); check("another project's control job is not this project's claim", ok and c == [])
c, ok = run_case(kind="restore_test", jobs=[job("restore-control (production)", "success", [step("Claim run", "success")]), job("restore (production)", "success", [step("Verify complete coverage", "success")])]); check("a restore is claimed by restore-control and recorded", ok and c[0]["p_kind"] == "restore_test" and c[0]["p_status"] == "succeeded")
c, ok = run_case(kind="restore_test", jobs=[claimed, job("restore (production)", "success", [step("Verify complete coverage", "success")])]); check("a restore never uses the backup's control job", ok and c == [])
c, ok = run_case(run={"event": "pull_request"}, jobs=[claimed, good]); check("a run from an untrusted event is refused", not ok and c == [])
c, ok = run_case(run={"head_branch": "feature"}, jobs=[claimed, good]); check("a run from another branch is refused", not ok and c == [])
c, ok = run_case(run={"status": "in_progress"}, jobs=[claimed, good]); check("an unfinished run is refused", not ok and c == [])
c, ok = run_case(jobs=[claimed, good], env_extra={"GITHUB_REPOSITORY": "someone/else"}); check("another repository is refused", not ok and c == [])
c, ok = run_case(jobs=[claimed, good], env_extra={"SUPABASE_URL": "https://nxossqhdfltcqdwvbewi.supabase.co"}); check("the wrong project for the label is refused", not ok and c == [])
c, ok = run_case(argv=("report-run.py",), env_extra={"REQUEST_ID": "r"}); check("a claim (no --complete) records running", ok and c[0]["p_status"] == "running" and c[0]["p_request_id"] == "r")

print("report-run-test: %s" % ("OK" if not fails else "%d failed" % fails))
sys.exit(1 if fails else 0)
