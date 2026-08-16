#!/usr/bin/env python3
"""The STAGING demo-account model: who the 26 accounts are and how they sign in.

Shared by `build_staging_seed.py` (which emits the loader) and
`validate_staging_seed.py` (which checks the result), so the manifest, the email
remap and the assertions can never describe three different worlds.

Two responsibilities:

1. **The account list** — parsed from `supabase/staging/demo-accounts.toml`,
   which describes accounts the seed files already create. Nothing here inserts
   a user; the validator fails if this list and `auth.users` disagree.

2. **Deliverable addresses** — the seeds use `@example.test`, a reserved TLD that
   can never receive mail (RFC 6761). Sign-in is Email OTP and nothing else, so
   an address that cannot receive a code is an account nobody can open. There is
   no password to fall back on and no bypass worth adding: the address IS the
   credential path.

   This module composes a unique, deliverable address per account from a mailbox
   the repository owner configures, and **fails closed** — no configuration means
   no cloud artifact, never 26 silently unreachable accounts.
"""

from __future__ import annotations

import os
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STAGING_DIR = REPO_ROOT / "supabase" / "staging"
ACCOUNTS_FILE = STAGING_DIR / "demo-accounts.toml"
EMAIL_CONFIG_FILE = STAGING_DIR / "demo-email.toml"
EMAIL_TEMPLATE_FILE = STAGING_DIR / "demo-email.example.toml"

ENV_BASE = "STAGING_DEMO_EMAIL_BASE"
ENV_DOMAIN = "STAGING_DEMO_EMAIL_DOMAIN"
ENV_PREFIX = "STAGING_DEMO_EMAIL_PREFIX"

DEFAULT_PREFIX = "aladdin"

# The address every seeded account currently carries. Kept as a constant because
# the remap keys off it and the validator asserts none survive.
SEED_DOMAIN = "example.test"

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Deliberately permissive on the local part and strict on shape: this validates
# that we composed something sane, not that the mailbox exists.
EMAIL_RE = re.compile(r"^[^@\s,;<>\"]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", re.I)

# RFC 2606 / 6761 reserved names. An address under any of these can never be
# delivered, which is exactly the failure this module exists to prevent — so a
# configuration naming one is rejected rather than accepted and shipped.
RESERVED_TLDS = {"test", "example", "invalid", "localhost", "local"}
RESERVED_DOMAINS = {"example.com", "example.net", "example.org"}

EXPECTED_ACCOUNT_COUNT = 26


class DemoEmailError(RuntimeError):
    """Raised when no usable, deliverable email mapping could be resolved."""


@dataclass(frozen=True)
class Account:
    """One seeded demo identity, as described by demo-accounts.toml."""

    id: str
    slug: str
    #: Local part of the address the SEED FILES give this account. The remap keys
    #: on the UUID, but the invitation row keys on the address, so both are needed.
    seed_local: str
    name: str
    persona: str
    org: str
    org_type: str
    role: str
    landing: str
    data: str
    demo: str

    @property
    def seed_email(self) -> str:
        """The undeliverable @example.test address this account starts with."""
        return f"{self.seed_local}@{SEED_DOMAIN}"

    @property
    def persona_label(self) -> str:
        return self.persona or "— (business-only identity)"

    @property
    def org_label(self) -> str:
        return self.org or "— (no organization)"


@dataclass(frozen=True)
class EmailPlan:
    """The resolved slug → address mapping, plus where it came from."""

    addresses: dict[str, str]
    mode: str
    source: str
    #: False for the rehearsal plan, whose addresses are intentionally undeliverable.
    cloud_ready: bool

    def for_account(self, account: Account) -> str:
        return self.addresses[account.slug]


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


def load_accounts(path: Path | None = None) -> list[Account]:
    """Parse and validate demo-accounts.toml."""
    src = path or ACCOUNTS_FILE
    if not src.is_file():
        raise SystemExit(f"missing demo account list: {rel(src)}")

    with src.open("rb") as fh:
        raw = tomllib.load(fh)

    entries = raw.get("account", [])
    if not entries:
        raise SystemExit(f"no [[account]] entries in {rel(src)}")

    accounts: list[Account] = []
    required = ("id", "slug", "seed_local", "name", "role", "landing", "data", "demo")
    for i, entry in enumerate(entries, 1):
        missing = [k for k in required if not str(entry.get(k, "")).strip()]
        if missing:
            raise SystemExit(f"{rel(src)}: account #{i} is missing {', '.join(missing)}")
        account = Account(
            id=entry["id"],
            slug=entry["slug"],
            seed_local=entry["seed_local"],
            name=entry["name"],
            persona=entry.get("persona", ""),
            org=entry.get("org", ""),
            org_type=entry.get("org_type", ""),
            role=entry["role"],
            landing=entry["landing"],
            data=entry["data"],
            demo=entry["demo"],
        )
        if not UUID_RE.match(account.id):
            raise SystemExit(f"{rel(src)}: '{account.id}' is not a lowercase UUID")
        if not SLUG_RE.match(account.slug):
            raise SystemExit(
                f"{rel(src)}: slug '{account.slug}' must be lowercase a-z0-9 separated by single hyphens"
            )
        accounts.append(account)

    _reject_duplicates([a.id for a in accounts], "UUID", src)
    _reject_duplicates([a.slug for a in accounts], "slug", src)
    _reject_duplicates([a.seed_local for a in accounts], "seed_local", src)

    if len(accounts) != EXPECTED_ACCOUNT_COUNT:
        raise SystemExit(
            f"{rel(src)}: expected {EXPECTED_ACCOUNT_COUNT} accounts, found {len(accounts)}.\n"
            "The seed files create exactly 26 auth users. If that changed, update "
            "EXPECTED_ACCOUNT_COUNT in scripts/staging_demo.py in the same commit."
        )
    return accounts


