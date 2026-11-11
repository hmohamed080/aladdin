import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAcceptance, checkAcceptancePost, checkRecovery, FORWARD_FIX, RESTORE_VERIFIED_SNAPSHOTS, PLANS, plan } from "./acceptance-gate.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const SNAP = "aladdin-acceptance-20261108T094450Z";
const fixSha = createHash("sha256").update(readFileSync(fileURLToPath(new URL("./" + FORWARD_FIX.m1.file, import.meta.url)))).digest("hex");
test("recovery: m1 needs no backup label when the pinned forward-fix hash matches", () => assert.deepEqual(checkRecovery({ plan: "m1", label: "", forwardFixSha256: fixSha }), []));
test("recovery: the committed m1 forward-fix file is exactly the pinned one", () => assert.equal(fixSha, FORWARD_FIX.m1.sha256));
test("recovery: m1 refuses a missing or altered forward-fix", () => {
  has(checkRecovery({ plan: "m1", label: "", forwardFixSha256: undefined }), /forward-fix/);
  has(checkRecovery({ plan: "m1", label: "", forwardFixSha256: "0".repeat(64) }), /differs from the pinned/);
});
test("recovery: m1 accepts the pinned snapshot label as an extra reference but refuses an unpinned one", () => {
  assert.deepEqual(checkRecovery({ plan: "m1", label: SNAP, forwardFixSha256: fixSha }), []);
  has(checkRecovery({ plan: "m1", label: "aladdin-acceptance-20260101T000000Z", forwardFixSha256: fixSha }), /not a pinned restore-verified/);
});
for (const n of ["media", "media+m1"]) {
  test(`recovery: ${n} requires a pinned restore-verified snapshot label (reuse is allowed, no fresh backup)`, () => {
    assert.deepEqual(checkRecovery({ plan: n, label: SNAP }), []);
    has(checkRecovery({ plan: n, label: "" }), /no tested forward-fix/);
    has(checkRecovery({ plan: n, label: "aladdin-acceptance-20260101T000000Z" }), /not a pinned/);
  });
}
test("recovery: the pinned snapshot records the audited coverage", () => {
  assert.deepEqual(RESTORE_VERIFIED_SNAPSHOTS[SNAP], { backupRun: "42468447400", restoreRun: "42469078723", tables: 167, rows: 2584, migrations: 203 });
});
test("recovery: every plan declares a recovery mode", () => { for (const n of Object.keys(PLANS)) assert.ok(["forward-fix", "snapshot"].includes(plan(n).recovery)); });
