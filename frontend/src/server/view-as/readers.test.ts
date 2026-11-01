import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { craftsmanViewAsReader } = await import("./readers");

const SUBJECT = "71000006-0000-4000-8000-000000000006";
const rpc = vi.fn();
const reader = () => craftsmanViewAsReader({ rpc } as never, SUBJECT);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("craftsmanViewAsReader", () => {
  it.each([
    ["dashboard", "admin_view_craftsman_dashboard", { p_subject: SUBJECT }],
    ["profile", "admin_view_craftsman_profile", { p_subject: SUBJECT }],
    ["portfolio", "admin_view_craftsman_portfolio", { p_subject: SUBJECT }],
    ["work", "admin_view_craftsman_work", { p_subject: SUBJECT, p_limit: 25 }],
    ["points", "admin_view_craftsman_points", { p_subject: SUBJECT, p_limit: 50 }],
    ["reviews", "admin_view_craftsman_reviews", { p_subject: SUBJECT, p_limit: 50 }],
  ] as const)("%s reads ONLY the explicitly authorized subject through %s", async (method, fn, args) => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await reader()[method]();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(fn, args);
  });

  it("sends the admin back to the user page when the database refuses (session ended, revoked, rank changed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not permitted" } });
    await expect(reader().profile()).rejects.toThrow(`REDIRECT:/admin/users/${SUBJECT}`);
  });

  it("surfaces any other database error instead of rendering partial data", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(reader().work()).rejects.toThrow("view-as read failed");
    expect(redirect).not.toHaveBeenCalled();
  });
});
