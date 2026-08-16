#!/usr/bin/env python3
"""Assemble the one-time STAGING demo-world seed for a hosted Supabase project.

Why this exists
---------------
`supabase/seed.sql`, `seed-pilot.sql`, and `seed-showroom-sales.sql` are applied
locally by `supabase db reset`, which drops the database first. That command must
NEVER be pointed at a hosted project, and the seed files are not idempotent on
their own: they insert into `auth.users` and every public table with fixed UUIDs
and no `ON CONFLICT`, so a second apply fails on duplicate keys partway through.

This script does not rewrite those files (they are pinned by the pgTAP suite and
the E2E fixtures). It concatenates them, in the order `supabase/config.toml`
already declares, into a single transaction fronted by a refusal guard. The
result is safe to apply exactly once to a freshly migrated STAGING database and
is inert against any database that already holds data — which is what keeps
Production from ever depending on demo seeds.

`config.toml` stays the single source of truth for the seed list, so a seed added
to the local reset flow is picked up here automatically.

Two staging-only layers are appended INSIDE the same transaction:

  * `supabase/staging/demo-enrichment.sql` — additive demo data for the eleven
    accounts the seed files leave with nothing to show. Deliberately absent from
    `config.toml [db.seed].sql_paths` so the local world, the pgTAP snapshots and
    the Playwright fixtures stay exactly what they were.

  * a generated EMAIL REMAP — every seeded account uses `@example.test`, a
    reserved TLD that can never receive mail, and the app signs in with Email OTP
    and nothing else. Addresses are composed from a mailbox the repository owner
    configures (never committed), and the build FAILS CLOSED without one.

Usage:
    python scripts/build_staging_seed.py             # → supabase/.staging-seed.sql
    python scripts/build_staging_seed.py --stdout    # print instead
    python scripts/build_staging_seed.py --rehearsal # → supabase/.staging-seed.rehearsal.sql

Both output paths are gitignored: the assembled file is a build artifact, and the
cloud one carries real addresses.

See docs/operations/staging-deployment-runbook.md.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from staging_demo import (  # noqa: E402
    Account,
    DemoEmailError,
    EmailPlan,
    email_map_values,
    load_accounts,
    rehearsal_email_plan,
    rel,
    resolve_email_plan,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "supabase" / "config.toml"
ENRICHMENT = REPO_ROOT / "supabase" / "staging" / "demo-enrichment.sql"
DEFAULT_OUT = REPO_ROOT / "supabase" / ".staging-seed.sql"
REHEARSAL_OUT = REPO_ROOT / "supabase" / ".staging-seed.rehearsal.sql"
MANIFEST_MD = REPO_ROOT / "supabase" / ".staging-demo-manifest.md"
MANIFEST_CSV = REPO_ROOT / "supabase" / ".staging-demo-manifest.csv"
# The COMMITTED manifest. Same 26 accounts, but the email column shows the
# composition PATTERN rather than an address, so it carries no mailbox and is
# safe in a public repository.
DOCS_MANIFEST = REPO_ROOT / "docs" / "operations" / "staging-demo-accounts.md"

# Refuses on a non-empty database rather than trying to merge. A staging project
# is cheap to recreate; a half-applied demo world on top of real rows is not.
# `to_regclass` is checked first so "you forgot to push migrations" reads as
# itself instead of as a missing-relation error from the emptiness probe.
GUARD = """\
-- ---------------------------------------------------------------------------
-- Refusal guard. Everything below runs in ONE transaction: if this raises,
-- nothing is written. Re-running on an already-seeded database is a no-op error,
-- never a partial load.
-- ---------------------------------------------------------------------------
do $staging_guard$
begin
  if to_regclass('public.organizations') is null then
    raise exception
      'Schema is not deployed. Push migrations (supabase db push) before loading the staging demo world.';
  end if;

  if exists (select 1 from auth.users) or exists (select 1 from public.organizations) then
    raise exception
      'Refusing to load the staging demo world: this database already has users or organizations.'
      using hint =
        'This is a ONE-TIME load for an empty STAGING database. It must never run against Production.';
  end if;
