import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerSettings, type InstallerSettingsData } from "./installer-settings";

const changePhone = vi.hoisted(() => vi.fn());
const changePassword = vi.hoisted(() => vi.fn());
const setDisplayName = vi.hoisted(() => vi.fn());

vi.mock("@/server/actions/installer-security", () => ({ changeInstallerPhone: changePhone, changeInstallerPassword: changePassword }));
vi.mock("@/server/actions/profile-identity", () => ({ setDisplayNameAction: setDisplayName }));
vi.mock("@/server/actions/contact-email", () => ({ startContactEmailAction: vi.fn(async () => ({ ok: true, code: "contactEmail.sent" })), removeContactEmailAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/server/actions/secondary-phone", () => ({
  saveSecondaryPhoneAction: vi.fn(), renewSecondaryPhoneAction: vi.fn(),
  cancelSecondaryPhoneAction: vi.fn(), makeSecondaryPhonePrimaryAction: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() })); // pulled in through the preview module's shell imports
vi.mock("next/navigation", () => ({ usePathname: () => "/home/settings", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/dynamic", async () => {
  const { InstallerPhoneField } = await import("@/features/installer-dashboard-preview/installer-phone-field");
  return { default: () => InstallerPhoneField };
});

const DATA: InstallerSettingsData = {
  displayName: "Ahmed Mahmoud",
  phoneE164: "+201012345678",
  phoneNational: "1012345678",
  phoneVerified: false,
  phoneAccount: true,
  contactEmail: { status: "none", email: null, verifiedVia: null, pendingUntil: null },
  hasPassword: true,
  secondaryPhone: null,
};
const GOOD_PW = "Correct-horse-battery-1";
const NEW_PW = "Another-long-passphrase-9";

const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const settle = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  changePhone.mockReset();
  changePassword.mockReset();
  setDisplayName.mockReset();
});

