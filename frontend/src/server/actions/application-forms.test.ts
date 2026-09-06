import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ rpc })),
}));

import { applyToJobAction, withdrawApplicationAction } from "./application-forms";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "app-1", error: null });
  revalidatePath.mockClear();
});

/**
 * These tests are about what the action layer FORWARDS and how it NAMES a
 * refusal. Not one asserts an authorization outcome, because this layer decides
 * none: whether the job is open, whether the poster is still verified, whether
 * this account is a professional and whether a withdrawn candidacy may return
 * are all decided inside `job_application_submit`.
 */
describe("applyToJobAction", () => {
  it("applies through job_application_submit and nothing else", async () => {
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1", note: "Free Sunday." }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("job_application_submit", {
      p_job_id: "j1",
      p_note: "Free Sunday.",
    });
    expect(r).toEqual({ ok: true, code: "jobs.installerFlash.applied" });
  });

  /**
   * NO CLIENT INSERT, ever. There is no grant that would allow one, but the
   * assertion is here because "just insert the row and refresh" is the shortcut
   * this action exists to not take.
   */
  it("never writes job_applications directly", async () => {
    await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(rpc.mock.calls.every(([name]) => String(name).startsWith("job_application_"))).toBe(true);
  });

  it("treats the note as optional", async () => {
    await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(rpc).toHaveBeenCalledWith("job_application_submit", {
      p_job_id: "j1",
      p_note: undefined,
    });
  });

  it("does not send whitespace as a note", async () => {
    await applyToJobAction({ ok: false }, fd({ jobId: "j1", note: "   " }));
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_note).toBeUndefined();
  });

  it("catches an over-long note next to the field, before a round trip", async () => {
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1", note: "x".repeat(1001) }));
    expect(r.fieldErrors?.note).toBe("jobs.validation.noteTooLong");
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * §12: re-applying after a withdrawal is THE SAME CALL. The database returns
   * the same row to `submitted`, so a second code path here would be a second
   * writer of one row.
   */
  it("re-applies through the identical call, with no second path", async () => {
    await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    const first = rpc.mock.calls[0]![0];
    rpc.mockClear();
    await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(rpc.mock.calls[0]![0]).toBe(first);
  });

  it("refreshes both surfaces the application changed, rather than faking state", async () => {
    await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/home/jobs");
    expect(paths).toContain("/home/jobs/j1");
    expect(paths).toContain("/home/jobs/applications");
  });

  it("reports nothing as applied when the RPC refused", async () => {
    rpc.mockResolvedValue({ error: { code: "22023", message: "this job is not accepting applications" } });
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * The persona refusal arrives as 42501 and would otherwise fall through to
   * "you do not have permission", which is both wrong and unactionable — what
   * this caller lacks is a professional account, not a permission.
   */
  it("names the professional-account requirement rather than a permission failure", async () => {
    rpc.mockResolvedValue({
      error: { code: "42501", message: "a professional account is required to apply for work" },
    });
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(r.code).toBe("jobs.installerErrors.notProfessional");
  });

  it("explains a closed opening in its own words", async () => {
    rpc.mockResolvedValue({
      error: { code: "22023", message: "this job is not currently open to applications" },
    });
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(r.code).toBe("jobs.installerErrors.notOpenNow");
  });

  it("never leaks a raw database message or SQLSTATE", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates "uq_x"' } });
    const r = await applyToJobAction({ ok: false }, fd({ jobId: "j1" }));
    expect(r.code).toBe("states.genericRetry");
    expect(JSON.stringify(r)).not.toMatch(/23505|duplicate key/);
  });
});

describe("withdrawApplicationAction", () => {
  it("withdraws through job_application_withdraw, by application id", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await withdrawApplicationAction(
      { ok: false },
      fd({ applicationId: "a1", jobId: "j1" }),
    );
    expect(rpc).toHaveBeenCalledWith("job_application_withdraw", { p_application_id: "a1" });
    expect(r).toEqual({ ok: true, code: "jobs.installerFlash.withdrawn" });
  });

  it("sends no user id — only the applicant may, and the database knows who they are", async () => {
    rpc.mockResolvedValue({ error: null });
    await withdrawApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" }));
    expect(Object.keys(rpc.mock.calls[0]![1] as object)).toEqual(["p_application_id"]);
  });

  it("explains a terminal candidacy rather than saying permission denied", async () => {
    rpc.mockResolvedValue({
      error: { code: "22023", message: "a rejected application cannot be withdrawn" },
    });
    const r = await withdrawApplicationAction({ ok: false }, fd({ applicationId: "a1" }));
    expect(r.code).toBe("jobs.installerErrors.notWithdrawable");
  });

  it("names somebody else's application as not theirs", async () => {
    rpc.mockResolvedValue({
      error: { code: "42501", message: "only the applicant may withdraw an application" },
    });
    const r = await withdrawApplicationAction({ ok: false }, fd({ applicationId: "a1" }));
    expect(r.code).toBe("jobs.installerErrors.notYours");
  });

  it("refreshes authoritative state after a real withdrawal", async () => {
    rpc.mockResolvedValue({ error: null });
    await withdrawApplicationAction({ ok: false }, fd({ applicationId: "a1", jobId: "j1" }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toContain("/home/jobs/applications");
  });
});
