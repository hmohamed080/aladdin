import { test } from "node:test";
import assert from "node:assert/strict";
import { pick, postcheck } from "./acceptance-postcheck.mjs";

const preS = { media_locations: 11, storage_objects: 1, latest_migration: "20261107090006", applied_migrations: 207 };
const postS = { ...preS, latest_migration: "20261110090001", applied_migrations: 208 };
const preC = { "public.users": 23, "public.admin_permissions": 40 };
const has = (a, re) => assert.ok(a.some((x) => re.test(x)), JSON.stringify(a));

test("the media plan passes; other count changes are informational only", () => {
  const r = postcheck({ plan: "media", preS, preC, postS, postC: { ...preC, "public.users": 24 } });
  assert.deepEqual(r.fail, []); has(r.info, /public.users: 23 -> 24/);
});
test("the m1 plan passes from the post-media state, media+m1 from the original state", () => {
  assert.deepEqual(postcheck({ plan: "m1", preS: postS, preC, postS: { ...postS, latest_migration: "20261110090002", applied_migrations: 209 }, postC: preC }).fail, []);
  assert.deepEqual(postcheck({ plan: "media+m1", preS, preC, postS: { ...preS, latest_migration: "20261110090002", applied_migrations: 209 }, postC: preC }).fail, []);
});
test("a wrong latest migration or count fails", () => {
  has(postcheck({ plan: "media", preS, preC, postS: { ...postS, latest_migration: "20261107090006" }, postC: preC }).fail, /latest migration/);
  has(postcheck({ plan: "media", preS, preC, postS: { ...postS, applied_migrations: 207 }, postC: preC }).fail, /207 migrations applied/);
});
test("media or storage rows changing fails", () => {
  has(postcheck({ plan: "media", preS, preC, postS: { ...postS, storage_objects: 0 }, postC: preC }).fail, /storage\.objects changed/);
  has(postcheck({ plan: "media", preS, preC, postS: { ...postS, media_locations: 10 }, postC: preC }).fail, /media_storage_locations changed/);
});
test("a pre state that does not match the plan is refused (the old 203 baseline, or already migrated)", () => {
  has(postcheck({ plan: "media", preS: { ...preS, applied_migrations: 203, latest_migration: "20261107090002" }, preC, postS, postC: preC }).fail, /pre-push state/);
  has(postcheck({ plan: "media", preS: postS, preC, postS, postC: preC }).fail, /pre-push state/);
});
test("pick handles array, rows and string-json shapes and rejects bad input", () => {
  assert.deepEqual(pick(JSON.stringify([{ facts: preS }]), "facts"), preS);
  assert.deepEqual(pick(JSON.stringify({ rows: [{ counts: JSON.stringify(preC) }] }), "counts"), preC);
  assert.throws(() => pick("[]", "facts")); assert.throws(() => pick("nope", "facts"));
});
