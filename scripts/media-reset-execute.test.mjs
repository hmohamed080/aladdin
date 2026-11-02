import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BUCKETS, ResetOperatorError } from "./media-reset.mjs";
import { assertBeforeSnapshot, assertExecutable, confirmationPhrase, ENABLE_ENV, executeReset, main, planBatches, readJournal, startedKeys } from "./media-reset-execute.mjs";
import { collectManifest, diffManifests, entriesSha256, loadManifest, summarize, validateManifest, writeManifest } from "./media-reset-manifest.mjs";

const NS = { avatars: "avatar", "professional-portfolio": "portfolio", "professional-certificates": "certificate", "product-images": "product",
  "organization-images": "organization", "purchase-request-images": "request", "business-verification-documents": "verification" };
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "reset-"));
const cmp = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * A small model of the database side (legacy-media-reset.sql): same decisions, same refusals. The SQL itself is proven against a real
 * Postgres in CI; this lets the executor and manifest logic be tested end to end, including races.
 */
class FakeDb {
  constructor() {
    this.objects = Object.fromEntries(BUCKETS.map((b) => [b, []]));   // {name,id,size,etag,updatedAt}
    this.rows = [];        // {ns,key,id,state,submitted,r2}
    this.pointers = 0;     // pointers that still reference a legacy row
    this.journal = new Map(); // `${ns}\0${key}` -> {kind,removed,purged}
    this.locations = [];   // stale supabase locations {ns,key}
    this.counter = 0; this.calls = []; this.truncate = false; this.pageCap = Infinity;
  }
  addObject(bucket, name, { row = true, submitted = false, r2 = false } = {}) {
    this.objects[bucket].push({ name, id: `id-${++this.counter}`, size: 10, etag: `e-${this.counter}`, updatedAt: "2026-11-01T00:00:00Z" });
    if (row) this.rows.push({ ns: NS[bucket], key: name, id: `row-${this.counter}`, state: "ready", submitted, r2 });
    else if (r2) this.rows.push({ ns: NS[bucket], key: name, id: null, state: null, submitted: false, r2 });
  }
  find(bucket, name) { return this.objects[bucket].find((o) => o.name === name); }
  rowOf(ns, key) { return this.rows.find((r) => r.ns === ns && r.key === key && r.id); }
  decide(bucket, o) {
    const ns = NS[bucket]; const r = this.rowOf(ns, o.name);
    const row = r ?? null;
    const base = { name: o.name, object_id: o.id, size_bytes: o.size, etag: o.etag, updated_at: o.updatedAt, namespace: ns, row_id: row?.id ?? null, row_state: row?.state ?? null, referenced: false, submitted: Boolean(row?.submitted), r2: this.rows.some((x) => x.ns === ns && x.key === o.name && x.r2), bucket };
    if (ns === "verification" && (!row || row.submitted)) return { ...base, decision: "retain", reason: row ? "submitted-verification-evidence" : "unreferenced-verification-object" };
    if (this.rows.some((x) => x.ns === ns && x.key === o.name && x.r2)) return { ...base, decision: "retain", reason: "r2-located" };
    return { ...base, decision: "delete", reason: row ? "legacy-row" : "orphan-object" };
  }
  rowsWithoutObject() {
    return this.rows.filter((r) => r.id && !this.find(Object.keys(NS).find((b) => NS[b] === r.ns), r.key) && (r.submitted || !r.r2)).sort((a, b) => cmp(a.ns, b.ns) || cmp(a.key, b.key));
  }
  async rpc(name, a) {
    this.calls.push(name);
    switch (name) {
      case "media_reset_manifest_counts": {
        const counts = { objects: Object.fromEntries(BUCKETS.map((b) => [b, this.objects[b].length])), rows: this.rowsWithoutObject().length, locations: this.locations.length,
          submitted_verification_rows: this.rows.filter((r) => r.submitted).length };
        if (this.truncate) counts.objects.avatars += 1; // the database says more than the read returned
        return counts;
      }
      case "media_reset_manifest_objects": {
        const all = [...this.objects[a.p_bucket]].sort((x, y) => cmp(x.name, y.name)).filter((o) => a.p_after == null || cmp(o.name, a.p_after) > 0);
        return all.slice(0, Math.min(a.p_limit, this.pageCap)).map((o) => this.decide(a.p_bucket, o));
      }
      case "media_reset_manifest_rows": {
        const after = a.p_after_namespace == null ? null : `${a.p_after_namespace}\0${a.p_after_key}`;
        return this.rowsWithoutObject().filter((r) => after == null || cmp(`${r.ns}\0${r.key}`, after) > 0).slice(0, a.p_limit).map((r) => ({
          namespace: r.ns, bucket: Object.keys(NS).find((b) => NS[b] === r.ns), object_key: r.key, row_id: r.id, row_state: r.state, referenced: false, submitted: r.submitted,
          decision: r.submitted ? "retain" : "delete", reason: r.submitted ? "submitted-verification-evidence" : "row-without-object" }));
      }
      case "media_reset_manifest_locations": {
        const after = a.p_after_namespace == null ? null : `${a.p_after_namespace}\0${a.p_after_key}`;
        return [...this.locations].sort((x, y) => cmp(`${x.ns}\0${x.key}`, `${y.ns}\0${y.key}`)).filter((l) => after == null || cmp(`${l.ns}\0${l.key}`, after) > 0).slice(0, a.p_limit)
          .map((l) => ({ namespace: l.ns, object_key: l.key, decision: "delete", reason: "stale-supabase-location" }));
      }
      case "media_reset_retire": {
        const stage = [];
        for (const item of a.p_items) {
          if (this.journal.has(`${a.p_namespace}\0${item.key}`)) continue;
          const bucket = Object.keys(NS).find((b) => NS[b] === a.p_namespace);
          const row = this.rowOf(a.p_namespace, item.key); const o = this.find(bucket, item.key);
          const refuse = (code) => { const e = new Error("reset batch refused"); e.code = code; throw e; };
          if (a.p_namespace === "verification" && (!row || row.submitted)) refuse("42501");
          if (this.rows.some((x) => x.ns === a.p_namespace && x.key === item.key && x.r2)) refuse("42501");
          if (item.kind === "object" ? (!o || o.id !== item.object_id || o.etag !== item.etag) : (o || !row)) refuse("40001");
          stage.push(item);
        }
        for (const item of stage) { // all or nothing: nothing is applied unless every item passed
          const row = this.rowOf(a.p_namespace, item.key);
          if (row) row.state = "deleted";
          this.journal.set(`${a.p_namespace}\0${item.key}`, { kind: item.kind, removed: item.kind === "row", purged: false });
        }
        return a.p_items.length;
      }
      case "media_reset_storage_removed": {
        const bucket = Object.keys(NS).find((b) => NS[b] === a.p_namespace);
        if (this.find(bucket, a.p_key)) return false;
        this.journal.get(`${a.p_namespace}\0${a.p_key}`).removed = true; return true;
      }
      case "media_reset_finalize": {
        let n = 0;
        for (const [k, j] of this.journal) {
          if (!j.removed || j.purged) continue;
          const [ns, key] = k.split("\0");
          this.rows = this.rows.filter((r) => !(r.ns === ns && r.key === key && r.state === "deleted"));
          j.purged = true; n++;
        }
        return n;
      }
      case "media_reset_drop_locations": {
        let n = 0;
        for (const i of a.p_items) { const idx = this.locations.findIndex((l) => l.ns === i.namespace && l.key === i.key); if (idx >= 0) { this.locations.splice(idx, 1); n++; } }
        return n;
      }
      case "media_reset_verify": {
        const legacyRows = this.rows.filter((r) => r.id && !r.submitted && !r.r2).length;
        const legacyObjects = BUCKETS.reduce((n, b) => n + this.objects[b].filter((o) => this.decide(b, o).decision === "delete").length, 0);
        const unpurged = [...this.journal.values()].filter((j) => !j.purged).length;
        return { ok: !this.pointers && !legacyRows && !legacyObjects && !this.locations.length && !unpurged, broken_pointers: { profiles_avatar: this.pointers }, legacy_rows_left: legacyRows, legacy_objects_left: legacyObjects };
      }
      default: throw new Error(`unexpected rpc ${name}`);
    }
  }
  async removeObjects(bucket, names) { this.objects[bucket] = this.objects[bucket].filter((o) => !names.includes(o.name)); }
}

