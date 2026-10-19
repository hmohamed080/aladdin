import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertEgressGuard, buildPlan, foldJournal, JournalWriteFailed, journalTargets, migrateRows, openJournal, OperatorError, parseArgs,
  parseBytes, parseJournal, QuotaExceeded, rehashTargets, rollbackTargets, selectRun,
} from "./media-storage.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const sharp = require("sharp");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = (r, size = 4) => sharp({ create: { width: size, height: size, channels: 3, background: { r, g: 10, b: 10 } } }).png().toBuffer();
const LIMITS = { avatar: 3145728, certificate: 10485760, portfolio: 5242880, product: 5242880, organization: 3145728 };

/** In-memory Supabase (inventory, storage, switch/rollback RPCs) and R2. Records every call. */
async function world(specs) {
  const objects = new Map();
  for (const [i, spec] of specs.entries()) {
    const bytes = spec.bytes ?? new Uint8Array(await png(i * 20 + 5, spec.px ?? 4));
    objects.set(`${spec.ns}/${spec.key}`, { ns: spec.ns, key: spec.key, bytes, provider: spec.provider ?? "supabase",
      sourceExists: spec.sourceExists ?? true, owner: `owner-${i}` });
  }
  const r2 = new Map();
  const ledger = new Map();
  const calls = { inventory: [], metadata: [], download: [], put: [], readback: [], switch: [], rollback: [] };
  const row = (o) => ({ namespace: o.ns, object_key: o.key, owner_user_id: o.owner, content_type: "image/png", provider: o.provider,
    source_exists: o.sourceExists, max_bytes: LIMITS[o.ns], cursor_key: `${o.ns}/${o.key}`, migration_tracked: ledger.has(`${o.ns}/${o.key}`) });
  const id = (r) => `${r.namespace}/${r.object_key}`;
  const io = {
    inventory: async ({ limit, after }) => {
      calls.inventory.push(after);
      return [...objects.values()].map(row).filter((r) => r.cursor_key > after).sort((a, b) => (a.cursor_key < b.cursor_key ? -1 : 1)).slice(0, limit);
    },
    sourceMetadata: async (r) => {
      calls.metadata.push(id(r)); const o = objects.get(id(r));
      return o?.sourceExists ? { size: o.bytes.byteLength, etag: sha(o.bytes).slice(0, 8) } : null;
    },
    sourceBytes: async (r) => { calls.download.push(id(r)); return objects.get(id(r)).bytes; },
    putDestination: async (r, bytes) => {
      calls.put.push(id(r));
      if (r2.has(id(r))) return "exists";
      r2.set(id(r), new Uint8Array(bytes)); return "created";
    },
    destinationBytes: async (r) => { calls.readback.push(id(r)); return r2.get(id(r)) ?? null; },
    switchReference: async (r, verified) => {
      calls.switch.push(id(r));
      assert.equal(verified.sha256, sha(objects.get(id(r)).bytes), "switch only with the source hash");
      objects.get(id(r)).provider = "r2";
      ledger.set(id(r), { sha256: verified.sha256, size: verified.size, rolledBack: false });
    },
    rollbackReference: async (t) => {
      calls.rollback.push(`${t.ns}/${t.key}`);
      const entry = ledger.get(`${t.ns}/${t.key}`);
      if (!entry || entry.sha256 !== t.sha256) throw new Error("no verified legacy migration");
      objects.get(`${t.ns}/${t.key}`).provider = "supabase"; entry.rolledBack = true;
    },
  };
  return { io, objects, r2, ledger, calls };
}

const memoryJournal = (entries = []) => ({ entries, append(entry) { this.entries.push({ v: 1, ...entry }); } });
const run = async (w, journal, opts = {}) => {
  const options = { namespaces: ["avatar", "certificate"], maxBytes: 10_000_000, batchSize: 25, maxBatches: null, ...opts };
  const selection = await selectRun(w.io, foldJournal(journal.entries), options);
  return { selection, result: await migrateRows(selection.selected, w.io, journal, options) };
};
const avatars = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ ns: "avatar", key: `u${i}/a.png`, ...extra }));

