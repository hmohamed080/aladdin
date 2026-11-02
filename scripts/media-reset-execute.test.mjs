import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BUCKETS, ResetOperatorError } from "./media-reset.mjs";
import { assertExecutable, confirmationPhrase, ENABLE_ENV, executeStorageDeletion, main, planStorageDeletion, readJournal } from "./media-reset-execute.mjs";

const SHA = "a".repeat(64);
const good = { enabled: "true", project: "acc", approvedSha: SHA, currentSha: SHA, confirm: confirmationPhrase("acc"), before: { buckets: {} }, journalPath: "j" };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reset-")), "journal.jsonl");

function fakeIo(objects, evidence = []) {
  const store = Object.fromEntries(BUCKETS.map((b) => [b, new Set(objects[b] ?? [])]));
  const calls = [];
  return {
    store, calls,
    listObjects: async (b) => [...store[b]],
    submittedVerificationKeys: async () => evidence,
    removeObjects: async (b, names) => { calls.push([b, names]); names.forEach((n) => store[b].delete(n)); },
    remaining: async (b, names) => names.filter((n) => store[b].has(n)).length,
  };
}

test("execution is disabled by default", () => {
  assert.throws(() => assertExecutable({ ...good, enabled: undefined }), /disabled/);
  assert.throws(() => assertExecutable({ ...good, enabled: "1" }), /disabled/);
  assert.equal(ENABLE_ENV, "MEDIA_RESET_EXECUTE_ENABLED");
});

test("every gate is required", () => {
  assert.doesNotThrow(() => assertExecutable(good));
  assert.throws(() => assertExecutable({ ...good, project: "" }), /--project/);
  assert.throws(() => assertExecutable({ ...good, approvedSha: "xyz" }), /approved/);
  assert.throws(() => assertExecutable({ ...good, confirm: "yes" }), /confirmation/);
  assert.throws(() => assertExecutable({ ...good, before: null }), /--before/);
  assert.throws(() => assertExecutable({ ...good, journalPath: "" }), /--journal/);
});

test("a changed inventory (file uploaded after approval) stops the run", () => {
  assert.throws(() => assertExecutable({ ...good, currentSha: "b".repeat(64) }), /changed since it was approved/);
});

test("submitted verification evidence is never planned or removed", async () => {
  const io = fakeIo({ avatars: ["a1", "a2"], "business-verification-documents": ["doc-submitted", "doc-draft"] }, ["doc-submitted"]);
  const plan = await planStorageDeletion(io);
  assert.equal(plan.summary.retainedVerificationEvidence, 1);
  assert.deepEqual(plan.buckets["business-verification-documents"], ["doc-draft"]);
  const journalPath = tmp();
  const result = await executeStorageDeletion(io, plan, { journalPath });
  assert.equal(result.failed, 0);
  assert.equal(io.store["business-verification-documents"].has("doc-submitted"), true);
  assert.equal(io.store.avatars.size, 0);
});

test("a batch containing retained evidence is refused whatever produced it", async () => {
  const io = fakeIo({ "business-verification-documents": ["doc-submitted"] }, ["doc-submitted"]);
  const plan = await planStorageDeletion(io);
  plan.buckets["business-verification-documents"] = ["doc-submitted"];
  const result = await executeStorageDeletion(io, plan, { journalPath: tmp() });
  assert.equal(result.failed, 1);
  assert.equal(io.calls.length, 0);
  assert.equal(io.store["business-verification-documents"].size, 1);
});

test("journal records counts and hashes only, never names", async () => {
  const io = fakeIo({ avatars: ["secret-owner-id/secret.png"] });
  const journalPath = tmp();
  await executeStorageDeletion(io, await planStorageDeletion(io), { journalPath });
  const text = fs.readFileSync(journalPath, "utf8");
  assert.ok(!text.includes("secret"));
  assert.ok(readJournal(journalPath).some((e) => e.event === "batch" && e.ok && e.count === 1));
});

test("resume skips batches already verified gone", async () => {
  const names = Array.from({ length: 5 }, (_, i) => `n${i}`);
  const journalPath = tmp();
  const first = fakeIo({ avatars: names });
  const plan = await planStorageDeletion(first);
  await executeStorageDeletion(first, plan, { journalPath, batchSize: 2, limit: 2 });
  assert.equal(first.store.avatars.size, 3);
  const second = fakeIo({ avatars: names.slice(2) });
  const plan2 = { ...plan, buckets: { ...plan.buckets, avatars: names } };
  const result = await executeStorageDeletion(second, plan2, { journalPath, batchSize: 2 });
  assert.equal(result.skipped, 2);
  assert.equal(second.store.avatars.size, 0);
});

test("fail-stop: a batch not confirmed gone stops the run non-zero", async () => {
  const io = fakeIo({ avatars: ["a", "b", "c"], "product-images": ["p"] });
  io.removeObjects = async () => {};
  const result = await executeStorageDeletion(io, await planStorageDeletion(io), { journalPath: tmp(), batchSize: 2 });
  assert.equal(result.failed, 1);
  assert.equal(result.removed, 0);
});

test("a thrown removal stops the run and is journaled without detail", async () => {
  const io = fakeIo({ avatars: ["a"] });
  io.removeObjects = async () => { throw new Error("boom secret"); };
  const journalPath = tmp();
  const result = await executeStorageDeletion(io, await planStorageDeletion(io), { journalPath });
  assert.equal(result.failed, 1);
  assert.ok(!fs.readFileSync(journalPath, "utf8").includes("secret"));
});

test("main: refuses a mismatched project and missing credentials before any client is built", async () => {
  await assert.rejects(main(["plan", "--project", "x"], {}), ResetOperatorError);
  await assert.rejects(main(["plan", "--project", "other"], { SUPABASE_URL: "https://acc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), /does not match/);
  await assert.rejects(main(["bogus"], {}), /Usage/);
});
