import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { WhatsappOtpDeliverySwitch } from "./whatsapp-otp-delivery-switch";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const action = vi.fn(async () => ({ ok: true as const, code: "whatsappOtp.delivery.doneOn" }));
vi.mock("@/server/actions/whatsapp-otp-settings", () => ({ setWhatsappOtpDeliveryAction: (...a: unknown[]) => (action as (...x: unknown[]) => unknown)(...a) }));

const toggle = () => screen.getByRole("switch");

describe("WhatsappOtpDeliverySwitch", () => {
  it("is a real switch that reflects the backend state, never local state", () => {
    const off = renderWithI18n(<WhatsappOtpDeliverySwitch enabled={false} version={0} blockers={[]} />);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().hasAttribute("disabled")).toBe(false);
    off.unmount();
    renderWithI18n(<WhatsappOtpDeliverySwitch enabled version={1} blockers={[]} />);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("the OFF knob is always visible: it never uses the same token as its track (surface on surface-hover vanished in dark mode)", () => {
    const off = renderWithI18n(<WhatsappOtpDeliverySwitch enabled={false} version={0} blockers={[]} />);
    const knob = toggle().querySelector("span")!;
    expect(knob.className).toContain("bg-fg-muted");
    expect(knob.className).not.toContain("bg-surface");
    expect(toggle().className).toContain("bg-surface-hover");
    off.unmount();
    renderWithI18n(<WhatsappOtpDeliverySwitch enabled version={1} blockers={[]} />);
    expect(toggle().querySelector("span")!.className).toContain("bg-surface");
  });

  it("is DISABLED while OFF and a prerequisite is missing, but turning OFF is never blocked", () => {
    const off = renderWithI18n(<WhatsappOtpDeliverySwitch enabled={false} version={0} blockers={["settings_not_initialized"]} />);
    expect(toggle().hasAttribute("disabled")).toBe(true);
    off.unmount();
    renderWithI18n(<WhatsappOtpDeliverySwitch enabled version={2} blockers={["settings_not_initialized"]} />);
    expect(toggle().hasAttribute("disabled")).toBe(false);
  });

  it("clicking never changes anything by itself: it opens a confirmation that requires a reason and carries only the version and the requested state", () => {
    renderWithI18n(<WhatsappOtpDeliverySwitch enabled={false} version={3} blockers={[]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(toggle());
    const dialog = screen.getByRole("dialog");
    expect(action).not.toHaveBeenCalled();
    const reason = within(dialog).getByRole("textbox") as HTMLTextAreaElement;
    expect(reason.required).toBe(true);
    expect(reason.minLength).toBe(10);
    const hidden = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type=hidden]")).map((i) => [i.name, i.value]);
    expect(hidden).toEqual([["version", "3"], ["enabled", "on"]]);
  });

  it("when ON the confirmation asks to turn it OFF", () => {
    renderWithI18n(<WhatsappOtpDeliverySwitch enabled version={4} blockers={[]} />);
    fireEvent.click(toggle());
    const hidden = Array.from(screen.getByRole("dialog").querySelectorAll<HTMLInputElement>("input[type=hidden]")).map((i) => [i.name, i.value]);
    expect(hidden).toEqual([["version", "4"], ["enabled", "off"]]);
  });
});
