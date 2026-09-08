"""Regression tests for supabase/staging/verify-staging-seed.sql.

These exercise the CANONICAL verifier file itself — not a copy of it — against
a real local Postgres, injecting one synthetic violation per test inside a
transaction that is always rolled back afterward, alongside whatever the
verifier's own `rollback;` already discards. Nothing here is committed.

Requires the local Supabase Postgres container (`supabase_db_aladdin`) to
already be running with the enriched 26-account STAGING demo world loaded —
base seeds (seed.sql/seed-pilot.sql/seed-showroom-sales.sql) PLUS
supabase/staging/demo-enrichment.sql, exactly what
`supabase/staging/verify-staging-seed.sql` itself checks against. Note this is
NOT the same as a plain `supabase db reset` (which never applies
demo-enrichment.sql, so e.g. Karim Adel and the platform admin are missing
their primary email contact row and B5 fails), nor is it what a *completed*
`python scripts/rehearse_staging_seed.py` run leaves behind (its own last step
resets back to that same plain seed). Load the correct state with:

    python scripts/rehearse_staging_seed.py --keep

The module-level readiness check below confirms not merely that the container
answers, but that it actually holds that enriched world (every account in
scripts/staging_demo.py's manifest has a primary email contact) — a reachable
container in the WRONG state skips with an actionable message instead of
failing 4 unrelated-looking tests on the same upstream B5 error before their
own scenario-specific assertions ever run (the exact failure mode that
motivated this check: see scripts/test_build_staging_seed.py for the static
regression pin on the underlying seed-source gap).

This keeps `python -m unittest discover -s scripts -p "test_*.py"` fast and
Docker-independent for everyone whose container isn't running; run this file
directly (or via `pnpm staging:seed:test`, which runs the whole
`scripts/test_*.py` suite) when validating a change to the verifier itself.

    docker exec -i supabase_db_aladdin pg_isready -U postgres   # sanity check
    python scripts/rehearse_staging_seed.py --keep              # load the right state
    python scripts/test_verify_staging_seed.py -v
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import staging_demo as sd  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
VERIFY = REPO_ROOT / "supabase" / "staging" / "verify-staging-seed.sql"
CONTAINER = "supabase_db_aladdin"

KARIM_USER_ID = "22222222-2222-4222-8222-222222222222"
NADIA_USER_ID = "33333333-3333-4333-8333-333333333333"


def _container_ready() -> bool:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
        capture_output=True,
    )
    return result.returncode == 0


def _demo_world_ready() -> tuple[bool, str]:
    """Whether the container is up AND already holds the enriched 26-account
    demo world these tests assert against — not merely that Postgres answers.
    A container that is up but was reset to the plain local dev seed (missing
    supabase/staging/demo-enrichment.sql) skips cleanly with a fix-it message
    instead of failing 4 tests on the same opaque upstream B5 error."""
    if not _container_ready():
        return False, f"local Postgres container {CONTAINER!r} is not running"
    accounts = sd.load_accounts()
    ids_sql = ",".join(f"'{a.id}'::uuid" for a in accounts)
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
         "select count(*) from public.contacts "
         f"where channel = 'email' and is_primary and user_id in ({ids_sql});"],
        capture_output=True, text=True, encoding="utf-8",
    )
    have = result.stdout.strip()
    if result.returncode != 0 or have != str(len(accounts)):
        return False, (
            f"container {CONTAINER!r} is up but does not hold the enriched {len(accounts)}-account "
            f"demo world (only {have or '0'}/{len(accounts)} expected accounts have a primary email "
            "contact — see this file's own docstring). Run "
            "`python scripts/rehearse_staging_seed.py --keep` to load it, then retry."
        )
    return True, ""


_READY, _READY_REASON = _demo_world_ready()


def _verifier_body_without_own_begin() -> str:
    """The canonical file's content, minus its own leading `begin;` — the
    caller supplies the outer transaction instead, so an injected violation
    and the verifier's own checks share one session/GUC scope."""
    text = VERIFY.read_text(encoding="utf-8")
    marker = "begin;\n\n-- Default to the strict mode"
    if marker not in text:
        raise AssertionError(
            "verify-staging-seed.sql's expected leading `begin;` marker was not "
            "found — did the file's structure change? Update this test's marker."
        )
    return text.replace(marker, "-- Default to the strict mode", 1)


