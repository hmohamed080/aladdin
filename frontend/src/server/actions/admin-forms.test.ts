import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Administrative account verification actions. They are shared by the Verifications queue and the Users
 * directory / user page, so this suite pins the contract both rely on:
 *   - the request is re-read from the DATABASE (client-supplied status / type are never trusted);
 *   - Approve auto-claims, approves, then runs the matching idempotent apply step;
 *   - a repeated approval is a no-op that only re-runs apply (never an "invalid transition");
 *   - Reject needs a reason BEFORE any database call;
 *   - every refusal is mapped to a translation key, never raw database text.
 * Authorization itself (platform permission, no-self-review, sticky reviewer) is the RPCs' — pgTAP 11 / 68.
 */
const rpc = vi.fn();
const maybeSingle = vi.fn();
const query = { select: vi.fn(), eq: vi.fn(), neq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle };
query.select.mockReturnValue(query);
query.eq.mockReturnValue(query);
query.neq.mockReturnValue(query);
query.is.mockReturnValue(query);
query.order.mockReturnValue(query);
query.limit.mockReturnValue(query);
const from = vi.fn(() => query);
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, from })) }));

const { adminInitiateVerificationAction,
  approveVerificationAction, rejectVerificationAction, startReviewAction } = await import("./admin-forms");

const ID = "70000001-0000-4000-8000-000000000001";
const initial = { ok: false };
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
};
const target = (status: string, verification_type = "professional") =>
  maybeSingle.mockResolvedValue({ data: { status, verification_type }, error: null });
const calls = () => rpc.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: null, error: null }); // default: no approved-unapplied request, no target
  query.is.mockClear();
  query.eq.mockClear();
  revalidatePath.mockClear();
  from.mockClear();
});

