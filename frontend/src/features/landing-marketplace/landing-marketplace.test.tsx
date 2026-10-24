import { existsSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import {
  categoryOrder,
  landingMarketplaceContent,
  previewProducts,
  type LandingProduct,
} from "./landing-marketplace-content";
import { LandingMarketplaceProductCard } from "./landing-marketplace-product-card";
import { LandingMarketplaceSection } from "./landing-marketplace-section";

function renderSection(locale: "ar" | "en" = "ar") {
  return render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <LandingMarketplaceSection />
    </I18nProvider>,
  );
}

const base: LandingProduct = {
  id: "t", type: "wallpaper", image: "/x.svg", unit: "roll", priceEgp: 100,
  copy: { ar: { title: "منتج", description: "وصف" }, en: { title: "Product", description: "Desc" } },
};

describe("LandingMarketplaceSection", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-11T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("renders the Arabic heading, preview label and the seven filters", () => {
    renderSection("ar");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("اكتشف سوق علاء الدين");
    expect(screen.getByText(landingMarketplaceContent.ar.preview)).toBeInTheDocument();
    const group = screen.getByRole("group", { name: landingMarketplaceContent.ar.filterLabel });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["الكل", "ورق حائط", "بديل خشب", "بديل رخام", "شيبورد", "كرانيش", "زوايا"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the featured product of each type under 'All' and filters by product type", () => {
    renderSection("ar");
    expect(screen.getAllByRole("article")).toHaveLength(previewProducts.filter((p) => p.featured).length);
    fireEvent.click(screen.getByRole("button", { name: "بديل خشب" }));
    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card).toHaveAttribute("data-product-type", "wood_alternative");
    expect(screen.getByRole("button", { name: "بديل خشب" })).toHaveAttribute("aria-pressed", "true");
  });

  it("covers every approved product type with at least one product", () => {
    for (const type of categoryOrder) expect(previewProducts.some((p) => p.type === type)).toBe(true);
  });

  it("lists only products that have their own real image file", () => {
    const seen = new Set<string>();
    for (const p of previewProducts) {
      expect(p.image).toMatch(/.(png|jpe?g|webp)$/);
      expect(existsSync(join(process.cwd(), "public", p.image))).toBe(true);
      expect(seen.has(p.image)).toBe(false);
      seen.add(p.image);
    }
  });

  it("adds to the guest cart and links to it", () => {
    window.localStorage.clear();
    renderSection("ar");
    const [first] = screen.getAllByRole("button", { name: /أضف للسلة/ });
    fireEvent.click(first!);
    expect(screen.getAllByText(/تمت الإضافة إلى السلة/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "عرض السلة" })[0]).toHaveAttribute("href", "/marketplace/cart");
    expect(JSON.parse(window.localStorage.getItem("aladdin.marketplace.guest-cart.v1") ?? "[]")).toHaveLength(1);
  });

  it("turns the button into Remove from cart once added, and removes it again", () => {
    window.localStorage.clear();
    renderSection("ar");
    const [first] = screen.getAllByRole("button", { name: /أضف للسلة/ });
    fireEvent.click(first!);
    const remove = screen.getAllByRole("button", { name: "حذف من السلة" })[0]!;
    expect(remove).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(remove);
    expect(JSON.parse(window.localStorage.getItem("aladdin.marketplace.guest-cart.v1") ?? "[]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "حذف من السلة" })).toBeNull();
  });

  it("shows prices as tax-exclusive with the sale unit", () => {
    renderSection("ar");
    expect(screen.getAllByText("للرول").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/الضريبة|excl. tax/);
  });

  it("renders English with LTR direction", () => {
    const { container } = renderSection("en");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Discover the Aladdin Marketplace");
    expect(container.querySelector("section")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("link", { name: /Explore More Products/ })).toHaveAttribute("href", "/marketplace");
  });

  it("has the same filter and unit keys in both languages", () => {
    const ar = landingMarketplaceContent.ar;
    const en = landingMarketplaceContent.en;
    expect(Object.keys(ar.categories)).toEqual(Object.keys(en.categories));
    expect(Object.keys(ar.units)).toEqual(Object.keys(en.units));
  });
});

describe("LandingMarketplaceProductCard offers", () => {
  const renderCard = (product: LandingProduct) =>
    render(
      <I18nProvider locale="ar" dir="rtl">
        <LandingMarketplaceProductCard product={product} />
      </I18nProvider>,
    );

  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-11T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("derives the flash countdown from the end timestamp and ticks", () => {
    const endsAt = Date.now() + (2 * 3600 + 5 * 60 + 9) * 1000;
    renderCard({ ...base, offer: { kind: "flash", referencePriceEgp: 150, endsAt } });
    expect(screen.getByRole("timer")).toHaveAttribute("aria-label", expect.stringContaining("02:05:09"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer")).toHaveAttribute("aria-label", expect.stringContaining("02:05:08"));
    expect(screen.getByText(landingMarketplaceContent.ar.flash)).toBeInTheDocument();
  });

  it("drops an expired flash offer: no badge, countdown or struck-through price", () => {
    const endsAt = Date.now() + 2000;
    renderCard({ ...base, offer: { kind: "flash", referencePriceEgp: 150, endsAt } });
    expect(screen.getByRole("timer")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(landingMarketplaceContent.ar.flash)).toBeNull();
    expect(document.querySelector("del")).toBeNull();
  });

  it("never shows a flash offer that has no end timestamp", () => {
    renderCard({ ...base, offer: { kind: "flash", referencePriceEgp: 150, endsAt: null } });
    expect(screen.queryByRole("timer")).toBeNull();
    expect(document.querySelector("del")).toBeNull();
  });

  it("shows the special-offer badge and previous price for a regular offer", () => {
    renderCard({ ...base, offer: { kind: "regular", referencePriceEgp: 130 } });
    expect(screen.getByText(landingMarketplaceContent.ar.special)).toBeInTheDocument();
    expect(document.querySelector("del")).toHaveTextContent("130");
  });

  it("shows no offer UI for a product without an offer", () => {
    renderCard(base);
    expect(screen.queryByText(landingMarketplaceContent.ar.special)).toBeNull();
    expect(document.querySelector("del")).toBeNull();
  });
});
