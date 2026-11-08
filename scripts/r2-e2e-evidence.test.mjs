import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOWS, requiredCells, verifyEvidence } from "./r2-e2e-evidence.mjs";

const full = () => FLOWS.flatMap((flow) => requiredCells(flow).map(([actor, op, expected]) => ({ flow, actor, op, expected, observed: expected, status: expected === "allow" ? 200 : 404 })));

test("a complete, correct evidence file passes", () => {
  const r = verifyEvidence(full());
  assert.equal(r.ok, true);
  assert.equal(r.checked, FLOWS.reduce((n, f) => n + requiredCells(f).length, 0));
});

test("every flow requires user B read, replace and delete denials", () => {
  for (const flow of FLOWS) {
    const cells = requiredCells(flow).filter(([a, , e]) => a === "B" && e === "deny").map(([, op]) => op);
    assert.deepEqual(cells.sort(), ["delete", "read", "replace"]);
  }
});

test("a missing denial cell fails (key prefix alone is not proof)", () => {
  const r = verifyEvidence(full().filter((e) => !(e.flow === "product" && e.actor === "B" && e.op === "delete")));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /product: missing B delete/);
});

test("B being allowed, or anon reading an unpublished portfolio object, fails", () => {
  const e = full().map((x) => (x.flow === "certificate" && x.actor === "B" && x.op === "read" ? { ...x, observed: "allow", status: 200 } : x))
    .map((x) => (x.flow === "portfolio" && x.op === "read-unpublished" ? { ...x, observed: "allow" } : x));
  const r = verifyEvidence(e);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /certificate: B read observed allow/);
  assert.match(r.problems.join(), /portfolio: anon read-unpublished observed allow/);
});

test("an evidence file that smuggles an id, key or token is refused", () => {
  const e = full();
  e[0].note = "u/11111111-1111-1111-1111-111111111111/profile";
  assert.match(verifyEvidence(e).problems.join(), /must not contain ids/);
});
