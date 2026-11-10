import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOWS, SEVEN_FLOWS, requiredCells, verifyEvidence } from "./r2-e2e-evidence.mjs";

const stateOnly = (op) => op.endsWith("-action") || op === "read-old-bytes";
const entry = (flow, actor, op, expected, path) => ({
  flow, actor, op, path, expected, observed: expected,
  ...(stateOnly(op) ? {} : { status: expected === "allow" ? 200 : 404 }),
  ...(actor === "other" ? { sessionActive: true } : {}),
  ...(op.endsWith("-action") ? { dbUnchanged: true, r2Unchanged: true } : {}),
  ...(op === "read-old-bytes" ? { servedOldBytes: false } : {}),
});
const full = () => FLOWS.flatMap((flow) => requiredCells(flow).map(([a, op, e, p]) => entry(flow, a, op, e, p)));
const without = (pred) => full().filter((e) => !pred(e));
const patch = (pred, over) => full().map((e) => (pred(e) ? { ...e, ...over } : e));
const is = (flow, actor, op) => (e) => e.flow === flow && e.actor === actor && e.op === op;

test("a complete, correct evidence file passes; the seven flows plus the cover row are all required", () => {
  const r = verifyEvidence(full());
  assert.deepEqual([r.ok, r.problems], [true, []]);
  assert.equal(r.checked, FLOWS.reduce((n, f) => n + requiredCells(f).length, 0));
  assert.deepEqual(SEVEN_FLOWS.filter((f) => !FLOWS.includes(f)), []);
  assert.ok(FLOWS.includes("cover"));
});

test("avatar is owner-private on the application route: the other user and anonymous are denied, and the public image is the cover", () => {
  const cells = requiredCells("avatar");
  assert.deepEqual(cells.filter(([a, op]) => a !== "owner" && op === "read").map(([a, , e, p]) => `${a}:${e}:${p}`).sort(), ["anon:deny:api-media", "other:deny:api-media"]);
  const cover = requiredCells("cover");
  assert.deepEqual(cover.filter(([, op]) => op === "read").map(([a, , e, p]) => `${a}:${e}:${p}`).sort(), ["anon:allow:p-cover", "other:allow:p-cover"]);
});

test("published portfolio stays public through p-media while its owner-private route stays denied", () => {
  const cells = requiredCells("portfolio");
  assert.deepEqual(cells.filter(([, op]) => op === "read-published").map(([a, , e, p]) => `${a}:${e}:${p}`).sort(), ["anon:allow:p-media", "other:allow:p-media"]);
  assert.deepEqual(cells.filter(([a, op]) => a !== "owner" && op === "read").map(([a, , e]) => `${a}:${e}`).sort(), ["anon:deny", "other:deny"]);
});

test("withdrawal is required after unpublish, unlist and delete, and replaced bytes must not be served", () => {
  const ops = (flow) => requiredCells(flow).filter(([a]) => a === "anon").map(([, op]) => op).sort();
  assert.deepEqual(ops("portfolio"), ["read", "read-after-delete", "read-after-unpublish", "read-old-bytes", "read-published"]);
  assert.deepEqual(ops("cover"), ["read", "read-after-delete", "read-after-unlist", "read-old-bytes"]);
});

test("the five private flows deny the other user and anonymous reads plus the other user's replace and delete actions", () => {
  for (const flow of ["certificate", "product", "organization", "request", "verification"]) {
    const denied = requiredCells(flow).filter(([a, , e]) => a !== "owner" && e === "deny").map(([a, op]) => `${a}:${op}`).sort();
    assert.deepEqual(denied, ["anon:read", "other:delete-action", "other:read", "other:replace-action"]);
  }
});

test("rejects a missing cell", () => {
  const r = verifyEvidence(without(is("product", "other", "delete-action")));
  assert.match(r.problems.join(), /product: missing other delete-action/);
});

