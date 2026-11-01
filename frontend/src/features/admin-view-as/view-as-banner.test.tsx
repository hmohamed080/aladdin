import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ViewAsBanner } from "./view-as-banner";

const ID = "70000009-0000-4000-8000-000000000009";
const show = (locale: "en" | "ar" = "en", name = "Ahmed Sobhy") =>
  render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <ViewAsBanner subjectUserId={ID} subjectName={name} kind="craftsman" expiresAt="2026-11-01T15:30:00Z" />
    </I18nProvider>,
  );
afterEach(cleanup);

describe("ViewAsBanner", () => {
  it("states Admin View — Read Only and names the viewed account", () => {
    show();
    expect(screen.getByRole("region", { name: "Admin View — Read Only" })).toBeTruthy();
    expect(screen.getByTestId("view-as-subject").textContent).toContain("Viewing Ahmed Sobhy");
    expect(screen.getByTestId("view-as-subject").textContent).toContain("Craftsman account");
    expect(screen.getByText(/still signed in as an administrator/i)).toBeTruthy();
  });

  it("offers one way out: a POST to this subject's exit route (no link into /home)", () => {
    const { container } = show();
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe("post");
    expect(form.getAttribute("action")).toBe(`/admin/users/${ID}/view/exit`);
    expect(screen.getByRole("button", { name: "Return to admin" })).toBeTruthy();
    expect(container.querySelector('a[href^="/home"]')).toBeNull();
  });

  it("renders in Arabic", () => {
    show("ar");
    expect(screen.getByRole("region", { name: "عرض الإدارة — للقراءة فقط" })).toBeTruthy();
  });
});
