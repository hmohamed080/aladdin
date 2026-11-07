import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), update: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { admin: { createUser: mocks.create, deleteUser: mocks.remove, updateUserById: mocks.update } } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:63321" }), parseServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "local-test-only" }) }));
import * as admin from "./admin-server";
import { createPhoneSignUpUser, deleteCraftsmanPasswordUser, PASSWORD_SET_FLAG } from "./admin-server";

const grant = { id: "33333333-3333-4333-8333-333333333333", registrationId: "11111111-1111-4111-8111-111111111111", alias: "p201012345678@craftsman-login.aladdin.invalid", phone: "+201012345678", expiresAt: "2030-01-01T00:00:00Z" };
const params = { grant, password: "  valid local password  ", fullName: "Local Test", locale: "ar" as const };
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ data: { user: { id: "fresh-user" } }, error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.update.mockResolvedValue({ error: null }); });

describe("trusted phone identity creation", () => {
  it("creates the alias user only WITH the grant, in app_metadata (never user_metadata), and confirms only the INTERNAL alias", async () => {
    expect(await createPhoneSignUpUser(params)).toEqual({ ok: true, userId: "fresh-user" });
    const sent = mocks.create.mock.lastCall![0];
    expect(sent).toEqual({
      email: grant.alias,
      password: params.password,
      email_confirm: true,
      user_metadata: { full_name: "Local Test", locale: "ar" },
      app_metadata: { registration_source: "phone_whatsapp_sign_up", [PASSWORD_SET_FLAG]: true, phone_signup_grant: grant.id, phone_signup_registration: grant.registrationId },
    });
    expect(JSON.stringify(sent.user_metadata)).not.toContain(grant.id);
    expect(sent).not.toHaveProperty("phone_confirm");
    expect(sent).not.toHaveProperty("role");
  });
  it.each([
    [{ code: "email_exists" }, "exists"],
    [{ code: "user_already_exists" }, "exists"],
    [{ status: 429 }, "rate_limited"],
    [{ code: "weak_password" }, "rejected"],
    [{ code: "unexpected_failure" }, "failed"],
  ])("maps the Auth error %o to %s", async (error, reason) => {
    mocks.create.mockResolvedValue({ data: { user: null }, error });
    expect(await createPhoneSignUpUser(params)).toEqual({ ok: false, reason });
  });
  it("no longer exports a phone-alias creator that takes no grant, nor any app-owned challenge storage", () => {
    for (const retired of ["createCraftsmanPasswordUser", "createShowroomPasswordUser", "insertPhoneChallenge", "loadPhoneChallenge", "consumePhoneChallenge", "recordPhoneChallengeAttempt", "countRecentPhoneChallenges", "deletePhoneChallenge"]) {
      expect(admin).not.toHaveProperty(retired);
    }
  });
  it("does not ban when compensation succeeds", async () => { expect(await deleteCraftsmanPasswordUser("fresh-user")).toBe(true); expect(mocks.update).not.toHaveBeenCalled(); });
  it("quarantines only the newly created identity if compensation fails", async () => { mocks.remove.mockResolvedValue({ error: { code: "unexpected_failure" } }); expect(await deleteCraftsmanPasswordUser("fresh-user")).toBe(false); expect(mocks.update).toHaveBeenCalledWith("fresh-user", { ban_duration: "876000h" }); });
});