# The local rehearsal fixture seeds all 26 demo accounts on the reserved,
# undeliverable `@example.test` domain by design (see B2's rehearsal skip) —
# so any "hosted" mode test needs those addresses looking deliverable first,
# or B2 fails every hosted-mode case before the check under test ever runs.
_HOSTED_DOMAIN_FIX = """
update auth.users set email = regexp_replace(email, '@example\\.test$', '@aladdin-hosted-test.dev')
 where email ~ '@example\\.test$';
update public.contacts set value = regexp_replace(value, '@example\\.test$', '@aladdin-hosted-test.dev')
 where channel = 'email' and value ~ '@example\\.test$';
"""


def _run(mode: str, prelude: str = "") -> subprocess.CompletedProcess:
    """Run the canonical verifier, in `mode`, with `prelude` SQL injected
    first inside the SAME transaction the verifier's own body runs in. The
    verifier's own trailing `rollback;` discards the prelude's mutation too —
    nothing here is ever committed."""
    domain_fix = _HOSTED_DOMAIN_FIX if mode == "hosted" else ""
    sql = (
        "begin;\n"
        + domain_fix
        + prelude
        + f"\nselect set_config('aladdin.verify_mode', '{mode}', false);\n"
        + _verifier_body_without_own_begin()
    )
    return subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1"],
        input=sql,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _count(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
         "-t", "-A", "-c", sql],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


