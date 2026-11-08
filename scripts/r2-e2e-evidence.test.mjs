import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOWS, requiredCells, verifyEvidence } from "./r2-e2e-evidence.mjs";

const entry = (flow, actor, op, expected) => ({ flow, actor, op, expected, observed: expected, status: expected === "allow" ? 200 : 404 });
const full = () => FLOWS.flatMap((flow) => requiredCells(flow).map(([actor, op, expected]) => entry(flow, actor, op, expected)));
const without = (pred) => full().filter((e) => !pred(e));
const patch = (pred, over) => full().map((e) => (pred(e) ? { ...e, ...over } : e));

test("a complete, correct evidence file passes", () => {
  const r = verifyEvidence(full());
  assert.deepEqual([r.ok, r.problems], [true, []]);
  assert.equal(r.checked, FLOWS.reduce((n, f) => n + requiredCells(f).length, 0));
});

test("public reads stay legitimate: current avatar and published portfolio are readable by B and anonymous", () => {
  const cells = (flow) => requiredCells(flow).filter(([a]) => a !== "A");
  assert.deepEqual(cells("avatar").filter(([, op]) => op === "read-current").map(([a, , e]) => `${a}:${e}`).sort(), ["B:allow", "anon:allow"]);
  assert.deepEqual(cells("portfolio").filter(([, op]) => op === "read-published").map(([a, , e]) => `${a}:${e}`).sort(), ["B:allow", "anon:allow"]);
  // the denied reads for those two flows target the withdrawn state, never the public one
  const deniedReads = (flow) => requiredCells(flow).filter(([, op, e]) => op.startsWith("read") && e === "deny").map(([a, op]) => `${a}:${op}`).sort();
  assert.deepEqual(deniedReads("avatar"), ["B:read-replaced", "A:read-after-delete", "anon:read-replaced"].sort());
  assert.deepEqual(deniedReads("portfolio"), ["B:read-unpublished", "A:read-after-delete", "anon:read-unpublished"].sort());
});

test("the five private flows deny B and anonymous reads, and B replace and delete", () => {
  for (const flow of ["certificate", "product", "organization", "request", "verification"]) {
    const denied = requiredCells(flow).filter(([a, , e]) => a !== "A" && e === "deny").map(([a, op]) => `${a}:${op}`).sort();
    assert.deepEqual(denied, ["B:delete", "B:read", "B:replace", "anon:read"]);
  }
});

test("rejects a missing cell", () => {
  const r = verifyEvidence(without((e) => e.flow === "product" && e.actor === "B" && e.op === "delete"));
  assert.match(r.problems.join(), /product: missing B delete/);
});

test("rejects B or anonymous allowed on a private/withdrawn object", () => {
  const r = verifyEvidence(patch((e) => e.flow === "certificate" && e.actor === "B" && e.op === "read", { observed: "allow", status: 200 }));
  assert.match(r.problems.join(), /certificate: B read observed allow, expected deny/);
  const r2 = verifyEvidence(patch((e) => e.flow === "portfolio" && e.actor === "anon" && e.op === "read-unpublished", { observed: "allow", status: 200 }));
  assert.match(r2.problems.join(), /portfolio: anon read-unpublished observed allow/);
});

test("rejects a legitimate public read that was denied (public access must not be weakened)", () => {
  const r = verifyEvidence(patch((e) => e.flow === "avatar" && e.actor === "anon" && e.op === "read-current", { observed: "deny", status: 404 }));
  assert.match(r.problems.join(), /avatar: anon read-current observed deny, expected allow/);
});

test("rejects unexpected entries, unknown flows or actors", () => {
  assert.match(verifyEvidence([...full(), entry("avatar", "B", "read", "deny")]).problems.join(), /not part of the approved matrix/);
  assert.match(verifyEvidence([...full(), entry("video", "A", "read", "allow")]).problems.join(), /video\/A\/read is not part of/);
  assert.match(verifyEvidence([...full(), { ...entry("avatar", "A", "read", "allow"), actor: "C" }]).problems.join(), /unknown actor/);
});

test("rejects contradictory evidence: duplicate cell with different outcomes, or status contradicting the outcome", () => {
  const dup = [...full(), { ...entry("request", "B", "read", "deny"), observed: "allow", status: 200 }];
  assert.match(verifyEvidence(dup).problems.join(), /request: B read has contradictory observations/);
  assert.match(verifyEvidence(patch((e) => e.flow === "request" && e.actor === "B" && e.op === "read", { status: 200 })).problems.join(), /status 200 contradicts observed deny/);
  assert.match(verifyEvidence(patch((e) => e.flow === "avatar" && e.actor === "A" && e.op === "read", { status: 500 })).problems.join(), /status 500 contradicts observed allow/);
});

test("rejects a recorded expectation that differs from the requirement", () => {
  const r = verifyEvidence(patch((e) => e.flow === "verification" && e.actor === "B" && e.op === "read", { expected: "allow", observed: "allow", status: 200 }));
  assert.match(r.problems.join(), /recorded expected allow, requirement is deny/);
});

test("rejects ids, keys or tokens in the file, and non-array input", () => {
  const e = full();
  e[0].note = "u/11111111-1111-1111-1111-111111111111/profile";
  assert.match(verifyEvidence(e).problems.join(), /must not contain ids/);
  assert.equal(verifyEvidence({}).ok, false);
});
