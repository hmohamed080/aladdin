import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { judgeFacts, parseFacts } from "./marketplace-clarity-smoke.mjs";
import { PLANS, FORWARD_FIX, checkAcceptance, checkAcceptancePost, checkRecovery, pendingDrift } from "./acceptance-gate.mjs";

const here = (f) => new URL(f, import.meta.url);
const read = (f) => readFileSync(here(f), "utf8");
const NAME = "marketplace-clarity";
const P = () => PLANS[NAME];
const versions = () => readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
const applied = () => [...Array.from({ length: P().applied - 1 }, (_, i) => String(20200000000000 + i)), P().latest].map((v) => ({ local: v, remote: v }));
const sha = () => ({ [NAME]: createHash("sha256").update(readFileSync(here(FORWARD_FIX[NAME].file))).digest("hex") });
const pre = (o = {}) => ({ applied_migrations: 264, latest_migration: "20261126120002", templates: 36, new_templates: 0, new_helpers: 0, active_return_timers: 0,
  refund_confirm_timers: 0, return_reject_presets: 4, invoices: 1, ...o });
const post = (o = {}) => pre({ applied_migrations: 266, latest_migration: "20261128120001", templates: 39, new_templates: 3, new_helpers: 2, ...o });

test("the plan is exactly the 2 migrations after 264, the checkout holds nothing it does not list up to its last one, and it follows marketplace-orders", () => {
  assert.equal(P().applied, PLANS["marketplace-orders"].applied + PLANS["marketplace-orders"].pending.length);
  assert.equal(P().latest, PLANS["marketplace-orders"].pending.at(-1));
  assert.deepEqual(P().pending, ["20261128090001", "20261128120001"]);
  assert.deepEqual(versions().filter((v) => v > P().latest && v <= P().pending.at(-1)).sort(), P().pending);
  assert.deepEqual(pendingDrift({ plan: NAME, localVersions: versions() }).missing, []);
  assert.equal(P().preContract, PLANS["marketplace-orders"].postContract);
  for (const v of [P().preContract, P().postContract]) assert.ok(read(`../../supabase/permissions/${v}.json`).includes(`"${v}"`));
});
test("the gate accepts the exact pending state and refuses an unapplied base, a repeat run and Production", () => {
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
test("the migrations insert only the 3 templates and drop no table or column, which is why no backup is required", () => {
  for (const v of P().pending) {
    const file = readdirSync(here("../../supabase/migrations")).find((f) => f.startsWith(v));
    const outside = read(`../../supabase/migrations/${file}`).replace(/--.*$/gm, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
    assert.deepEqual([...outside.matchAll(/^\s*insert into (\S+)/gim)].map((m) => m[1]), v === "20261128090001" ? ["public.notification_templates"] : []);
    assert.doesNotMatch(outside, /^\s*(update|delete|truncate|drop (table|column|schema)|create table)\b/im);
  }
});
test("forward-fix: one transaction, every guard before the first change, drops only IF EXISTS, deletes only the seeded templates", () => {
  const code = read(`./${FORWARD_FIX[NAME].file}`).replace(/--.*$/gm, "");
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  const outside = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  const first = Math.min(...["create or replace function app.", "create or replace function public.", "alter table", "drop function", "delete from"]
    .map((s) => outside.toLowerCase().indexOf(s)).filter((i) => i > -1));
  assert.ok(outside.indexOf("raise exception") > -1 && outside.lastIndexOf("raise exception") < first, "all guards precede the first change");
  assert.deepEqual([...outside.matchAll(/^delete from (\S+)/gim)].map((m) => m[1]), ["public.notification_templates"]);
  for (const m of outside.matchAll(/^drop function (.*)$/gim)) assert.match(m[1], /^if exists/i);
});
test("smoke: pre and post pass on the expected facts and fail on a wrong history, a missing template or an existing timer", () => {
  assert.equal(judgeFacts("pre", pre()).ok, true);
  assert.equal(judgeFacts("post", post()).ok, true);
  assert.equal(judgeFacts("pre", pre({ applied_migrations: 266 })).ok, false);
  assert.equal(judgeFacts("pre", pre({ refund_confirm_timers: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ new_templates: 2 })).ok, false);
  assert.deepEqual(parseFacts(JSON.stringify({ rows: [{ facts: pre() }] })), pre());
  assert.throws(() => parseFacts("{}"), /not a marketplace-clarity facts row/);
});
test("smoke SQL and script only read; both acceptance scripts accept the plan and the smoke runs before and after the push", () => {
  assert.doesNotMatch(read("./marketplace-clarity-smoke.sql").replace(/--.*$/gm, "").replace(/'[^']*'/g, "''"), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(read("./marketplace-clarity-smoke.mjs"), /fetch\(|writeFile|appendFile|spawn|execSync|execFile/);
  const apply = read("./acceptance-apply.sh"), preflight = read("./acceptance-preflight.sh");
  assert.match(apply, /\|marketplace-clarity\|/); assert.match(preflight, /\|marketplace-clarity\|/);
  const push = apply.indexOf('STEP="push"');
  assert.ok(apply.indexOf("marketplace-clarity-smoke.mjs facts pre") > -1 && apply.indexOf("marketplace-clarity-smoke.mjs facts pre") < push);
  assert.ok(apply.indexOf("marketplace-clarity-smoke.mjs facts post") > push);
});
