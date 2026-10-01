import { describe, it, expect, vi, beforeEach } from "vitest";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";

/**
 * `loadStaffRanks` (rank-aware controls) and `withAccountEmails` (Staff list email).
 *
 * The email source is the SAME one the Users directory uses (`admin_user_detail` -> `app.user_facing_email`), never a
 * `public.contacts` row we would have to invent and never the Auth Admin API; it needs `users.read`, and any failure
 * leaves the member's email `null` rather than failing the page.
 */
vi.mock("server-only", () => ({}));
const loadUserDetail = vi.fn();
vi.mock("@/server/queries/admin-directory", () => ({ loadUserDetail: (...a: unknown[]) => loadUserDetail(...a) }));

const { loadStaffRanks, withAccountEmails } = await import("./admin-rbac");

const ALL = [...ADMIN_PERMISSIONS];
const acc = (rank: number, permissions: readonly (typeof ALL)[number][]): AdminAccess => ({ isStaff: true, rank, permissions, roles: [] });
const administrator = acc(80, ALL.filter((p) => p !== "roles.manage"));

type Member = Parameters<typeof withAccountEmails>[2][number];
const member = (userId: string, email: string | null): Member => ({
  userId,
  displayName: userId,
  email,
  accountStatus: "active",
  isActive: true,
  firstAssignedAt: "2026-10-01T00:00:00Z",
  lastSignInAt: null,
  assignments: [],
  rank: 80,
});

const supabase = {} as never;

beforeEach(() => loadUserDetail.mockReset());

describe("withAccountEmails", () => {
  it("fills a missing email from the Users directory read, keeps existing emails, and never re-reads them", async () => {
    loadUserDetail.mockImplementation(async (_s: unknown, id: string) => ({ ok: true, data: { email: `${id}@example.test` } }));
    const out = await withAccountEmails(supabase, administrator, [member("a", null), member("b", "kept@example.test")]);
    expect(out.map((m) => m.email)).toEqual(["a@example.test", "kept@example.test"]);
    expect(loadUserDetail).toHaveBeenCalledTimes(1);
    expect(loadUserDetail.mock.calls[0]?.[1]).toBe("a");
  });

  it("does nothing without users.read (no extra reads, emails untouched)", async () => {
    const out = await withAccountEmails(supabase, acc(40, ["admin_staff.read"]), [member("a", null)]);
    expect(out[0]?.email).toBeNull();
    expect(loadUserDetail).not.toHaveBeenCalled();
  });

  it("leaves the email null when the read fails, returns nothing for the account, or the account has no email", async () => {
    loadUserDetail
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({ ok: true, data: { email: null } });
    const out = await withAccountEmails(supabase, administrator, [member("a", null), member("b", null), member("c", null)]);
    expect(out.map((m) => m.email)).toEqual([null, null, null]);
  });

  it("caps the lookups so a large roster cannot fan out unbounded", async () => {
    loadUserDetail.mockResolvedValue({ ok: true, data: { email: "x@example.test" } });
    const roster = Array.from({ length: 80 }, (_, i) => member(`u${i}`, null));
    await withAccountEmails(supabase, administrator, roster);
    expect(loadUserDetail.mock.calls.length).toBeLessThanOrEqual(50);
  });
});

describe("loadStaffRanks", () => {
  const rpcWith = (rows: unknown[] | null) => ({ rpc: vi.fn(async () => ({ data: rows, error: rows ? null : { message: "boom" } })) }) as never;
  const row = (id: string, active: boolean, rank: number) => ({
    user_id: id,
    display_name: id,
    email: null,
    account_status: "active",
    is_active: active,
    first_assigned_at: "2026-10-01T00:00:00Z",
    last_sign_in_at: null,
    assignments: [
      { id: `a-${id}`, role_id: "r", role_key: "x", role_name: "x", is_system: true, rank, role_status: "active", scope_type: "platform", is_active: active, created_at: "2026-10-01T00:00:00Z" },
    ],
  });

  it("is null without admin_staff.read, so the UI draws the control and the server judges", async () => {
    const client = rpcWith([row("a", true, 80)]);
    expect(await loadStaffRanks(client, acc(40, ["users.read"]))).toBeNull();
  });

  it("is null when the read fails", async () => {
    expect(await loadStaffRanks(rpcWith(null), administrator)).toBeNull();
  });

  it("maps ACTIVE staff to their highest platform rank; disabled members are absent (rank 0)", async () => {
    const ranks = await loadStaffRanks(rpcWith([row("sa", true, 100), row("adm", true, 80), row("gone", false, 80)]), administrator);
    expect(ranks?.get("sa")).toBe(100);
    expect(ranks?.get("adm")).toBe(80);
    expect(ranks?.has("gone")).toBe(false);
  });
});
