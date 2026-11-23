import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConfirmed, classify, PurgeError, runPurge } from "./media-legacy-purge.mjs";

const inv = (namespace, object_key, provider) => ({ namespace, object_key, provider, cursor_key: `${namespace}/${object_key}` });
function io({ objects, inventory = [], verified = [] }) {
  const store = new Map(Object.entries(objects).map(([b, names]) => [b, new Set(names)]));
  const calls = [];
  return {
    calls,
    listBucket: async (b) => [...(store.get(b) ?? [])],
    inventory: async () => inventory,
    r2Verified: async () => new Set(verified),
    remove: async (b, names) => { calls.push([b, names]); names.forEach((n) => store.get(b).delete(n)); },
  };
}

test("retained sources and orphans are deletable; the only copy and unverified R2 rows are protected", () => {
  const r = classify(
    [{ bucket: "avatars", name: "a" }, { bucket: "avatars", name: "orphan" }, { bucket: "avatars", name: "only" }, { bucket: "avatars", name: "unver" }, { bucket: "business-verification-documents", name: "x" }],
    [inv("avatar", "a", "r2"), inv("avatar", "only", "supabase"), inv("avatar", "unver", "r2")], new Set(["avatar/a"]));
  assert.deepEqual([r.retainedSource, r.orphan, r.onlyCopy, r.r2Unverified, r.foreignBucket], [1, 1, 1, 1, 1]);
  assert.deepEqual(r.deletable.avatars.sort(), ["a", "orphan"]);
});

test("dry-run deletes nothing and reports counts", async () => {
  const w = io({ objects: { avatars: ["a", "o"] }, inventory: [inv("avatar", "a", "r2")], verified: ["avatar/a"] });
  const s = await runPurge(w, { project: "p", execute: false });
  assert.equal(w.calls.length, 0);
  assert.deepEqual([s.objects, s.toDelete, s.deleted, s.protected], [2, 2, 0, 0]);
});

test("--execute refuses and deletes nothing when any object is the only copy", async () => {
  const w = io({ objects: { avatars: ["a", "only"] }, inventory: [inv("avatar", "a", "r2"), inv("avatar", "only", "supabase")], verified: ["avatar/a"] });
  await assert.rejects(runPurge(w, { project: "p", execute: true }), PurgeError);
  assert.equal(w.calls.length, 0);
});

test("--execute refuses when an R2 row is unverified", async () => {
  const w = io({ objects: { "professional-portfolio": ["k"] }, inventory: [inv("portfolio", "k", "r2")], verified: [] });
  await assert.rejects(runPurge(w, { project: "p", execute: true }), PurgeError);
  assert.equal(w.calls.length, 0);
});

test("--execute deletes in batches of 100 and reports nothing remaining", async () => {
  const names = Array.from({ length: 230 }, (_, i) => `k${i}`);
  const w = io({ objects: { "product-images": names }, inventory: names.map((n) => inv("product", n, "r2")), verified: names.map((n) => `product/${n}`) });
  const s = await runPurge(w, { project: "p", execute: true });
  assert.deepEqual(w.calls.map(([, n]) => n.length), [100, 100, 30]);
  assert.deepEqual([s.deleted, s.remainingAfter], [230, 0]);
});

test("a bucket outside the five is never touched", async () => {
  const w = io({ objects: { "business-verification-documents": ["x"] } });
  const s = await runPurge(w, { project: "p", execute: true });
  assert.equal(w.calls.length, 0);
  assert.equal(s.objects, 0);
});

test("--execute needs the exact typed confirmation", () => {
  assert.throws(() => assertConfirmed({ project: "p", execute: true, confirm: "yes" }), PurgeError);
  assert.doesNotThrow(() => assertConfirmed({ project: "p", execute: true, confirm: "DELETE LEGACY MEDIA p" }));
  assert.doesNotThrow(() => assertConfirmed({ project: "p", execute: false }));
});