function seeded() {
  const db = new FakeDb();
  for (let i = 0; i < 5; i++) db.addObject("avatars", `secret-a${i}.png`);
  db.addObject("avatars", "orphan-secret.png", { row: false });
  db.addObject("avatars", "r2-secret.png", { r2: true });
  db.addObject("professional-portfolio", "secret-p1.jpg");
  db.addObject("business-verification-documents", "draft-secret.pdf");
  db.addObject("business-verification-documents", "submitted-secret.pdf", { submitted: true });
  db.addObject("business-verification-documents", "norow-secret.pdf", { row: false });
  db.rows.push({ ns: "avatar", key: "ghost-secret.png", id: "row-ghost", state: "ready", submitted: false, r2: false }); // row without object
  db.locations.push({ ns: "avatar", key: "stale-secret.png" });
  return db;
}
const goodArgs = async (db, project = "acc") => {
  const manifest = await collectManifest(db, project);
  const before = { project, buckets: Object.fromEntries(BUCKETS.map((b) => [b, db.objects[b].length])) };
  return { manifest, before, approvedSha: entriesSha256(manifest.entries) };
};
const gate = (manifest, before, approvedSha, over = {}) => ({ enabled: "true", project: "acc", approvedSha, manifest, diff: { stale: false }, confirm: confirmationPhrase("acc"), before, journalPath: "j", ...over });

