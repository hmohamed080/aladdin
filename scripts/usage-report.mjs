import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readMaintenanceEnv } from "../frontend/src/lib/env/media-maintenance.mjs";
import { formatBytes, OperatorError, parseBytes } from "./media-storage.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
/** Supabase egress alert levels as a share of the monthly quota (see docs/operations/media-monitoring.md). */
export const EGRESS_THRESHOLDS = [0.5, 0.8, 0.95];

/**
 * Read-only media usage report. Bytes per provider and namespace come from the database's
 * verified metadata; no object is listed or downloaded. Supabase egress is not readable through
 * any RPC, so the operator passes the Usage-page figure to get an alert level.
 */
export function summarize({ metrics, inventory, locations, ledger }, { egressUsedBytes = null, egressQuotaBytes = null } = {}) {
  const byNamespace = {};
  for (const row of locations) {
    const ns = (byNamespace[row.namespace] ??= {});
    const provider = (ns[row.provider] ??= { records: 0, bytes: 0 });
    provider.records++;
    provider.bytes += Number(row.size_bytes ?? 0);
  }
  const migration = { switched: 0, rolledBack: 0, bytes: 0 };
  for (const row of ledger) {
    if (row.rolled_back_at) migration.rolledBack++;
    else { migration.switched++; migration.bytes += Number(row.size_bytes); }
  }
  const alerts = [];
  if (Number(metrics?.stale_pending) > 0) alerts.push(`stale_pending=${metrics.stale_pending} (uploads pending > 24 h)`);
  for (const bucket of inventory ?? []) {
    if (Number(bucket.missing_references) > 0) alerts.push(`${bucket.bucket}: ${bucket.missing_references} references without a source object`);
  }
  let egress = null;
  if (egressUsedBytes != null && egressQuotaBytes) {
    const share = egressUsedBytes / egressQuotaBytes;
    const level = EGRESS_THRESHOLDS.filter((t) => share >= t).at(-1) ?? null;
    egress = { usedBytes: egressUsedBytes, quotaBytes: egressQuotaBytes, share, remainingBytes: Math.max(egressQuotaBytes - egressUsedBytes, 0), level };
    if (level) alerts.push(`Supabase egress at ${(share * 100).toFixed(1)}% of quota (>= ${level * 100}% threshold)`);
  }
  return { providers: metrics?.providers ?? [], stalePending: Number(metrics?.stale_pending ?? 0), byNamespace, migration,
    sourceInventory: inventory ?? [], egress, alerts };
}

export function formatReport(project, report) {
  const lines = [`Media usage - project ${project}`, "", "provider   records  verified_bytes"];
  for (const p of report.providers) lines.push(`${String(p.provider).padEnd(9)}${String(p.records).padStart(9)}${formatBytes(Number(p.verified_bytes ?? 0)).padStart(16)}`);
  lines.push("", "namespace     provider  records  bytes");
  for (const [ns, providers] of Object.entries(report.byNamespace)) {
    for (const [provider, v] of Object.entries(providers)) lines.push(`${ns.padEnd(14)}${provider.padEnd(9)}${String(v.records).padStart(8)}  ${formatBytes(v.bytes)}`);
  }
  lines.push("", `Migration ledger: ${report.migration.switched} switched (${formatBytes(report.migration.bytes)}), ${report.migration.rolledBack} rolled back`);
  lines.push("", "bucket                       source_objects  orphans  missing_refs");
  for (const b of report.sourceInventory) lines.push(`${b.bucket.padEnd(29)}${String(b.source_objects).padStart(14)}${String(b.orphan_objects).padStart(9)}${String(b.missing_references).padStart(14)}`);
  if (report.egress) lines.push("", `Supabase egress: ${formatBytes(report.egress.usedBytes)} of ${formatBytes(report.egress.quotaBytes)} (${(report.egress.share * 100).toFixed(1)}%), ${formatBytes(report.egress.remainingBytes)} remaining`);
  lines.push("", report.alerts.length ? `ALERTS:\n${report.alerts.map((a) => `  - ${a}`).join("\n")}` : "No alerts.");
  return lines.join("\n");
}

async function selectAll(supabase, table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error, status } = await filter(supabase.from(table).select(columns)).order("object_key").range(from, from + 999);
    if (status === 402) throw new OperatorError("Supabase returned HTTP 402 (quota exceeded)");
    if (error) throw new OperatorError(`${table} query failed; confirm the provider migration is installed`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log("node scripts/usage-report.mjs --project <ref|local> [--egress-used 4.71GB --egress-quota 5GB] [--json]");
    console.log("Read-only. Exit code 2 when an alert threshold is crossed (for schedulers).");
    return;
  }
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (!value("--project")) throw new OperatorError("Explicit --project is required");
  const env = readMaintenanceEnv();
  const url = new URL(env.SUPABASE_URL);
  const project = ["localhost", "127.0.0.1"].includes(url.hostname) ? "local" : url.hostname.split(".")[0];
  if (value("--project") !== project) throw new OperatorError("Requested project does not match configured environment");
  const egressUsedBytes = value("--egress-used") ? parseBytes(value("--egress-used"), "--egress-used") : null;
  const egressQuotaBytes = value("--egress-quota") ? parseBytes(value("--egress-quota"), "--egress-quota") : null;
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (name) => {
    const { data, error, status } = await supabase.rpc(name);
    if (status === 402) throw new OperatorError("Supabase returned HTTP 402 (quota exceeded)");
    if (error) throw new OperatorError(`${name} failed; confirm the provider migration is installed`);
    return data;
  };
  const report = summarize({
    metrics: await rpc("media_storage_metrics"),
    inventory: await rpc("media_source_inventory_summary"),
    locations: await selectAll(supabase, "media_storage_locations", "namespace,object_key,provider,size_bytes", (q) => q.is("cleaned_at", null)),
    ledger: await selectAll(supabase, "media_migration_ledger", "object_key,size_bytes,rolled_back_at"),
  }, { egressUsedBytes, egressQuotaBytes });
  console.log(args.includes("--json") ? JSON.stringify({ project, ...report }) : formatReport(project, report));
  if (report.alerts.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof OperatorError ? error.message : "Usage report failed; verify the selected environment and settings.");
    process.exitCode = 1;
  });
}