def _reject_duplicates(values: list[str], label: str, src: Path) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise SystemExit(f"{rel(src)}: duplicate {label} '{value}'")
        seen.add(value)


# ---------------------------------------------------------------------------
# Email resolution
# ---------------------------------------------------------------------------


def resolve_email_plan(
    accounts: list[Account],
    *,
    cli_base: str | None = None,
    cli_domain: str | None = None,
    cli_prefix: str | None = None,
    config_path: Path | None = None,
    env: dict[str, str] | None = None,
) -> EmailPlan:
    """Build the slug → address mapping, or raise DemoEmailError.

    Precedence: command line → environment → demo-email.toml. Whichever wins
    supplies the whole mapping; the sources are not merged, because a half-taken
    configuration is how you end up with two accounts sharing an inbox.
    """
    env = os.environ if env is None else env
    path = config_path or EMAIL_CONFIG_FILE

    if cli_base or cli_domain:
        settings = {"base": cli_base, "domain": cli_domain, "prefix": cli_prefix}
        source = "command line"
    elif env.get(ENV_BASE) or env.get(ENV_DOMAIN):
        settings = {
            "base": env.get(ENV_BASE),
            "domain": env.get(ENV_DOMAIN),
            "prefix": cli_prefix or env.get(ENV_PREFIX),
        }
        source = f"environment ({ENV_BASE}/{ENV_DOMAIN})"
    elif path.is_file():
        with path.open("rb") as fh:
            data = tomllib.load(fh)
        settings = {
            "base": data.get("base"),
            "domain": data.get("domain"),
            "prefix": cli_prefix or data.get("prefix"),
            "mode": data.get("mode"),
            "overrides": data.get("overrides", {}),
        }
        source = rel(path)
    else:
        raise DemoEmailError(_no_config_message(path))

    return _compose(accounts, settings, source=source, cloud_ready=True)


def rehearsal_email_plan(accounts: list[Account]) -> EmailPlan:
    """A structurally identical mapping that is deliberately NOT deliverable.

    The local rehearsal must exercise the remap — uniqueness, the contact
    rows, the invitation row — without needing anyone's real mailbox. Its
    addresses stay under the reserved `.test` TLD so a rehearsal artifact can
    never be mistaken for the cloud one, and it is written to its own path.
    """
    addresses = {a.slug: f"demo+{DEFAULT_PREFIX}-{a.slug}@{SEED_DOMAIN}" for a in accounts}
    _assert_unique(addresses)
    return EmailPlan(addresses=addresses, mode="rehearsal", source="built in", cloud_ready=False)


def _compose(
    accounts: list[Account],
    settings: dict,
    *,
    source: str,
    cloud_ready: bool,
) -> EmailPlan:
    base = (settings.get("base") or "").strip()
    domain = (settings.get("domain") or "").strip()
    prefix = (settings.get("prefix") or DEFAULT_PREFIX).strip()
    overrides = {k.strip(): v.strip() for k, v in (settings.get("overrides") or {}).items()}
    declared_mode = (settings.get("mode") or "").strip()

    # `mode` in the file is documentation; the value actually supplied decides,
    # so a file that sets mode = "plus" but only fills in `domain` still works.
    if base and domain:
        if declared_mode == "domain":
            base = ""
        else:
            domain = ""

    if base:
        mode = "plus"
        addresses = {a.slug: _plus_address(base, prefix, a.slug, source) for a in accounts}
    elif domain:
        mode = "domain"
        _check_domain(domain, source)
        addresses = {a.slug: f"{a.slug}@{domain}" for a in accounts}
    else:
        raise DemoEmailError(
            f"demo email configuration from {source} sets neither `base` nor `domain`.\n"
            f"See {rel(EMAIL_TEMPLATE_FILE)}."
        )

    unknown = set(overrides) - {a.slug for a in accounts}
    if unknown:
        raise DemoEmailError(
            f"demo email overrides from {source} name unknown account slugs: "
            f"{', '.join(sorted(unknown))}.\n"
            f"Valid slugs are listed in {rel(ACCOUNTS_FILE)}."
        )
    addresses.update(overrides)

    for slug, address in sorted(addresses.items()):
        _check_address(address, slug, source)
    _assert_unique(addresses)

    return EmailPlan(addresses=addresses, mode=mode, source=source, cloud_ready=cloud_ready)


