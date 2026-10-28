import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";
import { LandingHeader } from "./landing-header";

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({ locale: "ar", dir: "rtl", t: createTranslator("ar") }),
}));
vi.mock("@/components/layout/switchers", () => ({ LanguageSwitch: () => <button type="button">EN</button> }));

describe("landing header: marketplace link", () => {
  it("always points at /marketplace (the coming-soon page) and keeps anchors on the home page", () => {
    render(<LandingHeader anchorBase="/" />);
    expect(screen.getByRole("link", { name: "السوق" })).toHaveAttribute("href", "/marketplace");
    // in-page anchors keep their base so they return to the home page from other routes
    expect(screen.getByRole("link", { name: "عن المنصة" })).toHaveAttribute("href", "/#how-it-works");
  });
});

describe("landing header: account type menu", () => {
  it("opens a list of the nine account types instead of linking straight to sign-up", () => {
    render(<LandingHeader />);
    const trigger = screen.getByRole("button", { name: /إنشاء حساب/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "اختر نوع حسابك" })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("group", { name: "اختر نوع حسابك" });
    expect(within(menu).getAllByRole("listitem")).toHaveLength(REGISTRATION_CHOICE_ORDER.length);
    expect(REGISTRATION_CHOICE_ORDER).toHaveLength(9);
  });

  it("links each open type to its own registration and disables the Coming Soon ones", () => {
    render(<LandingHeader />);
    fireEvent.click(screen.getByRole("button", { name: /إنشاء حساب/ }));
    const menu = screen.getByRole("group", { name: "اختر نوع حسابك" });
    const links = within(menu).getAllByRole("link");
    const open = REGISTRATION_CHOICE_ORDER.filter((k) => !CHOICES_BY_KEY[k]?.comingSoon);
    expect(links).toHaveLength(open.length);
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/auth/sign-up?type=showroom_dealer");
    expect(hrefs).toContain("/auth/sign-up?type=installer_technician");
    expect(hrefs).not.toContain("/auth/sign-up");
    const soon = REGISTRATION_CHOICE_ORDER.filter((k) => CHOICES_BY_KEY[k]?.comingSoon);
    expect(menu.querySelectorAll('[aria-disabled="true"]')).toHaveLength(soon.length);
  });

  it("closes on Escape", () => {
    render(<LandingHeader />);
    const trigger = screen.getByRole("button", { name: /إنشاء حساب/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
