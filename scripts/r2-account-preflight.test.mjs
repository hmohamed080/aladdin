import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAccount, pinnedAccounts } from "./r2-account-preflight.mjs";

const PINNED = "a4c2b7ac45e58a81691b9165492ce6a2";

test("the manifest pins exactly the owner-confirmed account", () => {
  assert.deepEqual(pinnedAccounts(), [PINNED]);
});
test("an exact match passes", () => assert.equal(checkAccount(PINNED).ok, true));
test("everything else fails closed", () => {
  for (const value of [undefined, "", " " + PINNED, PINNED + "\n", PINNED.toUpperCase(), "b".repeat(32), PINNED.slice(1)]) {
    assert.equal(checkAccount(value).ok, false, JSON.stringify(value));
  }
});
test("a manifest with two different accounts or none is refused", () => {
  assert.equal(checkAccount(PINNED, ["a".repeat(32), "b".repeat(32)]).ok, false);
  assert.equal(checkAccount(PINNED, []).ok, false);
});
