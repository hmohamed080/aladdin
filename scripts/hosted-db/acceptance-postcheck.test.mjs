import { test } from "node:test";
import assert from "node:assert/strict";
import { pick, postcheck } from "./acceptance-postcheck.mjs";

const preS = { storage_key_column: false, media_locations: 11, storage_objects: 1, backup_tables: 0, delivery_requests_table: false, latest_migration: "20261107090002" };
const postS = { ...preS, storage_key_column: true, backup_tables: 4, delivery_requests_table: true, latest_migration: "20261107090006" };
const preC = { "public.users": 23, "public.admin_permissions": 40 };
const postC = { ...preC, "public.admin_permissions": 44, "app.backup_settings": 1, "app.backup_environment": 0, "app.backup_runs": 0, "app.backup_run_events": 0, "app.whatsapp_otp_delivery_requests": 0 };
const has = (a, re) => assert.ok(a.some((x) => re.test(x)), JSON.stringify(a));

test("the expected result passes; other count changes are informational only", () => {
  const r = postcheck({ preS, preC, postS, postC }); assert.deepEqual(r.fail, []); has(r.info, /admin_permissions: 40 -> 44/);
});
test("a missing column, table or migration fails", () => {
  has(postcheck({ preS, preC, postS: { ...postS, storage_key_column: false }, postC }).fail, /storage_key/);
  has(postcheck({ preS, preC, postS: { ...postS, backup_tables: 3 }, postC }).fail, /3 of 4/);
  has(postcheck({ preS, preC, postS: { ...postS, latest_migration: "20261107090005" }, postC }).fail, /latest migration/);
});
test("media or storage rows changing fails", () => {
  has(postcheck({ preS, preC, postS: { ...postS, storage_objects: 0 }, postC }).fail, /storage\.objects changed/);
  has(postcheck({ preS, preC, postS: { ...postS, media_locations: 10 }, postC }).fail, /media_storage_locations changed/);
});
test("new tables must be in their initial state", () => has(postcheck({ preS, preC, postS, postC: { ...postC, "app.backup_runs": 2 } }).fail, /backup_runs has 2/));
test("an already-migrated pre state is refused", () => has(postcheck({ preS: postS, preC, postS, postC }).fail, /pre-push state/));
test("pick handles array, rows and string-json shapes and rejects bad input", () => {
  assert.deepEqual(pick(JSON.stringify([{ facts: preS }]), "facts"), preS);
  assert.deepEqual(pick(JSON.stringify({ rows: [{ counts: JSON.stringify(preC) }] }), "counts"), preC);
  assert.throws(() => pick("[]", "facts")); assert.throws(() => pick("nope", "facts"));
});
