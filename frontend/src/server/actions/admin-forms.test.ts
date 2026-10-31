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
const query = { select: vi.fn(), eq: vi.fn(), neq: vi.fn(), maybeSingle };
query.select.mockReturnValue(query);
query.eq.mockReturnValue(query);
query.neq.mockReturnValue(query);
const from = vi.fn(() => query);
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, from })) }));

const { approveVerificationAction, rejectVerificationAction, startReviewAction } = await import("./admin-forms");

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
  revalidatePath.mockClear();
  from.mockClear();
});

describe("approveVerificationAction", () => {
  it("claims, approves with a public listing, then applies the account upgrade (professional)", async () => {
    target("submitted");
    const res = await approveVerificationAction(initial, form({ id: ID }));
    expect(res).toEqual({ ok: true, code: "admin.review.approved" });
    expect(calls()).toEqual(["review_start", "review_approve", "apply_account_upgrade"]);
    expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  describe("public listing is reviewer-set", () => {
    it("lists a professional approval by default (the queue's historical behaviour)", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: true });
    });

    it("withholds the listing when the reviewer declines it", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID, listingChoice: "1" }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: false });
    });

    it("lists only when the shown choice is ticked", async () => {
      target("under_review");
      await approveVerificationAction(initial, form({ id: ID, listingChoice: "1", grantListing: "on" }));
      expect(rpc).toHaveBeenCalledWith("review_approve", { p_verification_id: ID, p_grant_public_listing: true });
    });

    it("never requests a listing for a non-professional subject, whatever the form says", async () => {
      target("under_review", "organization");
      await approveVerificationAction(initial, form({ id: ID, listingChoice: "1", grantListing: "on" }));
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

  it("refuses a missing id before touching the database", async () => {
    expect((await approveVerificationAction(initial, form({}))).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("rejectVerificationAction", () => {
  it.each(["", "   "])("requires a reason (%j) before any database call", async (reason) => {
    const res = await rejectVerificationAction(initial, form({ id: ID, reason }));
    expect(res).toEqual({ ok: false, code: "admin.review.error.reasonRequired" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
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
