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

There are TWO module-level readiness checks below, deliberately different
strength:

  `_identities_loaded()` confirms only that the 26 expected demo IDENTITIES
  exist (by user id) — genuinely independent of whether each one also has
  its primary email contact. `PrimaryEmailContactInvariantTests` (the B5
  invariant itself) is gated on THIS weaker check, so that a world where the
  26 identities exist but one is missing its primary email contact — exactly
  what B5 exists to catch — makes those tests FAIL, not skip. Gating them on
  the stronger check below would mean the one condition this suite exists to
  catch is also the one condition that hides it, which is exactly the defect
  an earlier version of this file had (confirmed by reproduction: deleting
  Karim Adel's primary email contact from an otherwise-correct loaded world
  produced `OK (skipped=10)`, not a failure).

  `_demo_world_ready()` confirms the container actually holds the FULLY
  correct enriched world (every account has its primary email contact too).
  `VerifyStagingSeedRegressionTests` — every test that needs the full
  verifier script to reach a check AFTER B5 (Karim's G2/G3/C5, the
  hosted-mode pass/fail scenarios) — stays gated on this stronger check: a
  reachable container in the wrong state skips with an actionable message
  instead of failing on the same upstream B5 error before their own
  scenario-specific assertions ever run (the failure mode that originally
  motivated adding a readiness check at all: see
  scripts/test_build_staging_seed.py for the static regression pin on the
  underlying seed-source gap).

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


def _identities_loaded() -> tuple[bool, str]:
    """Whether the container is up AND holds all 26 expected demo IDENTITIES
    (by user id) — a genuinely WEAKER precondition than `_demo_world_ready`
    below, deliberately independent of whether each one also has its primary
    email contact. This is the "is *some* version of the demo world loaded at
    all" gate: state 1 (nothing loaded) fails it and skips; state 2 (fully
    correct) and state 3 (26 identities present, but one is missing its
    primary email contact — exactly the regression this file exists to catch)
    BOTH satisfy it, so tests gated on this one run — and can genuinely FAIL —
    in either state. Only tests that need the FULL verifier script to reach a
    check AFTER B5 (Karim's G2/G3/C5, the hosted-mode pass/fail scenarios) use
    the stricter `_demo_world_ready` below instead."""
    if not _container_ready():
        return False, f"local Postgres container {CONTAINER!r} is not running"
    accounts = sd.load_accounts()
    ids_sql = ",".join(f"'{a.id}'::uuid" for a in accounts)
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
         f"select count(*) from auth.users where id in ({ids_sql});"],
        capture_output=True, text=True, encoding="utf-8",
    )
    have = result.stdout.strip()
    if result.returncode != 0 or have != str(len(accounts)):
        return False, (
            f"container {CONTAINER!r} is up but does not hold the 26 expected demo identities "
            f"(only {have or '0'}/{len(accounts)} present). Run "
            "`python scripts/rehearse_staging_seed.py --keep` to load it, then retry."
        )
    return True, ""


def _demo_world_ready() -> tuple[bool, str]:
    """Whether the container is up AND already holds the FULLY CORRECT
    enriched 26-account demo world these tests assert against — not merely
    that the 26 identities exist. A container that is up but was reset to the
    plain local dev seed (missing supabase/staging/demo-enrichment.sql), OR
    that holds the 26 identities but is missing a primary email contact for
    one of them, skips cleanly with a fix-it message instead of failing on
    the same opaque upstream B5 error before these tests' own
    scenario-specific assertions ever run.

    DELIBERATELY NOT used to gate the direct B5-invariant regression tests
    below (`test_all_26_accounts_have_exactly_one_primary_email_contact` and
    friends) — those are gated on the weaker `_identities_loaded` instead,
    specifically so that state 3 (26 identities present, one missing its
    primary email contact — i.e. this exact check returning False) makes
    them FAIL rather than SKIP. Gating them on this stricter check would mean
    the one condition this file exists to catch is also the one condition
    that hides it — the defect an earlier version of this file had."""
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


_IDENTITIES_READY, _IDENTITIES_READY_REASON = _identities_loaded()
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