test("rejects the other user or anonymous allowed on a private or withdrawn object", () => {
  const r = verifyEvidence(patch(is("certificate", "other", "read"), { observed: "allow", status: 200 }));
  assert.match(r.problems.join(), /certificate: other read observed allow, expected deny/);
  const r2 = verifyEvidence(patch(is("portfolio", "anon", "read-after-unpublish"), { observed: "allow", status: 200 }));
  assert.match(r2.problems.join(), /portfolio: anon read-after-unpublish observed allow/);
  const r3 = verifyEvidence(patch(is("cover", "anon", "read-after-unlist"), { observed: "allow", status: 200 }));
  assert.match(r3.problems.join(), /cover: anon read-after-unlist observed allow/);
});

test("rejects a legitimate public read that was denied (public access must not be weakened)", () => {
  const r = verifyEvidence(patch(is("cover", "anon", "read"), { observed: "deny", status: 404 }));
  assert.match(r.problems.join(), /cover: anon read observed deny, expected allow/);
  assert.match(verifyEvidence(patch(is("portfolio", "anon", "read-published"), { observed: "deny", status: 404 })).problems.join(), /portfolio: anon read-published observed deny, expected allow/);
});

test("a denial by the other user is not evidence unless that session was proven active", () => {
  const r = verifyEvidence(patch(is("product", "other", "read"), { sessionActive: false }));
  assert.match(r.problems.join(), /denial is not evidence unless the other user's session was proven active/);
  assert.match(verifyEvidence(without(() => false).map((e) => (is("avatar", "other", "read")(e) ? { ...e, sessionActive: undefined } : e))).problems.join(), /session was proven active/);
});

test("application-action denials need no HTTP 4xx but must show unchanged rows and an unchanged R2 object", () => {
  assert.deepEqual(verifyEvidence(patch(is("organization", "other", "replace-action"), { status: 200 })).problems, []);
  const noDb = verifyEvidence(patch(is("organization", "other", "delete-action"), { dbUnchanged: false }));
  assert.match(noDb.problems.join(), /must record unchanged database rows and unchanged R2 object/);
  const noR2 = verifyEvidence(patch(is("request", "other", "replace-action"), { r2Unchanged: undefined }));
  assert.match(noR2.problems.join(), /must record unchanged database rows and unchanged R2 object/);
});

test("old bytes of replaced media must be recorded as not served", () => {
  const r = verifyEvidence(patch(is("cover", "other", "read-old-bytes"), { servedOldBytes: true }));
  assert.match(r.problems.join(), /read-old-bytes must record that the old bytes were not served/);
});

test("rejects a wrong delivery path, unexpected entries, unknown flows or actors", () => {
  assert.match(verifyEvidence(patch(is("avatar", "anon", "read"), { path: "p-cover" })).problems.join(), /recorded path p-cover, requirement is api-media/);
  assert.match(verifyEvidence([...full(), entry("avatar", "other", "read-published", "deny", "api-media")]).problems.join(), /not part of the approved matrix/);
  assert.match(verifyEvidence([...full(), entry("video", "owner", "read", "allow", "api-media")]).problems.join(), /video\/owner\/read is not part of/);
  assert.match(verifyEvidence([...full(), { ...entry("avatar", "owner", "read", "allow", "api-media"), actor: "C" }]).problems.join(), /unknown actor/);
});

test("rejects contradictory evidence: duplicate cell with different outcomes, or status contradicting the outcome", () => {
  const dup = [...full(), { ...entry("request", "other", "read", "deny", "api-media"), observed: "allow", status: 200 }];
  assert.match(verifyEvidence(dup).problems.join(), /request: other read has contradictory observations/);
  assert.match(verifyEvidence(patch(is("request", "other", "read"), { status: 200 })).problems.join(), /status 200 contradicts observed deny/);
  assert.match(verifyEvidence(patch(is("avatar", "owner", "read"), { status: 500 })).problems.join(), /status 500 contradicts observed allow/);
});

test("rejects a recorded expectation that differs from the requirement", () => {
  const r = verifyEvidence(patch(is("verification", "other", "read"), { expected: "allow", observed: "allow", status: 200 }));
  assert.match(r.problems.join(), /recorded expected allow, requirement is deny/);
});

test("rejects ids, keys or tokens in the file, and non-array input", () => {
  const e = full();
  e[0].note = "u/11111111-1111-1111-1111-111111111111/profile";
  assert.match(verifyEvidence(e).problems.join(), /must not contain ids/);
  assert.equal(verifyEvidence({}).ok, false);
});
