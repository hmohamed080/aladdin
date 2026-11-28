import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));

const { saveSecondaryPhoneAction, makeSecondaryPhonePrimaryAction } = await import("./secondary-phone");
const { createTranslator } = await import("@/lib/i18n/translate");

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const RECEIPT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => rpc.mockReset());

describe("second phone actions", () => {
  it("confirms the password for exactly this operation and number, then forwards the receipt", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    const r = await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "pw", mode: "reserve" }));
    expect(r).toEqual({ ok: true, code: "profileIdentity.secondaryPhone.reserved" });
    expect(rpc.mock.calls[0]).toEqual(["account_password_confirm", { p_password: "pw", p_operation: "secondary_phone.reserve", p_target: "+201012345678" }]);
    expect(rpc.mock.calls[1]).toEqual(["secondary_phone_reserve", { p_phone: "+201012345678", p_receipt: RECEIPT }]);
  });

  it("a change asks for a change receipt and calls the change RPC", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "pw", mode: "change" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_operation: "secondary_phone.change" });
    expect(rpc.mock.calls[1]?.[0]).toBe("secondary_phone_change");
  });

  it("never reserves without a confirmed password", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "wrong_password" }, error: null });
    const r = await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "nope" }));
    expect(r.code).toBe("profileIdentity.secondaryPhone.errors.wrongPassword");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps the lockout, the cooldown and a conflict without saying who holds the number", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "locked" }, error: null });
    expect((await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "x" }))).code).toBe(
      "profileIdentity.secondaryPhone.errors.locked",
    );
    rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({ data: null, error: { code: "55P03", message: "phone number is in cooldown until x" } });
    expect((await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "x" }))).code).toBe(
      "profileIdentity.secondaryPhone.errors.cooldown",
    );
    rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({ data: null, error: { code: "23505", message: "phone number is unavailable" } });
    expect((await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "x" }))).code).toBe(
      "profileIdentity.secondaryPhone.errors.unavailable",
    );
  });

  it("your own main phone as the second phone (add or change) gets the friendly 'already your main phone' copy in both languages", async () => {
    for (const mode of ["reserve", "change"] as const) {
      rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message: "this is already your primary phone" },
      });
      const r = await saveSecondaryPhoneAction({ ok: false }, form({ e164: "+201012345678", password: "x", mode }));
      expect(r).toEqual({ ok: false, code: "profileIdentity.secondaryPhone.errors.alreadyPrimary" });
    }
    // The key resolves to real copy (a missing key would render as the raw key).
    expect(createTranslator("en")("profileIdentity.secondaryPhone.errors.alreadyPrimary")).toBe("This is already your main phone.");
    expect(createTranslator("ar")("profileIdentity.secondaryPhone.errors.alreadyPrimary")).toBe("هذا هو هاتفك الأساسي بالفعل.");
  });

  it("refuses a non-canonical number before any call", async () => {
    const r = await saveSecondaryPhoneAction({ ok: false }, form({ e164: "01012345678", password: "x" }));
    expect(r.code).toBe("profileIdentity.secondaryPhone.errors.invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a phone-login account is told its login phone stays", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, receipt: RECEIPT }, error: null }).mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "phone identity changes require verified recovery" },
    });
    const r = await makeSecondaryPhonePrimaryAction({ ok: false }, form({ e164: "+201012345678", password: "x", countryIso2: "EG", national: "1012345678" }));
    expect(r.code).toBe("profileIdentity.secondaryPhone.errors.loginPhone");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_operation: "secondary_phone.convert" });
  });
});