test("execution is disabled by default and every gate is required", async () => {
  const { manifest, before, approvedSha } = await goodArgs(seeded());
  assert.equal(ENABLE_ENV, "MEDIA_RESET_EXECUTE_ENABLED");
  assert.doesNotThrow(() => assertExecutable(gate(manifest, before, approvedSha)));
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { enabled: undefined })), /disabled/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { enabled: "1" })), /disabled/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { project: "" })), /--project/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { project: "other", confirm: confirmationPhrase("other") })), /different project/);
  assert.throws(() => assertExecutable(gate(manifest, before, "xyz")), /approved/);
  assert.throws(() => assertExecutable(gate(manifest, before, "b".repeat(64))), /does not match the approved hash/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { confirm: "yes" })), /confirmation/);
  assert.throws(() => assertExecutable(gate(manifest, null, approvedSha)), /--before/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { journalPath: "" })), /--journal/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { diff: { stale: true } })), /changed since it was approved/);
  assert.throws(() => assertExecutable(gate(manifest, before, approvedSha, { diff: undefined })), /comparison with the live inventory/);
});

test("the before-snapshot must belong to the project and agree with the manifest counts", async () => {
  const { manifest, before } = await goodArgs(seeded());
  assert.doesNotThrow(() => assertBeforeSnapshot(before, manifest));
  assert.throws(() => assertBeforeSnapshot({ ...before, project: "prod" }, manifest), /different project/);
  assert.throws(() => assertBeforeSnapshot({ ...before, buckets: { ...before.buckets, avatars: before.buckets.avatars + 1 } }, manifest), /disagrees/);
});

