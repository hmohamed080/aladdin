import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifyRunOutcome, type WorkflowRun } from "./github";

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
