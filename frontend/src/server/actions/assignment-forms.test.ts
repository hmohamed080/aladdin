import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ rpc, from }),
}));

import { revalidatePath } from "next/cache";
import {
  startWorkAction,
  addProgressAction,
  completeAssignmentAction,
  cancelAssignmentAction,
} from "./assignment-forms";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: 3, error: null });
  vi.mocked(revalidatePath).mockClear();
});

/**
 * The action layer.
 *
 * ONE ACTION, ONE RPC, and the assertion that matters most in this file is the
 * negative one: `from()` is never called. There is no client INSERT, UPDATE or
 * DELETE grant on any table in this domain, so a direct write would fail at the
 * database — but it would fail LATE, and the point of asserting it here is that
 * the shape of the code makes it unreachable rather than merely unsuccessful.
 */
describe("startWorkAction", () => {
  it("calls job_assignment_start with the version the reader was shown", async () => {
    const r = await startWorkAction({ ok: false }, fd({ assignmentId: "a1", expectedVersion: "1" }));
    expect(rpc).toHaveBeenCalledWith("job_assignment_start", {
      p_assignment_id: "a1",
      p_expected_version: 1,
    });
    expect(r.ok).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  /** Authoritative refresh, never an optimistic local patch. */
  it("revalidates the surfaces whose state actually moved", async () => {
    await startWorkAction({ ok: false }, fd({ assignmentId: "a1", expectedVersion: "1" }));
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/home/work");
    expect(paths).toContain("/home/work/a1");
    expect(paths).toContain("/home");
  });

  it("localizes an invalid-state refusal instead of leaking the SQL message", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "a completed assignment cannot be started" },
    });
    const r = await startWorkAction({ ok: false }, fd({ assignmentId: "a1", expectedVersion: "1" }));
    expect(r).toEqual({ ok: false, code: "work.errors.notScheduled" });
  });

  it("names the authority refusal rather than calling it a missing permission", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "only the assigned installer may start this work" },
    });
    const r = await startWorkAction({ ok: false }, fd({ assignmentId: "a1", expectedVersion: "1" }));
    expect(r.code).toBe("work.errors.notYoursToStart");
  });

  it("reports a concurrent change as a conflict, and does not retry with a fresher version", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "assignment was modified concurrently" },
    });
    const r = await startWorkAction({ ok: false }, fd({ assignmentId: "a1", expectedVersion: "1" }));
    expect(r.code).toBe("work.errors.conflict");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("addProgressAction", () => {
  it("calls job_progress_add with the reported figure and optional detail", async () => {
    await addProgressAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", percent: "60", stage: "Second course", note: "Done." }),
    );
    expect(rpc).toHaveBeenCalledWith("job_progress_add", {
      p_assignment_id: "a1",
      p_progress_percent: 60,
      p_stage: "Second course",
      p_note: "Done.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("sends no empty strings where the database expects null", async () => {
    await addProgressAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", percent: "25", stage: "  ", note: "" }),
    );
    expect(rpc).toHaveBeenCalledWith("job_progress_add", {
      p_assignment_id: "a1",
      p_progress_percent: 25,
      p_stage: undefined,
      p_note: undefined,
    });
  });

  /**
   * §14 at this layer: 100 is an ordinary value. The action reports it and does
   * nothing else — there is no follow-up call, and no second RPC to make.
   */
  it("treats 100 as an ordinary report and never chains a completion", async () => {
    const r = await addProgressAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", percent: "100" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("job_progress_add");
    expect(r.ok).toBe(true);
  });

  it("refuses a figure outside 0-100 before spending a round trip", async () => {
    for (const percent of ["-1", "101", "abc", "50.5"]) {
      const r = await addProgressAction(
        { ok: false },
        fd({ assignmentId: "a1", jobId: "j1", percent }),
      );
      expect(r.fieldErrors?.percent).toBe("work.validation.progressRange");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts both ends of the range", async () => {
    for (const percent of ["0", "100"]) {
      const r = await addProgressAction(
        { ok: false },
        fd({ assignmentId: "a1", jobId: "j1", percent }),
      );
      expect(r.ok).toBe(true);
    }
  });

  it("localizes the database's own range refusal too", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "progress must be between 0 and 100" },
    });
    const r = await addProgressAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", percent: "50" }),
    );
    expect(r.code).toBe("work.errors.progressRange");
  });

  it("refuses a report on work that is not under way", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "progress can only be reported on work in progress" },
    });
    const r = await addProgressAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", percent: "50" }),
    );
    expect(r.code).toBe("work.errors.notInProgress");
  });

  /** The poster's view of the same job carries this figure. */
  it("revalidates both parties' surfaces", async () => {
    await addProgressAction({ ok: false }, fd({ assignmentId: "a1", jobId: "j1", percent: "60" }));
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/home/work/a1");
    expect(paths).toContain("/b2b/jobs/j1");
  });
});

