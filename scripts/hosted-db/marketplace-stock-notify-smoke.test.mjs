import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judgeFacts, parseFacts } from "./marketplace-stock-notify-smoke.mjs";

const pre = (o = {}) => ({ applied_migrations: 244, latest_migration: "20261123160002", fn_present: true, fn_passes_localized_names: false, fn_callable_by_api_roles: 0, trigger_enabled: true,
  stock_templates: 2, defaults_localized: 0, defaults_declared: 0, stock_templates_edited: 0, ...o });
const post = (o = {}) => ({ ...pre(), applied_migrations: 246, latest_migration: "20261124120001", fn_passes_localized_names: true, defaults_localized: 2, defaults_declared: 2, ...o });

test("pre: the 244 (Acceptance) state passes; Production 237 passes with its own expectation and no templates", () => {
  assert.equal(judgeFacts("pre", pre()).ok, true);
  const p = pre({ applied_migrations: 237, latest_migration: "20261122090002", fn_present: false, trigger_enabled: false, stock_templates: 0 });
  assert.equal(judgeFacts("pre", p).ok, false);
  assert.equal(judgeFacts("pre", p, { applied: 237, latest: "20261122090002", noTemplates: true }).ok, true);
});
test("pre: refuses an already applied plan or a wrong history", () => {
  assert.equal(judgeFacts("pre", pre({ fn_passes_localized_names: true })).ok, false);
  assert.equal(judgeFacts("pre", pre({ defaults_localized: 2 })).ok, false);
  assert.equal(judgeFacts("pre", pre({ applied_migrations: 246, latest_migration: "20261124120001" })).ok, false);
});
test("post: a correct 246 state passes; each fact is checked", () => {
  assert.equal(judgeFacts("post", post()).ok, true);
  assert.equal(judgeFacts("post", post(), { applied: 246, latest: "20261124120001" }).ok, true);
  assert.equal(judgeFacts("post", post({ fn_present: false })).ok, false);
  assert.equal(judgeFacts("post", post({ fn_passes_localized_names: false })).ok, false);
  assert.equal(judgeFacts("post", post({ trigger_enabled: false })).ok, false);
  assert.equal(judgeFacts("post", post({ fn_callable_by_api_roles: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ defaults_localized: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ defaults_declared: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ applied_migrations: 245 })).ok, false);
});
test("parseFacts accepts the db query shapes and rejects anything else", () => {
  const f = pre();
  assert.equal(parseFacts(JSON.stringify([{ facts: f }])).applied_migrations, 244);
  assert.equal(parseFacts(JSON.stringify({ rows: [{ facts: JSON.stringify(f) }] })).applied_migrations, 244);
  assert.throws(() => parseFacts("{}"), /not a marketplace-stock-notify facts row/);
  assert.throws(() => parseFacts("[]"), /exactly one row/);
  assert.throws(() => parseFacts("no json"), /no JSON/);
});
test("the smoke only reads: no write or DDL verb in the SQL, and the script has no network or write call", () => {
  const sql = readFileSync(new URL("./marketplace-stock-notify-smoke.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  const js = readFileSync(new URL("./marketplace-stock-notify-smoke.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(js, /fetch\(|writeFile|appendFile|spawn|execSync|execFile/);
});
