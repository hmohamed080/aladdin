import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { SidebarShell } from "./sidebar-shell";
import { WorkspaceNavPanel } from "./workspace-nav";
import { MARKETPLACE_SELL_ENTITLEMENT } from "@/lib/nav/modules";

vi.mock("next/navigation", () => ({ usePathname: () => "/b2b" }));

/** The B2B workspace sidebar (used by non-showroom organizations; the showroom account has its own - see showroom-shell/navigation.test.ts). */
function sidebar(caps: string[], locale: "ar" | "en" = "en") {
  return renderWithI18n(
    <SidebarShell appName="Aladdin" mode="expanded" nav={<WorkspaceNavPanel allowed={caps} stance="buyer" />} />,
    locale,
  );
}

const hrefs = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("Marketplace group in the B2B workspace sidebar", () => {
  it("shows Marketplace with products, delivery areas and delivery prices for an approved seller", () => {
    sidebar(["org.manage", MARKETPLACE_SELL_ENTITLEMENT]);
    expect(hrefs()).toEqual(expect.arrayContaining(["/b2c/seller/products", "/b2c/seller/areas", "/b2c/seller/delivery"]));
    const group = screen.getByText("Marketplace", { selector: "*" });
    expect(group).toBeInTheDocument();
    for (const name of ["Marketplace products", "Delivery areas", "Delivery prices"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("names the group and the two new items in Arabic", () => {
    sidebar(["org.manage", MARKETPLACE_SELL_ENTITLEMENT], "ar");
    expect(screen.getByRole("link", { name: "المناطق" })).toHaveAttribute("href", "/b2c/seller/areas");
    expect(screen.getByRole("link", { name: "توصيل المناطق" })).toHaveAttribute("href", "/b2c/seller/delivery");
    expect(screen.getByRole("link", { name: "منتجات الماركت" })).toHaveAttribute("href", "/b2c/seller/products");
  });

  it("is not drawn at all for a showroom that was never approved as a seller", () => {
    sidebar(["org.manage"]);
    for (const path of ["/b2c/seller/products", "/b2c/seller/areas", "/b2c/seller/delivery"]) expect(hrefs()).not.toContain(path);
    expect(within(document.body).queryByRole("link", { name: "Delivery areas" })).not.toBeInTheDocument();
  });
});
