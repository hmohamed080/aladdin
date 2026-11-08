import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, physicalKey, reconcile, variantKeys, windowReport } from "./r2-reconcile.mjs";

const U = "11111111-1111-1111-1111-111111111111";
const M = "22222222-2222-2222-2222-222222222222";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const idsKey = `u/${U}/profile/${M}/original.jpg`;
const idsRow = { namespace: "avatar", object_key: "a.jpg", storage_key: idsKey, size_bytes: 100, verified_at: hoursAgo(5), cleaned_at: null };
const legacyRow = { namespace: "portfolio", object_key: "p/1.png", storage_key: null, size_bytes: 50, verified_at: hoursAgo(5), cleaned_at: null };
const obj = (key, size = 100, age = 5) => ({ key, size, lastModified: hoursAgo(age) });

test("physical key is the ids-only key when present, else the legacy namespace/object_key", () => {
  assert.equal(physicalKey(idsRow), idsKey);
  assert.equal(physicalKey(legacyRow), "portfolio/p/1.png");
});

test("variants follow each layout", () => {
  assert.deepEqual(variantKeys(idsKey), ["thumb", "card", "full"].map((n) => `u/${U}/profile/${M}/v/${n}.webp`));
  assert.deepEqual(variantKeys("portfolio/p/1.png")[0], "v/portfolio/p/1.png/thumb.webp");
});

test("a clean bucket reconciles: originals, variants and fresh pending are not defects", () => {
  const r = reconcile([idsRow, legacyRow], [obj(idsKey), obj("portfolio/p/1.png", 50), obj(variantKeys(idsKey)[0]), obj(`pending/${idsKey}`, 100, 1)], { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual([r.counts.ok, r.counts.variantsOk, r.counts.pendingFresh, r.counts.missing, r.counts.orphan], [2, 1, 1, 0, 0]);
  assert.deepEqual(r.perNamespace, { avatar: 1, portfolio: 1 });
});

test("a missing original and a size mismatch are blockers; samples are fingerprints, never keys", () => {
  const r = reconcile([idsRow, legacyRow], [obj("portfolio/p/1.png", 49)], { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.blockers, 2);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.counts.sizeMismatch, 1);
  const text = JSON.stringify(r);
  assert.ok(!text.includes(U) && !text.includes("p/1.png"));
  assert.match(r.samples.missing[0], /^[0-9a-f]{10}$/);
});

test("orphans, orphan variants, leftovers of retired rows and stale pending are reported separately", () => {
  const retired = { ...idsRow, cleaned_at: hoursAgo(2) };
  const r = reconcile([retired], [
    obj(idsKey),
    obj(`u/${U}/profile/33333333-3333-3333-3333-333333333333/original.png`),
    obj(`u/${U}/profile/33333333-3333-3333-3333-333333333333/v/thumb.webp`),
    obj(`pending/u/${U}/x/original.png`, 10, 72),
  ], { now: NOW });
  assert.deepEqual([r.counts.retiredLeft, r.counts.orphan, r.counts.orphanVariant, r.counts.stalePending], [1, 1, 1, 1]);
  assert.equal(r.ok, true); // none of these is a blocker; the CLI still exits 1 on orphans unless --allow-orphans
});

test("rows reserved but not yet verified are neither missing nor live", () => {
  const r = reconcile([{ ...idsRow, verified_at: null }], [obj(idsKey)], { now: NOW });
  assert.equal(r.counts.unverified, 1);
  assert.equal(r.counts.live, 0);
  assert.equal(r.counts.missing, 0);
});

test("video and site objects are informational", () => {
  const r = reconcile([], [obj("video/abc/master.m3u8"), obj("site/shared/x/original.mp4")], { now: NOW });
  assert.deepEqual([r.counts.video, r.counts.other, r.counts.orphan], [1, 1, 0]);
});

test("arguments: explicit project, bounded age, unknown options refused", () => {
  assert.throws(() => parseArgs([]), /--project/);
  assert.throws(() => parseArgs(["--project", "x", "--max-age-hours", "0"]), /1\.\.720/);
  assert.throws(() => parseArgs(["--project", "x", "--delete"]), /Unknown option/);
  assert.deepEqual(parseArgs(["--project", "abc", "--allow-orphans"]), { project: "abc", maxAgeHours: 48, json: false, allowOrphans: true, since: null });
  assert.equal(parseArgs(["--project", "abc", "--since", "2026-11-08T10:00:00Z"]).since, "2026-11-08T10:00:00Z");
  assert.throws(() => parseArgs(["--project", "abc", "--since", "yesterday"]), /ISO/);
});

const NS = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"];
const fresh = (namespace, over = {}) => ({ namespace, provider: "r2", created_at: hoursAgo(1), owner_user_id: U, organization_id: null, storage_key: `u/${U}/${namespace}/${M}/original.png`, ...over });

test("window check: seven R2 ids-only flows pass and cover every namespace", () => {
  const r = windowReport(NS.map((n) => fresh(n)), hoursAgo(2));
  assert.deepEqual([r.ok, r.allFlowsCovered, r.newRows], [true, true, 7]);
});

test("window check: a Supabase-provider row, a missing key or a legacy-shaped key is a blocker; old rows are ignored", () => {
  const rows = [...NS.map((n) => fresh(n)), fresh("avatar", { provider: "supabase", storage_key: null }), fresh("product", { storage_key: null }),
    fresh("request", { storage_key: "request/legacy.png" }), fresh("avatar", { created_at: hoursAgo(50), provider: "supabase" })];
  const r = windowReport(rows, hoursAgo(2));
  assert.deepEqual([r.ok, r.supabaseCreated, r.missingStorageKey, r.badKeyShape], [false, 1, 1, 1]);
});

test("window check: reports namespaces whose flow did not run", () => {
  const r = windowReport(NS.slice(0, 5).map((n) => fresh(n)), hoursAgo(2));
  assert.deepEqual(r.uncovered, ["request", "verification"]);
  assert.equal(r.allFlowsCovered, false);
});

test("window check: the id inside the key must be the record's own owner or organization", () => {
  const O = "44444444-4444-4444-4444-444444444444";
  const ok = windowReport([fresh("product", { organization_id: O, storage_key: `o/${O}/products/${M}/${M}/original.png` })], hoursAgo(2));
  assert.equal(ok.ownerMismatch, 0);
  const wrong = windowReport([fresh("avatar", { owner_user_id: "55555555-5555-5555-5555-555555555555" }), fresh("product", { organization_id: null, storage_key: `o/${O}/products/${M}/${M}/original.png` })], hoursAgo(2));
  assert.equal(wrong.ownerMismatch, 2);
  assert.equal(wrong.ok, false);
});