describe("approveVerificationAction", () => {
  it("claims, approves WITHOUT a public listing, then applies the account upgrade (professional)", async () => {
    target("submitted");
    const res = await approveVerificationAction(initial, form({ id: ID }));
    expect(res).toEqual({ ok: true, code: "admin.review.approved" });
    expect(calls()).toEqual(["review_start", "review_approve", "apply_account_upgrade"]);
    expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  describe("public listing is reviewer-set and opt-in", () => {
    it("does NOT list a professional approval by default (missing field)", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
    });

    it("lists only when the box is explicitly ticked", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID, grantListing: "on" }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: true });
    });

    it("ignores any other value for the field", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID, grantListing: "true" }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
    });

    it("never requests a listing for a non-professional subject, whatever the form says", async () => {
      target("under_review", "organization");
      await approveVerificationAction(initial, form({ id: ID, grantListing: "on" }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
    });
  });

  it("does not claim a request that is already under review, and never lists a non-professional one", async () => {
    target("under_review", "identity");
    await approveVerificationAction(initial, form({ id: ID }));
    expect(calls()).toEqual(["review_approve"]);
    expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
  });

  it("applies an organization verification with its own RPC", async () => {
    target("under_review", "organization");
    await approveVerificationAction(initial, form({ id: ID }));
    expect(calls()).toEqual(["review_approve", "apply_organization_verification"]);
  });

  it("trusts the database, not the browser: forged status / type fields are ignored", async () => {
    target("under_review", "professional");
    await approveVerificationAction(initial, form({ id: ID, status: "submitted", verificationType: "identity" }));
    expect(calls()).toEqual(["review_approve", "apply_account_upgrade"]);
  });

  it("is idempotent: an already-approved request goes through review_approve (reviewer gate) and re-runs apply", async () => {
    target("approved");
    const res = await approveVerificationAction(initial, form({ id: ID }));
    expect(res.ok).toBe(true);
    expect(calls()).toEqual(["review_approve", "apply_account_upgrade"]);
  });

  it("a retry by someone who is not the assigned reviewer is refused BEFORE apply runs", async () => {
    target("approved");
    rpc.mockImplementation(async (fn: string) =>
      fn === "review_approve" ? { data: null, error: { message: "only the assigned reviewer may confirm approval" } } : { data: null, error: null },
    );
    const res = await approveVerificationAction(initial, form({ id: ID }));
    expect(res).toEqual({ ok: false, code: "admin.review.error.otherReviewer" });
    expect(calls()).toEqual(["review_approve"]);
  });

  it("an applicant cannot re-apply their own approved request", async () => {
    target("approved");
    rpc.mockImplementation(async (fn: string) =>
      fn === "review_approve" ? { data: null, error: { message: "a reviewer may not approve their own verification" } } : { data: null, error: null },
    );
    expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: false, code: "admin.review.error.ownReview" });
    expect(calls()).not.toContain("apply_account_upgrade");
  });

  it("repairs an approval whose apply failed the first time", async () => {
    target("under_review");
    rpc.mockImplementation(async (fn: string) =>
      fn === "apply_account_upgrade" ? { data: null, error: { message: "boom" } } : { data: null, error: null },
    );
    expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: false, code: "states.genericRetry" });
    // The second attempt sees `approved` and goes straight to apply.
    target("approved");
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await approveVerificationAction(initial, form({ id: ID }))).ok).toBe(true);
    expect(calls()).toEqual(["review_approve", "apply_account_upgrade"]);
  });

  it("refuses a rejected request (invalid transition) without approving it", async () => {
    target("rejected");
    rpc.mockImplementation(async (fn: string) =>
      fn === "review_approve" ? { data: null, error: { message: "invalid transition rejected -> approved" } } : { data: null, error: null },
    );
    const res = await approveVerificationAction(initial, form({ id: ID }));
    expect(res).toEqual({ ok: false, code: "admin.review.error.state" });
    expect(calls()).not.toContain("apply_account_upgrade");
  });

  it("reports a missing or business request as a state error without calling any RPC", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: false, code: "admin.review.error.state" });
    expect(rpc).not.toHaveBeenCalled();
    expect(query.neq).toHaveBeenCalledWith("verification_type", "business");
  });

  it.each([
    ["platform authority required", "admin.review.error.notAuthorized"],
    ["cannot review your own verification", "admin.review.error.ownReview"],
    ["owned by another reviewer", "admin.review.error.otherReviewer"],
    ["only the assigned reviewer may approve", "admin.review.error.otherReviewer"],
  ])("maps the RPC refusal %j to a key and stops before approving or applying", async (message, key) => {
    target("submitted");
    rpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: false, code: key });
    expect(calls()).toEqual(["review_start"]);
  });

  it("explains an incomplete showroom profile at approval and never applies", async () => {
    target("submitted");
    rpc.mockResolvedValueOnce({ data: null, error: null }); // review_start
    rpc.mockResolvedValueOnce({ data: null, error: { message: "complete showroom business information before approval" } }); // review_approve
    expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: false, code: "admin.review.error.incompleteProfile" });
    expect(calls()).toEqual(["review_start", "review_approve"]);
  });

  describe("adminInitiateVerificationAction", () => {
    const base = { subjectType: "user", subjectId: ID, reason: "owner could not submit" };

    it("validates the shape BEFORE any database call (subject type, id, optional note length)", async () => {
      for (const bad of [{ subjectType: "team" }, { subjectId: "not-a-uuid" }, { reason: "x".repeat(501) }]) {
        const res = await adminInitiateVerificationAction(initial, form({ ...base, ...bad }));
        expect(res.ok).toBe(false);
      }
      expect(rpc).not.toHaveBeenCalled();
    });

    it("forwards the subject and reason to the database function and refreshes the lists", async () => {
      rpc.mockResolvedValueOnce({ data: { state: "initiated", verification_id: "v1" }, error: null });
      expect(await adminInitiateVerificationAction(initial, form(base))).toEqual({ ok: true, code: "admin.review.initiated" });
      expect(rpc).toHaveBeenCalledWith("admin_initiate_verification", { p_subject_type: "user", p_subject_id: ID, p_reason: "owner could not submit" });
      expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
    });

    it("reports an already open request as a success that points to Approve / Reject", async () => {
      rpc.mockResolvedValueOnce({ data: { state: "already_open", verification_id: "v1" }, error: null });
      expect(await adminInitiateVerificationAction(initial, form(base))).toEqual({ ok: true, code: "admin.review.alreadyOpen" });
    });

    it.each([
      ["platform reviewer authority required", "admin.review.error.notAuthorized"],
      ["this account already holds an approved professional verification", "admin.review.error.alreadyVerified"],
      ["only a professional account can be verified", "admin.review.error.notEligible"],
      ["the organization has no active owner", "admin.review.error.notEligible"],
      ["a reviewer may not initiate verification for their own account", "admin.review.error.notEligible"],
    ])("maps the database refusal %j to a key", async (message, key) => {
      rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await adminInitiateVerificationAction(initial, form(base))).toEqual({ ok: false, code: key });
    });

    it("never reports success for an unexpected answer", async () => {
      rpc.mockResolvedValueOnce({ data: { state: "weird" }, error: null });
      expect((await adminInitiateVerificationAction(initial, form(base))).ok).toBe(false);
    });
  });

  it("refuses a missing id before touching the database", async () => {
    expect((await approveVerificationAction(initial, form({}))).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("one-click decisions on an account with NO request", () => {
  const SUBJECT = "70000001-0000-4000-8000-0000000000b1";
  const filed = () =>
    rpc.mockImplementation(async (fn: string) =>
      fn === "admin_initiate_verification" ? { data: { state: "initiated", verification_id: ID }, error: null } : { data: null, error: null });

  it("Approve files the request through the authorized function, then claims, approves and applies it", async () => {
    filed();
    target("submitted");
    const res = await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }));
    expect(res).toEqual({ ok: true, code: "admin.review.approved" });
    expect(calls()).toEqual(["admin_initiate_verification", "review_start", "review_approve", "apply_account_upgrade"]);
    expect(rpc).toHaveBeenCalledWith("admin_initiate_verification", { p_subject_type: "user", p_subject_id: SUBJECT });
  });

  describe("RECOVERY: an approved request whose apply step never completed", () => {
    const lookup = (value: unknown) => maybeSingle.mockResolvedValueOnce(value);

    it("Approve resumes the EXACT approved request: no new request, no start, approve then apply", async () => {
      lookup({ data: { id: ID }, error: null });
      maybeSingle.mockResolvedValueOnce({ data: { status: "approved", verification_type: "professional" }, error: null });
      const res = await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }));
      expect(res).toEqual({ ok: true, code: "admin.review.approvalCompleted" });
      expect(calls()).toEqual(["review_approve", "apply_account_upgrade"]);
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
      expect(rpc).toHaveBeenCalledWith("apply_account_upgrade", { p_verification_id: ID });
      expect(query.is).toHaveBeenCalledWith("applied_at", null);
      expect(query.eq).toHaveBeenCalledWith("status", "approved");
      expect(query.eq).toHaveBeenCalledWith("user_id", SUBJECT);
      expect(query.eq).toHaveBeenCalledWith("verification_type", "professional");
    });

    it("answers a completed recovery with its OWN success code; a first approval keeps the normal one", async () => {
      // Recovery by exact id (the button posts the id): the request is already approved when read.
      target("approved");
      expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: true, code: "admin.review.approvalCompleted" });
      // Recovery found by subject lookup.
      lookup({ data: { id: ID }, error: null });
      maybeSingle.mockResolvedValueOnce({ data: { status: "approved", verification_type: "professional" }, error: null });
      expect(await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).toEqual({ ok: true, code: "admin.review.approvalCompleted" });
      // A first approval of a submitted / under-review request is unchanged.
      for (const status of ["submitted", "under_review"]) {
        target(status);
        expect(await approveVerificationAction(initial, form({ id: ID }))).toEqual({ ok: true, code: "admin.review.approved" });
      }
    });

    it("a failed completion returns the error, never a success code", async () => {
      target("approved");
      rpc.mockImplementation(async (fn: string) => (fn === "apply_account_upgrade" ? { data: null, error: { message: "boom" } } : { data: null, error: null }));
      const res = await approveVerificationAction(initial, form({ id: ID }));
      expect(res.ok).toBe(false);
      expect(res.code).not.toBe("admin.review.approvalCompleted");
    });

    it("an unauthorized reviewer is refused by review_approve BEFORE apply runs (no duplicate side effects)", async () => {
      lookup({ data: { id: ID }, error: null });
      maybeSingle.mockResolvedValueOnce({ data: { status: "approved", verification_type: "professional" }, error: null });
      rpc.mockImplementation(async (fn: string) => (fn === "review_approve" ? { data: null, error: { message: "only the assigned reviewer may confirm approval" } } : { data: null, error: null }));
      const res = await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }));
      expect(res).toEqual({ ok: false, code: "admin.review.error.otherReviewer" });
      expect(calls()).toEqual(["review_approve"]);
    });

    it("an authorized reviewer's repeated resume is a no-op for approve and apply", async () => {
      for (let i = 0; i < 2; i += 1) {
        lookup({ data: { id: ID }, error: null });
        maybeSingle.mockResolvedValueOnce({ data: { status: "approved", verification_type: "professional" }, error: null });
        expect((await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).ok).toBe(true);
      }
      expect(calls().filter((c) => c === "admin_initiate_verification" || c === "review_start")).toEqual([]);
    });

    it("FAILS CLOSED when the lookup errors: nothing is filed, started, approved or applied", async () => {
      lookup({ data: null, error: { message: "boom" } });
      expect(await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).toEqual({ ok: false, code: "states.genericRetry" });
      lookup({ data: null, error: { message: "boom" } });
      expect(await rejectVerificationAction(initial, form({ subjectType: "organization", subjectId: SUBJECT }))).toEqual({ ok: false, code: "states.genericRetry" });
      lookup({ data: null, error: { message: "boom" } });
      expect((await adminInitiateVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("Reject and Start are refused while an approved-unapplied request exists (recovery offers Approve only)", async () => {
      lookup({ data: { id: ID }, error: null });
      expect(await rejectVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT, reason: "x" }))).toEqual({ ok: false, code: "admin.review.error.state" });
      lookup({ data: { id: ID }, error: null });
      expect(await adminInitiateVerificationAction(initial, form({ subjectType: "organization", subjectId: SUBJECT }))).toEqual({ ok: false, code: "admin.review.error.state" });
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("Reject files the request and rejects it with NO reason", async () => {
    filed();
    target("submitted");
    const res = await rejectVerificationAction(initial, form({ subjectType: "organization", subjectId: SUBJECT }));
    expect(res).toEqual({ ok: true, code: "admin.review.rejected" });
    expect(calls()).toEqual(["admin_initiate_verification", "review_start", "review_reject"]);
  });

  it("reuses an already-open request (no duplicate) and still decides it", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "admin_initiate_verification" ? { data: { state: "already_open", verification_id: ID }, error: null } : { data: null, error: null });
    target("under_review");
    await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }));
    expect(calls()).toEqual(["admin_initiate_verification", "review_approve", "apply_account_upgrade"]);
  });

  it("stops at the database's refusal (authority / eligibility) and decides nothing", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "platform reviewer authority required" } });
    expect(await approveVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).toEqual({ ok: false, code: "admin.review.error.notAuthorized" });
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "only a professional account can be verified" } });
    expect(await rejectVerificationAction(initial, form({ subjectType: "user", subjectId: SUBJECT }))).toEqual({ ok: false, code: "admin.review.error.notEligible" });
    expect(calls()).toEqual(["admin_initiate_verification"]);
  });

  it("refuses a malformed subject before any database call", async () => {
    for (const bad of [{ subjectType: "team", subjectId: SUBJECT }, { subjectType: "user", subjectId: "nope" }, {}]) {
      expect(await approveVerificationAction(initial, form(bad as Record<string, string>))).toEqual({ ok: false, code: "states.genericRetry" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("rejectVerificationAction", () => {
  it.each(["", "   "])("rejects with NO reason (%j): the reason is optional", async (reason) => {
    target("under_review");
    const res = await rejectVerificationAction(initial, form({ id: ID, reason }));
    expect(res).toEqual({ ok: true, code: "admin.review.rejected" });
    expect(rpc).toHaveBeenLastCalledWith("review_reject", { p_verification_id: ID, p_reason: "" });
  });

  it("refuses an over-long reason before any database call", async () => {
    const res = await rejectVerificationAction(initial, form({ id: ID, reason: "x".repeat(2001) }));
    expect(res).toEqual({ ok: false, code: "admin.review.error.reasonTooLong" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("starts a verification with no note at all", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "initiated", verification_id: "v1" }, error: null });
    const res = await adminInitiateVerificationAction(initial, form({ subjectType: "user", subjectId: ID }));
    expect(res).toEqual({ ok: true, code: "admin.review.initiated" });
  });

  it("claims a submitted request, then rejects with the trimmed reason", async () => {
    target("submitted");
    const res = await rejectVerificationAction(initial, form({ id: ID, reason: "  Blurry ID  " }));
    expect(res).toEqual({ ok: true, code: "admin.review.rejected" });
    expect(calls()).toEqual(["review_start", "review_reject"]);
    expect(rpc).toHaveBeenLastCalledWith("review_reject", { p_verification_id: ID, p_reason: "Blurry ID" });
  });

  it("maps an invalid transition (already decided) to the state error", async () => {
    target("approved");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid transition approved -> rejected" } });
    expect(await rejectVerificationAction(initial, form({ id: ID, reason: "x" }))).toEqual({
      ok: false,
      code: "admin.review.error.state",
    });
  });

  it("surfaces the self-review restriction", async () => {
    target("under_review");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "cannot review your own verification" } });
    expect((await rejectVerificationAction(initial, form({ id: ID, reason: "x" }))).code).toBe("admin.review.error.ownReview");
  });
});

describe("startReviewAction", () => {
  it("forwards only the id and refreshes the users directory too", async () => {
    await startReviewAction(initial, form({ id: ID }));
    expect(rpc).toHaveBeenCalledWith("review_start", { p_verification_id: ID });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });
});
