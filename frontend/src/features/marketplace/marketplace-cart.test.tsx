import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { MarketplaceCartProvider, useMarketplaceCart } from "./marketplace-cart";
import { MarketplaceCartPage } from "./marketplace-cart-page";
import { deliveryFee } from "./marketplace-delivery";

const wrap = (node: ReactNode, locale: "ar" | "en" = "en") => (
  <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <MarketplaceCartProvider>{node}</MarketplaceCartProvider>
  </I18nProvider>
);

let api: ReturnType<typeof useMarketplaceCart>;
function Probe() {
  api = useMarketplaceCart();
  return null;
}

beforeEach(() => window.localStorage.clear());

describe("delivery price list", () => {
  it("uses the area price, then the governorate price, and never invents one", () => {
    expect(deliveryFee("cairo", "maadi")).toBe(90); // area price
    expect(deliveryFee("cairo", "nasr_city")).toBe(80); // governorate default
    expect(deliveryFee("cairo", "nowhere")).toBe(80);
    expect(deliveryFee("luxor", "any")).toBeNull(); // seller does not deliver there
  });
});

describe("guest cart", () => {
  it("adds, merges, clamps to stock and removes lines", () => {
    render(wrap(<Probe />));
    act(() => { api.add("p-mb-3", "v-mb-3a", 2); });
    act(() => { api.add("p-mb-3", "v-mb-3a", 1); });
    expect(api.lines).toHaveLength(1);
    expect(api.count).toBe(3);
    expect(api.subtotalEgp).toBe(850 * 3);
    act(() => { api.setQty("v-mb-3a", 9999); });
    expect(api.lines[0]!.qty).toBe(40); // stock of that sample variant
    expect(api.add("p-mb-3", "v-mb-3f", 1)).toBe("out_of_stock"); // stock 0
    act(() => { api.remove("v-mb-3a"); });
    expect(api.count).toBe(0);
  });

  it("drops unknown or tampered stored lines instead of trusting them", () => {
    window.localStorage.setItem("aladdin.marketplace.guest-cart.v1", JSON.stringify([
      { productId: "ghost", variantId: "x", qty: 3 },
      { productId: "p-mb-3", variantId: "v-mb-3a", qty: 2 },
      { nope: true },
    ]));
    render(wrap(<Probe />));
    expect(api.lines.map((l) => l.variant.id)).toEqual(["v-mb-3a"]);
  });
});

describe("hydration safety", () => {
  it("renders the empty cart on the server even when a cart is stored in this browser", () => {
    window.localStorage.setItem("aladdin.marketplace.guest-cart.v1", JSON.stringify([
      { productId: "p-mb-3", variantId: "v-mb-3a", qty: 1 },
    ]));
    function Buttons() {
      const cart = useMarketplaceCart();
      return <p>{cart.hasProduct("p-mb-3") ? "IN_CART" : "NOT_IN_CART"}:{cart.count}</p>;
    }
    // renderToString uses getServerSnapshot — the markup must not depend on localStorage
    const html = renderToString(wrap(<Buttons />));
    expect(html).toContain("NOT_IN_CART");
    expect(html).not.toContain("IN_CART:1");
  });
});

describe("cart page", () => {
  it("shows an empty state", () => {
    render(wrap(<MarketplaceCartPage />));
    expect(screen.getByText("Your cart is empty")).toBeInTheDocument();
    // an empty cart still shows best sellers and offers, never a dead end
    expect(screen.getByRole("heading", { name: "Best sellers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deals and offers" })).toBeInTheDocument();
  });

  it("totals = products + the delivery fee of the chosen area, with no tax anywhere", () => {
    window.localStorage.setItem("aladdin.marketplace.guest-cart.v1", JSON.stringify([
      { productId: "p-mb-3", variantId: "v-mb-3a", qty: 2 },
    ]));
    render(wrap(<MarketplaceCartPage />));
    const summary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(summary).getAllByText("EGP 1,700").length).toBeGreaterThan(0); // 2 x 850
    expect(within(summary).getAllByText("EGP 80").length).toBeGreaterThan(0); // Cairo / Nasr City
    expect(within(summary).getByText("EGP 1,780")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/tax|vat|ضريبة/i);
    fireEvent.click(within(summary).getByLabelText(/Pick up from showroom/));
    expect(within(summary).getByText("EGP 1,700", { selector: "strong" })).toBeInTheDocument();
  });
});