describe("installer settings (production)", () => {
  it("renders the approved four sections with the account's REAL data and no preview wording", () => {
    renderWithI18n(<InstallerSettings data={DATA} />, "en");
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument();
    for (const name of ["Personal information", "Privacy & security", "Notifications", "Account settings", "Sign-in methods", "Active sessions", "Trusted devices", "Account recovery", "Change password"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/Display name/)).toHaveValue("Ahmed Mahmoud");
    expect(within(screen.getByTestId("settings-current-phone")).getByText("+201012345678")).toBeInTheDocument();
    expect(screen.getByTestId("settings-phone-status")).toHaveTextContent("Not verified");
    expect(document.body).not.toHaveTextContent(/preview/i);
  });

  it("states how THIS account signs in: phone + password, or email + password", () => {
    const { unmount } = renderWithI18n(<InstallerSettings data={DATA} />, "en");
    expect(screen.getByTestId("settings-sign-in-method")).toHaveTextContent("You sign in with the phone number you registered with and your password.");
    expect(screen.getByText("This number is also how you sign in.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/your email address and your password/);
    unmount();

    renderWithI18n(<InstallerSettings data={{ ...DATA, phoneAccount: false }} />, "en");
    expect(screen.getByTestId("settings-sign-in-method")).toHaveTextContent(/^You sign in with your email address and your password\./);
    expect(screen.queryByText("This number is also how you sign in.")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/phone number you registered with/);
    expect(document.body).not.toHaveTextContent("Ahmed Mahmoud".replace("Ahmed", "Mona")); // sanity: nothing hard-coded
  });

  it("shows no fictitious connected / enabled / saved state for controls whose backend is not connected", () => {
    renderWithI18n(<InstallerSettings data={DATA} />, "en");
    // Google / Facebook are not "Connected"; only the phone sign-in is.
    expect(screen.getAllByText("Connected")).toHaveLength(1);
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(6);
    for (const name of [/Enable two-step verification/, /Enable notifications/]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    for (const name of ["Temporarily suspend account", "Delete account"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    // The contact email is connected: it shows the database state (none yet) and an Add control, never a fake value.
    expect(screen.getByTestId("contact-email-status")).toHaveTextContent("Not added");
    expect(screen.getByRole("button", { name: "Add email" })).toBeEnabled();
    // The secondary phone (PR #88) is connected too.
    expect(screen.getByTestId("settings-secondary-phone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active sessions/ })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("saves the display name through the real action and reports the backend's answer only", async () => {
    setDisplayName.mockResolvedValueOnce({ ok: true });
    renderWithI18n(<InstallerSettings data={DATA} />, "en");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing edited yet
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Ahmed M." } });
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(setDisplayName).toHaveBeenCalledTimes(1));
    expect(fields(setDisplayName.mock.calls[0]![1] as FormData)).toEqual({ displayName: "Ahmed M." });
    expect(await screen.findByTestId("name-saved")).toBeInTheDocument();
  });

  it("shows the real error when the display name is refused", async () => {
    setDisplayName.mockResolvedValueOnce({ ok: false, code: "profileIdentity.displayName.error" });
    renderWithI18n(<InstallerSettings data={DATA} />, "en");
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("name-saved")).not.toBeInTheDocument();
  });

  describe("change phone", () => {
    async function open() {
      renderWithI18n(<InstallerSettings data={DATA} />, "en");
      fireEvent.click(screen.getByRole("button", { name: "Change phone number" }));
      const form = document.getElementById("settings-phone-change") as HTMLFormElement;
      return { form, submit: within(form).getByRole("button", { name: "Confirm phone change" }) };
    }

    it("needs the new number AND the current password before it can be sent", async () => {
      const { form, submit } = await open();
      expect(submit).toBeDisabled();
      fireEvent.change(within(form).getByLabelText("New phone number"), { target: { value: "01112223334" } });
      expect(submit).toBeDisabled();
      fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: GOOD_PW } });
      expect(submit).toBeEnabled();
    });

    it("sends country + national + current password + request id (never an E.164, never an alias) and clears the password", async () => {
      changePhone.mockResolvedValueOnce({ ok: true, code: "installerSecurity.phone.done" });
      const { form, submit } = await open();
      fireEvent.change(within(form).getByLabelText("New phone number"), { target: { value: "01112223334" } });
      const password = within(form).getByLabelText("Current password");
      fireEvent.change(password, { target: { value: GOOD_PW } });
      await act(async () => { fireEvent.click(submit); });
      await waitFor(() => expect(changePhone).toHaveBeenCalledTimes(1));
      const sent = fields(changePhone.mock.calls[0]![1] as FormData);
      expect(Object.keys(sent).sort()).toEqual(["countryIso2", "currentPassword", "national", "requestId"]);
      expect(sent.countryIso2).toBe("EG");
      expect(sent.national).toBe("1112223334");
      expect(sent.currentPassword).toBe(GOOD_PW);
      expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("claims success only after the backend answers ok, says the new number is unverified, and closes the form", async () => {
      let resolve!: (value: unknown) => void;
      changePhone.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      const { form, submit } = await open();
      fireEvent.change(within(form).getByLabelText("New phone number"), { target: { value: "01112223334" } });
      fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: GOOD_PW } });
      await act(async () => { fireEvent.click(submit); });
      // In flight: busy, no success claim yet.
      expect(screen.queryByTestId("phone-change-success")).not.toBeInTheDocument();
      expect(within(form).getByRole("button", { name: "Changing…" })).toBeDisabled();
      await act(async () => { resolve({ ok: true, code: "installerSecurity.phone.done" }); });
      const success = await screen.findByTestId("phone-change-success");
      expect(success).toHaveTextContent("Your phone number was changed");
      expect(success).toHaveTextContent("not verified yet");
      expect(document.getElementById("settings-phone-change")).toBeNull();
    });

    it.each([
      ["installerSecurity.error.wrongPassword", "The current password is incorrect."],
      ["installerSecurity.error.phoneUnavailable", "This phone number is unavailable."],
      ["installerSecurity.error.phoneNotConfirmed", "We couldn't confirm the change yet"],
      ["installerSecurity.error.needsAttention", "needs support review"],
      ["installerSecurity.error.notInstaller", "only available for phone sign-in accounts"],
    ])("shows %s and keeps the form open without claiming success", async (code, text) => {
      changePhone.mockResolvedValueOnce({ ok: false, code });
      const { form, submit } = await open();
      fireEvent.change(within(form).getByLabelText("New phone number"), { target: { value: "01112223334" } });
      fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: GOOD_PW } });
      await act(async () => { fireEvent.click(submit); });
      expect(await screen.findByTestId("phone-change-error")).toHaveTextContent(text);
      expect(screen.queryByTestId("phone-change-success")).not.toBeInTheDocument();
      expect(document.getElementById("settings-phone-change")).not.toBeNull();
      expect(within(form).getByLabelText("Current password")).toHaveValue(""); // must be retyped
    });

    it("shows the M2 lockout with when to try again", async () => {
      changePhone.mockResolvedValueOnce({ ok: false, code: "installerSecurity.error.locked", retryAfterSeconds: 600 });
      const { form, submit } = await open();
      fireEvent.change(within(form).getByLabelText("New phone number"), { target: { value: "01112223334" } });
      fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: GOOD_PW } });
      await act(async () => { fireEvent.click(submit); });
      expect(await screen.findByTestId("phone-change-error")).toHaveTextContent(/Too many incorrect attempts.*Try again in about 10 min\./);
    });

    it("cancel closes the form and drops the typed password", async () => {
      const { form } = await open();
      fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: GOOD_PW } });
      fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
      expect(document.getElementById("settings-phone-change")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Change phone number" }));
      expect(within(document.getElementById("settings-phone-change")!).getByLabelText("Current password")).toHaveValue("");
    });

    it("is not offered to an account that does not sign in with phone + password", () => {
      renderWithI18n(<InstallerSettings data={{ ...DATA, phoneAccount: false }} />, "en");
      expect(screen.queryByRole("button", { name: "Change phone number" })).not.toBeInTheDocument();
      expect(screen.getAllByText("Available for phone sign-in accounts only.").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    });
  });

  describe("change password", () => {
    function open() {
      renderWithI18n(<InstallerSettings data={DATA} />, "en");
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
      const form = document.getElementById("settings-password-change") as HTMLFormElement;
      const type = (label: string, value: string) => fireEvent.change(within(form).getByLabelText(label), { target: { value } });
      return { form, type, submit: within(form).getByRole("button", { name: "Update password" }) };
    }

    it("has current / new / confirm fields, a visibility toggle, and live policy feedback", () => {
      const { form, type } = open();
      for (const label of ["Current password", "New password", "Confirm new password"]) expect(within(form).getByLabelText(label)).toHaveAttribute("type", "password");
      fireEvent.click(within(form).getAllByRole("button", { name: "Show password" })[1]!);
      expect(within(form).getByLabelText("New password")).toHaveAttribute("type", "text");
      type("New password", "password123");
      expect(within(form).getByText("Not a common or easily guessed password")).toBeInTheDocument();
    });

    it("blocks a mismatching confirmation", () => {
      const { form, type, submit } = open();
      type("Current password", GOOD_PW);
      type("New password", NEW_PW);
      type("Confirm new password", NEW_PW + "x");
      expect(within(form).getByText("The new password and its confirmation don't match.")).toBeInTheDocument();
      expect(submit).toBeDisabled();
    });

    it("sends the three values, shows success only after the backend answers, and clears every field", async () => {
      changePassword.mockResolvedValueOnce({ ok: true, code: "installerSecurity.password.done" });
      const { type, submit } = open();
      type("Current password", GOOD_PW);
      type("New password", NEW_PW);
      type("Confirm new password", NEW_PW);
      await act(async () => { fireEvent.click(submit); });
      await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
      expect(fields(changePassword.mock.calls[0]![1] as FormData)).toEqual({ currentPassword: GOOD_PW, newPassword: NEW_PW, confirmNewPassword: NEW_PW });
      expect(await screen.findByTestId("password-change-success")).toHaveTextContent("Your password was changed");
      expect(document.getElementById("settings-password-change")).toBeNull();
      // Reopened, nothing is remembered.
      fireEvent.click(screen.getByRole("button", { name: "Change password" }));
      const reopened = document.getElementById("settings-password-change")!;
      for (const label of ["Current password", "New password", "Confirm new password"]) expect(within(reopened).getByLabelText(label)).toHaveValue("");
    });

    it.each([
      ["installerSecurity.error.wrongPassword", "The current password is incorrect."],
      ["installerSecurity.error.verificationExpired", "The confirmation expired"],
      ["installerSecurity.error.passwordNotConfirmed", "We couldn't confirm the new password yet"],
      ["temporaryCraftsman.error.passwordCommon", "too common"],
    ])("shows %s without claiming success, keeps the new pair, and clears the current password", async (code, text) => {
      changePassword.mockResolvedValueOnce({ ok: false, code });
      const { form, type, submit } = open();
      type("Current password", GOOD_PW);
      type("New password", NEW_PW);
      type("Confirm new password", NEW_PW);
      await act(async () => { fireEvent.click(submit); });
      expect(await screen.findByTestId("password-change-error")).toHaveTextContent(text);
      expect(screen.queryByTestId("password-change-success")).not.toBeInTheDocument();
      expect(within(form).getByLabelText("Current password")).toHaveValue("");
      expect(within(form).getByLabelText("New password")).toHaveValue(NEW_PW);
    });

    it("shows the M2 lockout with the wait", async () => {
      changePassword.mockResolvedValueOnce({ ok: false, code: "installerSecurity.error.locked", retryAfterSeconds: 61 });
      const { type, submit } = open();
      type("Current password", GOOD_PW);
      type("New password", NEW_PW);
      type("Confirm new password", NEW_PW);
      await act(async () => { fireEvent.click(submit); });
      expect(await screen.findByTestId("password-change-error")).toHaveTextContent(/Too many incorrect attempts.*about 2 min/);
    });

    it("keeps no password in browser storage", async () => {
      changePassword.mockResolvedValueOnce({ ok: true, code: "installerSecurity.password.done" });
      const { type, submit } = open();
      type("Current password", GOOD_PW);
      type("New password", NEW_PW);
      type("Confirm new password", NEW_PW);
      await act(async () => { fireEvent.click(submit); });
      await settle();
      for (const store of [window.localStorage, window.sessionStorage]) expect(JSON.stringify({ ...store })).not.toContain(NEW_PW);
    });
  });

  describe("no application username (Phase 1)", () => {
    it("shows no username field or copy, in either language", () => {
      const { unmount } = renderWithI18n(<InstallerSettings data={DATA} />, "en");
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/username/i);
      unmount();
      renderWithI18n(<InstallerSettings data={DATA} />, "ar");
      expect(screen.queryByLabelText("اسم المستخدم")).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("اسم المستخدم");
    });
  });

  it("renders in Arabic RTL with the same structure", () => {
    renderWithI18n(<InstallerSettings data={DATA} />, "ar");
    const root = document.querySelector("[data-installer-settings]");
    expect(root).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "الإعدادات", level: 1 })).toBeInTheDocument();
    for (const name of ["البيانات الشخصية", "الخصوصية والأمان", "الإشعارات", "إعدادات الحساب"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByTestId("settings-phone-status")).toHaveTextContent("غير مُوثَّق");
    expect(screen.getAllByText("غير متاح بعد").length).toBeGreaterThanOrEqual(6);
    fireEvent.click(screen.getByRole("button", { name: "تغيير رقم الهاتف" }));
    expect(within(document.getElementById("settings-phone-change")!).getByLabelText("كلمة المرور الحالية")).toBeInTheDocument();
  });
});