test("manifest: object-level, complete across pages, sorted, with compliance decisions", async () => {
  const db = seeded();
  for (let i = 0; i < 450; i++) db.addObject("product-images", `p-${String(i).padStart(4, "0")}.png`);
  const { manifest } = await goodArgs(db);
  assert.equal(manifest.entries.filter((e) => e.bucket === "product-images").length, 450);
  const by = (name) => manifest.entries.find((e) => e.name === name);
  assert.deepEqual([by("submitted-secret.pdf").decision, by("submitted-secret.pdf").reason], ["retain", "submitted-verification-evidence"]);
  assert.deepEqual([by("norow-secret.pdf").decision, by("norow-secret.pdf").reason], ["retain", "unreferenced-verification-object"]);
  assert.deepEqual([by("r2-secret.png").decision, by("r2-secret.png").reason], ["retain", "r2-located"]);
  assert.deepEqual([by("draft-secret.pdf").decision, by("secret-a0.png").decision, by("orphan-secret.png").reason], ["delete", "delete", "orphan-object"]);
  assert.equal(by("secret-a0.png").etag, db.find("avatars", "secret-a0.png").etag);
  const summary = summarize(manifest);
  assert.equal(summary.sha256, manifest.sha256);
  assert.ok(!JSON.stringify(summary).includes("secret"));
});

test("manifest: a truncated or incomplete read fails closed", async () => {
  const db = seeded();
  db.truncate = true;
  await assert.rejects(collectManifest(db, "acc"), /incomplete/);
  const capped = seeded(); capped.pageCap = 3;       // an API row cap far below the page size must not lose rows
  const full = await collectManifest(capped, "acc");
  assert.equal(full.entries.filter((e) => e.t === "object" && e.bucket === "avatars").length, 7);
  const racing = seeded(); const orig = racing.rpc.bind(racing); let n = 0;
  racing.rpc = async (name, args) => { if (name === "media_reset_manifest_counts" && ++n === 2) racing.addObject("avatars", "late.png"); return orig(name, args); };
  await assert.rejects(collectManifest(racing, "acc"), /changed while/);
});

test("approval is of every entry: a replaced object with the same count changes the hash", async () => {
  const db = seeded();
  const a = await collectManifest(db, "acc");
  const o = db.find("avatars", "secret-a0.png"); o.id = "replaced"; o.etag = "new-etag";
  const b = await collectManifest(db, "acc");
  assert.equal(a.entries.length, b.entries.length);
  assert.notEqual(a.sha256, b.sha256);
  assert.deepEqual(diffManifests(a.entries, b.entries), { stale: true, added: 0, removed: 0, changed: 1 });
  db.rows.find((r) => r.key === "draft-secret.pdf").submitted = true; // a verification status change
  const c = await collectManifest(db, "acc");
  assert.equal(diffManifests(b.entries, c.entries).stale, true);
  assert.equal(diffManifests(a.entries, a.entries).stale, false);
});

test("manifest file: written once, read-only, hash recomputed on load, tampering detected", async () => {
  const { manifest } = await goodArgs(seeded());
  const file = path.join(dir(), "m.json");
  writeManifest(file, manifest);
  assert.equal(fs.statSync(file).mode & 0o777, 0o400);
  assert.throws(() => writeManifest(file, manifest), /EEXIST/);
  assert.equal(loadManifest(file).sha256, manifest.sha256);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.chmodSync(file, 0o600);
  doc.entries.find((e) => e.name === "secret-a0.png").etag = "forged";
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.throws(() => loadManifest(file), /hash does not match/);
  doc.sha256 = entriesSha256(doc.entries); // even with a consistent forged hash, protected entries cannot be turned into deletions
  const sub = doc.entries.find((e) => e.name === "submitted-secret.pdf"); sub.decision = "delete"; sub.reason = "legacy-row";
  doc.sha256 = entriesSha256(doc.entries);
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.throws(() => loadManifest(file), /protected verification evidence|inconsistent|canonical|order/);
});

