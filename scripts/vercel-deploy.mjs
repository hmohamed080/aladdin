#!/usr/bin/env node
/**
 * Vercel side of the staged staging deployment (see .github/workflows/deploy-staging.yml).
 *
 * Vercel builds every `main` commit by itself. This workflow never rebuilds anything: it only
 *   1. checks that the project is configured so that a main deployment is STAGED, not live
 *      (`check-project`), and
 *   2. finds the one READY production deployment that was built from EXACTLY this commit (`find-deployment`),
 * and the workflow then promotes that existing deployment with `vercel promote`.
 *
 * Environment (never printed): VERCEL_TOKEN, VERCEL_ORG_ID (team id), VERCEL_PROJECT_ID.
 *
 *   node scripts/vercel-deploy.mjs check-project [--report-only]
 *   node scripts/vercel-deploy.mjs find-deployment --sha <40-hex> [--ref main] [--timeout-min 25] [--interval-sec 15]
 *   node scripts/vercel-deploy.mjs previous-production [--exclude <deployment id>]   (informational; never fails)
 *
 * `find-deployment` writes `deployment_id`, `deployment_url` and `already_promoted` to $GITHUB_OUTPUT.
 * Exit codes: 0 ok · 1 refused (nothing safe to promote / setting wrong) · 2 usage or API error.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.vercel.com";
const OWNER_ACTION =
  "Vercel -> Project -> Settings -> Environments -> Production -> Branch Tracking -> turn OFF \"Auto-assign Custom Production Domains\" " +
  "(API field autoAssignCustomDomains = false).";

export class VercelApiError extends Error {}

const stateOf = (d) => d.readyState ?? d.state;
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Decide what to do about the deployments Vercel lists for this commit. Pure.
 *
 *   ready-staged    a READY production deployment of this exact commit that has never served traffic: promote it
 *   ready-promoted  the same, but already serving (idempotent re-run): nothing to promote
 *   pending         it exists but is still building/queued: keep waiting
 *   failed          it exists but every candidate ended ERROR/CANCELED/BLOCKED: stop
 *   none            Vercel has not created it yet: keep waiting
 *
 * A deployment is a candidate only if it belongs to the configured project, targets production, and was built from
 * exactly `sha` (full-string match, never a prefix) - and, when Vercel reports the branch, from `ref`.
 */
export function selectDeployment(deployments, { projectId, sha, ref = "main" }) {
  if (!projectId) throw new VercelApiError("projectId is required");
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) throw new VercelApiError("sha must be the full 40-character commit SHA");
  const candidates = (deployments ?? [])
    .filter((d) => d && d.projectId === projectId)
    .filter((d) => d.target === "production")
    .filter((d) => same(d.meta?.githubCommitSha, sha))
    .filter((d) => d.meta?.githubCommitRef === undefined || d.meta.githubCommitRef === ref)
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

  if (candidates.length === 0) return { status: "none", reason: "no production deployment for this commit exists yet" };
  const ready = candidates.find((d) => stateOf(d) === "READY");
  if (ready) {
    const promoted = ready.readySubstate === "PROMOTED";
    return { status: promoted ? "ready-promoted" : "ready-staged", deployment: ready, substate: ready.readySubstate ?? "unknown" };
  }
  const inFlight = candidates.some((d) => ["BUILDING", "QUEUED", "INITIALIZING"].includes(stateOf(d)));
  if (inFlight) return { status: "pending", reason: `building (${candidates.map(stateOf).join(", ")})` };
  return { status: "failed", reason: `every deployment of this commit ended ${candidates.map(stateOf).join(", ")}` };
}

/**
 * The most recently promoted production deployment other than `excludeId`: what a human would roll back TO.
 * Informational only (printed in the rollback instruction); it is never used to decide anything automatically.
 */
export function selectPreviousProduction(deployments, { projectId, excludeId }) {
  return (
    (deployments ?? [])
      .filter((d) => d && d.projectId === projectId && d.target === "production")
      .filter((d) => stateOf(d) === "READY" && d.readySubstate === "PROMOTED" && d.uid !== excludeId)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null
  );
}

/** Is the project set up so that a main deployment is staged rather than live? Pure. */
export function evaluateProjectGate(project, { projectId }) {
  if (!project || typeof project !== "object") return { ok: false, message: "Vercel returned no project." };
  if (project.id !== projectId) {
    return { ok: false, message: `Vercel returned project ${project.id ?? "<none>"}, expected the configured VERCEL_PROJECT_ID. Refusing.` };
  }
  if (project.autoAssignCustomDomains === false) {
    return { ok: true, message: "Auto-assignment of production domains is OFF: a main deployment is staged until this workflow promotes it." };
  }
  if (project.autoAssignCustomDomains === true) {
    return {
      ok: false,
      message: `Auto-assignment of production domains is ON, so Vercel makes every main deployment customer-facing before the database is migrated. Owner action required: ${OWNER_ACTION}`,
    };
  }
  return {
    ok: false,
    message: `Cannot confirm the auto-assignment setting (autoAssignCustomDomains was not returned). Refusing to migrate. Owner action: verify ${OWNER_ACTION}`,
  };
}

