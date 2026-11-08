import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAcceptance, EXPECT_PENDING } from "./acceptance-gate.mjs";

const list = (extra = []) => ({ migrations: [
  ...Array.from({ length: 202 }, (_, i) => ({ local: `2025${1000 + i}000000`, remote: `2025${1000 + i}000000` })),
  { local: "20261107090002", remote: "20261107090002" },
  ...EXPECT_PENDING.map((v) => ({ local: v, remote: null })), ...extra] });
const dry = (v = EXPECT_PENDING) => ({ dryRun: true, migrations: v.map((x) => `${x}_x.sql`) });
const local = [...EXPECT_PENDING];
const has = (p, re) => assert.ok(p.some((x) => re.test(x)), JSON.stringify(p));

test("the expected state passes", () => assert.deepEqual(checkAcceptance({ list: list(), dry: dry(), localVersions: local }), []));
test("an extra pending file is refused", () => has(checkAcceptance({ list: list([{ local: "20261108090001", remote: null }]), dry: dry([...EXPECT_PENDING, "20261108090001"]), localVersions: local }), /pending is/));
test("remote-only drift is refused", () => has(checkAcceptance({ list: list([{ local: null, remote: "20261201000000" }]), dry: dry(), localVersions: local }), /drift/));
test("an out-of-order pending migration (needs --include-all) is refused", () => {
  const l = list(); l.migrations.push({ local: "20250101000000", remote: null });
  has(checkAcceptance({ list: l, dry: dry(), localVersions: local }), /out-of-order/);
});
test("a wrong dry run or non-dry run is refused", () => {
  has(checkAcceptance({ list: list(), dry: dry(EXPECT_PENDING.slice(1)), localVersions: local }), /dry run would push/);
  has(checkAcceptance({ list: list(), dry: { ...dry(), dryRun: false }, localVersions: local }), /dryRun:true/);
});
test("Production history (latest 090003) is refused here", () => {
  const l = list(); l.migrations = l.migrations.filter((r) => r.local !== "20261107090003").concat([{ local: "20261107090003", remote: "20261107090003" }]);
  has(checkAcceptance({ list: l, dry: dry(), localVersions: local }), /latest applied|applied migrations/);
});