describe("completeAssignmentAction", () => {
  it("calls job_assignment_complete with the version the poster was shown", async () => {
    const r = await completeAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "2" }),
    );
    expect(rpc).toHaveBeenCalledWith("job_assignment_complete", {
      p_assignment_id: "a1",
      p_expected_version: 2,
    });
    expect(r.ok).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  /**
   * The job and the assignment complete in ONE transaction inside the RPC. The
   * action must not follow up with a job write of its own — that would be half a
   * transaction, run outside it.
   */
  it("makes exactly one call, because the RPC completes the job too", async () => {
    await completeAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "2" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  /** The OTHER party's surface moved as well, and they are not looking at it. */
  it("revalidates the installer's surfaces as well as the poster's", async () => {
    await completeAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "2" }),
    );
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/b2b/jobs/j1");
    expect(paths).toContain("/home/work/a1");
  });

  it("names an unauthorized attempt precisely", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "job.manage required" },
    });
    const r = await completeAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "2" }),
    );
    expect(r.code).toBe("work.errors.manageRequired");

    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not a member of the posting organization" },
    });
    const r2 = await completeAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "2" }),
    );
    expect(r2.code).toBe("work.errors.notAMember");
  });
});

describe("cancelAssignmentAction", () => {
  it("calls job_assignment_cancel with the reason the caller gave", async () => {
    await cancelAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "1", reason: "Family emergency." }),
    );
    expect(rpc).toHaveBeenCalledWith("job_assignment_cancel", {
      p_assignment_id: "a1",
      p_expected_version: 1,
      p_reason: "Family emergency.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("requires a reason before spending a round trip", async () => {
    for (const reason of ["", "   "]) {
      const r = await cancelAssignmentAction(
        { ok: false },
        fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "1", reason }),
      );
      expect(r.fieldErrors?.reason).toBe("work.validation.reasonRequired");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("caps the reason at the length the column accepts", async () => {
    const r = await cancelAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "1", reason: "x".repeat(501) }),
    );
    expect(r.fieldErrors?.reason).toBe("work.validation.reasonTooLong");
    expect(rpc).not.toHaveBeenCalled();
  });

  /** §17: one RPC serves both parties, so one action does too. */
  it("is the same call whichever party made it, and refreshes both sides", async () => {
    await cancelAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "1", reason: "Postponed." }),
    );
    const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(paths).toContain("/home/work/a1");
    expect(paths).toContain("/b2b/jobs/j1");
  });

  it("names a refusal from somebody who is not a party to the engagement", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "only a party to this assignment may cancel it" },
    });
    const r = await cancelAssignmentAction(
      { ok: false },
      fd({ assignmentId: "a1", jobId: "j1", expectedVersion: "1", reason: "x" }),
    );
    expect(r.code).toBe("work.errors.notAParty");
  });
});

/**
 * §16, as a claim about this module rather than about a rendered page: there is
 * no installer-side completion action, because there is no function here that
 * an installer surface could import.
 */
describe("the module surface", () => {
  it("exports exactly the four lifecycle actions", async () => {
    const mod = await import("./assignment-forms");
    expect(Object.keys(mod).sort()).toEqual([
      "addProgressAction",
      "cancelAssignmentAction",
      "completeAssignmentAction",
      "startWorkAction",
    ]);
  });
});
