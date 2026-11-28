import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReport, summarize } from "./usage-report.mjs";

const input = {
  metrics: { providers: [{ provider: "supabase", records: 2, verified_bytes: 300 }, { provider: "r2", records: 1, verified_bytes: 100 }], stale_pending: 0 },
  inventory: [{ bucket: "avatars", source_objects: 3, orphan_objects: 0, missing_references: 0 }],
  locations: [
    { namespace: "avatar", provider: "r2", size_bytes: 100 },
    { namespace: "portfolio", provider: "supabase", size_bytes: 200 },
    { namespace: "portfolio", provider: "supabase", size_bytes: 100 },
  ],
  ledger: [{ size_bytes: 100, rolled_back_at: null }, { size_bytes: 50, rolled_back_at: "2026-10-18T00:00:00Z" }],
};

test("bytes are reported per provider and namespace with no alerts on a healthy project", () => {
  const report = summarize(input);
  assert.deepEqual(report.byNamespace, { avatar: { r2: { records: 1, bytes: 100 } }, portfolio: { supabase: { records: 2, bytes: 300 } } });
  assert.deepEqual(report.migration, { switched: 1, rolledBack: 1, bytes: 100 });
  assert.deepEqual(report.alerts, []);
  assert.match(formatReport("local", report), /No alerts/);
});

test("egress thresholds, stale uploads and missing sources raise alerts", () => {
  const report = summarize({ ...input, metrics: { ...input.metrics, stale_pending: 2 },
    inventory: [{ bucket: "avatars", source_objects: 1, orphan_objects: 0, missing_references: 1 }] },
  { egressUsedBytes: 4_710_000_000, egressQuotaBytes: 5_000_000_000 });
  assert.equal(report.egress.level, 0.8);
  assert.equal(report.egress.remainingBytes, 290_000_000);
  assert.equal(report.alerts.length, 3);
  assert.equal(summarize(input, { egressUsedBytes: 4_800_000_000, egressQuotaBytes: 5_000_000_000 }).egress.level, 0.95);
  assert.equal(summarize(input, { egressUsedBytes: 1_000_000_000, egressQuotaBytes: 5_000_000_000 }).egress.level, null);
});
