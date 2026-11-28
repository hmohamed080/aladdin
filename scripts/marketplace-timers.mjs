#!/usr/bin/env node
// Manual runner for the Marketplace timers (PR 14): calls the same service-role RPC the Cloudflare cron Worker
// (edge/marketplace-timers-worker) calls, until that Worker is approved and deployed. All logic is in Postgres
// (public.marketplace_timers_run: bounded, idempotent, SKIP LOCKED), so a double run is safe.
//
//   node scripts/marketplace-timers.mjs run --project <ref|local> [--limit 200] [--now <ISO time>] [--execute]
//
// Without --execute nothing is called: the command only says what it would do. --now simulates the clock (tests and Acceptance
// verification); it is refused on any project other than local and Acceptance. A project other than local and Acceptance also needs
// MARKETPLACE_TIMERS_APPROVED_PROJECT=<ref> (the owner's approval of that hosted step). Output is numbers only.
import { pathToFileURL } from "node:url";
import { readMaintenanceEnv } from "../frontend/src/lib/env/media-maintenance.mjs";

const ACCEPTANCE_PROJECT = "nxossqhdfltcqdwvbewi";

export class OperatorError extends Error {}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help")) return { command: "help" };
  const [command, ...rest] = argv;
  if (command !== "run") throw new OperatorError("First argument must be: run");
  const raw = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--execute") { raw.execute = true; continue; }
    if (!["--project", "--limit", "--now"].includes(arg)) throw new OperatorError(`Unknown option ${arg}`);
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) throw new OperatorError(`${arg} needs a value`);
    raw[arg.slice(2)] = value;
  }
  if (!raw.project) throw new OperatorError("Explicit --project is required");
  const limit = raw.limit === undefined ? 200 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new OperatorError("--limit must be an integer 1..500");
  let now = null;
  if (raw.now !== undefined) {
    const t = new Date(raw.now);
    if (Number.isNaN(t.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(raw.now)) throw new OperatorError("--now must be an ISO time such as 2026-12-01T10:00:00Z");
    now = t.toISOString();
  }
  return { command, project: raw.project, limit, now, execute: Boolean(raw.execute) };
}

/** The guard that decides whether a run may touch the configured project. Throws OperatorError with a fixed message. */
export function assertAllowed(options, env, approvedProject = process.env.MARKETPLACE_TIMERS_APPROVED_PROJECT) {
  const url = new URL(env.SUPABASE_URL);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const project = local ? "local" : url.hostname.split(".")[0];
  if (options.project !== project) throw new OperatorError("Requested project does not match configured environment");
  const hosted = !local && project !== ACCEPTANCE_PROJECT;
  if (options.now && hosted) throw new OperatorError("--now (simulated time) is refused on a hosted project other than Acceptance");
  if (options.execute && hosted && approvedProject !== project) throw new OperatorError("Production execution requires separate verified approval");
  return { project, local };
}

export async function run(options, env, fetcher = fetch) {
  const { project } = assertAllowed(options, env);
  if (!options.execute) {
    return { project, dryRun: true, wouldCall: "marketplace_timers_run", limit: options.limit, simulatedNow: options.now };
  }
  const body = { p_limit: options.limit, ...(options.now ? { p_now: options.now } : {}) };
  const response = await fetcher(`${new URL(env.SUPABASE_URL).origin}/rest/v1/rpc/marketplace_timers_run`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new OperatorError(`Timers run failed (HTTP ${response.status})`);
  const counts = await response.json();
  const numbers = {};
  for (const key of ["processed", "reminders", "cancelled", "errors"]) numbers[key] = Number.isFinite(counts?.[key]) ? counts[key] : null;
  return { project, dryRun: false, ...numbers };
}

const HELP = `Marketplace timers (manual runner)
  run --project <ref|local> [--limit 200] [--now <ISO time>] [--execute]
Dry run unless --execute. --now simulates time (local and Acceptance only). Output is counts only.`;

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === "help") { console.log(HELP); return; }
  const result = await run(options, readMaintenanceEnv());
  console.log(JSON.stringify(result));
  if (!result.dryRun && result.errors) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof OperatorError ? error.message : "Unexpected failure");
    process.exitCode = 1;
  });
}
