import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { judge, verify } from "./media-r2-verify.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const bytes = new Uint8Array([1, 2, 3]);
const row = (key, over = {}) => ({ namespace: "avatar", object_key: key, storage_key: `o/${key}`, size_bytes: 3, sha256: sha(bytes), ...over });

function io(rows, objects) {
  const calls = { head: 0, body: 0 };
  return { calls,
    rows: async () => rows,
    head: async (k) => { calls.head++; return objects.has(k) ? { size: objects.get(k).length } : null; },
    body: async (k) => { calls.body++; return objects.get(k) ?? null; } };
}

test("judge: missing, size and hash mismatch, ok", () => {
  assert.equal(judge(row("a"), null, null), "missing");
  assert.equal(judge(row("a"), { size: 4 }, null), "sizeMismatch");
  assert.equal(judge(row("a"), { size: 3 }, new Uint8Array([9, 9, 9])), "hashMismatch");
  assert.equal(judge(row("a"), { size: 3 }, bytes), "ok");
  assert.equal(judge(row("a"), { size: 3 }, null), "ok");
});

test("size-only run counts ok, missing and mismatches without downloading bodies", async () => {
  const w = io([row("a"), row("b"), row("c")], new Map([["o/a", bytes], ["o/c", new Uint8Array([1, 2])]]));
  const r = await verify(w);
  assert.deepEqual([r.checked, r.ok, r.missing, r.sizeMismatch], [3, 1, 1, 1]);
  assert.equal(w.calls.body, 0);
});

test("--deep downloads present objects and compares sha256", async () => {
  const w = io([row("a"), row("b")], new Map([["o/a", bytes], ["o/b", new Uint8Array([7, 7, 7])]]));
  const r = await verify(w, { deep: true });
  assert.deepEqual([r.ok, r.hashMismatch], [1, 1]);
  assert.equal(w.calls.body, 2);
});

test("rows without a storage key are counted, not checked", async () => {
  const r = await verify(io([row("a", { storage_key: null })], new Map()));
  assert.deepEqual([r.checked, r.noKey], [0, 1]);
});
