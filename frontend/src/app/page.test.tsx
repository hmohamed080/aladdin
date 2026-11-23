import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RootPage from "./page";

const state = vi.hoisted(() => ({ users: 1200 as number | null, open: false, items: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isMarketplacePreviewEnabled: () => state.open }));
vi.mock("@/server/queries/marketplace-public", () => ({ loadPublicCatalogPage: async () => ({ items: state.items }) }));
vi.mock("@/server/media/marketplace-public-images", () => ({ marketplacePublicImageUrls: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-var", className: "font-cls" }) }));
vi.mock("@/features/landing-brand/landing-brand-stats.server", () => ({
  readLandingStats: async () => ({ users: state.users, organizations: null, products: 0 }),
}));

describe("homepage: one canonical Landing", () => {
  it("renders the brand Landing sections in Arabic, with no language switch", async () => {
    const { container } = render(await RootPage());
    for (const id of ["top", "roles", "services", "market", "how", "why", "experience", "faq", "footer"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(screen.getAllByRole("heading", { level: 1 })[0]).toHaveTextContent("علاء الدين");
    expect(container.textContent).not.toMatch(/English|\bEN\b/);
  });

  it("shows only stats that are real: a null or zero count renders no pill", async () => {
    state.users = 1200;
    const { container } = render(await RootPage());
    const pills = container.querySelectorAll("ul li strong");
    expect(Array.from(pills).map((n) => n.textContent)).toContain("+1,200");
    expect(container.textContent).not.toContain("250");
  });

  it("hides the whole stat row when no count is available", async () => {
    state.users = null;
    const { container } = render(await RootPage());
    expect(container.querySelector("section")?.querySelectorAll("li").length).toBe(0);
  });

  it("Marketplace closed: sample cards, no cart, and the store link points at /market", async () => {
    state.open = false;
    const { container } = render(await RootPage());
    expect(container.querySelector('a[href="/market/cart"]')).toBeNull();
    expect(screen.getAllByRole("link", { name: "المتجر" })[0]).toHaveAttribute("href", "/market");
    expect(container.querySelector('a[href="/marketplace"]')).toBeNull();
  });

  it("Marketplace open: the header shows the cart and real products replace the samples", async () => {
    state.open = true;
    state.items = [{ slug: "oak-panel", name_ar: "لوح بلوط", name_en: "Oak panel", seller_name: "معرض النيل", image_id: null, from_price_egp: "1200", variant_count: 1, in_stock: true, cart_sku: "OAK-1", product_type_key: "panels" }];
    const { container } = render(await RootPage());
    expect(container.querySelector('a[href="/market/cart"]')).not.toBeNull();
    expect(container.querySelector('a[href="/market/products/oak-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("لوح بلوط");
    state.open = false;
    state.items = [];
  });
});
