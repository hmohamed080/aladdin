import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { CartQuote, CartQuoteLine, CartSeller, PublicCard } from "./public-contract";
import { LIVE_CART_KEY, useLiveCart } from "./live-cart-store";
import { LiveCartPage } from "./live-cart-page";

const quoteAction = vi.fn<(refs: { slug: string; sku: string }[], gov: string | null, area: string | null) => Promise<CartQuote | null>>();
vi.mock("@/server/actions/marketplace-cart", () => ({
  quoteMarketplaceCartAction: (refs: { slug: string; sku: string }[], gov: string | null, area: string | null) => quoteAction(refs, gov, area),
}));

const wrap = (node: ReactNode, locale: "ar" | "en" = "en") => (
  <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>
);

const ok = (sku: string, seller: number, price: number, available: number): CartQuoteLine => ({
  status: "ok", slug: `p-${sku.toLowerCase()}`, sku, name_ar: `منتج ${sku}`, name_en: `Product ${sku}`, brand: null, selling_unit: "piece",
  price_egp: price, available, seller, image_id: null, attributes: [],
});
const showroom = (index: number, name: string, fees: Record<string, number>, pickup = false): { seller: CartSeller; fees: Record<string, number> } => ({
  seller: { index, name, pickup_available: pickup, delivery: { status: "needs_area" } },
  fees,
});

/** A quote the way the database answers it: each showroom's price for the asked governorate / area. */
function answer(lines: CartQuoteLine[], showrooms: ReturnType<typeof showroom>[]) {
  return async (_refs: unknown, gov: string | null, area: string | null): Promise<CartQuote> => ({
    lines,
    sellers: showrooms.map(({ seller, fees }) => {
      const fee = gov ? (area && fees[`${gov}/${area}`] !== undefined ? fees[`${gov}/${area}`] : fees[gov]) : undefined;
      const delivery: CartSeller["delivery"] = !gov ? { status: "needs_area" } : fee === undefined ? { status: "not_available" } : { status: "available", fee_egp: fee };
      return { ...seller, delivery };
    }),
  });
}

const store = (items: { slug: string; sku: string; qty: number }[]) => window.localStorage.setItem(LIVE_CART_KEY, JSON.stringify(items));
/** the shared Select keeps a real <select> in the tree as the form-value carrier */
const choose = (id: "mp-gov" | "mp-area", value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });

beforeEach(() => {
  window.localStorage.clear();
  quoteAction.mockReset();
});

describe("live cart store", () => {
  let api: ReturnType<typeof useLiveCart>;
  function Probe() {
    api = useLiveCart();
    return null;
  }

  it("keeps only slug, SKU and quantity - never a price - and merges the same variant", () => {
    render(wrap(<Probe />));
    act(() => { api.add("p-a", "A", 2); });
    act(() => { api.add("p-a", "A"); });
    expect(api.count).toBe(3);
    expect(JSON.parse(window.localStorage.getItem(LIVE_CART_KEY)!)).toEqual([{ slug: "p-a", sku: "A", qty: 3 }]);
    act(() => { api.setQty("p-a", "A", 0); });
    expect(api.lines[0]!.qty).toBe(1);
    act(() => { api.remove("p-a", "A"); });
    expect(api.count).toBe(0);
  });

  it("refuses a 51st product", () => {
    render(wrap(<Probe />));
    for (let i = 0; i < 50; i++) act(() => { api.add(`p-${i}`, `S${i}`); });
    let result = "";
    act(() => { result = api.add("p-x", "X"); });
    expect(result).toBe("cart_full");
    expect(api.lines).toHaveLength(50);
  });
});

