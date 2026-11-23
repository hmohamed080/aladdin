import { test } from "node:test";
import assert from "node:assert/strict";
import { BUCKETS, NAMESPACE_TABLES, buildInventory, compareSnapshots, main, resetScope, storageSnapshot } from "./media-reset.mjs";

function fakeIo(over = {}) {
  const calls = [];
  const io = {
    calls,
    async count(table, filters = {}) { calls.push(["count", table, filters]); return over.count?.(table, filters) ?? 0; },
    async locations(ns, provider) { calls.push(["locations", ns, provider]); return over.locations?.(ns, provider) ?? 0; },
    async storageObjects(bucket) { calls.push(["storage", bucket]); return over.storage?.(bucket) ?? 0; },
  };
  return io;
}

test("every application bucket and namespace is inventoried, including request photos and verification documents", async () => {
  const io = fakeIo();
  const inv = await buildInventory(io);
  assert.deepEqual(Object.keys(inv.namespaces).sort(), Object.keys(NAMESPACE_TABLES).sort());
  assert.deepEqual(io.calls.filter((c) => c[0] === "storage").map((c) => c[1]).sort(), [...BUCKETS].sort());
  assert.ok("request" in inv.namespaces && "verification" in inv.namespaces);
  assert.deepEqual(Object.keys(inv.references).sort(), ["organizations.logo_media_id", "portfolio_projects.cover_id", "profiles.avatar_media_id", "profiles.cover_media_id"]);
});

test("the inventory is read-only: it only counts and lists", async () => {
  const io = fakeIo();
  await buildInventory(io);
  assert.ok(io.calls.every((c) => ["count", "locations", "storage"].includes(c[0])));
});

test("the scope retains submitted verification evidence and never selects accounts, demo art or static assets", async () => {
  const inv = await buildInventory(fakeIo({
    count: (table, f) => (table === "business_verification_documents" && f.submitted ? 7 : table === "profiles" && !f.notNull ? 40 : 1),
    storage: () => 5 }));
  const scope = resetScope(inv);
  const verification = scope.find((s) => s.namespace === "verification");
  assert.equal(verification.action, "retain-submitted-evidence-only");
  assert.equal(verification.retained, 7);
  assert.ok(scope.filter((s) => s.namespace !== "verification").every((s) => s.action === "remove-all"));
  assert.equal(inv.retained.accountsAndProfiles, 40);
  assert.match(inv.retained.staticWebsiteAssets, /not media/);
  assert.ok(!JSON.stringify(scope).includes("products"), "demo product art is never in the reset scope");
});

test("the hash changes with the counts so an approval names exactly one inventory", async () => {
  const a = await buildInventory(fakeIo());
  const b = await buildInventory(fakeIo({ storage: (bucket) => (bucket === "avatars" ? 1 : 0) }));
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(a.sha256, b.sha256);
  assert.equal(a.sha256, (await buildInventory(fakeIo())).sha256);
});

test("the output carries counts only: no keys, owners or ids", async () => {
  const inv = await buildInventory(fakeIo({ count: () => 3, storage: () => 2, locations: () => 1 }));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(inv)));
});

test("the CLI refuses anything but inventory and a mismatched project, and has no execute mode", async () => {
  await assert.rejects(() => main(["delete", "--project", "x"]), /never deletes/);
  await assert.rejects(() => main(["inventory", "--execute"]), /never deletes|required/);
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://abcdefgh.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  try { await assert.rejects(() => main(["inventory", "--project", "someotherref"]), /does not match/); }
  finally { process.env.SUPABASE_URL = saved.u; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k; if (!saved.u) delete process.env.SUPABASE_URL; if (!saved.k) delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});

test("the no-new-bytes proof: a bucket that grew fails, shrinking passes, an incomplete snapshot is refused", async () => {
  const before = await storageSnapshot(fakeIo({ storage: () => 10 }));
  assert.deepEqual(Object.keys(before.buckets).sort(), [...BUCKETS].sort());
  assert.equal(compareSnapshots(before, await storageSnapshot(fakeIo({ storage: () => 10 }))).ok, true);
  assert.equal(compareSnapshots(before, await storageSnapshot(fakeIo({ storage: () => 4 }))).ok, true);
  const grown = compareSnapshots(before, await storageSnapshot(fakeIo({ storage: (b) => (b === "purchase-request-images" ? 11 : 10) })));
  assert.deepEqual(grown, { ok: false, grown: [{ bucket: "purchase-request-images", before: 10, after: 11 }] });
  assert.throws(() => compareSnapshots(before, { buckets: {} }), /missing bucket/);
});
