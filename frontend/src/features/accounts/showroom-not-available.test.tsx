import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ShowroomNotAvailable } from "./showroom-not-available";

/**
 * What a non-Sales personal account sees at /home/showroom and
 * /home/showroom/refer. Two things matter and both are asserted: the copy is
 * localized and account-safe, and there is no way to submit anything.
 */
describe("ShowroomNotAvailable", () => {
  it("explains the account-type mismatch in English", () => {
    renderWithI18n(<ShowroomNotAvailable />, "en");
    expect(screen.getByTestId("showroom-not-available")).toBeTruthy();
    expect(screen.getByText("Connecting a showroom is for sales accounts")).toBeTruthy();
    expect(screen.getByText(/isn't set up for sales work/i)).toBeTruthy();
  });

  it("renders the Arabic copy under the default locale", () => {
    renderWithI18n(<ShowroomNotAvailable />, "ar");
    expect(screen.getByText("ربط المعرض متاح لحسابات المبيعات")).toBeTruthy();
  });

  it("offers the way back home", () => {
    renderWithI18n(<ShowroomNotAvailable />, "en");
    const link = screen.getByRole("link", { name: /back to your home/i });
    expect(link.getAttribute("href")).toBe("/home");
  });

  it("exposes NO affiliation form — no search, no fields, no submit", () => {
    const { container } = renderWithI18n(<ShowroomNotAvailable />, "en");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button", { name: /request to join|submit for review|search/i })).toBeNull();
  });

  it("says nothing technical — no error code, no server language", () => {
    const { container } = renderWithI18n(<ShowroomNotAvailable />, "en");
    const text = container.textContent ?? "";
    for (const leak of ["42501", "RPC", "permission denied", "error", "forbidden", "persona"]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});
