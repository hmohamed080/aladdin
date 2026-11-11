import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAcceptance, checkAcceptancePost, PLANS, plan } from "./acceptance-gate.mjs";

const hist = (n) => Array.from({ length: n }, (_, i) => ({ local: `2025${1000 + i}000000`, remote: `2025${1000 + i}000000` }));
// 206 filler + the real latest 20261107090006 = 207 applied
const base = () => [...hist(206), { local: "20261107090006", remote: "20261107090006" }];
const appliedFor = (P) => (P.applied === 207 ? base() : [...base(), { local: "20261110090001", remote: "20261110090001" }]);
const list = (name, extra = []) => {
  const P = PLANS[name];
  return { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: null })), ...extra] };
};
const dry = (v) => ({ dryRun: true, migrations: v.map((x) => `${x}_x.sql`) });
const has = (p, re) => assert.ok(p.some((x) => re.test(x)), JSON.stringify(p));

for (const name of Object.keys(PLANS)) {
  const P = PLANS[name], local = [...P.pending];
  test(`${name}: the expected state passes`, () => assert.deepEqual(checkAcceptance({ plan: name, list: list(name), dry: dry(P.pending), localVersions: local }), []));
  test(`${name}: an extra pending file is refused`, () => has(checkAcceptance({ plan: name, list: list(name, [{ local: "20261201090001", remote: null }]), dry: dry([...P.pending, "20261201090001"]), localVersions: local }), /pending is/));
  test(`${name}: remote-only drift is refused`, () => has(checkAcceptance({ plan: name, list: list(name, [{ local: null, remote: "20261201000000" }]), dry: dry(P.pending), localVersions: local }), /drift/));
  test(`${name}: an out-of-order pending migration (needs --include-all) is refused`, () => {
    const l = list(name); l.migrations.push({ local: "20250101000000", remote: null });
    has(checkAcceptance({ plan: name, list: l, dry: dry(P.pending), localVersions: local }), /out-of-order|pending is/);
  });
  test(`${name}: a wrong dry run or non-dry run is refused`, () => {
    has(checkAcceptance({ plan: name, list: list(name), dry: dry([...P.pending, "20261201090001"]), localVersions: local }), /dry run would push/);
    has(checkAcceptance({ plan: name, list: list(name), dry: { ...dry(P.pending), dryRun: false }, localVersions: local }), /dryRun:true/);
  });
  test(`${name}: a missing migration file in the checkout is refused`, () => has(checkAcceptance({ plan: name, list: list(name), dry: dry(P.pending), localVersions: [] }), /not in this checkout/));
  const after = () => ({ migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] });
  test(`${name}: post-push passes when everything is applied`, () => assert.deepEqual(checkAcceptancePost({ plan: name, list: after() }), []));
  test(`${name}: post-push refuses the pre-push state`, () => has(checkAcceptancePost({ plan: name, list: list(name) }), /applied after the push|still pending/));
}

test("the old 203-migration / 090003..090006 baseline is refused by every plan", () => {
  const old = { migrations: [...hist(202), { local: "20261107090002", remote: "20261107090002" }, ...["20261107090003", "20261107090004", "20261107090005", "20261107090006"].map((v) => ({ local: v, remote: null }))] };
  for (const name of Object.keys(PLANS)) has(checkAcceptance({ plan: name, list: old, dry: dry(PLANS[name].pending), localVersions: PLANS[name].pending }), /applied migrations|latest applied|pending is/);
});
test("the media plan refuses a history where media is already applied", () => {
  has(checkAcceptance({ plan: "media", list: list("m1"), dry: dry(["20261110090002"]), localVersions: ["20261110090001"] }), /applied migrations|latest applied|pending is/);
});
test("unknown plan is refused", () => assert.throws(() => plan("backup-4"), /unknown plan/));
test("media+m1 is exactly media then m1, and the post contract is the M1 one", () => {
  assert.deepEqual(PLANS["media+m1"].pending, [...PLANS.media.pending, ...PLANS.m1.pending]);
  assert.equal(PLANS["media+m1"].postContract, PLANS.m1.postContract);
  assert.equal(PLANS.m1.preContract, PLANS.media.postContract);
});