describe("live cart page", () => {
  const suggestions: PublicCard[] = [];

  it("is empty with a way back to the marketplace", async () => {
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
    expect(quoteAction).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: "Continue shopping" })[0]).toHaveAttribute("href", "/marketplace");
  });

  it("prices products and delivery by area from the database quote, with no tax line", async () => {
    store([{ slug: "p-a", sku: "A", qty: 2 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 785, 50)], [showroom(1, "Decore Store", { cairo: 80, "cairo/maadi": 60 })]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    expect(await screen.findByText("Product A")).toBeInTheDocument();
    const summary = screen.getByRole("complementary");
    // no place chosen yet: delivery and the total are not guessed
    expect(within(summary).getByText("Choose a governorate and area to see the delivery fee")).toBeInTheDocument();
    choose("mp-gov", "cairo");
    await waitFor(() => expect(within(summary).getAllByText("EGP 80").length).toBeGreaterThan(0));
    expect(within(summary).getByText("EGP 1,570")).toBeInTheDocument();
    expect(within(summary).getByText("EGP 1,650")).toBeInTheDocument();
    expect(within(summary).queryByText(/VAT|ضريبة/)).not.toBeInTheDocument();
    expect(quoteAction).toHaveBeenLastCalledWith([{ slug: "p-a", sku: "A" }], "cairo", null);
    choose("mp-area", "maadi");
    await waitFor(() => expect(within(summary).getAllByText("EGP 60").length).toBeGreaterThan(0));
    expect(within(summary).getByText("EGP 1,630")).toBeInTheDocument();
  });

  it("shows each showroom's own delivery price when the cart spans showrooms, and blocks a place one of them skips", async () => {
    store([{ slug: "p-a", sku: "A", qty: 1 }, { slug: "p-b", sku: "B", qty: 1 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 9), ok("B", 2, 200, 9)], [
      showroom(1, "Showroom One", { cairo: 60, giza: 100 }),
      showroom(2, "Showroom Two", { cairo: 90 }),
    ]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    await screen.findByText("Product A");
    choose("mp-gov", "cairo");
    const fees = await screen.findByText("Delivery fee by showroom");
    const list = fees.closest("div")!.querySelector("ul")!;
    expect(within(list).getByText("Showroom One").closest("li")).toHaveTextContent("EGP 60");
    expect(within(list).getByText("Showroom Two").closest("li")).toHaveTextContent("EGP 90");
    expect(within(screen.getByRole("complementary")).getAllByText("EGP 150").length).toBeGreaterThan(0);
    choose("mp-gov", "giza");
    expect(await screen.findByText(/Does not deliver to this area: Showroom Two/)).toBeInTheDocument();
  });

  it("offers pickup only when every showroom does", async () => {
    store([{ slug: "p-a", sku: "A", qty: 1 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 9)], [showroom(1, "Decore Store", {}, false)]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    await screen.findByText("Product A");
    fireEvent.click(screen.getByRole("radio", { name: /Pick up from showroom/ }));
    expect(await screen.findByText(/No showroom pickup: Decore Store/)).toBeInTheDocument();
    expect(within(screen.getByRole("complementary")).getByText("Free")).toBeInTheDocument();
  });

  it("brings a quantity down to what the showroom can supply and flags it", async () => {
    store([{ slug: "p-a", sku: "A", qty: 9 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 2)], [showroom(1, "Decore Store", { cairo: 0 })]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    expect(await screen.findByText("Only 2 available")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(LIVE_CART_KEY)!)[0].qty).toBe(2));
    expect(screen.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  });

  it("says a product that is no longer sold is unavailable and lets the buyer remove it", async () => {
    store([{ slug: "gone", sku: "X-1", qty: 1 }, { slug: "p-a", sku: "A", qty: 1 }]);
    quoteAction.mockImplementation(answer([{ status: "unavailable", slug: "gone", sku: "X-1" }, ok("A", 1, 100, 9)], [showroom(1, "Decore Store", {})]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    expect(await screen.findByText("This product is no longer available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove X-1 from cart" }));
    await waitFor(() => expect(screen.queryByText("This product is no longer available")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(LIVE_CART_KEY)!)).toEqual([{ slug: "p-a", sku: "A", qty: 1 }]);
  });

  it("keeps checkout closed: disabled and labelled coming soon", async () => {
    store([{ slug: "p-a", sku: "A", qty: 1 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 9)], [showroom(1, "Decore Store", { cairo: 0 })]));
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    await screen.findByText("Product A");
    const button = screen.getByRole("button", { name: /Place order/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Coming soon");
  });

  it("says so, and offers a retry, when prices cannot be loaded", async () => {
    store([{ slug: "p-a", sku: "A", qty: 1 }]);
    quoteAction.mockResolvedValueOnce(null);
    render(wrap(<LiveCartPage suggestions={suggestions} />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Prices could not be updated right now");
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 9)], [showroom(1, "Decore Store", {})]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Product A")).toBeInTheDocument();
  });

  it("suggests other products but never one already in the cart", async () => {
    store([{ slug: "p-a", sku: "A", qty: 1 }]);
    quoteAction.mockImplementation(answer([ok("A", 1, 100, 9)], [showroom(1, "Decore Store", {})]));
    const cards: PublicCard[] = ["p-a", "p-z"].map((slug) => ({
      slug, name_ar: slug, name_en: `Card ${slug}`, brand: null, product_type_key: "t", product_type_name_ar: "t", product_type_name_en: "t",
      category_key: "c", category_name_ar: "c", category_name_en: "c", seller_name: "Decore Store", from_price_egp: 50, in_stock: true,
      variant_count: 1, image_id: null, colors: [],
    }));
    render(wrap(<LiveCartPage suggestions={cards} />));
    await screen.findByText("Product A");
    expect(screen.getByText("Card p-z")).toBeInTheDocument();
    expect(screen.queryByText("Card p-a")).not.toBeInTheDocument();
  });
});