test("argument parsing keeps dry-run as the default and demands explicit limits for execution", () => {
  assert.equal(parseArgs(["migrate", "--project", "local"]).execute, false);
  assert.equal(parseBytes("20MB", "x"), 20_000_000);
  assert.equal(parseBytes("0.29GB", "x"), 290_000_000);
  assert.throws(() => parseBytes("lots", "x"), OperatorError);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--max-byte", "1"]), /Unknown option/);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--execute", "--max-bytes", "1MB", "--journal", "j"]), /--namespace/);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--execute", "--namespace", "avatar", "--journal", "j"]), /--max-bytes/);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--execute", "--namespace", "avatar", "--max-bytes", "1MB"]), /--journal/);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--namespace", "avatars"]), /Unknown namespace/);
  assert.throws(() => parseArgs(["migrate", "--project", "local", "--batch-size", "500"]), /--batch-size/);
  assert.throws(() => parseArgs(["rehash", "--project", "local"]), /--journal/);
  assert.throws(() => parseArgs(["migrate"]), /--project/);
  const options = parseArgs(["migrate", "--project", "local", "--namespace", "avatar,certificate", "--max-bytes", "20MB", "--journal", "j", "--execute"]);
  assert.deepEqual(options.namespaces, ["avatar", "certificate"]);
  assert.equal(options.batchSize, 25);
});

test("egress guard refuses without an operator-supplied quota figure and above the safety fraction", () => {
  const base = { plannedBytes: 16_300_000, objects: 147, egressSafetyFraction: 0.5 };
  assert.throws(() => assertEgressGuard({ ...base, remainingEgressBytes: null, required: true }), /--remaining-egress-bytes is required/);
  assert.equal(assertEgressGuard({ ...base, remainingEgressBytes: 290_000_000, required: true }).allowance, 145_000_000);
  // The full copy (273 MB) against 290 MB remaining is refused before anything is read.
  assert.throws(() => assertEgressGuard({ ...base, plannedBytes: 273_100_000, objects: 309, remainingEgressBytes: 290_000_000, required: true }), /exceeds 50%/);
});

test("default dry-run selection reads metadata only and never downloads, writes or switches", async () => {
  const w = await world(avatars(3));
  const selection = await selectRun(w.io, new Map(), { namespaces: ["avatar"], maxBytes: Infinity, batchSize: 25 });
  assert.equal(selection.selected.length, 3);
  assert.deepEqual([w.calls.download, w.calls.put, w.calls.switch], [[], [], []]);
});

test("budget stop: the run stops before a download would exceed --max-bytes", async () => {
  const w = await world(avatars(4));
  const size = w.objects.get("avatar/u0/a.png").bytes.byteLength;
  const all = [...w.objects.values()].reduce((sum, o) => sum + o.bytes.byteLength, 0);
  const { selection, result } = await run(w, memoryJournal(), { namespaces: ["avatar"], maxBytes: all - 1 });
  assert.equal(selection.stop, "budget");
  assert.equal(result.switched, 3);
  assert.equal(w.calls.download.length, 3);
  assert.ok(result.downloadedBytes <= all - 1);
  // An object larger than the whole budget is never downloaded.
  const tiny = await world(avatars(1));
  const stopped = await run(tiny, memoryJournal(), { namespaces: ["avatar"], maxBytes: size - 1 });
  assert.equal(stopped.selection.stop, "budget");
  assert.deepEqual(tiny.calls.download, []);
});

test("namespace filter: other namespaces are never inventoried past their prefix, sized or downloaded", async () => {
  const w = await world([...avatars(2), { ns: "certificate", key: "c/1.png" }, { ns: "portfolio", key: "p/1.png" }, { ns: "portfolio", key: "p/2.png" }]);
  const { result } = await run(w, memoryJournal(), { namespaces: ["avatar", "certificate"] });
  assert.equal(result.switched, 3);
  assert.deepEqual(w.calls.inventory, ["avatar/", "certificate/"]);
  assert.ok(![...w.calls.metadata, ...w.calls.download, ...w.calls.put].some((key) => key.startsWith("portfolio/")));
  assert.equal(w.objects.get("portfolio/p/1.png").provider, "supabase");
});

