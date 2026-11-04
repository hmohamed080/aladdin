import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const isStaff = vi.fn();
vi.mock("@/server/queries/platform", () => ({ loadIsAdminStaff: () => isStaff() }));
vi.mock("@/server/queries/business-setup", () => ({ computeMandatoryBusinessSetup: vi.fn(async () => ({ required: false })) }));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: vi.fn(async () => "/home") }));

import { GET } from "@/app/auth/staff-invitation/[token]/route";
import { sanitizeNext } from "./next";
import { entryLandingPath } from "./landing-path";
import { needsAccountBasics } from "@/server/queries/account-basics";
import { STAFF_INVITATION_COOKIE } from "./staff-invitation-token";

const TOKEN = "c".repeat(64);
const call = (token: string) => GET(new Request(`https://app.test/auth/staff-invitation/${token}`), { params: Promise.resolve({ token }) });

beforeEach(() => isStaff.mockReset());

describe("the invitation link handoff (token leaves the URL on the first hop)", () => {
  it("stores a well-formed token in an httpOnly, SameSite=Lax, path-scoped cookie and redirects to the TOKENLESS page", async () => {
    const res = await call(TOKEN);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.test/auth/staff-invitation");
    expect(res.headers.get("location")).not.toContain(TOKEN);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${STAFF_INVITATION_COOKIE}=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/auth\/staff-invitation/i);
    expect(cookie).toMatch(/Max-Age=1800/i);
  });
  it("is uncacheable, sends no Referer and is not indexed", async () => {
    const res = await call(TOKEN);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("drops a malformed token: no cookie, still the same redirect", async () => {
    for (const bad of ["short", "G".repeat(64), `${TOKEN}0`, "../../etc/passwd"]) {
      const res = await call(bad);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("location")).toBe("https://app.test/auth/staff-invitation");
    }
  });
});

describe("redirect plumbing", () => {
  it("lets the tokenless staff-invitation pages ride a `next`, and still refuses external or protocol-relative targets", () => {
    expect(sanitizeNext("/auth/staff-invitation")).toBe("/auth/staff-invitation");
    expect(sanitizeNext("/auth/staff-invitation/register")).toBe("/auth/staff-invitation/register");
    for (const evil of ["//evil.test/auth/staff-invitation", "https://evil.test/auth/staff-invitation", "/\evil.test", "javascript:alert(1)"]) {
      expect(sanitizeNext(evil)).toBe("/b2b");
    }
  });
  it("an OAuth or sign-in continuation to the invitation keeps its handoff and never enters registration/onboarding checks", async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as Parameters<typeof entryLandingPath>[0];
    expect(await entryLandingPath(supabase, "/auth/staff-invitation")).toBe("/auth/staff-invitation");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("platform staff are never sent to the marketplace account-basics screen", () => {
  const owesEverything = { rpc: vi.fn(async () => ({ data: { phone: null, governorate: null, city: null, cityCustom: null, specialtyKind: "trades", specialties: [] }, error: null })) } as unknown as Parameters<typeof needsAccountBasics>[0];
  it("staff: no", async () => {
    isStaff.mockResolvedValue(true);
    expect(await needsAccountBasics(owesEverything)).toBe(false);
  });
  it("a marketplace account that owes basics is still asked", async () => {
    isStaff.mockResolvedValue(false);
    expect(await needsAccountBasics(owesEverything)).toBe(true);
  });
});