async function api(path, params, fetchImpl = fetch) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new VercelApiError("VERCEL_TOKEN is not set");
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // Status only: the body and the URL (which carries ids) are not echoed.
    throw new VercelApiError(`Vercel API ${path} answered HTTP ${response.status}${response.status === 401 || response.status === 403 ? " (check VERCEL_TOKEN scope and VERCEL_ORG_ID)" : ""}`);
  }
  return response.json();
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, reportOnly: false, ref: "main", timeoutMin: 25, intervalSec: 15, sha: undefined };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--report-only") opts.reportOnly = true;
    else if (a === "--sha") opts.sha = rest[++i];
    else if (a === "--ref") opts.ref = rest[++i];
    else if (a === "--exclude") opts.exclude = rest[++i];
    else if (a === "--timeout-min") opts.timeoutMin = Number(rest[++i]);
    else if (a === "--interval-sec") opts.intervalSec = Number(rest[++i]);
    else throw new VercelApiError(`unexpected argument: ${a}`);
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function main(argv, { fetchImpl = fetch, log = console.log } = {}) {
  try {
    const opts = parseArgs(argv);
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_ORG_ID;
    if (!projectId || !teamId) throw new VercelApiError("VERCEL_PROJECT_ID and VERCEL_ORG_ID must be set explicitly");

    if (opts.command === "check-project") {
      const project = await api(`/v9/projects/${encodeURIComponent(projectId)}`, { teamId }, fetchImpl);
      const gate = evaluateProjectGate(project, { projectId });
      log(`autoAssignCustomDomains = ${project.autoAssignCustomDomains === undefined ? "<not returned>" : project.autoAssignCustomDomains}`);
      log(gate.message);
      if (!gate.ok && opts.reportOnly) {
        log("(report-only: not failing; this must be OFF before automatic promotion is enabled)");
        return 0;
      }
      return gate.ok ? 0 : 1;
    }

    if (opts.command === "find-deployment") {
      if (!opts.sha) throw new VercelApiError("--sha is required");
      const deadline = Date.now() + opts.timeoutMin * 60_000;
      for (;;) {
        const body = await api("/v7/deployments", { projectId, teamId, target: "production", sha: opts.sha, limit: 20 }, fetchImpl);
        const pick = selectDeployment(body.deployments, { projectId, sha: opts.sha, ref: opts.ref });
        if (pick.status === "ready-staged" || pick.status === "ready-promoted") {
          const d = pick.deployment;
          log(`Found READY deployment ${d.uid} (${d.url}) for commit ${opts.sha} - ${pick.status === "ready-promoted" ? "already serving production" : `staged (${pick.substate})`}.`);
          setOutput("deployment_id", d.uid);
          setOutput("deployment_url", `https://${d.url}`);
          setOutput("already_promoted", String(pick.status === "ready-promoted"));
          return 0;
        }
        if (pick.status === "failed") {
          log(`No promotable deployment: ${pick.reason}.`);
          return 1;
        }
        if (Date.now() >= deadline) {
          log(`Timed out after ${opts.timeoutMin} min waiting for the Vercel deployment of ${opts.sha}: ${pick.reason}.`);
          return 1;
        }
        log(`Waiting for the Vercel deployment of ${opts.sha}: ${pick.reason}...`);
        await sleep(opts.intervalSec * 1000);
      }
    }
    if (opts.command === "previous-production") {
      // Informational: it must never block a deployment, so API trouble here is a warning, not a failure.
      try {
        const body = await api("/v7/deployments", { projectId, teamId, target: "production", state: "READY", limit: 20 }, fetchImpl);
        const previous = selectPreviousProduction(body.deployments, { projectId, excludeId: opts.exclude });
        if (previous) {
          log(`Previously promoted production deployment: ${previous.uid} (${previous.url}).`);
          setOutput("previous_id", previous.uid);
          setOutput("previous_url", `https://${previous.url}`);
        } else {
          log("No previously promoted production deployment found.");
        }
      } catch (error) {
        if (!(error instanceof VercelApiError)) throw error;
        log(`Could not look up the previous production deployment (${error.message}); continuing.`);
      }
      return 0;
    }
    throw new VercelApiError(
      "usage: vercel-deploy.mjs check-project [--report-only] | find-deployment --sha <sha> [--ref main] [--timeout-min N] [--interval-sec N] | previous-production [--exclude <id>]",
    );
  } catch (error) {
    if (!(error instanceof VercelApiError)) throw error;
    log(`vercel-deploy: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