test("hash mismatch on read-back leaves the reference on Supabase, is journaled, and the batch continues", async () => {
  const w = await world(avatars(2));
  const original = w.io.destinationBytes;
  w.io.destinationBytes = async (r) => (r.object_key === "u0/a.png" ? new Uint8Array([1, 2, 3]) : original(r));
  const journal = memoryJournal();
  const { result } = await run(w, journal, { namespaces: ["avatar"] });
  assert.equal(result.mismatches, 1);
  assert.equal(result.switched, 1);
  assert.equal(w.objects.get("avatar/u0/a.png").provider, "supabase");
  assert.ok(!w.calls.switch.includes("avatar/u0/a.png"));
  assert.ok(journal.entries.some((e) => e.key === "u0/a.png" && e.step === "readback" && e.ok === false));
});

test("never overwrites: a different object already at the key is a conflict; an identical one is reused", async () => {
  const w = await world(avatars(2));
  const foreign = new Uint8Array(await png(250));
  w.r2.set("avatar/u0/a.png", foreign);
  w.r2.set("avatar/u1/a.png", new Uint8Array(w.objects.get("avatar/u1/a.png").bytes));
  const journal = memoryJournal();
  const { result } = await run(w, journal, { namespaces: ["avatar"] });
  assert.equal(result.conflicts, 1);
  assert.equal(result.switched, 1);
  assert.equal(result.copied, 0);
  assert.equal(sha(w.r2.get("avatar/u0/a.png")), sha(foreign), "existing R2 object untouched");
  assert.equal(w.objects.get("avatar/u0/a.png").provider, "supabase");
  assert.deepEqual(journal.entries.filter((e) => e.step === "put").map((e) => e.result), ["conflict", "exists_same"]);
});

