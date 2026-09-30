import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Admin Core 1B-B server actions: each validates input shape, then forwards to
 * exactly ONE self-guarding RPC with the caller's session, and maps the result
 * to a translation key. Authorization itself is the RPC's (pgTAP 68).
 */
const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));

const {
  suspendSubjectAction,
  restoreSubjectAction,
  addNoteAction,
  logFollowUpAction,
  completeFollowUpAction,
  createCaseAction,
  resolveDuplicateAction,
} = await import("./admin-operations");

const ID = "70000001-0000-4000-8000-000000000001";
const OTHER = "9c000000-cccc-4ccc-8ccc-000000000001";
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
};
const initial = { ok: false };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe("suspend / restore", () => {
  it("requires a reason before calling the database", async () => {
    const res = await suspendSubjectAction(initial, form({ subjectType: "user", subjectId: ID, reason: "  " }));
    expect(res).toMatchObject({ ok: false, code: "admin.preview.ops.error.reasonRequired" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("suspends a user or an organization through its own RPC", async () => {
    await suspendSubjectAction(initial, form({ subjectType: "user", subjectId: ID, reason: "Fraud" }));
    expect(rpc).toHaveBeenLastCalledWith("admin_user_suspend", { p_user_id: ID, p_reason: "Fraud" });
    await suspendSubjectAction(initial, form({ subjectType: "organization", subjectId: OTHER, reason: "Counterfeit" }));
    expect(rpc).toHaveBeenLastCalledWith("admin_organization_suspend", { p_organization_id: OTHER, p_reason: "Counterfeit" });
  });

  it("refuses a malformed subject without calling the database", async () => {
    expect((await restoreSubjectAction(initial, form({ subjectType: "admin", subjectId: ID }))).ok).toBe(false);
    expect((await restoreSubjectAction(initial, form({ subjectType: "user", subjectId: "not-a-uuid" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal to a key, never raw text", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "the last active Super Admin cannot be suspended" } });
    const res = await suspendSubjectAction(initial, form({ subjectType: "user", subjectId: ID, reason: "x" }));
    expect(res).toEqual({ ok: false, code: "admin.preview.ops.error.lastSuperAdmin" });
  });
});

describe("notes, follow-ups, cases", () => {
  it("adds a note", async () => {
    const res = await addNoteAction(initial, form({ subjectType: "organization", subjectId: OTHER, body: "Called the owner." }));
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_note_add", { p_subject_type: "organization", p_subject_id: OTHER, p_body: "Called the owner." });
  });

  it("logs a follow-up with an Egypt-time due date and an assignee", async () => {
    await logFollowUpAction(
      initial,
      form({ subjectType: "user", subjectId: ID, actionType: "whatsapp", outcome: "Sent", dueDate: "2026-10-06", dueTime: "14:30", assignedTo: OTHER }),
    );
    expect(rpc).toHaveBeenCalledWith("admin_follow_up_log", {
      p_subject_type: "user",
      p_subject_id: ID,
      p_action_type: "whatsapp",
      p_outcome: "Sent",
      p_due_at: "2026-10-06 14:30 Africa/Cairo",
      p_assigned_to: OTHER,
    });
  });

  it("rejects an unknown action type and a bad due time before calling the database", async () => {
    expect((await logFollowUpAction(initial, form({ subjectType: "user", subjectId: ID, actionType: "fax", outcome: "x" }))).ok).toBe(false);
    const bad = await logFollowUpAction(initial, form({ subjectType: "user", subjectId: ID, actionType: "call", outcome: "x", dueDate: "2026-10-06", dueTime: "99:99" }));
    expect(bad.code).toBe("admin.preview.ops.error.dueInvalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("completes a follow-up by id", async () => {
    await completeFollowUpAction(initial, form({ subjectType: "user", subjectId: ID, followUpId: OTHER }));
    expect(rpc).toHaveBeenCalledWith("admin_follow_up_complete", { p_follow_up_id: OTHER });
  });

  it("opens a case, requiring subject and details", async () => {
    expect((await createCaseAction(initial, form({ subjectType: "user", subjectId: ID, title: "", details: "d" }))).code).toBe("admin.preview.ops.error.titleRequired");
    await createCaseAction(initial, form({ subjectType: "user", subjectId: ID, title: "Listing", details: "d", contactEmail: "a@b.co" }));
    expect(rpc).toHaveBeenCalledWith("admin_case_create", expect.objectContaining({ p_title: "Listing", p_details: "d", p_contact_email: "a@b.co" }));
  });
});

describe("duplicates", () => {
  it("links THIS organization to the chosen existing one", async () => {
    await resolveDuplicateAction(initial, form({ organizationId: ID, otherId: OTHER, mode: "link", reason: "Same showroom" }));
    expect(rpc).toHaveBeenCalledWith("admin_organization_link_duplicate", { p_duplicate_org_id: ID, p_canonical_org_id: OTHER, p_reason: "Same showroom" });
  });

  it("dismisses a suggestion", async () => {
    await resolveDuplicateAction(initial, form({ organizationId: ID, otherId: OTHER, mode: "dismiss", reason: "Different branch" }));
    expect(rpc).toHaveBeenCalledWith("admin_organization_dismiss_duplicate", { p_organization_id: ID, p_other_org_id: OTHER, p_reason: "Different branch" });
  });

  it("refuses an unknown mode or a missing reason", async () => {
    expect((await resolveDuplicateAction(initial, form({ organizationId: ID, otherId: OTHER, mode: "merge", reason: "x" }))).ok).toBe(false);
    expect((await resolveDuplicateAction(initial, form({ organizationId: ID, otherId: OTHER, mode: "link", reason: "" }))).code).toBe("admin.preview.ops.error.reasonRequired");
    expect(rpc).not.toHaveBeenCalled();
  });
});
