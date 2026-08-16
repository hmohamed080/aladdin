#!/usr/bin/env python3
"""Tests for the staging demo-account model and email resolution.

    python -m unittest discover -s scripts -p "test_*.py"

Stdlib `unittest` on purpose. These scripts are run with whatever Python the
repository owner has on PATH, outside the backend service's `uv` environment, so
a test that needed pytest would need an environment to run in — and the repo's
dependency policy says justify every one. There is nothing here that `unittest`
cannot express.

The email rules are the ones worth pinning: they are the difference between a
staging project full of usable accounts and one full of accounts nobody can open,
and they fail in ways that are invisible until someone tries to sign in.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import staging_demo as sd


class LoadAccountsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.accounts = sd.load_accounts()

    def test_parses_all_26_seeded_accounts(self) -> None:
        self.assertEqual(len(self.accounts), sd.EXPECTED_ACCOUNT_COUNT)

    def test_uuids_slugs_and_seed_addresses_are_unique(self) -> None:
        for field in ("id", "slug", "seed_local"):
            values = [getattr(a, field) for a in self.accounts]
            self.assertEqual(len(set(values)), len(values), f"duplicate {field}")

    def test_every_account_declares_a_landing_route(self) -> None:
        allowed = {"/b2b", "/home", "/admin", "/onboarding (consent step)"}
        for a in self.accounts:
            self.assertIn(a.landing, allowed, f"{a.slug} has landing {a.landing!r}")

    def test_seed_addresses_are_on_the_reserved_domain(self) -> None:
        # If this ever stops holding, the seed files changed and the remap would
        # silently match nothing.
        for a in self.accounts:
            self.assertTrue(a.seed_email.endswith("@example.test"), a.seed_email)


class EmailResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.accounts = sd.load_accounts()

    def resolve(self, **kw) -> sd.EmailPlan:
        kw.setdefault("env", {})
        kw.setdefault("config_path", Path("/nonexistent/demo-email.toml"))
        return sd.resolve_email_plan(self.accounts, **kw)

    # --- fail closed ------------------------------------------------------

    def test_no_configuration_raises_rather_than_guessing(self) -> None:
        with self.assertRaises(sd.DemoEmailError) as ctx:
            self.resolve()
        self.assertIn("refusing to build", str(ctx.exception).lower())

    def test_reserved_tld_is_rejected(self) -> None:
        for base in ("you@example.com", "you@thing.test", "you@host.invalid", "you@box.localhost"):
            with self.subTest(base=base), self.assertRaises(sd.DemoEmailError):
                self.resolve(cli_base=base)

    def test_reserved_domain_is_rejected_in_domain_mode(self) -> None:
        with self.assertRaises(sd.DemoEmailError):
            self.resolve(cli_domain="demo.example.com")

    def test_base_that_already_has_a_plus_tag_is_rejected(self) -> None:
        # Double sub-addressing is not portable; several providers drop it.
        with self.assertRaises(sd.DemoEmailError):
            self.resolve(cli_base="you+demo@gmail.com")

    def test_base_without_an_at_sign_is_rejected(self) -> None:
        with self.assertRaises(sd.DemoEmailError):
            self.resolve(cli_base="not-an-address")

    def test_override_for_an_unknown_slug_is_rejected(self) -> None:
        with self.assertRaises(sd.DemoEmailError) as ctx:
            sd._compose(
                self.accounts,
                {"base": "you@gmail.com", "overrides": {"no-such-account": "x@gmail.com"}},
                source="test",
                cloud_ready=True,
            )
        self.assertIn("unknown account slugs", str(ctx.exception))

    def test_colliding_override_is_rejected(self) -> None:
        # Two accounts on one address would break the verified-contact unique
        # index and leave one identity unreachable.
        collision = "you+aladdin-hana-showroom-owner@gmail.com"
        with self.assertRaises(sd.DemoEmailError) as ctx:
            sd._compose(
                self.accounts,
                {"base": "you@gmail.com", "overrides": {"platform-admin": collision}},
                source="test",
                cloud_ready=True,
            )
        self.assertIn("collide", str(ctx.exception))

    # --- happy paths ------------------------------------------------------

    def test_plus_mode_composes_one_unique_address_per_account(self) -> None:
        plan = self.resolve(cli_base="owner@aladdindemo.io")
        self.assertEqual(plan.mode, "plus")
        addresses = [plan.for_account(a) for a in self.accounts]
        self.assertEqual(len(set(addresses)), sd.EXPECTED_ACCOUNT_COUNT)
        for a in self.accounts:
            self.assertEqual(plan.for_account(a), f"owner+aladdin-{a.slug}@aladdindemo.io")

    def test_domain_mode_composes_one_address_per_slug(self) -> None:
        plan = self.resolve(cli_domain="demo.aladdindemo.io")
        self.assertEqual(plan.mode, "domain")
        for a in self.accounts:
            self.assertEqual(plan.for_account(a), f"{a.slug}@demo.aladdindemo.io")

    def test_custom_prefix_is_honoured(self) -> None:
        plan = self.resolve(cli_base="owner@aladdindemo.io", cli_prefix="uat")
        self.assertTrue(plan.for_account(self.accounts[0]).startswith("owner+uat-"))

    def test_environment_is_used_when_no_flag_is_given(self) -> None:
        plan = sd.resolve_email_plan(
            self.accounts,
            env={sd.ENV_BASE: "owner@aladdindemo.io"},
            config_path=Path("/nonexistent/demo-email.toml"),
        )
        self.assertIn("environment", plan.source)
        self.assertEqual(plan.mode, "plus")

    def test_command_line_beats_environment(self) -> None:
        plan = sd.resolve_email_plan(
            self.accounts,
            cli_base="cli@aladdindemo.io",
            env={sd.ENV_BASE: "env@aladdindemo.io"},
            config_path=Path("/nonexistent/demo-email.toml"),
        )
        self.assertTrue(plan.for_account(self.accounts[0]).startswith("cli+"))

    def test_a_valid_override_replaces_only_that_account(self) -> None:
        plan = sd._compose(
            self.accounts,
            {"base": "owner@aladdindemo.io", "overrides": {"hana-showroom-owner": "client@theirco.io"}},
            source="test",
            cloud_ready=True,
        )
        self.assertEqual(plan.addresses["hana-showroom-owner"], "client@theirco.io")
        self.assertEqual(plan.addresses["platform-admin"], "owner+aladdin-platform-admin@aladdindemo.io")

    # --- rehearsal --------------------------------------------------------

    def test_rehearsal_plan_is_unique_but_explicitly_not_cloud_ready(self) -> None:
        plan = sd.rehearsal_email_plan(self.accounts)
        self.assertFalse(plan.cloud_ready)
        addresses = [plan.for_account(a) for a in self.accounts]
        self.assertEqual(len(set(addresses)), sd.EXPECTED_ACCOUNT_COUNT)
        # Deliberately undeliverable, so a rehearsal artifact can never be
        # mistaken for the cloud one.
        for address in addresses:
            self.assertTrue(address.endswith("@example.test"))


class SqlRenderingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.accounts = sd.load_accounts()
        self.plan = sd.resolve_email_plan(
            self.accounts, cli_base="owner@aladdindemo.io", env={}, config_path=Path("/nonexistent")
        )

    def test_single_quotes_are_escaped(self) -> None:
        self.assertEqual(sd.sql_literal("O'Brien"), "'O''Brien'")

    def test_map_has_one_row_per_account_with_both_addresses(self) -> None:
        rows = sd.email_map_values(self.accounts, self.plan).splitlines()
        self.assertEqual(len(rows), sd.EXPECTED_ACCOUNT_COUNT)
        for account, row in zip(self.accounts, rows):
            self.assertIn(account.id, row)
            self.assertIn(account.seed_email, row)
            self.assertIn(self.plan.for_account(account), row)


if __name__ == "__main__":
    unittest.main()