end
$staging_guard$;
"""


def seed_paths() -> list[Path]:
    """The seed files declared by `[db.seed].sql_paths`, resolved and ordered."""
    with CONFIG.open("rb") as fh:
        config = tomllib.load(fh)
    declared = config.get("db", {}).get("seed", {}).get("sql_paths", [])
    if not declared:
        raise SystemExit("no [db.seed].sql_paths declared in supabase/config.toml")

    resolved: list[Path] = []
    for entry in declared:
        # Paths in config.toml are relative to the supabase/ directory, but the
        # repo writes them as "./seed.sql" — resolve against supabase/ and fall
        # back to the repo root so either convention works.
        candidate = (CONFIG.parent / entry).resolve()
        if not candidate.is_file():
            candidate = (REPO_ROOT / entry).resolve()
        if not candidate.is_file():
            raise SystemExit(f"seed file declared in config.toml does not exist: {entry}")
        resolved.append(candidate)
    return resolved


def email_remap(accounts: list[Account], plan: EmailPlan) -> str:
    """SQL that repoints every demo identity at a deliverable address.

    Runs LAST, inside the same transaction, so it cannot leave half the world on
    one address space and half on another. Three tables carry an address and all
    three move together:

      * `auth.users.email`             — what GoTrue matches on for the OTP
      * `public.contacts.value`        — the verified primary contact
      * `organization_invitations.email` — Nour's pending invitation, which is
                                           addressed to a person, not a user id

    The final assertion is the point of the whole block: if any account failed to
    move, or two accounts collide, the transaction aborts and the database stays
    empty rather than accepting a set of accounts nobody can open. A cloud build
    additionally refuses to leave anything on a reserved, undeliverable domain —
    the rehearsal build cannot make that claim, because its addresses are
    deliberately undeliverable, and its own output path says so.
    """
    reserved_domain_check = (
        """
  select count(*) into v_reserved
    from auth.users
   where split_part(lower(email), '@', 2) ~ '\\.(test|example|invalid|localhost|local)$'
      or split_part(lower(email), '@', 2) ~ '(^|\\.)example\\.(com|net|org)$';
  if v_reserved > 0 then
    raise exception
      'Demo email remap: % account(s) landed on a RESERVED, undeliverable domain.', v_reserved
      using hint = 'Sign-in is Email OTP only — such an account can never be opened.';
  end if;
"""
        if plan.cloud_ready
        else "  -- (reserved-domain check omitted: this is the rehearsal artifact)\n"
    )
    return f"""\
-- ---------------------------------------------------------------------------
-- Demo email remap — {plan.mode} mode, from {plan.source}
-- ---------------------------------------------------------------------------
-- Every seeded account ships on `@example.test`, a reserved TLD (RFC 6761) that
-- can never receive mail. Sign-in is Email OTP and nothing else, so those
-- addresses are not cosmetic: they are the credential path. This repoints all
-- {len(accounts)} accounts at addresses the repository owner controls.
--
-- No password is created and no authentication path is bypassed. The accounts
-- sign in exactly the way a real user does — request a code, receive it, enter
-- it — which is also why this is the only correct fix.
create temporary table _demo_email_map (
  user_id    uuid primary key,
  old_email  text not null,
  new_email  text not null unique
) on commit drop;

insert into _demo_email_map (user_id, old_email, new_email) values
{email_map_values(accounts, plan)};

-- The invitation is addressed BEFORE the invitee is matched to a user row, so it
-- is remapped by address, not by id. Done first, while the old address is still
-- the one on file.
update public.organization_invitations i
   set email = m.new_email
  from _demo_email_map m
 where lower(i.email) = lower(m.old_email);

update auth.users u
   set email = m.new_email
  from _demo_email_map m
 where u.id = m.user_id;

update public.contacts c
   set value = m.new_email
  from _demo_email_map m
 where c.user_id = m.user_id
   and c.channel = 'email'
   and lower(c.value) = lower(m.old_email);

do $remap_check$
declare
  v_missing  int;
  v_stale    int;
  v_reserved int;
  v_contacts int;
  v_dupes    int;
