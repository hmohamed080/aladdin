import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));
vi.mock("@/server/actions/auth-password-preview", () => ({ requestPasswordSignUp: vi.fn() }));
vi.mock("@/server/auth/phone-sign-up", () => ({ requestPhoneSignUp: vi.fn(), resendPhoneSignUpCode: vi.fn(), verifyPhoneSignUp: vi.fn() }));

import { checkUsername } from "./sign-up";

beforeEach(() => rpc.mockReset());

describe("checkUsername", () => {
  it("rejects a malformed name without a lookup", async () => {
    expect(await checkUsername("_x")).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers available from the username_available RPC", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkUsername(" ahmed ")).toEqual({ status: "available" });
    expect(rpc).toHaveBeenCalledWith("username_available", { p_username: "ahmed" });
  });

  it("offers a free variant when taken", async () => {
    rpc.mockImplementation(async (_name: string, args?: { p_username: string }) => ({ data: args?.p_username !== "ahmed", error: null }));
    const result = await checkUsername("ahmed");
    expect(result.status).toBe("taken");
    expect(result.suggestion).toMatch(/^ahmed\d{2,3}$/);
  });

  it("never reports taken on a lookup failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "500" } });
    expect(await checkUsername("ahmed")).toEqual({ status: "unknown" });
  });
});
