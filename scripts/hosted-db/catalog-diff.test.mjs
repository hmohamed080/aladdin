import { test } from "node:test";
import assert from "node:assert/strict";
import { load, diff, checkExpected } from "./catalog-diff.mjs";

const fp = (o = {}) => ({ functions_def: { "public.a(x integer)": "1", "app.b()": "2" }, functions_meta: { "public.a(x integer)": "m", "app.b()": "n" }, columns: { "public.t.c": "c1" }, counts: { functions: 2 }, ...o });

test("identical fingerprints have no differences", () => assert.equal(diff(fp(), fp()).touched.size, 0));
test("a changed function body is reported once, by signature", () => {
  const { touched } = diff(fp(), fp({ functions_def: { "public.a(x integer)": "9", "app.b()": "2" } }));
  assert.deepEqual([...touched.keys()], ["public.a(x integer)"]);
  assert.deepEqual(checkExpected(touched, ["public.a"]), []);
});
test("an unexpected extra change (grant, column) is refused", () => {
  const { touched } = diff(fp(), fp({ functions_meta: { "public.a(x integer)": "CHANGED-GRANT", "app.b()": "n" }, columns: { "public.t.c": "c2" } }));
  assert.ok(checkExpected(touched, ["public.a"]).some((p) => /unexpected change: public\.t\.c/.test(p)));
});
test("an expected change that did not happen is refused", () => assert.ok(checkExpected(diff(fp(), fp()).touched, ["public.a"]).some((p) => /missing/.test(p))));
test("added and removed objects count as changes", () => {
  const { touched, lines } = diff(fp(), fp({ functions_def: { "public.a(x integer)": "1", "app.c()": "3" } }));
  assert.deepEqual([...touched.keys()].sort(), ["app.b()", "app.c()"]);
  assert.ok(lines.some((l) => /^added/.test(l)) && lines.some((l) => /^removed/.test(l)));
});
test("an overload matches by schema.name but a different name does not", () => {
  const t = new Map([["public.media_migration_switch(p text)", ["functions_def:changed"]]]);
  assert.deepEqual(checkExpected(t, ["public.media_migration_switch"]), []);
  assert.ok(checkExpected(t, ["public.media_migration"]).length > 0);
});
test("load accepts raw, row-array, rows and string shapes and rejects other JSON", () => {
  assert.ok(load(JSON.stringify(fp())).functions_def);
  assert.ok(load(JSON.stringify([{ fingerprint: fp() }])).functions_def);
  assert.ok(load(JSON.stringify({ rows: [{ fingerprint: JSON.stringify(fp()) }] })).functions_def);
  assert.throws(() => load("[]")); assert.throws(() => load("nope")); assert.throws(() => load('{"a":1}'));
});
