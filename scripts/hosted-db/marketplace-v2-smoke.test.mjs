import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCEPTANCE_REF, MUST_EXIST, NEW_TABLES, SEED, judgeFacts, parseFacts, projectRef, runHttp } from "./marketplace-v2-smoke.mjs";

const pre = (o = {}) => ({ applied_migrations: 237, latest_migration: "20261122090002", new_tables: [], templates: 6, stock_templates: 0, presets: null, preset_actions: null, marketplace_open: null,
  marketplace_open_default: null, media_verification_ready: false, enum_has_marketplace: false, permission: 0, permission_super_admin_locked: 0, permission_other_roles: 0, marketplace_videos: 0,
  sellers: 2, products: 5, published_products: 1, functions_present: [], public_status: null, public_catalog_page: null, public_facets: null, publication_blockers_unknown_product: null, ...o });
const post = (o = {}) => ({ ...pre(), applied_migrations: 244, latest_migration: "20261123160002", new_tables: [...NEW_TABLES], templates: 8, stock_templates: 2, presets: 15, preset_actions: SEED.presetActions,
  marketplace_open: true, marketplace_open_default: "true", media_verification_ready: true, enum_has_marketplace: true, permission: 1, permission_super_admin_locked: 1, functions_present: [...MUST_EXIST],
  public_status: { open: true }, public_catalog_page: "object", public_facets: "object", publication_blockers_unknown_product: "array", ...o });
const fails = (r) => r.lines.filter((l) => l.startsWith("FAIL"));

test("pre: the 237 state passes and prints the value to note", () => {
  const r = judgeFacts("pre", pre());
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /media_verification_ready before/.test(l)));
});
test("pre: refuses a history that is not 237, an existing new table, or an already applied plan", () => {
  assert.equal(judgeFacts("pre", pre({ applied_migrations: 244, latest_migration: "20261123160002" })).ok, false);
  assert.equal(judgeFacts("pre", pre({ new_tables: ["marketplace_video_events"] })).ok, false);
  assert.equal(judgeFacts("pre", pre({ enum_has_marketplace: true })).ok, false);
});
test("post: a correct 244 state passes", () => {
  const r = judgeFacts("post", post());
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.equal(fails(r).length, 0);
});
test("post: each seed and default is checked (templates 8, stock templates 2, presets 15, open by default)", () => {
  assert.equal(fails(judgeFacts("post", post({ templates: 6 }))).length > 0, true);
  assert.equal(judgeFacts("post", post({ stock_templates: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ presets: 14 })).ok, false);
  assert.equal(judgeFacts("post", post({ preset_actions: "approve:1" })).ok, false);
  assert.equal(judgeFacts("post", post({ marketplace_open: false })).ok, false);
  assert.equal(judgeFacts("post", post({ marketplace_open_default: "false" })).ok, false);
  assert.equal(judgeFacts("post", post({ media_verification_ready: false })).ok, false);
});
test("post: missing table, function, permission or a failing public read is a failure", () => {
  assert.equal(judgeFacts("post", post({ new_tables: NEW_TABLES.slice(1) })).ok, false);
  assert.equal(judgeFacts("post", post({ functions_present: MUST_EXIST.slice(1) })).ok, false);
  assert.equal(judgeFacts("post", post({ permission_other_roles: 1 })).ok, false);
  assert.equal(judgeFacts("post", post({ public_status: null })).ok, false);
  assert.equal(judgeFacts("post", post({ public_catalog_page: null })).ok, false);
  assert.equal(judgeFacts("post", post({ publication_blockers_unknown_product: null })).ok, false);
  assert.equal(judgeFacts("post", post({ marketplace_videos: 1 })).ok, false);
});
test("parseFacts accepts the db query shapes and rejects anything else", () => {
  const f = pre();
  assert.equal(parseFacts(JSON.stringify([{ facts: f }])).applied_migrations, 237);
  assert.equal(parseFacts(JSON.stringify({ rows: [{ facts: JSON.stringify(f) }] })).applied_migrations, 237);
  assert.equal(parseFacts("noise\n" + JSON.stringify(f)).applied_migrations, 237);
  assert.throws(() => parseFacts("{}"), /not a marketplace-v2 facts row/);
  assert.throws(() => parseFacts("[]"), /exactly one row/);
  assert.throws(() => parseFacts("no json"), /no JSON/);
});

const env = (o = {}) => ({ SMOKE_URL: `https://${ACCEPTANCE_REF}.supabase.co`, SMOKE_PUBLISHABLE_KEY: "sb_publishable_x", ...o });
const res = (status, json) => ({ status, text: async () => JSON.stringify(json) });
test("http: only Acceptance, only a publishable key", async () => {
  assert.equal(projectRef("https://kkpkgjrweysgvhvkhzun.supabase.co"), "kkpkgjrweysgvhvkhzun");
  const never = async () => { throw new Error("must not be called"); };
  assert.match((await runHttp({ fetchImpl: never, env: env({ SMOKE_URL: "https://kkpkgjrweysgvhvkhzun.supabase.co" }) })).lines[0], /not the Acceptance project/);
  assert.match((await runHttp({ fetchImpl: never, env: env({ SMOKE_PUBLISHABLE_KEY: "sb_secret_abc" }) })).lines[0], /PUBLISHABLE/);
  assert.equal((await runHttp({ fetchImpl: never, env: env({ SMOKE_URL: "" }) })).ok, false);
});
test("http: passes when the three public reads answer, sends no user token, fails when the status is closed or the function is missing", async () => {
  const seen = [];
  const good = async (url, init) => { seen.push([url, init.headers.authorization]); return url.endsWith("marketplace_public_status") ? res(200, { open: true }) : res(200, { items: [] }); };
  const r = await runHttp({ fetchImpl: good, env: env() });
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.deepEqual([...new Set(seen.map((x) => x[1]))], ["Bearer sb_publishable_x"]);
  assert.equal((await runHttp({ fetchImpl: async (u) => (u.endsWith("status") ? res(200, { open: false }) : res(200, {})), env: env() })).ok, false);
  assert.equal((await runHttp({ fetchImpl: async () => res(404, { message: "function not found" }), env: env() })).ok, false);
});
test("the smoke only reads: no INSERT/UPDATE/DELETE/DDL in the SQL, and the script sends no write verb", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("./marketplace-v2-smoke.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
  const js = readFileSync(new URL("./marketplace-v2-smoke.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(js, /method:\s*"(PATCH|PUT|DELETE)"/);
});
