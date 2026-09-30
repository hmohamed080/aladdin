import { describe, it, expect } from "vitest";
import { localizedName, mapDirectoryUser, mapOrgDetail, mapOrgsPage, mapUserDetail, mapUsersPage } from "./directory-mappers";

const USER_ID = "70000001-0000-4000-8000-000000000001";
const PROFILE_ID = "aed52a4d-7757-447f-82f2-8a7b2dc7ef1e";

const userRow = {
  id: USER_ID,
  display_name: "Hana Mansour",
  display_name_ar: "هناء منصور",
  display_name_en: "Hana Mansour",
  username: "hana",
  email: "hana@example.test",
  phone: "+201001234567",
  account_type: "engineer",
  status: "active",
  is_verified: false,
  created_at: "2026-09-30T10:37:13.917782+00:00",
  verification_state: "rejected",
  latest_verification_status: "rejected",
  governorate: "giza",
  city: "sheikh_zayed",
  completion: 57,
  organization: { id: "9c000000-cccc-4ccc-8ccc-000000000001", name: "Cairo Ceramics Showroom", name_ar: "معرض سيراميك القاهرة", name_en: null },
  organization_count: 2,
  profile_id: PROFILE_ID,
  public_profile_available: true,
  flags: ["verification_issue", "possible_duplicate"],
};

describe("mapUsersPage", () => {
  it("maps the envelope, every tab count and the rows", () => {
    const page = mapUsersPage({
      rows: [userRow],
      total: 213,
      page: 21,
      page_size: 10,
      sort: "registered:desc",
      counts: { all: 213, pending: 4, verified: 200, suspended: 2, rejected: 7 },
    });
    expect(page).toMatchObject({ total: 213, page: 21, pageSize: 10, counts: { all: 213, pending: 4, verified: 200, suspended: 2, rejected: 7 } });
    expect(page?.rows).toHaveLength(1);
  });

  it("fails closed on a malformed envelope rather than showing a partial table", () => {
    expect(mapUsersPage(null)).toBeNull();
    expect(mapUsersPage({ rows: [] })).toBeNull();
    expect(mapUsersPage({ rows: [], total: "3", page: 1, page_size: 10, counts: {} })).toBeNull();
  });

  it("drops a malformed row and keeps the valid ones", () => {
    const page = mapUsersPage({ rows: [userRow, { id: 7 }, null], total: 3, page: 1, page_size: 10, counts: { all: 3 } });
    expect(page?.rows.map((r) => r.id)).toEqual([USER_ID]);
  });
});

describe("mapDirectoryUser", () => {
  it("keeps the PROFILE id separate from the user id (the /p/[profileId] key)", () => {
    const u = mapDirectoryUser(userRow);
    expect(u?.id).toBe(USER_ID);
    expect(u?.profileId).toBe(PROFILE_ID);
    expect(u?.profileId).not.toBe(u?.id);
  });

  it("keeps only flags the database defines", () => {
    expect(mapDirectoryUser(userRow)?.flags).toEqual(["verification_issue"]);
  });

  it("clamps completion and defaults an unknown verification state to unverified", () => {
    const u = mapDirectoryUser({ ...userRow, completion: 140, verification_state: "surprise" });
    expect(u?.completion).toBe(100);
    expect(u?.verificationState).toBe("unverified");
  });

  it("represents missing contact data as null, not as an empty string", () => {
    const u = mapDirectoryUser({ ...userRow, email: null, phone: null, organization: null });
    expect(u).toMatchObject({ email: null, phone: null, organization: null });
  });
});

describe("mapUserDetail", () => {
  it("maps completion items, memberships and verification history", () => {
    const d = mapUserDetail({
      ...userRow,
      headline: "Site engineer",
      bio: null,
      last_sign_in_at: null,
      completion: { percent: 50, missing: ["username", "avatar", 3] },
      memberships: [
        { membership_id: "m1", organization_id: "o1", organization_name: "Org", org_type: "supplier", status: "active", capabilities: ["org.manage", 1] },
        { membership_id: "m2" },
      ],
      verifications: [{ id: "v1", submitted_at: "2026-09-01T00:00:00Z", status: "rejected", reason: "blurry" }],
    });
    expect(d?.completion).toEqual({ percent: 50, missing: ["username", "avatar"] });
    expect(d?.memberships).toHaveLength(1);
    expect(d?.memberships[0]?.capabilities).toEqual(["org.manage"]);
    expect(d?.verifications[0]).toMatchObject({ id: "v1", status: "rejected", reason: "blurry" });
    expect(d?.lastSignInAt).toBeNull();
    expect(d).not.toHaveProperty("flags");
  });
});

describe("organizations", () => {
  it("maps a directory page and derives verification state from real fields", () => {
    const page = mapOrgsPage({
      rows: [
        { id: "o1", name: "A", org_type: "supplier", status: "pending_verification", is_verified: false, created_at: "2026-01-01T00:00:00Z", member_count: 3, branch_count: 1, owner: { user_id: "u1", display_name: "Owner" } },
        { id: "o2", name: "B", org_type: "importer", status: "active", is_verified: true, created_at: "2026-01-02T00:00:00Z", owner: null },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      counts: { all: 2, pending: 1, verified: 1, suspended: 0 },
    });
    expect(page?.rows.map((o) => o.verificationState)).toEqual(["pending", "verified"]);
    expect(page?.rows[0]?.owner).toEqual({ userId: "u1", displayName: "Owner" });
    expect(page?.rows[1]?.owner).toBeNull();
  });

  it("maps organization detail collections, dropping malformed entries", () => {
    const d = mapOrgDetail({
      id: "o1",
      name: "A",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      referred_by: { user_id: "u9", display_name: "Referrer" },
      owners: [{ user_id: "u1", display_name: "Owner" }, {}],
      members: [{ membership_id: "m1", user_id: "u1", display_name: "Owner", status: "active", capabilities: ["org.manage"] }],
      branches: [{ id: "b1", name: "Main", name_ar: "الرئيسي", is_active: true }],
      verifications: [],
    });
    expect(d?.owners).toHaveLength(1);
    expect(d?.referredBy?.userId).toBe("u9");
    expect(d?.branches[0]).toMatchObject({ id: "b1", nameAr: "الرئيسي", isActive: true });
    expect(d).not.toHaveProperty("memberCount");
  });
});

describe("localizedName", () => {
  it("prefers the locale's variant and falls back to the canonical name", () => {
    expect(localizedName({ name: "Cairo Ceramics", nameAr: "سيراميك القاهرة", nameEn: null }, "ar")).toBe("سيراميك القاهرة");
    expect(localizedName({ name: "Cairo Ceramics", nameAr: "سيراميك القاهرة", nameEn: null }, "en")).toBe("Cairo Ceramics");
  });
});