@unittest.skipUnless(_READY, _READY_REASON)
class VerifyStagingSeedRegressionTests(unittest.TestCase):
    def test_extra_unrelated_user_does_not_fail_hosted_mode(self) -> None:
        prelude = """
        insert into auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current, reauthentication_token,
          phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        ) values (
          'aaaaaaaa-0000-4000-8000-00000000fe27', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'unrelated-27th-user@example.test', 'x',
          now(), '', '', '', '', '', '', '', '',
          '{}'::jsonb, '{}'::jsonb, now(), now()
        );
        """
        proc = _run("hosted", prelude)
        self.assertEqual(
            proc.returncode, 0,
            f"an unrelated 27th user must not fail hosted mode:\n{proc.stderr}",
        )

    def test_missing_expected_demo_identity_fails(self) -> None:
        # A raw DELETE on a real demo user hits real, correct FK protection
        # (organizations.created_by, memberships.user_id, ...) before the
        # verifier ever runs — proof the schema itself won't let a demo
        # identity vanish by accident. To exercise the verifier's OWN A2
        # check specifically (rather than A1's separate total-count check,
        # which would otherwise fire first on the resulting 25-row total),
        # triggers are disabled for this one synthetic deletion, and an
        # unrelated extra user keeps the total at >= 26 so A1 stays quiet and
        # A2 is the one that names the specific missing identity.
        prelude = f"""
        set session_replication_role = replica;
        delete from auth.users where id = '{NADIA_USER_ID}'::uuid;
        set session_replication_role = origin;
        insert into auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current, reauthentication_token,
          phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        ) values (
          'aaaaaaaa-0000-4000-8000-00000000fe29', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'backfill-to-stay-at-26@aladdin-hosted-test.dev', 'x',
          now(), '', '', '', '', '', '', '', '',
          '{{}}'::jsonb, '{{}}'::jsonb, now(), now()
        );
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(proc.returncode, 0, "a missing expected demo identity must fail")
        self.assertIn("A2 population", proc.stderr)

    def test_duplicate_demo_email_fails(self) -> None:
        # GoTrue's own partial unique index (auth.users_email_partial_key) is
        # a literal, CASE-SENSITIVE constraint on `email` — real defense in
        # depth, but not by itself proof against two addresses that are only
        # the same once lower-cased, exactly what B1 groups by. Upper-casing
        # one duplicate's domain reaches B1 without touching that index.
        prelude = f"""
        update auth.users set email =
          upper(split_part((select email from auth.users where id = '{KARIM_USER_ID}'::uuid), '@', 1))
          || '@' || upper(split_part((select email from auth.users where id = '{KARIM_USER_ID}'::uuid), '@', 2))
        where id = '{NADIA_USER_ID}'::uuid;
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(proc.returncode, 0, "a duplicate demo-account email must fail")
        self.assertIn("B1 email", proc.stderr)

    def test_karim_missing_sales_read_fails(self) -> None:
        prelude = f"""
        delete from public.membership_capabilities
         where capability_key = 'sales.read'
           and membership_id = (select id from public.memberships where user_id = '{KARIM_USER_ID}'::uuid);
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(proc.returncode, 0, "Karim missing sales.read must fail")
        self.assertIn("G2 karim", proc.stderr)

    def test_karim_missing_sales_write_fails(self) -> None:
        prelude = f"""
        delete from public.membership_capabilities
         where capability_key = 'sales.write'
           and membership_id = (select id from public.memberships where user_id = '{KARIM_USER_ID}'::uuid);
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(proc.returncode, 0, "Karim missing sales.write must fail")
        self.assertIn("G3 karim", proc.stderr)

    def test_karim_branch_access_outside_his_organization_fails(self) -> None:
        # A real trigger (app.enforce_membership_branch_tenant) already blocks
        # this insert outright — schema-level defense in depth. To exercise
        # the verifier's OWN C5 check specifically (belt AND suspenders),
        # triggers are disabled for this one synthetic insert only.
        prelude = f"""
        set session_replication_role = replica;
        insert into public.membership_branch_access (membership_id, branch_id)
        select m.id, b.id
          from public.memberships m
          join public.branches b on b.organization_id <> m.organization_id
         where m.user_id = '{KARIM_USER_ID}'::uuid
         limit 1;
        set session_replication_role = origin;
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(
            proc.returncode, 0,
            "Karim holding branch access outside his own organization must fail",
        )
        self.assertIn("C5 linkage", proc.stderr)

    def test_rehearsal_mode_remains_strict_on_extra_user(self) -> None:
        prelude = """
        insert into auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, confirmation_token, recovery_token, email_change,
          email_change_token_new, email_change_token_current, reauthentication_token,
          phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        ) values (
          'aaaaaaaa-0000-4000-8000-00000000fe28', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'unrelated-28th-user@example.test', 'x',
          now(), '', '', '', '', '', '', '', '',
          '{}'::jsonb, '{}'::jsonb, now(), now()
        );
        """
        proc = _run("rehearsal", prelude)
        self.assertNotEqual(
            proc.returncode, 0,
            "rehearsal/fixture mode must stay strict — an extra user must fail it",
        )
        self.assertIn("A1 population", proc.stderr)

    def test_hosted_execution_performs_zero_persistent_writes(self) -> None:
        before = _count("select count(*) from auth.users;")
        # Run once clean (expected pass) and once with an injected failure —
        # either way, nothing survives the verifier's own rollback.
        _run("hosted")
        _run("hosted", f"delete from auth.users where id = '{NADIA_USER_ID}'::uuid;\n")
        after = _count("select count(*) from auth.users;")
        self.assertEqual(before, after, "hosted-mode runs must never change persisted row counts")

    def test_all_26_accounts_have_exactly_one_primary_email_contact(self) -> None:
        # Direct regression pin for the exact defect class this suite's own
        # readiness check (_demo_world_ready) already relies on: every account
        # scripts/staging_demo.py's manifest lists must have EXACTLY ONE
        # public.contacts row with channel='email' and is_primary=true — the
        # invariant B5 enforces. Checked independently, against the live
        # database, rather than trusting the verifier to grade its own homework.
        accounts = sd.load_accounts()
        ids_array = ",".join(f"'{a.id}'::uuid" for a in accounts)
        sql = (
            f"select a.id, coalesce(c.n, 0) from unnest(array[{ids_array}]) as a(id) "
            "left join (select user_id, count(*) n from public.contacts "
            "where channel = 'email' and is_primary group by user_id) c on c.user_id = a.id "
            "order by a.id;"
        )
        result = subprocess.run(
            ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        slug_by_id = {a.id: a.slug for a in accounts}
        wrong = []
        for line in result.stdout.strip().splitlines():
            uid, _, n = line.partition("|")
            if n.strip() != "1":
                wrong.append(f"{slug_by_id.get(uid, uid)} ({uid}): {n.strip()} primary email contact(s)")
        self.assertEqual(
            wrong, [],
            "every demo account must have EXACTLY ONE primary email contact:\n  " + "\n  ".join(wrong),
        )

    def test_second_primary_contact_for_same_user_is_rejected(self) -> None:
        # uq_contacts_primary_per_user (supabase/migrations/20260802090001_identity_core.sql)
        # is a partial unique index enforcing at most one primary contact per
        # user, across every channel. Proves the DATABASE itself — not merely
        # the verifier — refuses a duplicate, so demo-enrichment.sql's insert
        # (or any future one) can never silently double up a primary contact
        # for an account the base seed files already cover. Rolled back — this
        # asserts an INSERT is rejected, so nothing to roll back on success,
        # but the transaction is aborted either way and never committed.
        sql = (
            "begin;\n"
            "insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)\n"
            f"values ('{KARIM_USER_ID}'::uuid, 'whatsapp', '+20-100-000-0000', true, true, now());\n"
            "rollback;\n"
        )
        result = subprocess.run(
            ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
             "-v", "ON_ERROR_STOP=1"],
            input=sql, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertNotEqual(
            result.returncode, 0,
            "a second primary contact for an already-covered demo account must be rejected",
        )
        self.assertIn("uq_contacts_primary_per_user", result.stderr)


if __name__ == "__main__":
    unittest.main()