test("a manifest can never mark submitted evidence, a row-less verification object or an R2 object for deletion", async () => {
  const { manifest } = await goodArgs(seeded());
  for (const [name, reason] of [["submitted-secret.pdf", "legacy-row"], ["norow-secret.pdf", "orphan-object"], ["r2-secret.png", "legacy-row"]]) {
    const copy = structuredClone(manifest);
    const e = copy.entries.find((x) => x.name === name); e.decision = "delete"; e.reason = reason;
    assert.throws(() => validateManifest(copy), ResetOperatorError, name);
  }
});

test("execute: removes exactly the approved legacy files, keeps evidence and R2 files, and proves the post-condition", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  const journalPath = path.join(dir(), "j.jsonl");
  const result = await executeReset(db, manifest, { journalPath });
  assert.equal(result.ok, true);
  assert.equal(result.verified.ok, true);
  assert.deepEqual(db.objects.avatars.map((o) => o.name), ["r2-secret.png"]);
  assert.deepEqual(db.objects["business-verification-documents"].map((o) => o.name).sort(), ["norow-secret.pdf", "submitted-secret.pdf"]);
  assert.equal(db.locations.length, 0);
  assert.ok(!db.rows.some((r) => r.key === "ghost-secret.png"));
  assert.ok(db.rows.some((r) => r.key === "submitted-secret.pdf"));
  const text = fs.readFileSync(journalPath, "utf8");
  assert.ok(!text.includes("secret"), "the journal never carries names");
  assert.equal(readJournal(journalPath, { project: "acc", manifestSha256: manifest.sha256 }).at(-1).event, "verify");
});

test("execute: success is NOT reported while a broken pointer or leftover remains", async () => {
  const db = seeded();
  db.pointers = 1;
  const { manifest } = await goodArgs(db);
  const result = await executeReset(db, manifest, { journalPath: path.join(dir(), "j.jsonl") });
  assert.equal(result.ok, false);
  assert.equal(result.verified.ok, false);
});

test("execute: an object replaced after approval is refused by the database and nothing is removed or journaled as done", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  const o = db.find("avatars", "secret-a0.png"); o.id = "reuploaded"; o.etag = "fresh";
  const before = JSON.stringify(db.objects);
  const journalPath = path.join(dir(), "j.jsonl");
  const result = await executeReset(db, manifest, { journalPath });
  assert.equal(result.ok, false); assert.equal(result.failed, 1);
  assert.equal(JSON.stringify(db.objects), before);
  assert.ok(!readJournal(journalPath).some((e) => e.event === "done"));
});

test("execute: a draft document that becomes submitted evidence after approval is refused and the whole batch rolls back", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  db.rows.find((r) => r.key === "draft-secret.pdf").submitted = true;
  const result = await executeReset(db, manifest, { journalPath: path.join(dir(), "j.jsonl") });
  assert.equal(result.ok, false);
  assert.equal(db.objects["business-verification-documents"].length, 3);
  assert.equal(db.rows.find((r) => r.key === "draft-secret.pdf").state, "ready");
});

test("execute: resumes after a partial run; started batches are exempt from the staleness diff, anything else is not", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  const journalPath = path.join(dir(), "j.jsonl");
  const first = await executeReset(db, manifest, { journalPath, limit: 3, batchSize: 2 });
  assert.equal(first.stopped, true); assert.equal(first.ok, true);
  const journal = readJournal(journalPath, { project: "acc", manifestSha256: manifest.sha256 });
  const live = await collectManifest(db, "acc");
  assert.equal(diffManifests(manifest.entries, live.entries).stale, true, "without the journal the run looks stale");
  assert.equal(diffManifests(manifest.entries, live.entries, startedKeys(manifest, journal, 2)).stale, false, "with it, only started batches are exempt");
  db.addObject("avatars", "new-upload.png");
  const live2 = await collectManifest(db, "acc");
  assert.equal(diffManifests(manifest.entries, live2.entries, startedKeys(manifest, journal, 2)).stale, true, "a new upload still stops a resume");
  db.objects.avatars = db.objects.avatars.filter((o) => o.name !== "new-upload.png"); db.rows = db.rows.filter((r) => r.key !== "new-upload.png");
  const second = await executeReset(db, manifest, { journalPath, batchSize: 2 });
  assert.equal(second.ok, true);
  assert.ok(second.skipped >= 1);
  assert.deepEqual(db.objects.avatars.map((o) => o.name), ["r2-secret.png"]);
});

