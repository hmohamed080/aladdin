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
const here = (f) => fileURLToPath(new URL("./" + f, import.meta.url));
const sha = (f) => createHash("sha256").update(readFileSync(here(f))).digest("hex");
const allShas = () => Object.fromEntries(Object.entries(FORWARD_FIX).map(([k, v]) => [k, sha(v.file)]));
test("recovery: committed forward-fix files are exactly the pinned ones", () => {
  for (const [k, v] of Object.entries(FORWARD_FIX)) assert.equal(sha(v.file), v.sha256, k);
});
for (const n of Object.keys(PLANS)) {
  test(`recovery: ${n} needs no backup label when its pinned forward-fix hashes match`, () => assert.deepEqual(checkRecovery({ plan: n, label: "", forwardFixSha256: allShas() }), []));
  test(`recovery: ${n} refuses a missing or altered forward-fix`, () => {
    for (const fx of PLANS[n].fixes) {
      has(checkRecovery({ plan: n, label: "", forwardFixSha256: { ...allShas(), [fx]: undefined } }), /missing or its sha256/);
      has(checkRecovery({ plan: n, label: "", forwardFixSha256: { ...allShas(), [fx]: "0".repeat(64) } }), /differs from the pinned/);
    }
  });
  test(`recovery: ${n} accepts only the pinned snapshot label as an optional reference`, () => {
    assert.deepEqual(checkRecovery({ plan: n, label: SNAP, forwardFixSha256: allShas() }), []);
    has(checkRecovery({ plan: n, label: "aladdin-acceptance-20260101T000000Z", forwardFixSha256: allShas() }), /not a pinned restore-verified/);
  });
}
test("recovery: media+m1 needs both forward-fixes", () => assert.deepEqual(PLANS["media+m1"].fixes, ["media", "m1"]));
test("recovery: the pinned snapshot records the audited coverage", () => {
  assert.deepEqual(RESTORE_VERIFIED_SNAPSHOTS[SNAP], { backupRun: "42468447400", restoreRun: "42469078723", tables: 167, rows: 2584, migrations: 203 });
});
test("recovery: every plan declares forward-fix recovery with pinned fixes", () => {
  for (const n of Object.keys(PLANS)) { assert.equal(plan(n).recovery, "forward-fix"); for (const fx of plan(n).fixes) assert.ok(FORWARD_FIX[fx], fx); }
});
// The media forward-fix is also included byte for byte in the pgTAP helper, and its guard block is embedded verbatim in the test.
test("media forward-fix: the pgTAP helper copy is byte-identical", () => {
  assert.equal(readFileSync(here("../../supabase/tests/helpers/media_forward_fix.inc"), "utf8"), readFileSync(here(FORWARD_FIX.media.file), "utf8"));
});
test("media forward-fix: the guard block in pgTAP test 126 equals the guard in the file", () => {
  const fix = readFileSync(here(FORWARD_FIX.media.file), "utf8");
  const g = fix.match(/^do \$guard\$[\s\S]*?^\$guard\$;/m)?.[0];
  assert.ok(g, "guard block present");
  assert.ok(readFileSync(here("../../supabase/tests/126_media_forward_fix_test.sql"), "utf8").includes(g));
});
test("media forward-fix: data-safety structure (guard first, no BEGIN/COMMIT, no top-level DML, drops only the added function)", () => {
  const fix = readFileSync(here(FORWARD_FIX.media.file), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.ok(fix.indexOf("do $guard$") < fix.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.ok(!/^\s*(begin|commit)\s*;/im.test(fix));
  const outside = fix.replace(/\$guard\$[\s\S]*?\$guard\$/g, "").replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.ok(!/\b(insert|update|delete|truncate|alter table|drop table)\b/i.test(outside), "no top-level DML or table DDL");
  assert.deepEqual([...outside.matchAll(/drop function ([\w.]+)\(/gi)].map((m) => m[1]), ["public.media_migration_target_key"]);
});
