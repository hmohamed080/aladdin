import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { parseMyBusinessVerification } from "./business-verification";

describe("parseMyBusinessVerification", () => {
  it("maps the RPC payload and fails closed on unknown values", () => {
    const v = parseMyBusinessVerification({
      organization_status: "active",
      status: "needs_info",
      verified_at: null,
      legacy_verified: false,
      reason: "Please add the tax card",
      can_upload: true,
      can_submit: "yes",
      is_resubmission: true,
      drafts: [{ id: "d1", doc_type: "tax_card", file_name: "tax.pdf", content_type: "application/pdf", size_bytes: 2048, object_key: "k", created_at: "2026-10-17T00:00:00Z" }],
      requests: [{ id: "r1", status: "bogus", submissions: [{ id: "s1", round: 1, note: "", documents: [] }] }],
    });
    expect(v.status).toBe("needs_info");
    expect(v.canUpload).toBe(true);
    expect(v.canSubmit).toBe(false);
    expect(v.drafts[0]).toMatchObject({ docType: "tax_card", sizeBytes: 2048 });
    expect(v.requests[0]!.status).toBe("none");
    expect(v.requests[0]!.submissions[0]!.note).toBeNull();
  });

  it("treats a missing payload as nothing to show", () => {
    expect(parseMyBusinessVerification(null)).toMatchObject({ status: "none", canUpload: false, canSubmit: false, drafts: [], requests: [] });
  });
});
