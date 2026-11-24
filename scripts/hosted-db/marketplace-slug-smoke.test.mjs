import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judgeFacts, parseFacts } from "./marketplace-slug-smoke.mjs";

const pre = (o = {}) => ({ applied_migrations: 244, latest_migration: "20261123160002", fn_assign: false, fn_trigger: false, trigger_present: false, trigger_enabled: false, trigger_runs_slug_fn: false,
  fns_callable_by_api_roles: 0, approved_sellers: 3, approved_without_slug: 1, orgs_with_slug: 5, ...o });
const post = (o = {}) => ({ ...pre(), applied_migrations: 245, latest_migration: "20261124090001", fn_assign: true, fn_trigger: true, trigger_present: true, trigger_enabled: true, trigger_runs_slug_fn: true,
  approved_without_slug: 0, ...o });

test("pre: the 244 (Acceptance) state passes and reports the sellers the backfill will touch", () => {
  const r = judgeFacts("pre", pre());
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /1 of 3 approved seller\(s\) have no slug/.test(l)));
});
test("pre: the Production 237 history is accepted only with its own expectation", () => {
  const p = pre({ applied_migrations: 237, latest_migration: "20261122090002" });
  assert.equal(judgeFacts("pre", p).ok, false);
  assert.equal(judgeFacts("pre", p, { applied: 237, latest: "20261122090002" }).ok, true);
});
test("pre: refuses an already applied plan (objects exist) or a wrong history", () => {
  assert.equal(judgeFacts("pre", pre({ fn_assign: true })).ok, false);
  assert.equal(judgeFacts("pre", pre({ trigger_present: true })).ok, false);
  assert.equal(judgeFacts("pre", pre({ applied_migrations: 245, latest_migration: "20261124090001" })).ok, false);
});
test("post: a correct 245 state passes (also with the Production expectation)", () => {
  assert.equal(judgeFacts("post", post()).ok, true);
  assert.equal(judgeFacts("post", post(), { applied: 245, latest: "20261124090001" }).ok, true);
});
test("post: each slug object, the trigger state, the revokes and the backfill are checked", () => {
  assert.equal(judgeFacts("post", post({ fn_assign: false })).ok, false);
  assert.equal(judgeFacts("post", post({ fn_trigger: false })).ok, false);
  assert.equal(judgeFacts("post", post({ trigger_present: false })).ok, false);
  assert.equal(judgeFacts("post", post({ trigger_enabled: false })).ok, false);
  assert.equal(judgeFacts("post", post({ trigger_runs_slug_fn: false })).ok, false);
  assert.equal(judgeFacts("post", post({ fns_callable_by_api_roles: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ approved_without_slug: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ applied_migrations: 244, latest_migration: "20261123160002" })).ok, false);
});
test("parseFacts accepts the db query shapes and rejects anything else", () => {
  const f = pre();
  assert.equal(parseFacts(JSON.stringify([{ facts: f }])).applied_migrations, 244);
  assert.equal(parseFacts(JSON.stringify({ rows: [{ facts: JSON.stringify(f) }] })).applied_migrations, 244);
  assert.throws(() => parseFacts("{}"), /not a marketplace-slug facts row/);
  assert.throws(() => parseFacts("[]"), /exactly one row/);
  assert.throws(() => parseFacts("no json"), /no JSON/);
});
test("the smoke only reads: no write or DDL verb in the SQL, and the script has no network or write call", () => {
  const sql = readFileSync(new URL("./marketplace-slug-smoke.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  const js = readFileSync(new URL("./marketplace-slug-smoke.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(js, /fetch\(|writeFile|appendFile|spawn|execSync|execFile/);
});
