import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUserById: vi.fn(), eq: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ is: () => ({ eq: mocks.eq }) }) }),
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:63321" }), parseServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "local-test-only" }) }));
import * as admin from "./admin-server";

beforeEach(() => vi.clearAllMocks());

describe("savePendingRegistration (P1 PR-2)", () => {
  it("calls pending_registration_save with an EXPLICIT p_username: null (only p_ttl_minutes has a default)", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await admin.savePendingRegistration({ userId: "u1", audienceKind: "persona_type", audienceValue: "engineer" })).toBe(true);
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("pending_registration_save");
    expect(args).toEqual({ p_user_id: "u1", p_username: null, p_audience_kind: "persona_type", p_audience_value: "engineer" });
    expect(Object.prototype.hasOwnProperty.call(args, "p_username")).toBe(true);
    expect(args).not.toHaveProperty("p_ttl_minutes");
  });

  it("does not depend on the lease boolean the pre-M1 function returned: success means no error", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await admin.savePendingRegistration({ userId: "u1", audienceKind: "organization_type", audienceValue: "supplier" })).toBe(true);
  });

  it("a pre-M1 database refusing the NULL username is a logged best-effort failure, never a throw", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23502", message: "null value in column username" } });
    expect(await admin.savePendingRegistration({ userId: "u1", audienceKind: "persona_type", audienceValue: "engineer" })).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe("retired helpers", () => {
  it("no longer exports the birth date writer", () => {
    expect(admin).not.toHaveProperty("saveVerifiedBirthDate");
  });

  it("resolveSignInEmail resolves a phone number to its alias and has no username branch", async () => {
    mocks.eq.mockReturnValue({ limit: async () => ({ data: [{ user_id: "u9" }], error: null }) });
    mocks.getUserById.mockResolvedValue({ data: { user: { email: "p201012345678@craftsman-login.aladdin.invalid" } }, error: null });
    expect(await admin.resolveSignInEmail({ phoneE164: "+201012345678" })).toBe("p201012345678@craftsman-login.aladdin.invalid");
    expect(mocks.eq).toHaveBeenCalledWith("phone_e164", "+201012345678");
    mocks.eq.mockClear();
    mocks.eq.mockReturnValue({ limit: async () => ({ data: [], error: null }) });
    expect(await admin.resolveSignInEmail({ phoneE164: "+201099999999" })).toBeNull();
    // A legacy caller passing a username key must never reach a username column.
    await admin.resolveSignInEmail({ username: "x" } as never).catch(() => undefined);
    for (const call of mocks.eq.mock.calls) expect(call[0]).not.toBe("username_normalized");
  });
});
