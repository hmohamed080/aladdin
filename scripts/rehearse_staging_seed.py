#!/usr/bin/env python3
"""Rehearse the one-time staging load against the LOCAL database, end to end.

    python scripts/rehearse_staging_seed.py

What it proves, in the order staging will experience it:

  1. `supabase db reset --no-seed` — migrations only, so the local database is in
     exactly the state a freshly `db push`-ed staging project is in: schema
     present, `auth.users` and `public.organizations` empty.
  2. First apply of the generated bundle — succeeds.
  3. `supabase/staging/verify-staging-seed.sql` — all 26 accounts check out.
  4. SECOND apply of the same bundle — must FAIL on the refusal guard, and must
     leave the row counts byte-for-byte unchanged. A guard that raises but has
     already written half a world is worse than no guard, so the counts are
     captured before and after and compared.
  5. `supabase db reset` — puts the local world back the way it was, seeds and
     all, so this script costs a developer nothing but time.

It never touches a remote project: every step runs against the local Supabase
container, and step 1 would refuse to run against a linked one anyway.

This is a REHEARSAL: the bundle it builds uses `--rehearsal`, whose addresses are
deliberately undeliverable. It proves the load mechanics, the enrichment and the
assertions — not that anyone can receive an OTP, which only a real mailbox can.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BUNDLE = REPO_ROOT / "supabase" / ".staging-seed.rehearsal.sql"
VERIFY = REPO_ROOT / "supabase" / "staging" / "verify-staging-seed.sql"
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
CONTAINER = "supabase_db_aladdin"

# --- isolated mode ---------------------------------------------------------
# A throwaway container running the SAME Supabase Postgres image, seeded by
# replaying supabase/migrations in order. It reproduces the staging starting
# state more literally than `db reset --no-seed` does — a genuinely empty
# database with migrations applied and nothing else — and it touches neither the
# developer's local stack nor any remote project.
#
# It exists because `db reset` is not always available: the pinned CLI and a
# machine's global CLI can want different Postgres image tags, and an
# uncached tag turns the rehearsal into a 1.7 GB download (or a stalled one).
# Isolated mode runs against whichever supabase/postgres image is already local.
ISO_CONTAINER = "aladdin_staging_rehearsal"
ISO_PASSWORD = "rehearsal"
ISO_AUTH = "aladdin_staging_rehearsal_auth"


def supabase_cli() -> str:
    """Whichever Supabase CLI is actually driving this machine's local stack.

    Prefer one on PATH over the repository devDependency: the two can pin
    different Postgres image tags, and starting the stack with a CLI whose image
    is not cached turns a two-minute rehearsal into a 1.7 GB download.
    """
    found = shutil.which("supabase")
    if found:
        return found
    local = REPO_ROOT / "node_modules" / ".bin" / ("supabase.cmd" if sys.platform == "win32" else "supabase")
    if local.exists():
        return str(local)
    raise SystemExit("no supabase CLI found — install it, or run `pnpm install` for the pinned one")

# Tables whose totals must be identical before and after the refused second run.
COUNT_SQL = """
select 'auth.users='       || (select count(*) from auth.users)
    || ' users='           || (select count(*) from public.users)
    || ' profiles='        || (select count(*) from public.profiles)
    || ' orgs='            || (select count(*) from public.organizations)
    || ' branches='        || (select count(*) from public.branches)
    || ' memberships='     || (select count(*) from public.memberships)
    || ' capabilities='    || (select count(*) from public.membership_capabilities)
    || ' contacts='        || (select count(*) from public.contacts)
    || ' onboarding='      || (select count(*) from public.onboarding_progress)
    || ' individual='      || (select count(*) from public.individual_onboarding)
    || ' products='        || (select count(*) from public.products)
    || ' rfqs='            || (select count(*) from public.rfqs)
    || ' rfq_items='       || (select count(*) from public.rfq_items)
    || ' quotations='      || (select count(*) from public.quotations)
    || ' quotation_items=' || (select count(*) from public.quotation_items)
    || ' orders='          || (select count(*) from public.orders)
    || ' order_items='     || (select count(*) from public.order_items)
    || ' projects='        || (select count(*) from public.projects)
    || ' customers='       || (select count(*) from public.customers)
    || ' leads='           || (select count(*) from public.leads)
    || ' follow_ups='      || (select count(*) from public.follow_up_tasks)
    || ' activities='      || (select count(*) from public.sales_activities)
    || ' saved='           || (select count(*) from public.saved_products)
    || ' verifications='   || (select count(*) from public.verifications)
    || ' invitations='     || (select count(*) from public.organization_invitations)
    || ' join_requests='   || (select count(*) from public.organization_join_requests)
    || ' referrals='       || (select count(*) from public.organization_referrals)
    || ' audit='           || (select count(*) from public.audit_log);