begin
  select count(*) into v_missing
    from _demo_email_map m
    left join auth.users u on u.id = m.user_id
   where u.id is null;
  if v_missing > 0 then
    raise exception
      'Demo email remap: % of the {len(accounts)} manifest accounts do not exist in auth.users.', v_missing
      using hint = 'supabase/staging/demo-accounts.toml and the seed files have drifted apart.';
  end if;

  -- Every mapped account must have actually MOVED. Catches a remap that matched
  -- nothing (a drifted seed address) as loudly as one that ran and left rows.
  select count(*) into v_stale
    from auth.users u
    join _demo_email_map m on m.user_id = u.id
   where lower(u.email) = lower(m.old_email);
  if v_stale > 0 then
    raise exception
      'Demo email remap: % account(s) still carry their original seed address.', v_stale
      using hint = 'seed_local in supabase/staging/demo-accounts.toml no longer matches the seed files.';
  end if;
{reserved_domain_check}

  select count(*) into v_contacts
    from public.contacts c
    join _demo_email_map m on m.user_id = c.user_id
   where c.channel = 'email' and c.is_primary and c.value <> m.new_email;
  if v_contacts > 0 then
    raise exception
      'Demo email remap: % primary contact row(s) disagree with auth.users.', v_contacts;
  end if;

  select count(*) into v_dupes from (
    select lower(email) from auth.users group by 1 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Demo email remap: % duplicate address(es) across auth.users.', v_dupes;
  end if;
end
$remap_check$;
"""


def build(accounts: list[Account], plan: EmailPlan) -> str:
    files = seed_paths()
    listing = "\n".join(f"--   {i}. {rel(f)}" for i, f in enumerate(files, 1))
    banner = (
        "-- CLOUD-READY. Contains real, deliverable demo addresses — never commit this file."
        if plan.cloud_ready
        else "-- REHEARSAL ONLY. Addresses stay on the undeliverable @example.test domain;\n"
        "-- nobody can sign in to the result. Never apply this to a cloud project."
    )
    parts = [
        "-- ===========================================================================",
        "-- GENERATED — do not edit. Rebuild with:",
        "--   python scripts/build_staging_seed.py",
        "--",
        "-- One-time STAGING demo world, assembled from the seed files declared in",
        "-- supabase/config.toml [db.seed].sql_paths:",
        listing,
        "--",
        f"-- plus the staging-only demo enrichment ({rel(ENRICHMENT)})",
        f"-- plus a demo email remap for all {len(accounts)} accounts ({plan.mode} mode).",
        "--",
        banner,
        "--",
        "-- SYNTHETIC data only (no real people or companies). Apply once, to an empty",
        "-- STAGING database that has already had its migrations pushed. Never Production.",
        "-- ===========================================================================",
        "",
        "begin;",
        "",
        GUARD,
    ]
    for path in files + [ENRICHMENT]:
        name = rel(path)
        if not path.is_file():
            raise SystemExit(f"missing staging layer: {name}")
        parts.append("")
        parts.append(f"-- ==== BEGIN {name} " + "=" * max(0, 60 - len(name)))
        parts.append(path.read_text(encoding="utf-8").rstrip())
        parts.append(f"-- ==== END {name} " + "=" * max(0, 62 - len(name)))

    parts.append("")
    parts.append(email_remap(accounts, plan))
    parts.append("commit;")
    parts.append("")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def manifest_markdown(accounts: list[Account], plan: EmailPlan) -> str:
    lines = [
        "# Staging demo-account manifest",
        "",
        f"Generated by `scripts/build_staging_seed.py` — {len(accounts)} accounts, "
        f"addresses composed in **{plan.mode}** mode from {plan.source}.",
        "",
    ]
    if not plan.cloud_ready:
        lines += [
            "> **Rehearsal manifest.** These addresses are on the reserved `@example.test`",
            "> domain and cannot receive mail. Rebuild with a configured mailbox before a",
            "> real staging load.",
            "",
        ]
    else:
        lines += [
            "> Contains real addresses. This file is gitignored — keep it out of the repository,",
            "> pull requests, and chat logs.",
            "",
        ]

    lines += [
        "Sign in at `/auth/sign-in` with the address below; the six-digit code arrives by",
        "email. There are no demo passwords — the application is passwordless by design.",
        "",
    ]

    for i, a in enumerate(accounts, 1):
        lines += [
            f"## {i}. {a.name}",
            "",
            f"- **Email:** `{plan.for_account(a)}`",
            f"- **Persona / account type:** {a.persona_label}",
            f"- **Organization:** {a.org_label}"
            + (f" (`{a.org_type}`)" if a.org and a.org_type else ""),
            f"- **Role:** {a.role}",
            f"- **Expected landing route:** `{a.landing}`",
            f"- **Key visible data:** {a.data}",
            f"- **What to demo:** {a.demo}",
            "",
        ]
    return "\n".join(lines)


def docs_markdown(accounts: list[Account]) -> str:
    """The committed manifest — identical content, no addresses.

    Generated rather than hand-written so it cannot drift from
    `demo-accounts.toml`, and `--check-docs` fails the build when it has.
    """
    lines = [
        "# Staging demo accounts",
        "",
        "**Status:** Generated — do not edit by hand. Rebuild with "
        "`python scripts/build_staging_seed.py --write-docs`.",
        "",
        f"The {len(accounts)} demo identities in the STAGING demo world: who they are, where they "
        "land, what they can see, and what each one is for. Source of truth: "
        "[`supabase/staging/demo-accounts.toml`](../../supabase/staging/demo-accounts.toml).",
        "",
        "## How these accounts sign in",
        "",
        "The application is **passwordless** — Email OTP and nothing else. There is no demo",
        "password, no shared credential, and no bypass: each account requests a six-digit code",
        "and types it in, exactly as a real user does.",
        "",
        "That makes the address the credential path, which is why the seeded `@example.test`",
        "addresses are not usable as-is — that TLD is reserved and can never receive mail",
        "(RFC 6761). The loader repoints all 26 accounts at addresses composed from **a mailbox",
        "the repository owner configures**, and the build refuses to produce a cloud artifact",
        "without one:",
        "",
        "```",
        "plus mode      <mailbox-local>+<prefix>-<slug>@<mailbox-domain>",
        "domain mode    <slug>@<your-demo-domain>",
        "```",
        "",
        "Configure it in `supabase/staging/demo-email.toml` (gitignored — copy",
        "`demo-email.example.toml`). The resolved addresses are written to the gitignored",
        "`supabase/.staging-demo-manifest.md` and `.csv` at build time. **No real address",
        "appears in this repository.**",
        "",
        "## The accounts",
        "",
        "| # | Name | Slug | Persona | Organization | Role | Lands on |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, a in enumerate(accounts, 1):
        org = f"{a.org} (`{a.org_type}`)" if a.org and a.org_type else a.org_label
        lines.append(
            f"| {i} | {a.name} | `{a.slug}` | {a.persona_label} | {org} | {a.role} | `{a.landing}` |"
        )

    lines += [
        "",
        "## What each account shows",
        "",
    ]
    for i, a in enumerate(accounts, 1):
        org = f"{a.org} (`{a.org_type}`)" if a.org and a.org_type else a.org_label
        lines += [
            f"### {i}. {a.name}",
            "",
            f"- **Email slug:** `{a.slug}` — composed against your configured mailbox",
            f"- **Persona / account type:** {a.persona_label}",
            f"- **Organization:** {org}",
            f"- **Role:** {a.role}",
            f"- **Expected landing route:** `{a.landing}`",
            f"- **Key visible data:** {a.data}",
            f"- **What to demo:** {a.demo}",
            "",
        ]

    lines += [
        "## Verifying",
        "",
        "```bash",
        'psql "<connection string>" -f supabase/staging/verify-staging-seed.sql',
        "```",
        "",
        "Read-only and wrapped in a transaction that always rolls back. It checks population,",
        "address uniqueness and deliverability, persona/membership/branch linkage, commerce",
        "totals against their own line items, and — impersonating all 26 accounts under RLS —",
        "the landing route and non-emptiness of every one of them.",
        "",
        "## Related",
        "",
        "[`staging-deployment-runbook.md`](staging-deployment-runbook.md) ·",
        "[`../../supabase/staging/demo-enrichment.sql`](../../supabase/staging/demo-enrichment.sql) ·",
        "`scripts/build_staging_seed.py` · `scripts/rehearse_staging_seed.py`",
        "",
    ]
    return "\n".join(lines)


def manifest_csv(accounts: list[Account], plan: EmailPlan) -> str:
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        ["email", "display_name", "persona", "organization", "org_type", "role", "landing", "key_data", "what_to_demo"]
    )
    for a in accounts:
        writer.writerow(
            [plan.for_account(a), a.name, a.persona or "", a.org or "", a.org_type or "", a.role, a.landing, a.data, a.demo]
        )
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="build_staging_seed.py",
        description="Assemble the one-time STAGING demo-world seed.",
    )
    parser.add_argument("--stdout", action="store_true", help="print the SQL instead of writing it")
    parser.add_argument(
        "--rehearsal",
        action="store_true",
        help="build the LOCAL rehearsal artifact with undeliverable addresses (no mailbox needed)",
    )
    parser.add_argument("--demo-email-base", metavar="ADDRESS", help="mailbox to sub-address (plus mode)")
    parser.add_argument("--demo-email-domain", metavar="DOMAIN", help="catch-all domain (domain mode)")
    parser.add_argument("--demo-email-prefix", metavar="TAG", help="tag between the + and the slug")
    parser.add_argument(
        "--write-docs", action="store_true", help="regenerate the committed, address-free manifest and exit"
    )
    parser.add_argument(
        "--check-docs",
        action="store_true",
        help="fail if the committed manifest is stale (no mailbox needed); exit and write nothing",
    )
    args = parser.parse_args(argv)

    accounts = load_accounts()

    # Both doc modes are address-free, so neither needs an email mapping.
    if args.write_docs or args.check_docs:
        rendered = docs_markdown(accounts)
        current = DOCS_MANIFEST.read_text(encoding="utf-8") if DOCS_MANIFEST.is_file() else None
        if args.check_docs:
            if current == rendered:
                print(f"{rel(DOCS_MANIFEST)} is up to date ({len(accounts)} accounts)")
                return 0
            print(
                f"{rel(DOCS_MANIFEST)} is STALE — demo-accounts.toml has changed.\n"
                "Regenerate it with: python scripts/build_staging_seed.py --write-docs",
                file=sys.stderr,
            )
            return 1
        DOCS_MANIFEST.write_text(rendered, encoding="utf-8")
        print(f"wrote {rel(DOCS_MANIFEST)} ({len(accounts)} accounts, no addresses)")
        return 0

    if args.rehearsal:
        plan = rehearsal_email_plan(accounts)
        out_path = REHEARSAL_OUT
    else:
        try:
            plan = resolve_email_plan(
                accounts,
                cli_base=args.demo_email_base,
                cli_domain=args.demo_email_domain,
                cli_prefix=args.demo_email_prefix,
            )
        except DemoEmailError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        out_path = DEFAULT_OUT

    sql = build(accounts, plan)

    if args.stdout:
        # The seed files contain non-Latin-1 characters (Arabic customer names,
        # "→", "×"). A Windows console defaults to cp1252 and would abort the
        # write partway through, which for a paste-into-SQL-Editor workflow means
        # handing someone a truncated transaction. Force UTF-8 on the stream.
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(sql)
        return 0

    out_path.write_text(sql, encoding="utf-8")
    MANIFEST_MD.write_text(manifest_markdown(accounts, plan), encoding="utf-8")
    MANIFEST_CSV.write_text(manifest_csv(accounts, plan), encoding="utf-8")

    print(f"wrote {rel(out_path)} ({sql.count(chr(10))} lines)")
    print(f"wrote {rel(MANIFEST_MD)} and {rel(MANIFEST_CSV)} ({len(accounts)} accounts, {plan.mode} mode)")
    if plan.cloud_ready:
        print("apply ONCE to an empty, already-migrated staging database — see")
        print("docs/operations/staging-deployment-runbook.md")
    else:
        print("REHEARSAL artifact: addresses are undeliverable. Local rehearsal only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
