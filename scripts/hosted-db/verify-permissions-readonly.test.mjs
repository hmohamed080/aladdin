import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPermissions, verify } from "./verify-permissions-readonly.mjs";

const V = "20261107090006";
const real = JSON.parse(readFileSync(new URL(`../../supabase/permissions/${V}.json`, import.meta.url), "utf8")).functions;
const rows = (p) => JSON.stringify([{ permissions: p }]);

test("the exact reviewed contract passes in every output shape", () => {
  assert.deepEqual(verify(rows(real), V).errors, []);
  assert.deepEqual(verify(JSON.stringify({ rows: [{ permissions: real }] }), V).errors, []);
  assert.deepEqual(verify(rows(JSON.stringify(real)), V).errors, []);
  assert.deepEqual(verify("noise line\n" + rows(real), V).errors, []);
});
test("a widened grant is reported", () => {
  const p = structuredClone(real); p[0].effective.anon = true;
  const r = verify(rows(p), V); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /incorrect effective/);
});
test("an unreviewed function is reported", () => {
  const p = [...structuredClone(real), { ...structuredClone(real[0]), signature: "public.surprise()" }];
  assert.match(verify(rows(p), V).errors.join("\n"), /public\.surprise\(\): unreviewed/);
});
test("a missing function is reported", () => assert.match(verify(rows(real.slice(1)), V).errors.join("\n"), /missing or renamed/));
test("a changed owner or search_path is reported", () => {
  const p = structuredClone(real); p[1].owner = "someone"; p[2].config = null;
  assert.equal(verify(rows(p), V).errors.length, 2);
});
test("unusable output is rejected, not passed", () => {
  for (const bad of ["", "no json", "[]", rows([]), JSON.stringify([{ permissions: real }, { permissions: real }]), '{"error":"x"}'])
    assert.throws(() => extractPermissions(bad));
});
