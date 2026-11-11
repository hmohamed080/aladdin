import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));
vi.mock("@/server/actions/auth-password-preview", () => ({ requestPasswordSignUp: vi.fn() }));
vi.mock("@/server/auth/phone-sign-up", () => ({ requestPhoneSignUp: vi.fn(), resendPhoneSignUpCode: vi.fn(), verifyPhoneSignUp: vi.fn() }));

import { checkUsername } from "./sign-up";

describe("checkUsername (inert since P1 PR-2)", () => {
  it("makes no database call and always answers the neutral unknown state", async () => {
    for (const raw of ["ahmed", "_x", " ", undefined, 42]) {
      expect(await checkUsername(raw)).toEqual({ status: "unknown" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