"""


def step(n: int, title: str) -> None:
    print(f"\n{'=' * 78}\n[{n}] {title}\n{'=' * 78}", flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=REPO_ROOT, **kw)


def cached_postgres_image() -> str:
    """The newest supabase/postgres image already on this machine."""
    out = subprocess.run(
        ["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"],
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    tags = sorted(
        line.strip()
        for line in out.splitlines()
        if "/supabase/postgres:" in line and "postgres-meta" not in line
    )
    if not tags:
        raise SystemExit(
            "no supabase/postgres image cached locally.\n"
            "Pull one first:  docker pull public.ecr.aws/supabase/postgres:17.6.1.158"
        )
    return tags[-1]


def cached_gotrue_image() -> str | None:
    """The newest GoTrue image already on this machine, if any."""
    out = subprocess.run(
        ["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"],
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    tags = sorted(line.strip() for line in out.splitlines() if "/supabase/gotrue:" in line)
    return tags[-1] if tags else None


def migrate_auth_schema() -> None:
    """Let GoTrue build the real `auth` schema, rather than inventing one.

    The Postgres image ships GoTrue's v1 BASELINE only — `auth.users` there has
    no `email_confirmed_at`, no `email_change_token_new`, no `reauthentication_token`.
    Those columns come from GoTrue's own migrations, which the auth container runs
    at startup, and the seed writes to all of them.

    Running the real GoTrue against this database is the honest way to get them:
    hand-writing the missing columns would mean rehearsing against a schema this
    repository invented, which is exactly the kind of "verified" that proves
    nothing. GoTrue exits once it has migrated (`--version`-style bootstrap does
    not, so it is started as a server and stopped as soon as the columns appear).
    """
    image = cached_gotrue_image()
    if not image:
        raise SystemExit(
            "no supabase/gotrue image cached locally — isolated mode needs it to build the\n"
            "auth schema. Pull one:  docker pull public.ecr.aws/supabase/gotrue:v2.195.0"
        )
    print(f"    auth schema via {image}", flush=True)

    # GoTrue must connect as `supabase_auth_admin`: it OWNS the `auth` schema, and
    # `postgres` is denied there (the image's own privilege model, not ours).
    # The role already exists; it just has no password in a bare container.
    grant = psql(
        sql=f"alter role supabase_auth_admin with login password '{ISO_PASSWORD}';",
        user="supabase_admin",
    )
    if grant.returncode != 0:
        raise SystemExit(f"could not prepare supabase_auth_admin:\n{grant.stderr}")

    subprocess.run(["docker", "rm", "-f", ISO_AUTH], capture_output=True)
    started = subprocess.run(
        ["docker", "run", "-d", "--name", ISO_AUTH, "--link", f"{ISO_CONTAINER}:db",
         "-e", "GOTRUE_DB_DRIVER=postgres",
         "-e", f"GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:{ISO_PASSWORD}@db:5432/postgres?sslmode=disable",
         "-e", "GOTRUE_DB_NAMESPACE=auth",
         "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "PORT=9999",
         "-e", "API_EXTERNAL_URL=http://localhost:9999",
         "-e", "GOTRUE_SITE_URL=http://localhost:3000",
         "-e", "GOTRUE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long",
         "-e", "GOTRUE_JWT_AUD=authenticated",
         "-e", "GOTRUE_DB_MIGRATIONS_ENABLED=true",
         image],
        capture_output=True, text=True, encoding="utf-8",
    )
    if started.returncode != 0:
        raise SystemExit(f"could not start GoTrue:\n{started.stderr}")

    print("    migrating auth schema…", end="", flush=True)
    for _ in range(120):
        probe = psql(
            sql="select count(*) from information_schema.columns "
                "where table_schema='auth' and table_name='users' "
                "and column_name in ('email_confirmed_at','email_change_token_new',"
                "'reauthentication_token','phone_change_token','confirmation_token');",
        )
        if probe.returncode == 0 and probe.stdout.strip().isdigit() and int(probe.stdout.strip()) == 5:
            break
        print(".", end="", flush=True)
        time.sleep(1)
    else:
        logs = subprocess.run(["docker", "logs", "--tail", "30", ISO_AUTH],
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        raise SystemExit(f"\n    GoTrue never completed its migrations:\n{logs.stdout}{logs.stderr}")
    print(" done")
    subprocess.run(["docker", "rm", "-f", ISO_AUTH], capture_output=True)


def start_isolated() -> None:
    """Boot a throwaway Postgres and replay every migration in order."""
    image = cached_postgres_image()
    print(f"    image: {image}")
    subprocess.run(["docker", "rm", "-f", ISO_CONTAINER], capture_output=True)
    started = subprocess.run(
        ["docker", "run", "-d", "--name", ISO_CONTAINER,
         "-e", f"POSTGRES_PASSWORD={ISO_PASSWORD}", image],
        capture_output=True, text=True, encoding="utf-8",
    )
    if started.returncode != 0:
        raise SystemExit(f"could not start the rehearsal container:\n{started.stderr}")

    # Wait for the image's OWN init scripts to finish, not merely for the port
    # to answer. `pg_isready` succeeds during initialisation — the entrypoint
    # starts a local server so those scripts can run — and the Supabase image
    # creates and then removes `pg_graphql` while they do. Replaying migrations
    # inside that window fails nondeterministically with
    # `could not open relation` from `graphql.increment_schema_version()`,
    # because the extension's DDL event trigger is live while its sequence is
    # not yet visible. The log marker below is emitted once, after init.
    print("    waiting for postgres init…", end="", flush=True)
    for _ in range(180):
        logs = subprocess.run(
            ["docker", "logs", ISO_CONTAINER],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        blob = (logs.stdout or "") + (logs.stderr or "")
        ready = subprocess.run(
            ["docker", "exec", ISO_CONTAINER, "pg_isready", "-U", "postgres"],
            capture_output=True,
        )
        if "init process complete" in blob and ready.returncode == 0:
            break
        print(".", end="", flush=True)
        time.sleep(1)
    else:
        raise SystemExit("\n    postgres never finished initialising")
    print(" ready")

    # Belt and braces: if a future image leaves pg_graphql installed, its DDL
    # event triggers would fire on every CREATE TABLE below. Disabling them is
    # scoped to this throwaway container and changes no repository migration.
    # Non-fatal — on a normal image there is nothing to disable.
    psql(
        sql=(
            "do $prep$ declare t record; begin "
            "for t in select evtname from pg_event_trigger where evtname like 'graphql%' loop "
            "execute format('alter event trigger %I disable', t.evtname); "
            "end loop; end $prep$;"
        ),
        user="supabase_admin",
    )

    migrate_auth_schema()

    files = sorted(MIGRATIONS.glob("*.sql"))
    print(f"    replaying {len(files)} migrations…", flush=True)
    for path in files:
        result = psql(file=path, database="postgres")
        if result.returncode != 0:
            print(result.stdout[-2000:])
            print(result.stderr[-3000:], file=sys.stderr)
            raise SystemExit(f"migration failed: {path.name}")
    print(f"    {len(files)} migrations applied")


def stop_isolated() -> None:
    subprocess.run(["docker", "rm", "-f", ISO_AUTH], capture_output=True)
    subprocess.run(["docker", "rm", "-f", ISO_CONTAINER], capture_output=True)


def psql(sql: str | None = None, file: Path | None = None, stop_on_error: bool = True,
         database: str = "postgres", container: str | None = None, user: str = "postgres",
         variables: dict[str, str] | None = None):
    cmd = ["docker", "exec", "-i", container or CONTAINER, "psql", "-U", user, "-d", database]
    if stop_on_error:
        cmd += ["-v", "ON_ERROR_STOP=1"]
    for key, value in (variables or {}).items():
        cmd += ["-v", f"{key}={value}"]
    if sql is not None:
        cmd += ["-t", "-A", "-c", sql]
        return subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8")
    data = file.read_text(encoding="utf-8")
    return subprocess.run(
        cmd, cwd=REPO_ROOT, input=data, capture_output=True, text=True, encoding="utf-8"
    )


def counts() -> str:
    result = psql(sql=COUNT_SQL)
    if result.returncode != 0:
        raise SystemExit(f"could not read row counts:\n{result.stderr}")
    return result.stdout.strip()


def main() -> int:
    global CONTAINER

    parser = argparse.ArgumentParser(
        prog="rehearse_staging_seed.py",
        description="Rehearse the one-time staging load against a local database.",
    )
    parser.add_argument(
        "--isolated",
        action="store_true",
        help="use a throwaway container + replayed migrations instead of the local Supabase stack "
             "(no CLI needed, leaves your stack untouched)",
    )
    args = parser.parse_args()

    step(0, "Build the rehearsal bundle")
    if run([sys.executable, "scripts/build_staging_seed.py", "--rehearsal"]).returncode != 0:
        return 1

    if args.isolated:
        CONTAINER = ISO_CONTAINER
        step(1, "Throwaway Postgres + replayed migrations (the staging starting state)")
        try:
            start_isolated()
        except SystemExit as exc:
            stop_isolated()
            print(f"FAILED: {exc}", file=sys.stderr)
            return 1
    else:
        cli = supabase_cli()
        print(f"using supabase CLI: {cli}")
        step(1, "supabase db reset --no-seed  (migrations only — the staging starting state)")
        if run([cli, "db", "reset", "--no-seed"]).returncode != 0:
            print("FAILED: could not reset the local database", file=sys.stderr)
            return 1

    empty = psql(sql="select (select count(*) from auth.users) || '/' || (select count(*) from public.organizations);")
    print(f"    auth.users/organizations after reset: {empty.stdout.strip()}")
    if empty.stdout.strip() != "0/0":
        print("FAILED: --no-seed left rows behind; the guard would refuse for the wrong reason", file=sys.stderr)
        return 1

    step(2, "FIRST apply of the bundle — must succeed")
    first = psql(file=BUNDLE)
    if first.returncode != 0:
        print(first.stdout[-4000:])
        print(first.stderr[-4000:], file=sys.stderr)
        print("FAILED: the first apply did not succeed", file=sys.stderr)
        return 1
    after_first = counts()
    print(f"    {after_first}")

    step(3, "Verify all 26 demo accounts")
    # The rehearsal bundle uses deliberately undeliverable addresses, so the
    # deliverability check is told to stand down. Every other check still runs.
    verify = psql(file=VERIFY, variables={"rehearsal": "on"})
    print(verify.stdout)
    if verify.returncode != 0:
        print(verify.stderr, file=sys.stderr)
        print("FAILED: verification did not pass", file=sys.stderr)
        return 1
    print(verify.stderr.strip())

    step(4, "SECOND apply — must be REFUSED and must write zero rows")
    before_second = counts()
    second = psql(file=BUNDLE)
    after_second = counts()

    if second.returncode == 0:
        print("FAILED: the second apply SUCCEEDED. The one-time guard is not working.", file=sys.stderr)
        return 1
    refusal = [ln for ln in second.stderr.splitlines() if "Refusing to load" in ln]
    if not refusal:
        print(second.stderr[-3000:], file=sys.stderr)
        print("FAILED: the second apply failed, but not on the refusal guard.", file=sys.stderr)
        return 1
    print(f"    refused with: {refusal[0].strip()}")

    if before_second != after_second:
        print("FAILED: row counts CHANGED across the refused run.", file=sys.stderr)
        print(f"  before: {before_second}\n  after:  {after_second}", file=sys.stderr)
        return 1
    print("    row counts identical before and after the refused run — zero rows written:")
    print(f"    {after_second}")

    if args.isolated:
        step(5, "Remove the throwaway container")
        stop_isolated()
        print("    removed; your local Supabase stack was never touched")
    else:
        step(5, "supabase db reset  (restore the normal local world)")
        if run([cli, "db", "reset"]).returncode != 0:
            print("WARNING: could not restore the local seeded world; run `supabase db reset` yourself.", file=sys.stderr)
            return 1

    print("\n" + "=" * 78)
    print("REHEARSAL PASSED — first apply loaded, 26 accounts verified,")
    print("second apply refused with zero rows written.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
