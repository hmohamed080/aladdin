// Plan "prod-marketplace-orders": PRODUCTION 246 -> 266 (the marketplace-orders migrations followed by the marketplace-clarity ones, one push). No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PLANS, FORWARD_FIX, PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS, RESTORE_VERIFIED_SNAPSHOTS, checkAcceptance, checkAcceptancePost, checkRecovery, pendingDrift } from "./acceptance-gate.mjs";
import { judgeFacts as judgeOrders } from "./marketplace-orders-smoke.mjs";
import { judgeFacts as judgeClarity } from "./marketplace-clarity-smoke.mjs";

const here = (f) => new URL(f, import.meta.url);
const read = (f) => readFileSync(here(f), "utf8");
const NAME = "prod-marketplace-orders";
const P = () => PLANS[NAME];
const ORD = () => PLANS["marketplace-orders"], CLA = () => PLANS["marketplace-clarity"];
const versions = () => readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
const history = (done) => [...Array.from({ length: P().applied - 1 }, (_, i) => String(20200000000000 + i)), P().latest, ...done].map((v) => ({ local: v, remote: v }));
const list = (pending = P().pending, done = []) => ({ migrations: [...history(done), ...pending.map((v) => ({ local: v, remote: null }))] });
const dry = (v) => ({ dryRun: true, migrations: v.map((x) => `${x}_x.sql`) });
const shas = () => Object.fromEntries(P().fixes.map((fx) => [fx, createHash("sha256").update(readFileSync(here(FORWARD_FIX[fx].file))).digest("hex")]));
const gate = (o) => checkAcceptance({ target: "production", plan: NAME, list: list(), dry: dry(P().pending), localVersions: versions(), ...o }).join("\n");

test("targets Production, 246 / 20261124120001 -> 266 / 20261128120001: exactly the orders migrations then the clarity ones, 20 in all", () => {
  assert.equal(P().target, "production");
  assert.equal(P().applied, 246); assert.equal(P().latest, "20261124120001");
  assert.deepEqual(P().pending, [...ORD().pending, ...CLA().pending]);
  assert.equal(P().pending.length, 20); assert.equal(P().applied + P().pending.length, 266); assert.equal(P().pending.at(-1), "20261128120001");
  assert.equal(P().latest, PLANS["prod-marketplace-v2"].pending.at(-1), "chained: starts where prod-marketplace-v2 ends");
  assert.deepEqual([P().preContract, P().postContract], ["20261124120001", "20261128090001"]);
  for (const v of [P().preContract, P().postContract]) assert.ok(read(`../../supabase/permissions/${v}.json`).includes(`"${v}"`), v);
});
test("the checkout holds exactly these migrations after 246 (a newer one on main must be added to the plan first)", () => {
  assert.deepEqual(versions().filter((v) => v > P().latest && v <= P().pending.at(-1)).sort(), P().pending);
  assert.deepEqual(pendingDrift({ plan: NAME, localVersions: versions().filter((v) => v <= P().pending.at(-1)) }), { unplanned: [], missing: [] });
  assert.deepEqual(pendingDrift({ plan: NAME, localVersions: [...P().pending, "20261201090001"] }).unplanned, ["20261201090001"]);
});
test("the expected catalog change is the union of the two lists measured for Acceptance, never re-typed", () => {
  assert.deepEqual([...P().changed].sort(), [...new Set([...ORD().changed, ...CLA().changed])].sort());
  assert.equal(new Set(P().changed).size, P().changed.length);
});
test("the gate accepts the exact state and refuses Acceptance, a partial push, an already applied half and an extra migration", () => {
  assert.equal(gate({}), "");
  assert.match(gate({ target: "acceptance" }), /targets production, but this gate was run for acceptance/);
  assert.match(gate({ dry: dry(ORD().pending) }), /dry run would push/);
  assert.match(gate({ list: list(CLA().pending, ORD().pending), dry: dry(CLA().pending) }), /264 applied migrations, expected 246/);
  assert.match(gate({ list: list([...P().pending, "20261201090001"]), dry: dry([...P().pending, "20261201090001"]) }), /pending is/);
  for (const other of ["marketplace-orders", "marketplace-clarity"]) assert.match(checkAcceptance({ target: "production", plan: other, list: list(), dry: dry(P().pending), localVersions: versions() }).join(), /targets acceptance/);
  assert.deepEqual(checkAcceptancePost({ target: "production", plan: NAME, list: { migrations: history(P().pending) } }), []);
  assert.match(checkAcceptancePost({ target: "production", plan: NAME, list: { migrations: [...history(ORD().pending), ...CLA().pending.map((v) => ({ local: v, remote: null }))] } }).join(), /expected 266/);
});
test("recovery: a restore-verified PRODUCTION snapshot taken at >= 246 is mandatory; the pinned 237 one and every Acceptance label are refused", () => {
  const rec = (label) => checkRecovery({ plan: NAME, label, forwardFixSha256: shas() }).join("\n");
  assert.equal(P().freshBackup, true);
  assert.match(rec(""), /needs --backup-label of a fresh restore-verified snapshot \(migrations >= 246\)/);
  assert.match(rec("aladdin-production-20261124T133628Z"), /has 237 migrations; plan prod-marketplace-orders needs one taken at 246 or later/);
  assert.match(rec(Object.keys(RESTORE_VERIFIED_SNAPSHOTS).at(-1)), /not a pinned restore-verified PRODUCTION snapshot/);
  assert.match(rec("aladdin-production-20261128T020134Z"), /not a pinned restore-verified PRODUCTION snapshot/);
  const label = "aladdin-production-20990101T000000Z";
  PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS[label] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 246 };
  try { assert.equal(rec(label), ""); } finally { delete PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS[label]; }
});
test("recovery: the two pinned forward-fixes in undo order (clarity, then orders); a missing or altered one is refused", () => {
  assert.deepEqual(P().fixes, ["marketplace-clarity", "marketplace-orders"]);
  assert.equal(P().recovery, "forward-fix");
  for (const fx of P().fixes) assert.match(checkRecovery({ plan: NAME, label: "", forwardFixSha256: { ...shas(), [fx]: "0".repeat(64) } }).join(), new RegExp(`forward-fix .*${fx}.*sha256`));
});