test("execute: a failed removal stops the run and never reports success", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  db.removeObjects = async () => { throw new Error("boom secret"); };
  const journalPath = path.join(dir(), "j.jsonl");
  const result = await executeReset(db, manifest, { journalPath });
  assert.equal(result.ok, false);
  assert.ok(!fs.readFileSync(journalPath, "utf8").includes("secret"));
  const unconfirmed = seeded();
  const m2 = (await goodArgs(unconfirmed)).manifest;
  unconfirmed.removeObjects = async () => {}; // removal silently does nothing: not confirmed gone
  const r2 = await executeReset(unconfirmed, m2, { journalPath: path.join(dir(), "j2.jsonl") });
  assert.equal(r2.ok, false); assert.equal(r2.removed, 0);
});

test("journal: hash-chained, bound to project and manifest, and any damage is refused", async () => {
  const db = seeded();
  const { manifest } = await goodArgs(db);
  const journalPath = path.join(dir(), "j.jsonl");
  await executeReset(db, manifest, { journalPath, limit: 2, batchSize: 1 });
  assert.doesNotThrow(() => readJournal(journalPath, { project: "acc", manifestSha256: manifest.sha256 }));
  assert.throws(() => readJournal(journalPath, { project: "prod" }), /different project/);
  assert.throws(() => readJournal(journalPath, { manifestSha256: "c".repeat(64) }), /different manifest/);
  const lines = fs.readFileSync(journalPath, "utf8").split("\n").filter(Boolean);
  const tamper = (mutate) => { const p = path.join(dir(), "t.jsonl"); fs.writeFileSync(p, mutate([...lines]).join("\n") + "\n"); return p; };
  assert.throws(() => readJournal(tamper((l) => [l[0], l[1].replace('"event":"begin"', '"event":"done"'), ...l.slice(2)])), /integrity/);
  assert.throws(() => readJournal(tamper((l) => [l[0], ...l.slice(2)])), /integrity/);
  assert.throws(() => readJournal(tamper((l) => [...l, "{not json"])), /damaged/);
  assert.throws(() => readJournal(tamper((l) => { const h = JSON.parse(l[0]); h.project = "prod"; return [JSON.stringify(h), ...l.slice(1)]; })), /integrity/);
});

test("batches are grouped per namespace, objects before rows, locations last; protected entries are never planned", async () => {
  const { manifest } = await goodArgs(seeded());
  const batches = planBatches(manifest, 2);
  const kinds = batches.map((b) => b.kind);
  assert.equal(kinds.at(-1), "location");
  const planned = batches.flatMap((b) => b.items.map((i) => i.key));
  for (const protectedName of ["submitted-secret.pdf", "norow-secret.pdf", "r2-secret.png"]) assert.ok(!planned.includes(protectedName), protectedName);
  assert.ok(batches.every((b) => b.items.length <= 2 && /^[0-9a-f]{64}$/.test(b.sha256)));
});

test("main: refuses a mismatched project, missing credentials and an unknown command before any client is built", async () => {
  await assert.rejects(main(["verify", "--project", "x"], {}), ResetOperatorError);
  await assert.rejects(main(["verify", "--project", "other"], { SUPABASE_URL: "https://acc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), /does not match/);
  await assert.rejects(main(["bogus"], {}), /Usage/);
  await assert.rejects(main(["execute", "--project", "acc", "--manifest", "m.json"], { SUPABASE_URL: "https://acc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), /disabled/);
});
