import "server-only";

import { readBackupGithubEnv, type BackupGithubEnv } from "@/lib/env/backups";
import type { Json } from "@/types/database.types";

/**
 * The app's ONLY door to GitHub Actions for backups.
 *
 * It dispatches a workflow in the private `aladdin-backups` repository and reads
 * the run back together with its data-moving job. The distinction that matters:
 * a run whose `plan` job is green while `backup` never ran is NOT a backup. The
 * server therefore decides success from BOTH conclusions — never from the
 * workflow's own report and never from a planning job.
 *
 * Nothing here logs the token, the repository URL or a signed URL.
 */

export type BackupEnvironment = "acceptance" | "production";
export type BackupKind = "backup" | "restore_test";
export type VerifiedOutcome = "running" | "succeeded" | "failed" | "skipped" | "unknown";

export type WorkflowJob = { name: string; status: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] };
export type WorkflowRun = {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  displayTitle: string;
  jobs: WorkflowJob[];
};

export type DispatchOutcome =
  | { ok: true; runId: number; runUrl: string }
  | { ok: false; code: "not_configured" | "dispatch_failed" | "dispatch_uncertain" | "run_not_found" };

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
/** How long to wait for a just-dispatched run to appear in the runs list. */
const RUN_LOOKUP_ATTEMPTS = 8;
const RUN_LOOKUP_DELAY_MS = 1_500;

const JOB_NAME: Record<BackupKind, string> = { backup: "backup", restore_test: "restore" };

function workflowFor(env: BackupGithubEnv, kind: BackupKind): string {
  return kind === "backup" ? env.BACKUP_GITHUB_BACKUP_WORKFLOW : env.BACKUP_GITHUB_RESTORE_WORKFLOW;
}

async function github(env: BackupGithubEnv, path: string, init?: RequestInit): Promise<Response> {
  if (!env.BACKUP_GITHUB_TOKEN) throw new Error("backup GitHub token is not configured");
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.BACKUP_GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function repoPath(env: BackupGithubEnv, suffix: string): string {
  return `/repos/${env.BACKUP_GITHUB_REPO}${suffix}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dispatches the workflow and resolves the run it created. GitHub's dispatch
 * endpoint returns 204 with no body, so the run is found by the `request_id`
 * the workflows put in their `run-name`. A run that cannot be found is a
 * definite failure for the caller: it never becomes a success.
 */
export async function dispatchBackupWorkflow(input: {
  kind: BackupKind;
  environment: BackupEnvironment;
  requestId: string;
  /** The typed Production phrase, forwarded so the private workflow re-checks it. */
  confirm?: string;
  env?: BackupGithubEnv;
}): Promise<DispatchOutcome> {
  const env = input.env ?? readBackupGithubEnv();
  if (!env.BACKUP_GITHUB_TOKEN) return { ok: false, code: "not_configured" };

  const workflow = workflowFor(env, input.kind);
  let dispatched: Response;
  try {
    dispatched = await github(env, repoPath(env, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`), {
      method: "POST",
      body: JSON.stringify({
        ref: env.BACKUP_GITHUB_REF,
        inputs: {
          label: input.environment,
          request_id: input.requestId,
          ...(input.kind === "backup" ? { confirm: input.confirm ?? "" } : {}),
        },
      }),
    });
  } catch {
    return { ok: false, code: "dispatch_uncertain" };
  }
  // 204 No Content is the documented success response.
  if (dispatched.status !== 204) return { ok: false, code: dispatched.status >= 500 ? "dispatch_uncertain" : "dispatch_failed" };

  for (let attempt = 0; attempt < RUN_LOOKUP_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RUN_LOOKUP_DELAY_MS);
    try {
      const listed = await github(env, repoPath(env, `/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&per_page=30`));
      if (!listed.ok) continue;
      const body = (await listed.json()) as { workflow_runs?: { id?: number; html_url?: string; display_title?: string }[] };
      const match = (body.workflow_runs ?? []).find((run) => typeof run.display_title === "string" && run.display_title.includes(input.requestId));
      if (match && typeof match.id === "number" && match.id > 0 && typeof match.html_url === "string") {
        return { ok: true, runId: match.id, runUrl: match.html_url };
      }
    } catch {
      // A transient list failure is retried; it never fabricates a run.
    }
  }
  return { ok: false, code: "run_not_found" };
}