@unittest.skipUnless(_IDENTITIES_READY, _IDENTITIES_READY_REASON)
class PrimaryEmailContactInvariantTests(unittest.TestCase):
    """The B5 invariant itself ("every expected demo account has EXACTLY ONE
    primary email contact"), gated on `_identities_loaded` — the WEAK
    precondition that only the 26 identities exist — rather than on
    `_demo_world_ready`'s stronger "everything is already correct" check.

    THIS SEPARATION IS THE FIX for the exact defect state 3 describes: when
    one expected account is missing its primary email contact,
    `_demo_world_ready()` legitimately returns False (that IS what it means
    for the demo world to not be fully correct) — but that must never also
    be the reason THESE tests, whose entire job is to catch that exact
    condition, get skipped instead of failing. An earlier version of this
    file put these tests in the same `@unittest.skipUnless(_READY, ...)`
    class as everything else, so the one condition this suite exists to
    catch was also the one condition that hid it — confirmed by deleting
    Karim Adel's primary email contact from an otherwise-correct loaded
    world and observing `OK (skipped=10)` instead of a failure.

    Every test below is written to be self-contained where the underlying
    invariant it exercises would otherwise depend on ambient state (see
    `test_second_primary_contact_for_same_user_is_rejected`), so nothing
    here silently passes or fails for the wrong reason depending on what
    state the container happened to be in beforehand.
    """

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

    def test_removing_one_primary_email_contact_fails_b5_not_a_skip(self) -> None:
        # THE explicit proof state 3 asks for: starting from an otherwise
        # correct 26-account world, force-remove exactly one expected
        # account's primary email contact (Karim Adel's — this test does not
        # trust ambient state to already have it; it inserts one first if
        # absent, so the removal that follows is always real), run the
        # CANONICAL verifier in hosted mode inside a rolled-back transaction,
        # and assert it FAILS on B5 by name. This is the live-injection
        # counterpart to test_all_26_accounts_have_exactly_one_primary_email_
        # contact above (which only observes ambient state); together they
        # prove both that today's world is correct AND that the mechanism
        # itself still catches the regression when it is not.
        prelude = f"""
        insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
        select '{KARIM_USER_ID}'::uuid, 'email', 'karim.b5-regression-fixture@aladdin-hosted-test.dev', true, true, now()
        where not exists (
          select 1 from public.contacts
           where user_id = '{KARIM_USER_ID}'::uuid and channel = 'email' and is_primary
        );
        delete from public.contacts
         where user_id = '{KARIM_USER_ID}'::uuid and channel = 'email' and is_primary;
        """
        proc = _run("hosted", prelude)
        self.assertNotEqual(
            proc.returncode, 0,
            "removing one expected account's primary email contact must FAIL the verifier "
            f"(on B5), never pass or be skipped:\n{proc.stderr}",
        )
        self.assertIn("B5 email", proc.stderr)
        # And the count in the message must be exactly the one account this
        # test removed — not some pre-existing, unrelated gap the readiness
        # check should have already caught (and, being self-contained, did).
        self.assertIn("B5 email: 1 account(s)", proc.stderr)

    def test_second_primary_contact_for_same_user_is_rejected(self) -> None:
        # uq_contacts_primary_per_user (supabase/migrations/20260802090001_identity_core.sql)
        # is a partial unique index enforcing at most one primary contact per
        # user, across every channel. Proves the DATABASE itself — not merely
        # the verifier — refuses a duplicate, so demo-enrichment.sql's insert
        # (or any future one) can never silently double up a primary contact
        # for an account the base seed files already cover.
        #
        # SELF-CONTAINED: this test is gated on the weak `_identities_loaded`
        # precondition, so it must not assume Karim already has a primary
        # contact to collide with — in the exact state-3 scenario this file
        # exists to catch, he might not. It guarantees one first (inside the
        # same transaction, rolled back either way) so what it proves is
        # always "a SECOND primary contact is rejected", never "a first one
        # happened to succeed".
        sql = (
            "begin;\n"
            "insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)\n"
            f"select '{KARIM_USER_ID}'::uuid, 'email', 'karim.uniqueness-fixture@aladdin-hosted-test.dev', true, true, now()\n"
            "where not exists (\n"
            f"  select 1 from public.contacts where user_id = '{KARIM_USER_ID}'::uuid and is_primary\n"
            ");\n"
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