test("resume after a crash mid-batch: completed rows skip, the copied-but-unswitched row switches without a new download", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-journal-"));
  const file = path.join(dir, "run.jsonl");
  const w = await world(avatars(3));
  const journal = openJournal(file);
  const append = journal.append.bind(journal);
  // The process dies right after row 2's R2 put is journaled (before read-back and switch).
  journal.append = (entry) => { append(entry); if (entry.key === "u1/a.png" && entry.step === "put") throw new Error("SIGKILL"); };
  await assert.rejects(run(w, journal, { namespaces: ["avatar"] }), JournalWriteFailed);
  journal.close();
  fs.appendFileSync(file, '{"v":1,"op":"migrate","ns":"avatar","key":"u2/a.p'); // torn final line
  assert.equal(w.objects.get("avatar/u0/a.png").provider, "r2");
  assert.equal(w.objects.get("avatar/u1/a.png").provider, "supabase");
  assert.deepEqual(w.calls.download, ["avatar/u0/a.png", "avatar/u1/a.png"]);

  const resumed = openJournal(file);
  assert.equal(resumed.torn, 1);
  const { selection, result } = await run(w, resumed, { namespaces: ["avatar"] });
  resumed.close();
  assert.equal(selection.counts.onR2, 1);
  assert.equal(result.resumedWithoutDownload, 1);
  assert.equal(result.switched, 2);
  assert.deepEqual(w.calls.download, ["avatar/u0/a.png", "avatar/u1/a.png", "avatar/u2/a.png"], "row 2 is not downloaded twice");
  assert.ok([...w.objects.values()].every((o) => o.provider === "r2"));
  const { entries } = parseJournal(fs.readFileSync(file, "utf8"));
  assert.equal(entries.filter((e) => e.step === "switch").length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a held journal lock refuses a concurrent run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-journal-"));
  const journal = openJournal(path.join(dir, "j.jsonl"));
  assert.throws(() => openJournal(path.join(dir, "j.jsonl")), /locked/);
  journal.close();
  openJournal(path.join(dir, "j.jsonl")).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("idempotent rerun: a finished namespace performs no download, put or switch", async () => {
  const w = await world(avatars(3));
  const journal = memoryJournal();
  await run(w, journal, { namespaces: ["avatar"] });
  const before = { ...w.calls, download: [...w.calls.download], put: [...w.calls.put], switch: [...w.calls.switch] };
  const { selection, result } = await run(w, journal, { namespaces: ["avatar"] });
  assert.equal(selection.selected.length, 0);
  assert.equal(result.switched, 0);
  assert.deepEqual([w.calls.download, w.calls.put, w.calls.switch], [before.download, before.put, before.switch]);
});

test("missing sources and invalid bytes are never switched", async () => {
  const w = await world([{ ns: "avatar", key: "gone.png", sourceExists: false }, { ns: "avatar", key: "junk.png", bytes: new Uint8Array([9, 9, 9]) }]);
  const { selection, result } = await run(w, memoryJournal(), { namespaces: ["avatar"] });
  assert.equal(selection.counts.missingSource, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual([w.calls.put, w.calls.switch], [[], []]);
});

test("Supabase HTTP 402 aborts the whole run immediately", async () => {
  const w = await world(avatars(3));
  w.io.sourceBytes = async (r) => { w.calls.download.push(r.object_key); throw new QuotaExceeded(); };
  const journal = memoryJournal();
  await assert.rejects(run(w, journal, { namespaces: ["avatar"] }), QuotaExceeded);
  assert.equal(w.calls.download.length, 1);
  assert.equal(journal.entries.at(-1).reason, "quota_402");
});

test("rollback per journal namespace or key uses media_migration_rollback and deletes nothing", async () => {
  const w = await world([...avatars(2), { ns: "certificate", key: "c/1.png" }]);
  const journal = memoryJournal();
  await run(w, journal);
  const r2Before = new Map(w.r2);
  const state = () => foldJournal(journal.entries);
  const dry = await rollbackTargets(journalTargets(state(), { namespaces: ["avatar"], which: "rollback" }), w.io, journal, { execute: false });
  assert.deepEqual([dry.targets, dry.rolledBack, w.calls.rollback.length], [2, 0, 0]);
  const single = await rollbackTargets(journalTargets(state(), { key: "certificate/c/1.png", which: "rollback" }), w.io, journal, { execute: true });
  assert.equal(single.rolledBack, 1);
  w.objects.get("avatar/u1/a.png").sourceExists = false; // a source that vanished is never rolled back to
  const result = await rollbackTargets(journalTargets(state(), { namespaces: ["avatar"], which: "rollback" }), w.io, journal, { execute: true });
  assert.deepEqual([result.rolledBack, result.refused], [1, 1]);
  assert.equal(w.objects.get("avatar/u0/a.png").provider, "supabase");
  assert.equal(w.objects.get("avatar/u1/a.png").provider, "r2");
  assert.deepEqual(new Map(w.r2), r2Before, "R2 copies are kept for a later retry");
  assert.ok([...w.objects.values()].every((o) => o.bytes.byteLength > 0), "Supabase sources untouched");
  // Rolled-back rows are not silently re-migrated by the next run.
  const again = await run(w, journal);
  assert.equal(again.selection.counts.rolledBack, 2);
  assert.equal(again.result.switched, 0);
});

test("rehash re-reads R2 and flags a copy that no longer matches the journal", async () => {
  const w = await world(avatars(2));
  const journal = memoryJournal();
  await run(w, journal, { namespaces: ["avatar"] });
  const targets = () => journalTargets(foldJournal(journal.entries), { namespaces: ["avatar"], which: "rehash" });
  assert.deepEqual(await rehashTargets(targets(), w.io, journal), { targets: 2, ok: 2, mismatches: 0, missing: 0 });
  w.r2.set("avatar/u0/a.png", new Uint8Array(await png(99)));
  w.r2.delete("avatar/u1/a.png");
  assert.deepEqual(await rehashTargets(targets(), w.io, journal), { targets: 2, ok: 0, mismatches: 1, missing: 1 });
  assert.deepEqual(w.calls.download.length, 2, "rehash never reads Supabase");
});

test("plan reports counts, bytes, batches and egress per namespace without downloading", async () => {
  const w = await world([...avatars(30), { ns: "certificate", key: "c/1.png" }, { ns: "avatar", key: "zz.png", provider: "r2" }]);
  const plan = await buildPlan(w.io, new Map(), { namespaces: ["avatar", "certificate"], batchSize: 25, maxBytes: 1000 });
  assert.equal(plan.perNamespace.avatar.toCopy, 30);
  assert.equal(plan.perNamespace.avatar.onR2, 1);
  assert.equal(plan.perNamespace.avatar.batches, 2);
  assert.equal(plan.perNamespace.certificate.batches, 1);
  const bytes = [...w.objects.values()].filter((o) => o.provider === "supabase").reduce((s, o) => s + o.bytes.byteLength, 0);
  assert.equal(plan.total.bytesToCopy, bytes);
  assert.ok(plan.total.estimatedEgressBytes > bytes);
  assert.ok(plan.runsAtMaxBytes >= Math.ceil(bytes / 1000));
  assert.deepEqual(w.calls.download, []);
});