/** Reads a run and its jobs. `null` means the read failed (never "success"). */
export async function readWorkflowRun(runId: number, env: BackupGithubEnv = readBackupGithubEnv()): Promise<WorkflowRun | null> {
  if (!env.BACKUP_GITHUB_TOKEN) return null;
  try {
    const [runResponse, jobsResponse] = await Promise.all([
      github(env, repoPath(env, `/actions/runs/${runId}`)),
      github(env, repoPath(env, `/actions/runs/${runId}/jobs?per_page=100`)),
    ]);
    if (!runResponse.ok || !jobsResponse.ok) return null;
    const run = (await runResponse.json()) as { id?: number; html_url?: string; status?: string; conclusion?: string | null; display_title?: string };
    const jobs = (await jobsResponse.json()) as { jobs?: { name?: string; status?: string; conclusion?: string | null; steps?: {name: string; conclusion: string | null}[] }[] };
    if (typeof run.id !== "number" || typeof run.status !== "string") return null;
    return {
      id: run.id,
      htmlUrl: typeof run.html_url === "string" ? run.html_url : `https://github.com/${env.BACKUP_GITHUB_REPO}/actions/runs/${runId}`,
      status: run.status,
      conclusion: run.conclusion ?? null,
      displayTitle: typeof run.display_title === "string" ? run.display_title : "",
      jobs: (jobs.jobs ?? []).flatMap((job) =>
        typeof job.name === "string" && typeof job.status === "string"
          ? [{ name: job.name, status: job.status, conclusion: job.conclusion ?? null, steps: job.steps }]
          : [],
      ),
    };
  } catch {
    return null;
  }
}

/**
 * The ONE success rule. A run is `succeeded` only when the run AND its
 * `backup` / `restore` job are both completed with `success`. A missing job
 * (plan-only, skipped matrix, renamed job) is `unknown`, never success.
 */
export function verifyRunOutcome(run: WorkflowRun, kind: BackupKind, environment: BackupEnvironment): VerifiedOutcome {
  if (run.status !== "completed") return "running";
  const expected = JOB_NAME[kind];
  const job = run.jobs.find((j) => j.name === `${expected} (${environment})`);
  if (!job) return "unknown";
  if (job.status !== "completed") return "running";
  if (job.conclusion === "skipped") return "skipped";
  const evidence = job.steps?.find(step => step.name === "Verify complete coverage");
  if (job.conclusion === "success" && evidence?.conclusion === "skipped") return "skipped";
  if (job.conclusion === "success" && run.conclusion === "success" && evidence?.conclusion === "success") return "succeeded";
  if (job.conclusion === "success" && ["failure", "cancelled", "timed_out"].includes(run.conclusion ?? "")) return "failed";
  if (job.conclusion === "success") return "unknown";
  if (run.conclusion === "skipped") return "skipped";
  // Cancelled, timed out, neutral or a failed job: the backup did not complete.
  return "failed";
}

/** The compact summary stored on the run ledger. Counts and conclusions only. */
export function summarizeRun(run: WorkflowRun, kind: BackupKind): Json {
  const expected = JOB_NAME[kind];
  const job = run.jobs.find((j) => j.name === expected || j.name.startsWith(`${expected} (`));
  return {
    github_status: run.status,
    github_conclusion: run.conclusion,
    job: job ? { name: job.name, status: job.status, conclusion: job.conclusion } : null,
    jobs_seen: run.jobs.length,
  };
}
