import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { dispatchBackupWorkflow, verifyRunOutcome, type WorkflowRun } from "./github";

const run = (jobs: WorkflowRun["jobs"], conclusion = "success"): WorkflowRun => ({
  id: 1, htmlUrl: "https://github.com/test/test/actions/runs/1", status: "completed", conclusion, displayTitle: "test", jobs,
});
const good = { name: "backup (acceptance)", status: "completed", conclusion: "success", steps: [{name: "Verify complete coverage", conclusion: "success"}] };
describe("real backup evidence", () => {
  it("rejects a green planner", () => expect(verifyRunOutcome(run([{...good, name: "plan"}]), "backup", "acceptance")).toBe("unknown"));
  it("rejects the other environment", () => expect(verifyRunOutcome(run([good]), "backup", "production")).toBe("unknown"));
  it("requires coverage evidence", () => expect(verifyRunOutcome(run([{...good, steps: []}]), "backup", "acceptance")).toBe("unknown"));
  it("rejects skipped work", () => expect(verifyRunOutcome(run([{...good, conclusion: "skipped"}]), "backup", "acceptance")).toBe("skipped"));
  it("requires workflow success too", () => expect(verifyRunOutcome(run([good], "failure"), "backup", "acceptance")).toBe("failed"));
  it("accepts completed verified work", () => expect(verifyRunOutcome(run([good]), "backup", "acceptance")).toBe("succeeded"));
});

describe("GitHub dispatch request", () => {
  it("always sends a User-Agent (GitHub answers 403 to a request without one, before it checks the token)", async () => {
    const seen: Headers[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(null, { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const outcome = await dispatchBackupWorkflow({
        kind: "backup",
        environment: "acceptance",
        requestId: "00000000-0000-4000-8000-000000000000",
        env: {
          BACKUP_GITHUB_TOKEN: "test-token",
          BACKUP_GITHUB_REPO: "owner/repo",
          BACKUP_GITHUB_BACKUP_WORKFLOW: "daily-backup.yml",
          BACKUP_GITHUB_RESTORE_WORKFLOW: "restore-test.yml",
          BACKUP_GITHUB_REF: "main",
        },
      });
      expect(outcome).toEqual({ ok: false, code: "dispatch_failed" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sent = seen[0]!;
      expect(sent.get("user-agent")).toMatch(/\S/);
      expect(sent.get("authorization")).toBe("Bearer test-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
