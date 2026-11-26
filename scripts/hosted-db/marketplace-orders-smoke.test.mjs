import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { judgeFacts, parseFacts } from "./marketplace-orders-smoke.mjs";
import { PLANS, FORWARD_FIX, RESTORE_VERIFIED_SNAPSHOTS, checkRecovery, pendingDrift } from "./acceptance-gate.mjs";

const here = (f) => new URL(f, import.meta.url);
const read = (f) => readFileSync(here(f), "utf8");
const P = () => PLANS["marketplace-orders"];
const SNAP = "aladdin-acceptance-20261126T140613Z";
const versions = () => readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
const pre = (o = {}) => ({ applied_migrations: 246, latest_migration: "20261124120001", new_tables: 0, new_tables_without_rls: 0, new_tables_open_to_anon: 0, orders: 11,
  orders_open_old_model: 0, orders_not_legacy: 0, orders_unmigrated: 11, templates: 8, presets: 15, new_permissions: 0, new_permission_grants: 0,
  new_permission_grants_super_admin: 0, return_rules: null, upload_limits: null, functions_without_search_path: 9, ...o });
const post = (o = {}) => ({ ...pre(), applied_migrations: 264, latest_migration: "20261126120002", new_tables: 21, orders_unmigrated: 0, templates: 36, presets: 35,
  new_permissions: 2, new_permission_grants: 2, new_permission_grants_super_admin: 2, return_rules: 6, upload_limits: "50/150/1024", functions_without_search_path: 0, ...o });

test("the plan is exactly the 18 migrations after 246, and the checkout holds nothing it does not list up to its last one", () => {
  assert.equal(P().applied, 246); assert.equal(P().latest, "20261124120001"); assert.equal(P().pending.length, 18);
  const mine = versions().filter((v) => v > P().latest && v <= P().pending.at(-1)).sort();
  assert.deepEqual(P().pending, mine);
  assert.deepEqual(pendingDrift({ plan: "marketplace-orders", localVersions: versions() }).missing, []);
  assert.equal(P().postContract, P().pending.at(-1));
});
test("recovery: a fresh restore-verified snapshot of 246 is mandatory and the forward-fix is pinned", () => {
  const sha = { "marketplace-orders": createHash("sha256").update(readFileSync(here(FORWARD_FIX["marketplace-orders"].file))).digest("hex") };
  assert.equal(RESTORE_VERIFIED_SNAPSHOTS[SNAP].migrations, 246);
  assert.deepEqual(checkRecovery({ plan: "marketplace-orders", label: SNAP, forwardFixSha256: sha }), []);
  assert.match(checkRecovery({ plan: "marketplace-orders", label: "", forwardFixSha256: sha }).join(), /needs --backup-label/);
  assert.match(checkRecovery({ plan: "marketplace-orders", label: "aladdin-acceptance-20261124T092536Z", forwardFixSha256: sha }).join(), /needs one taken at 246 or later/);
  assert.match(checkRecovery({ plan: "marketplace-orders", label: SNAP, forwardFixSha256: {} }).join(), /sha256/);
});
test("forward-fix: one transaction, every guard before the first change, drops only IF EXISTS, deletes only seeded rows", () => {
  const code = read(`./${FORWARD_FIX["marketplace-orders"].file}`).replace(/--.*$/gm, "");
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  const outside = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  const first = Math.min(...["drop trigger", "alter table", "drop table", "delete from"].map((s) => outside.indexOf(s)).filter((i) => i > -1));
  assert.ok(outside.lastIndexOf("select pg_temp.mo_guard(") < first, "all guards precede the first change");
  assert.deepEqual([...outside.matchAll(/^delete from (\S+)/gm)].map((m) => m[1]),
    ["public.notification_templates", "public.marketplace_seller_message_presets", "public.admin_role_permissions", "public.admin_permissions"]);
  assert.doesNotMatch(outside, /drop (table|function|sequence|index|trigger)(?! if exists)/i);
  assert.doesNotMatch(outside, /\btruncate\b/i);
  assert.equal((outside.match(/^drop table if exists public\.\S+ cascade;/gm) ?? []).length, 21);
  assert.ok(outside.indexOf("disable trigger trg_admin_role_permissions_guard") < outside.indexOf("delete from public.admin_role_permissions"));
  assert.ok(outside.indexOf("enable trigger trg_admin_role_permissions_guard") > outside.indexOf("delete from public.admin_role_permissions"));
});
test("pre: the 246 state passes; an open old order, a new table or a wrong history refuses", () => {
  assert.equal(judgeFacts("pre", pre()).ok, true);
  for (const o of [{ orders_open_old_model: 1 }, { new_tables: 1 }, { new_permissions: 2 }, { applied_migrations: 264 }]) assert.equal(judgeFacts("pre", pre(o)).ok, false, JSON.stringify(o));
});
test("post: a correct 264 state passes; each fact is checked", () => {
  assert.equal(judgeFacts("post", post()).ok, true);
  for (const k of ["new_tables", "new_tables_without_rls", "new_tables_open_to_anon", "orders_unmigrated", "orders_not_legacy", "templates", "presets", "new_permissions",
    "new_permission_grants", "new_permission_grants_super_admin", "return_rules", "upload_limits", "functions_without_search_path", "applied_migrations"]) {
    assert.equal(judgeFacts("post", post({ [k]: k === "upload_limits" ? "60/150/1024" : 99 })).ok, false, k);
  }
  assert.equal(judgeFacts("post", post({ return_rules: null })).ok, false);
});
test("parseFacts accepts the db query shapes and rejects anything else", () => {
  assert.equal(parseFacts(JSON.stringify([{ facts: pre() }])).orders, 11);
  assert.equal(parseFacts(JSON.stringify({ rows: [{ facts: JSON.stringify(pre()) }] })).orders, 11);
  assert.throws(() => parseFacts("{}"), /not a marketplace-orders facts row/);
  assert.throws(() => parseFacts("no json"), /no JSON/);
});
test("the smoke only reads, and the apply and preflight scripts know the plan", () => {
  assert.doesNotMatch(read("./marketplace-orders-smoke.sql").replace(/--.*$/gm, "").replace(/'[^']*'/g, "''"), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(read("./marketplace-orders-smoke.mjs"), /fetch\(|writeFile|appendFile|spawn|execSync|execFile/);
  const apply = read("./acceptance-apply.sh"), preflight = read("./acceptance-preflight.sh");
  assert.match(apply, /\|marketplace-orders\|/); assert.match(preflight, /\|marketplace-orders\|/);
  const push = apply.indexOf('STEP="push"');
  assert.ok(apply.indexOf("marketplace-orders-smoke.mjs facts pre") > -1 && apply.indexOf("marketplace-orders-smoke.mjs facts pre") < push);
  assert.ok(apply.indexOf("marketplace-orders-smoke.mjs facts post") > push);
});