const pre = (o = {}) => ({ applied_migrations: 246, latest_migration: "20261124120001", new_tables: 0, new_tables_without_rls: 0, new_tables_open_to_anon: 0, orders: 0,
  orders_open_old_model: 0, orders_not_legacy: 0, orders_unmigrated: 0, templates: 8, presets: 15, marketplace_open: true, approved_sellers: 1, marketplace_products: 0,
  new_permissions: 0, new_permission_grants: 0, new_permission_grants_super_admin: 0, return_rules: null, upload_limits: null, functions_without_search_path: 9, ...o });
const post = (o = {}) => pre({ applied_migrations: 266, latest_migration: "20261128120001", new_tables: 21, templates: 39, presets: 35, new_permissions: 2,
  new_permission_grants: 2, new_permission_grants_super_admin: 2, return_rules: 6, upload_limits: "50/150/1024", functions_without_search_path: 0, ...o });

test("orders smoke for Production: pre refuses an open old order, a wrong history or seeded counts the post check could not match", () => {
  assert.equal(judgeOrders("pre", pre(), NAME).ok, true);
  for (const o of [{ orders_open_old_model: 1 }, { new_tables: 1 }, { applied_migrations: 264 }, { templates: 9 }, { presets: 16 }]) assert.equal(judgeOrders("pre", pre(o), NAME).ok, false, JSON.stringify(o));
  assert.match(judgeOrders("pre", pre(), NAME).lines.join("\n"), /Marketplace open=true, 1 approved seller\(s\), 0 product\(s\)/);
});
test("orders smoke for Production: post expects 266 and 39 templates, while the Acceptance plan still expects 264 and 36", () => {
  assert.equal(judgeOrders("post", post(), NAME).ok, true);
  for (const o of [{ templates: 36 }, { applied_migrations: 264 }, { latest_migration: "20261126120002" }, { presets: 36 }, { upload_limits: "60/150/1024" }]) assert.equal(judgeOrders("post", post(o), NAME).ok, false, JSON.stringify(o));
  assert.equal(judgeOrders("post", post({ applied_migrations: 264, latest_migration: "20261126120002", templates: 36 })).ok, true);
  assert.throws(() => judgeOrders("post", post(), "prod-catchup"), /knows the plans/);
});
test("clarity smoke for Production: only the post phase (its SQL reads tables the same push creates)", () => {
  const f = { applied_migrations: 266, latest_migration: "20261128120001", templates: 39, new_templates: 3, new_helpers: 2, active_return_timers: 0, refund_confirm_timers: 0, return_reject_presets: 4, invoices: 0 };
  assert.equal(judgeClarity("post", f, NAME).ok, true);
  assert.equal(judgeClarity("post", { ...f, new_helpers: 0 }, NAME).ok, false);
  assert.throws(() => judgeClarity("pre", f, NAME), /only "post"/);
});
test("production scripts: both accept the plan; the apply runs the smokes before and after the push, and the Acceptance scripts do not know the plan", () => {
  const apply = read("./production-apply.sh"), preflight = read("./production-preflight.sh");
  for (const sh of [apply, preflight]) assert.ok(sh.includes("|prod-marketplace-orders)$"));
  const push = apply.indexOf('STEP="push"'), at = (s) => apply.indexOf(s);
  assert.ok(at('marketplace-orders-smoke.mjs facts pre "$OUT/mo-pre.json" --plan "$PLAN"') > -1 && at("marketplace-orders-smoke.mjs facts pre") < push);
  assert.ok(at('marketplace-orders-smoke.mjs facts post "$OUT/mo-post.json" --plan "$PLAN"') > push);
  assert.ok(at('marketplace-clarity-smoke.mjs facts post "$OUT/mc-post.json" --plan "$PLAN"') > push);
  assert.equal(at("marketplace-clarity-smoke.mjs facts pre"), -1);
  for (const f of ["acceptance-apply.sh", "acceptance-preflight.sh"]) assert.ok(!read(`./${f}`).includes(NAME), f);
});
