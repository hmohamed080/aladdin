import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ResetOperatorError } from "./media-reset.mjs";
import { assertExecutable, confirmationPhrase, ENABLE_ENV, main, migrateEvidence, planSha256, readInventory, signatureMatches, summarizePlan, verifyOnR2 } from "./bv-evidence-migrate.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const pdf = (text) => Buffer.from(`%PDF-1.4 ${text}`);
const journal = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bv-")), "j.jsonl");

function world(docs) {
  const supabase = new Map(), r2 = new Map(), db = [];
  docs.forEach((d, i) => {
    const bytes = d.bytes ?? pdf(`doc${i}`);
    const row = { object_key: `org/doc${i}.pdf`, organization_id: "org", owner_user_id: "u", content_type: d.type ?? "application/pdf", size_bytes: d.size ?? bytes.length,
      storage_key: `o/org/verification/doc${i}/original.pdf`, supabase_object_present: !d.missing, adopted: Boolean(d.adopted), location_sha256: d.adopted ? sha(bytes) : null };
    db.push(row);
    if (!d.missing) supabase.set(row.object_key, bytes);
    if (d.adopted) r2.set(row.storage_key, bytes);
  });
  const calls = [];
  return {
    supabase, r2, db, calls,
    async rpc(name, args) {
      calls.push(name);
      if (name === "bv_evidence_adoption_inventory") return db.filter((r) => args.p_after == null || r.object_key > args.p_after).slice(0, args.p_limit);
      if (name === "bv_evidence_adoption_verify") return { ok: db.every((r) => r.adopted && r.supabase_object_present), submitted: db.length };
      if (name === "bv_evidence_adopt") {
        const r = db.find((x) => x.object_key === args.p_key);
        if (!r || args.p_size !== r.size_bytes) { const e = new Error("refused"); e.code = "40001"; throw e; }
        r.adopted = true; r.location_sha256 = args.p_sha256; return true;
      }
      throw new Error(`unexpected ${name}`);
    },
    async download(key) { return supabase.get(key) ?? null; },
    async r2Put(key, bytes) { if (r2.has(key)) return "exists"; r2.set(key, bytes); return "created"; },
    async r2Get(key) { return r2.get(key) ?? null; },
  };
}