def _plus_address(base: str, prefix: str, slug: str, source: str) -> str:
    if "@" not in base:
        raise DemoEmailError(f"`base` from {source} is not an email address: {base!r}")
    local, _, domain = base.partition("@")
    if "+" in local:
        # Sub-addressing a sub-address is not portable and silently breaks on
        # several providers. Better to say so than to emit 26 dead addresses.
        raise DemoEmailError(
            f"`base` from {source} already contains a '+' tag ({base!r}).\n"
            "Supply the plain mailbox address; the tag is added per account."
        )
    tag = f"{prefix}-{slug}" if prefix else slug
    _check_domain(domain, source)
    return f"{local}+{tag}@{domain}"


def _check_domain(domain: str, source: str) -> None:
    domain = domain.lower().strip(".")
    tld = domain.rsplit(".", 1)[-1] if "." in domain else domain
    # A SUBDOMAIN of a documentation domain is just as undeliverable as the
    # domain itself — `demo.example.com` is the shape a half-edited template
    # produces, so it has to be caught here rather than at first sign-in.
    reserved_apex = domain in RESERVED_DOMAINS or any(
        domain.endswith(f".{d}") for d in RESERVED_DOMAINS
    )
    if tld in RESERVED_TLDS or reserved_apex:
        raise DemoEmailError(
            f"demo email domain '{domain}' (from {source}) is RESERVED and can never receive mail.\n"
            "\n"
            "This is the exact failure the mapping exists to prevent: the app signs in with\n"
            "Email OTP only, so an undeliverable address is an account nobody can open.\n"
            f"\n"
            f"Edit {rel(EMAIL_CONFIG_FILE)} and set a mailbox you actually control,\n"
            f"or run with --rehearsal to build the LOCAL rehearsal artifact instead."
        )


def _check_address(address: str, slug: str, source: str) -> None:
    if not EMAIL_RE.match(address):
        raise DemoEmailError(f"composed address for '{slug}' is not valid: {address!r} (from {source})")
    if len(address) > 254:
        raise DemoEmailError(f"composed address for '{slug}' exceeds 254 characters: {address!r}")
    _check_domain(address.rsplit("@", 1)[1], source)


def _assert_unique(addresses: dict[str, str]) -> None:
    seen: dict[str, str] = {}
    for slug, address in sorted(addresses.items()):
        key = address.lower()
        if key in seen:
            raise DemoEmailError(
                f"demo addresses collide: '{slug}' and '{seen[key]}' both resolve to {address}.\n"
                "Every demo account needs its own address — `auth.users` and the verified-contact "
                "unique index both reject a duplicate, so the load would fail anyway."
            )
        seen[key] = slug


def _no_config_message(path: Path) -> str:
    return (
        "No demo email mapping configured — refusing to build the cloud staging seed.\n"
        "\n"
        "All 26 seeded accounts use @example.test, a reserved TLD that can never receive\n"
        "mail. The app signs in with Email OTP and nothing else, so shipping them as-is\n"
        "would produce 26 accounts nobody can open — and there is no password or bypass\n"
        "to fall back on.\n"
        "\n"
        "Fix it in one of three ways:\n"
        "\n"
        f"  1. cp {rel(EMAIL_TEMPLATE_FILE)} \\\n"
        f"       {rel(path)}\n"
        "     then set `base` to a mailbox you control.\n"
        "\n"
        f"  2. {ENV_BASE}='you@yourmailbox.com' python scripts/build_staging_seed.py\n"
        "\n"
        "  3. python scripts/build_staging_seed.py --demo-email-base you@yourmailbox.com\n"
        "\n"
        "To rehearse the load locally without a real mailbox:\n"
        "\n"
        "     python scripts/build_staging_seed.py --rehearsal\n"
    )


# ---------------------------------------------------------------------------
# SQL + manifest rendering
# ---------------------------------------------------------------------------


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def email_map_values(accounts: list[Account], plan: EmailPlan) -> str:
    """The `(uuid, old_email, new_email)` VALUES body the remap joins against."""
    rows = [
        f"    ({sql_literal(a.id)}::uuid, {sql_literal(a.seed_email)}, {sql_literal(plan.for_account(a))})"
        for a in accounts
    ]
    return ",\n".join(rows)


def rel(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)
