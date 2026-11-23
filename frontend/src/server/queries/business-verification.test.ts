import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { loadBusinessVerificationDetail, parseMyBusinessVerification } from "./business-verification";

describe("parseMyBusinessVerification", () => {
  it("maps the RPC payload and fails closed on unknown values", () => {
    const v = parseMyBusinessVerification({
      organization_status: "active",
      status: "needs_info",
      verified_at: null,
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

describe("loadBusinessVerificationDetail social links", () => {
  const base = { id: "v1", status: "pending", submissions: [], previous: [] };
  const load = async (organization: Record<string, unknown>) => {
    const supabase = { rpc: async () => ({ data: { ...base, organization }, error: null }) } as never;
    return (await loadBusinessVerificationDetail(supabase, "v1"))!.organization;
  };

  it("maps the four link fields from the RPC payload", async () => {
    const o = await load({
      id: "o1", name: "Show", facebook_url: "https://www.facebook.com/showroom1", instagram_url: "https://www.instagram.com/show",
      tiktok_url: "https://www.tiktok.com/@show", website_url: "https://show.example.com",
    });
    expect(o).toMatchObject({
      facebookUrl: "https://www.facebook.com/showroom1", instagramUrl: "https://www.instagram.com/show",
      tiktokUrl: "https://www.tiktok.com/@show", websiteUrl: "https://show.example.com",
    });
  });

  it("is null when absent or not a string", async () => {
    const o = await load({ id: "o1", name: "Show", facebook_url: 5, instagram_url: { a: 1 } });
    expect(o).toMatchObject({ facebookUrl: null, instagramUrl: null, tiktokUrl: null, websiteUrl: null });
  });
});
