import "server-only";

import { adminBackupReconcile } from "@/lib/supabase/admin-server";
import { readWorkflowRun, summarizeRun, verifyRunOutcome } from "@/server/backups/github";
import type { BackupStatus } from "@/server/queries/admin-backups";

/**
 * Best-effort settlement of runs whose GitHub outcome is known. Only runs that
 * already carry a GitHub run id are considered, and only the verified run AND
 * its data-moving job can mark `succeeded`. A read failure leaves the run as it
 * is: unknown is never success. Called on page load and by the manual refresh.
 */
export async function reconcileBackupRuns(status: BackupStatus, actorId: string, limit = 5): Promise<number> {
  let settled = 0;
  const pending = status.runs
    .filter((run) => run.github_run_id !== null && !["succeeded", "failed", "skipped", "unknown"].includes(run.status))
    .slice(0, limit);

  for (const run of pending) {
    const snapshot = await readWorkflowRun(run.github_run_id!);
    if (!snapshot) continue;
    if (!status.environment) continue;
    const outcome = verifyRunOutcome(snapshot, run.kind, status.environment);
    if (outcome === "running") continue;
    const result = await adminBackupReconcile({
      actor: actorId,
      run: run.id,
      status: outcome,
      conclusion: snapshot.conclusion,
      summary: summarizeRun(snapshot, run.kind),
      githubRunId: snapshot.id,
      githubRunUrl: snapshot.htmlUrl,
    }).catch(() => ({ data: null }));
    if (result.data) settled++;
  }
  return settled;
}
