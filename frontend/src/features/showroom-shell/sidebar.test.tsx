import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ShowroomSidebar } from "./sidebar";
import { MARKETPLACE_SELL_ENTITLEMENT } from "@/lib/nav/modules";

vi.mock("next/navigation", () => ({
  usePathname: () => "/b2c/seller/areas",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));

/** The real showroom-account sidebar - the one a showroom owner actually sees. */
function render(caps: string[], locale: "ar" | "en" = "en") {
  return renderWithI18n(<ShowroomSidebar capabilities={caps} initialMode="expanded" mobileOpen={false} onCloseMobile={() => undefined} />, locale);
}
const hrefs = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("Marketplace group in the showroom account sidebar", () => {
  it("shows Marketplace with products, delivery areas and delivery prices for an approved seller", () => {
    render(["org.manage", MARKETPLACE_SELL_ENTITLEMENT]);
    expect(hrefs()).toEqual(expect.arrayContaining(["/b2c/seller/products", "/b2c/seller/areas", "/b2c/seller/delivery"]));
    expect(screen.getAllByText("Marketplace").length).toBeGreaterThan(0);
    for (const name of ["Marketplace products", "Delivery areas", "Delivery prices"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(name) }).length).toBeGreaterThan(0);
    }
  });

  it("shows the Arabic names الماركت, المناطق and توصيل المناطق", () => {
    render(["org.manage", MARKETPLACE_SELL_ENTITLEMENT], "ar");
    expect(screen.getAllByText("الماركت").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /المناطق/ }).map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining(["/b2c/seller/areas", "/b2c/seller/delivery"]),
    );
  });

  it("marks the page being viewed as current", () => {
    render(["org.manage", MARKETPLACE_SELL_ENTITLEMENT]);
    const current = Array.from(document.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute("href"));
    expect(current).toContain("/b2c/seller/areas");
  });

  it("is not drawn for a showroom that was not approved as a seller", () => {
    render(["org.manage"]);
    for (const path of ["/b2c/seller/products", "/b2c/seller/areas", "/b2c/seller/delivery"]) expect(hrefs()).not.toContain(path);
  });
});
