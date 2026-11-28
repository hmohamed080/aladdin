import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { judgeFacts, parseFacts } from "./marketplace-retest-smoke.mjs";
import { PLANS, FORWARD_FIX, checkAcceptance, checkAcceptancePost, checkRecovery, pendingDrift } from "./acceptance-gate.mjs";

const here = (f) => new URL(f, import.meta.url);
const read = (f) => readFileSync(here(f), "utf8");
const NAME = "marketplace-retest";
const P = () => PLANS[NAME];
const versions = () => readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
const applied = () => [...Array.from({ length: P().applied - 1 }, (_, i) => String(20200000000000 + i)), P().latest].map((v) => ({ local: v, remote: v }));
const sha = () => ({ [NAME]: createHash("sha256").update(readFileSync(here(FORWARD_FIX[NAME].file))).digest("hex") });
const pre = (o = {}) => ({ applied_migrations: 266, latest_migration: "20261128120001", money_helper: 0, writers_using_helper: 0, writers_old_format: 4,
  invoice_address_fallback: 0, waybill_payment_status: 0, templates: 39, invoices: 2, showrooms_selling_without_address: 0, ...o });
const post = (o = {}) => pre({ applied_migrations: 267, latest_migration: "20261128150001", money_helper: 1, writers_using_helper: 4, writers_old_format: 0,
  invoice_address_fallback: 1, waybill_payment_status: 1, ...o });

test("the plan is exactly the 1 migration after 266, the checkout holds nothing it does not list up to it, and it follows marketplace-clarity", () => {
  assert.equal(P().applied, PLANS["marketplace-clarity"].applied + PLANS["marketplace-clarity"].pending.length);
  assert.equal(P().latest, PLANS["marketplace-clarity"].pending.at(-1));
  assert.deepEqual(P().pending, ["20261128150001"]);
  assert.deepEqual(versions().filter((v) => v > P().latest && v <= P().pending.at(-1)).sort(), P().pending);
  assert.deepEqual(pendingDrift({ plan: NAME, localVersions: versions() }).missing, []);
  assert.equal(P().preContract, PLANS["marketplace-clarity"].postContract);
  for (const v of [P().preContract, P().postContract]) assert.ok(read(`../../supabase/permissions/${v}.json`).includes(`"${v}"`));
});
test("the gate accepts the exact pending state and refuses an unapplied base and Production", () => {
  const list = { migrations: [...applied(), ...P().pending.map((v) => ({ local: v, remote: null }))] };
  const dry = { migrations: P().pending.map((v) => `supabase/migrations/${v}_x.sql`), upToDate: false };
  assert.deepEqual(checkAcceptancePost({ plan: NAME, list: { migrations: [...applied(), ...P().pending.map((v) => ({ local: v, remote: v }))] } }), []);
  assert.match(checkAcceptancePost({ plan: NAME, list }).join(), /not applied/);
  assert.match(checkAcceptance({ target: "production", plan: NAME, list, dry, localVersions: versions() }).join(), /targets acceptance/);
});
test("recovery: the forward-fix is pinned and no fresh backup is required", () => {
  assert.deepEqual(checkRecovery({ plan: NAME, label: "", forwardFixSha256: sha() }), []);
  assert.match(checkRecovery({ plan: NAME, label: "", forwardFixSha256: {} }).join(), /sha256/);
});
test("the migration writes no row and changes no table, which is why no backup is required", () => {
  const file = readdirSync(here("../../supabase/migrations")).find((f) => f.startsWith(P().pending[0]));
  const outside = read(`../../supabase/migrations/${file}`).replace(/--.*$/gm, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
  assert.doesNotMatch(outside, /^\s*(insert|update|delete|truncate|alter table|create table|drop)\b/im);
});
test("forward-fix: one transaction, every guard before the first change, drops only the helper, writes no row", () => {
  const code = read(`./${FORWARD_FIX[NAME].file}`).replace(/--.*$/gm, "");
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  const outside = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  const first = Math.min(...["create or replace function app.", "create or replace function public.", "drop function"]
    .map((s) => outside.toLowerCase().indexOf(s)).filter((i) => i > -1));
  assert.ok(outside.indexOf("raise exception") > -1 && outside.lastIndexOf("raise exception") < first, "all guards precede the first change");
  assert.deepEqual([...outside.matchAll(/^drop function (.*)$/gim)].map((m) => m[1].trim()), ["if exists app.marketplace_money(numeric, boolean);"]);
  assert.doesNotMatch(outside, /^\s*(insert|update|delete|truncate|alter table)\b/im);
  assert.equal([...code.matchAll(/^CREATE OR REPLACE FUNCTION /gm)].length, P().changed.length - 1);
});
test("smoke: pre and post pass on the expected facts and fail on a wrong history or a writer left on the old format", () => {
  assert.equal(judgeFacts("pre", pre()).ok, true);
  assert.equal(judgeFacts("post", post()).ok, true);
  assert.equal(judgeFacts("pre", pre({ applied_migrations: 267 })).ok, false);
  assert.equal(judgeFacts("pre", pre({ money_helper: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ writers_old_format: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ waybill_payment_status: 0 })).ok, false);
  assert.deepEqual(parseFacts(JSON.stringify({ rows: [{ facts: pre() }] })), pre());
  assert.throws(() => parseFacts("{}"), /not a marketplace-retest facts row/);
});
test("smoke SQL and script only read; both acceptance scripts accept the plan and the smoke runs before and after the push", () => {
  assert.doesNotMatch(read("./marketplace-retest-smoke.sql").replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''"), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(read("./marketplace-retest-smoke.mjs"), /fetch\(|writeFile|appendFile|spawn|execSync|execFile/);
  const apply = read("./acceptance-apply.sh"), preflight = read("./acceptance-preflight.sh");
  assert.match(apply, /\|marketplace-retest\|/); assert.match(preflight, /\|marketplace-retest\|/);
  const push = apply.indexOf('STEP="push"');
  assert.ok(apply.indexOf("marketplace-retest-smoke.mjs facts pre") > -1 && apply.indexOf("marketplace-retest-smoke.mjs facts pre") < push);
  assert.ok(apply.indexOf("marketplace-retest-smoke.mjs facts post") > push);
});
