import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { CartAddButton } from "./cart-add-button";
import { ViewerContext, type Viewer } from "./viewer-context";

const wrap = (viewer: Viewer, node: ReactNode) => (
  <ViewerContext.Provider value={viewer}>
    <I18nProvider locale="en" dir="ltr">{node}</I18nProvider>
  </ViewerContext.Provider>
);

beforeEach(() => window.localStorage.clear());

describe("a showroom's own people cannot buy from it", () => {
  it("hides the add-to-cart button on a product of a showroom the viewer works for", () => {
    render(wrap({ signedIn: true, ownSellers: ["decore-store"] }, <CartAddButton slug="p-a" sku="A" inStock sellerSlug="decore-store" />));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides it even when the product is out of stock or has several variants (no button of any kind)", () => {
    const viewer = { signedIn: true, ownSellers: ["decore-store"] };
    const { container, rerender } = render(wrap(viewer, <CartAddButton slug="p-a" sku="A" inStock={false} sellerSlug="decore-store" />));
    expect(container).toBeEmptyDOMElement();
    rerender(wrap(viewer, <CartAddButton slug="p-a" sku={null} inStock sellerSlug="decore-store" />));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows it for another showroom's product, for a guest and when no showroom is known", () => {
    const own = { signedIn: true, ownSellers: ["decore-store"] };
    const { rerender } = render(wrap(own, <CartAddButton slug="p-a" sku="A" inStock sellerSlug="other-store" />));
    expect(screen.getByRole("button", { name: /Add to cart/ })).toBeInTheDocument();
    rerender(wrap({ signedIn: false, ownSellers: [] }, <CartAddButton slug="p-a" sku="A" inStock sellerSlug="decore-store" />));
    expect(screen.getByRole("button", { name: /Add to cart/ })).toBeInTheDocument();
    rerender(wrap(own, <CartAddButton slug="p-a" sku="A" inStock />));
    expect(screen.getByRole("button", { name: /Add to cart/ })).toBeInTheDocument();
  });
});