test("file signatures are checked per recorded type", () => {
  assert.ok(signatureMatches("application/pdf", pdf("x")));
  assert.ok(!signatureMatches("application/pdf", Buffer.from("<html>")));
  assert.ok(signatureMatches("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])));
  assert.ok(signatureMatches("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(signatureMatches("image/webp", Buffer.from("RIFF1234WEBPVP8 ")));
  assert.ok(!signatureMatches("text/plain", Buffer.from("x")));
});

test("execution is disabled by default and every gate is required", () => {
  const good = { enabled: "true", project: "acc", approvedSha: "a".repeat(64), currentSha: "a".repeat(64), confirm: confirmationPhrase("acc"), journalPath: "j" };
  assert.equal(ENABLE_ENV, "BV_EVIDENCE_MIGRATE_ENABLED");
  assert.doesNotThrow(() => assertExecutable(good));
  assert.throws(() => assertExecutable({ ...good, enabled: undefined }), /disabled/);
  assert.throws(() => assertExecutable({ ...good, approvedSha: "x" }), /approved/);
  assert.throws(() => assertExecutable({ ...good, currentSha: "b".repeat(64) }), /changed since/);
  assert.throws(() => assertExecutable({ ...good, confirm: "yes" }), /confirmation/);
  assert.throws(() => assertExecutable({ ...good, journalPath: "" }), /--journal/);
});

test("inventory is complete or fails closed; the plan hash covers every document", async () => {
  const w = world([{}, {}, {}]);
  const rows = await readInventory(w);
  assert.equal(rows.length, 3);
  assert.equal(summarizePlan(rows).toCopy, 3);
  const a = planSha256(rows);
  w.db[0].size_bytes += 1;
  assert.notEqual(planSha256(await readInventory(w)), a);
  const truncated = world([{}, {}]);
  const orig = truncated.rpc.bind(truncated);
  truncated.rpc = async (name, args) => (name === "bv_evidence_adoption_inventory" ? (await orig(name, args)).filter((r) => r.object_key !== "org/doc1.pdf") : orig(name, args));
  await assert.rejects(readInventory(truncated), /does not cover every submitted document/);
});

test("copies, verifies and adopts; keeps the Supabase copy; journal has no names", async () => {
  const w = world([{}, {}]);
  const rows = await readInventory(w);
  const j = journal();
  const result = await migrateEvidence(w, rows, { journalPath: j, project: "acc", planSha: planSha256(rows) });
  assert.equal(result.ok, true); assert.equal(result.copied, 2);
  assert.equal(w.supabase.size, 2, "nothing is removed from Supabase");
  assert.deepEqual([...w.r2.values()].map(sha).sort(), [...w.supabase.values()].map(sha).sort());
  assert.ok(!fs.readFileSync(j, "utf8").includes("doc0"));
  const proof = await verifyOnR2(w, await readInventory(w));
  assert.deepEqual(proof, { checked: 2, mismatched: 0, missing: 0, ok: true });
});

test("resume skips adopted documents and never rewrites an R2 object", async () => {
  const w = world([{ adopted: true }, {}]);
  const rows = await readInventory(w);
  const before = new Map(w.r2);
  const result = await migrateEvidence(w, rows, { journalPath: journal(), project: "acc", planSha: planSha256(rows) });
  assert.equal(result.copied, 1); assert.equal(result.skipped, 1);
  for (const [k, v] of before) assert.equal(w.r2.get(k), v);
});

test("fail-stop: size, signature, missing source, differing R2 object and refused adoption each stop the run without adopting", async () => {
  const cases = [
    [{ size: 5 }, /size differs/], [{ bytes: Buffer.from("<html>not a pdf</html>") }, /signature/], [{ missing: true }, /missing/],
  ];
  for (const [doc, pattern] of cases) {
    const w = world([doc, {}]);
    const rows = await readInventory(w); const j = journal();
    const result = await migrateEvidence(w, rows, { journalPath: j, project: "acc", planSha: planSha256(rows) });
    assert.equal(result.ok, false, String(pattern)); assert.equal(result.failed, 1);
    assert.equal(w.db.filter((r) => r.adopted).length, 0, "the second document is not attempted after a failure");
    assert.match(fs.readFileSync(j, "utf8"), /"event":"fail"/);
  }
  const existing = world([{}]);
  existing.r2.set(existing.db[0].storage_key, pdf("DIFFERENT"));
  const rows = await readInventory(existing);
  const result = await migrateEvidence(existing, rows, { journalPath: journal(), project: "acc", planSha: planSha256(rows) });
  assert.equal(result.ok, false);
  assert.equal(existing.r2.get(existing.db[0].storage_key).toString(), pdf("DIFFERENT").toString(), "an existing object is never overwritten");
  const readBack = world([{}]);
  readBack.r2Get = async () => pdf("corrupted");
  const rows2 = await readInventory(readBack);
  assert.equal((await migrateEvidence(readBack, rows2, { journalPath: journal(), project: "acc", planSha: planSha256(rows2) })).ok, false);
  assert.equal(readBack.db[0].adopted, false);
});

test("verify detects an R2 copy that no longer matches the recorded checksum", async () => {
  const w = world([{ adopted: true }, { adopted: true }]);
  w.r2.set(w.db[0].storage_key, pdf("tampered"));
  const proof = await verifyOnR2(w, await readInventory(w));
  assert.equal(proof.ok, false); assert.equal(proof.mismatched, 1);
});

test("a journal from another project or plan is refused", async () => {
  const w = world([{}]);
  const rows = await readInventory(w); const j = journal();
  await migrateEvidence(w, rows, { journalPath: j, project: "acc", planSha: planSha256(rows) });
  await assert.rejects(migrateEvidence(w, rows, { journalPath: j, project: "prod", planSha: planSha256(rows) }), /different project/);
  await assert.rejects(migrateEvidence(w, rows, { journalPath: j, project: "acc", planSha: "c".repeat(64) }), /different manifest/);
});

test("main refuses before any client is built when execution is disabled or the command is unknown", async () => {
  await assert.rejects(main(["execute", "--project", "acc"], {}), /disabled/);
  await assert.rejects(main(["bogus"], {}), ResetOperatorError);
  await assert.rejects(main(["plan", "--project", "x"], {}), /required/);
});
