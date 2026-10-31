#!/usr/bin/env python3
"""Offline tests of media-record.py and inventory-compare.py: python3 ops/backups/media-record-test.py
The record validator must FAIL CLOSED on anything but a well formed, consistent, complete record."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SHA = "a" * 64
NAME = "aladdin-production-20261031T013000Z"


def good(**changes):
    record = {"snapshot": NAME, "label": "production", "objects": 3, "backed_up": 3, "missing": 0, "copy_failures": 0,
              "complete": True, "r2_media_records_not_covered": 0, "inventory_sha256": SHA}
    record.update(changes)
    return record


def check(text, label="production", snapshot=NAME, kind="production"):
    """The findings for a media.json holding `text` (str), a record (dict) or None for a missing file."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "media.json")
        if text is not None:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text if isinstance(text, str) else json.dumps(text))
        out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "media-record.py"), path, label, snapshot, kind],
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        return [line.split(" ", 1) for line in out.stdout.splitlines()]


def problems(*args, **kw):
    return [t for level, t in check(*args, **kw) if level in "PA"]


class Record(unittest.TestCase):
    def test_a_good_record_is_silent(self):
        self.assertEqual(check(good()), [])

    def test_missing_file_fails(self):
        self.assertTrue(problems(None))

    def test_empty_file_fails(self):
        self.assertTrue(problems(""))

    def test_malformed_json_fails(self):
        for text in ['{"complete": tr', "{", "not json", '{"complete": true,}', "\x00\x01"]:
            self.assertTrue(problems(text), text)

    def test_not_an_object_fails(self):
        for text in ["[]", '"complete"', "true", "null", "42"]:
            self.assertTrue(problems(text), text)

    def test_every_required_field_is_required(self):
        for field in good():
            record = good(); del record[field]
            found = problems(record)
            self.assertTrue(any(field in t for t in found), f"{field}: {found}")

    def test_wrong_types_fail(self):
        for field, value in [("complete", "true"), ("complete", 1), ("complete", None), ("missing", "0"), ("missing", False),
                             ("objects", 3.5), ("objects", -1), ("backed_up", None), ("copy_failures", "none"),
                             ("inventory_sha256", "zz"), ("inventory_sha256", SHA.upper()), ("inventory_sha256", 7),
                             ("snapshot", 5), ("label", None), ("r2_media_records_not_covered", "0")]:
            self.assertTrue(problems(good(**{field: value})), f"{field}={value!r}")

    def test_a_repeated_key_fails(self):
        text = json.dumps(good(complete=False)).replace('"complete": false', '"complete": false, "complete": true')
        self.assertIn('"complete": true', text)
        self.assertTrue(problems(text))

    def test_contradictions_fail(self):
        self.assertTrue(problems(good(objects=4)))                      # 3 + 0 is not 4
        self.assertTrue(problems(good(missing=1)))                      # 3 + 1 is not 3
        self.assertTrue(problems(good(missing=1, backed_up=2)))         # says complete with a file missing
        self.assertTrue(problems(good(copy_failures=1)))                # says complete with a failure

    def test_incomplete_fails_and_says_why(self):
        found = problems(good(complete=False, missing=1, backed_up=2))
        self.assertTrue(any("incomplete: 1 missing" in t for t in found), found)

    def test_another_label_or_snapshot_fails(self):
        self.assertTrue(problems(good(label="acceptance")))
        self.assertTrue(problems(good(snapshot="aladdin-production-20250101T000000Z")))

    def test_r2_records_not_covered_are_an_alarm_for_production_and_a_warning_elsewhere(self):
        self.assertEqual(check(good(r2_media_records_not_covered=2))[0][0], "A")
        self.assertEqual(check(good(label="acceptance", r2_media_records_not_covered=2), label="acceptance", kind="acceptance")[0][0], "W")

    def test_a_huge_file_fails(self):
        self.assertTrue(problems(" " * 70000 + json.dumps(good())))

    def test_unknown_extra_fields_are_allowed(self):
        self.assertEqual(check(good(note="later versions may add fields")), [])


class Compare(unittest.TestCase):
    def run_compare(self, inventory, database, label="production"):
        with tempfile.TemporaryDirectory() as d:
            for name, rows in (("inv.tsv", inventory), ("db.tsv", database)):
                with open(os.path.join(d, name), "w", encoding="utf-8") as f:
                    f.write("".join("\t".join(map(str, r)) + "\n" for r in rows))
            out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "inventory-compare.py"), os.path.join(d, "inv.tsv"),
                                  os.path.join(d, "db.tsv"), label], capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            return [line for line in out.stdout.splitlines() if line.startswith("P ")]

    ID1, ID2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"

    def rows(self):
        key = lambda i, b, e: f"media/production/supabase/objects/{b}/{i}-{e}.age"
        db = [(self.ID1, "avatars", "u1/a.png", 100, "abc123"), (self.ID2, "portfolio", "u2/dir/b.png", 200, "")]
        inv = [(self.ID1, "avatars", "u1/a.png", 100, key(self.ID1, "avatars", "abc123"), "ok"),
               (self.ID2, "portfolio", "u2/dir/b.png", 200, key(self.ID2, "portfolio", "noetag"), "ok")]
        return inv, db

    def test_equal_rows_are_exact(self):
        self.assertEqual(self.run_compare(*self.rows()), [])

    def test_every_field_is_compared(self):
        def mutate(i, col, value):
            inv, db = self.rows(); inv[i] = inv[i][:col] + (value,) + inv[i][col + 1:]; return self.run_compare(inv, db)
        self.assertTrue(mutate(0, 1, "portfolio"))            # bucket
        self.assertTrue(mutate(0, 2, "u1/other.png"))         # complete path
        self.assertTrue(mutate(0, 3, 101))                    # size
        self.assertTrue(mutate(0, 4, "media/production/supabase/objects/avatars/x-abc123.age"))   # copy key
        self.assertTrue(mutate(1, 5, "MISSING"))              # state

    def test_a_path_that_matches_only_in_its_first_part_differs(self):
        inv, db = self.rows(); db[1] = (self.ID2, "portfolio", "u2/dir/b.png.bak", 200, "")
        self.assertTrue(self.run_compare(inv, db))

    def test_an_extra_or_missing_row_differs(self):
        inv, db = self.rows()
        self.assertTrue(self.run_compare(inv[:1], db))        # a database file the inventory lacks
        self.assertTrue(self.run_compare(inv, db[:1]))        # an inventory entry the database lacks

    def test_a_wrong_label_differs(self):
        self.assertTrue(self.run_compare(*self.rows(), label="acceptance"))

    def test_a_ragged_row_differs(self):
        inv, db = self.rows(); inv[0] = inv[0][:5]
        self.assertTrue(self.run_compare(inv, db))


if __name__ == "__main__":
    unittest.main(verbosity=1)
