import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { ClosedState } from "./closed-state";
import { DeliveryBlock, termsForPrice } from "./delivery-block";
import { ProductCard } from "./product-card";
import { SellerStorefront } from "./seller-storefront";
import type { DeliveryTerms, PublicCard } from "./public-contract";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), usePathname: () => "/market/products/p" }));

const card = (patch: Partial<PublicCard> = {}): PublicCard => ({
  slug: "p", name_ar: "ورق حائط", name_en: "Wallpaper", brand: null, product_type_key: "wallpaper", product_type_name_ar: "ورق", product_type_name_en: "Wallpaper type",
  category_key: "c", category_name_ar: "قسم", category_name_en: "Category", seller_name: "Nile Interiors", seller_slug: "nile", seller_official: true,
  from_price_egp: 450, in_stock: true, stock_left: 2, free_shipping: true, variant_count: 1, cart_sku: "S-1", image_id: null, colors: [],
  delivery: { status: "needs_area", configured: true, min_days: 3, max_days: 7, fee_egp: null, pickup_available: true }, ...patch,
});

const terms = (patch: Partial<DeliveryTerms> = {}): DeliveryTerms => ({
  configured: true, status: "available", fee_egp: 80, fee_min_egp: null, fee_max_egp: null, prep_days: 2, min_days: 3, max_days: 4,
  earliest: "2026-11-26", latest: "2026-11-27", cutoff_time: "14:00", after_cutoff: false, seconds_to_cutoff: 3600, free_min_egp: 1000,
  next_day: { fee_egp: 60, arrival: "2026-11-24" }, pickup_available: true, pickup_instructions: "Ask for the front desk", free_shipping: false, free_reason: null,
  product_free: false, ...patch,
});

const en = (node: React.ReactNode) => render(<I18nProvider locale="en" dir="ltr">{node}</I18nProvider>);
const ar = (node: React.ReactNode) => render(<I18nProvider locale="ar" dir="rtl">{node}</I18nProvider>);

describe("ProductCard", () => {
  it("shows the showroom with the Official Store mark, the estimate, free shipping and 'Only N left'", () => {
    en(<ProductCard item={card()} locale="en" />);
    expect(screen.getByRole("link", { name: "Nile Interiors" })).toHaveAttribute("href", "/market/sellers/nile");
    expect(screen.getByText("Official Store")).toBeInTheDocument();
    expect(screen.getByText("Arrives in 3–7 days")).toBeInTheDocument();
    expect(screen.getByText("Free shipping")).toBeInTheDocument();
    expect(screen.getByText("Only 2 left in stock – order soon")).toBeInTheDocument();
  });

  it("has no in-stock label, no 'sold by' sentence and no contact element", () => {
    en(<ProductCard item={card()} locale="en" />);
    expect(screen.queryByText(/^In stock$/i)).toBeNull();
    expect(screen.queryByText(/sold by/i)).toBeNull();
    expect(screen.queryByText(/call|whatsapp|phone|contact/i)).toBeNull();
  });

  it("is quiet when nothing is known: no estimate, no badge, no low-stock line, no official mark", () => {
    en(<ProductCard item={card({ seller_official: false, stock_left: null, free_shipping: false, delivery: { status: "needs_area", configured: false, min_days: null, max_days: null, fee_egp: null, pickup_available: false } })} locale="en" />);
    expect(screen.queryByText("Official Store")).toBeNull();
    expect(screen.queryByText(/Arrives/)).toBeNull();
    expect(screen.queryByText("Free shipping")).toBeNull();
    expect(screen.queryByText(/left in stock/)).toBeNull();
  });

  it("says the showroom does not deliver there, and links the product with the chosen place", () => {
    en(<ProductCard item={card({ delivery: { status: "not_available", configured: true, min_days: null, max_days: null, fee_egp: null, pickup_available: false } })} locale="en" place={{ gov: "cairo", area: "nasr-city" }} />);
    expect(screen.getByText("This showroom does not deliver to your area")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Wallpaper" })[0]).toHaveAttribute("href", "/market/products/p?gov=cairo&area=nasr-city");
  });

  it("renders in Arabic", () => {
    ar(<ProductCard item={card()} locale="ar" />);
    expect(screen.getByText("المتجر الرسمي")).toBeInTheDocument();
    expect(screen.getByText("متبقي ٢ فقط في المخزون، اطلب قريبًا")).toBeInTheDocument();
    expect(screen.getByText("شحن مجاني")).toBeInTheDocument();
  });
});

describe("DeliveryBlock", () => {
  it("shows the arrival dates, the fee, the countdown, the faster option and pickup", () => {
    en(<DeliveryBlock locale="en" terms={terms()} place={{ gov: "cairo", area: "" }} unitPrice={450} />);
    expect(screen.getByText(/Get it Thu 26 Nov – Fri 27 Nov/)).toBeInTheDocument();
    expect(screen.getByText("Delivery fee:", { exact: false })).toHaveTextContent("EGP 80");
    expect(screen.getByText("Order within 01:00:00")).toBeInTheDocument();
    expect(screen.getByText("Faster delivery options")).toBeInTheDocument();
    expect(screen.getByText("Ask for the front desk")).toBeInTheDocument();
  });

  it("a unit that reaches the free-shipping threshold ships free", () => {
    expect(termsForPrice(terms(), 1200).free_shipping).toBe(true);
    expect(termsForPrice(terms(), 450).free_shipping).toBe(false);
    en(<DeliveryBlock locale="en" terms={terms()} place={{ gov: "cairo", area: "" }} unitPrice={1200} />);
    expect(screen.getByText("Free", { exact: false, selector: "span" })).toBeInTheDocument();
  });

  it("without a place it asks for one and shows the range", () => {
    en(<DeliveryBlock locale="en" terms={terms({ status: "needs_area", fee_egp: null, fee_min_egp: 80, fee_max_egp: 120, next_day: null })} place={null} unitPrice={450} />);
    expect(screen.getByText("Choose your area to see the arrival date and the fee.")).toBeInTheDocument();
    expect(screen.getByText("Arrives in 3–4 days depending on your area")).toBeInTheDocument();
    expect(screen.getByText("EGP 80 to EGP 120")).toBeInTheDocument();
  });

  it("says so when the showroom does not deliver to the chosen place, and when it has not configured delivery", () => {
    const { unmount } = en(<DeliveryBlock locale="en" terms={terms({ status: "not_available", fee_egp: null, earliest: null })} place={{ gov: "luxor", area: "" }} unitPrice={450} />);
    expect(screen.getByText("This showroom does not deliver to your area")).toBeInTheDocument();
    unmount();
    en(<DeliveryBlock locale="en" terms={terms({ configured: false, min_days: null, max_days: null, earliest: null, latest: null, cutoff_time: null, seconds_to_cutoff: null })} place={{ gov: "cairo", area: "" }} unitPrice={450} />);
    expect(screen.getByText("The showroom will confirm its delivery details soon.")).toBeInTheDocument();
  });

  it("explains an elapsed cut-off and renders nothing without terms", () => {
    const { container, unmount } = en(<DeliveryBlock locale="en" terms={null} place={null} unitPrice={1} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    en(<DeliveryBlock locale="ar" terms={terms({ after_cutoff: true, seconds_to_cutoff: null })} place={{ gov: "cairo", area: "" }} unitPrice={450} />);
    expect(screen.getByText("تجاوزت موعد الطلب اليومي؛ يُحتسب طلبك من الغد.")).toBeInTheDocument();
  });
});

describe("SellerStorefront and ClosedState", () => {
  it("lists the showroom's products with the Official Store mark and no contact element", () => {
    en(<SellerStorefront locale="en" seller={{ slug: "nile", name: "Nile Interiors", official: true, product_count: 1 }} page={{ total: 1, limit: 24, offset: 0, items: [card()] }} pageNo={1} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nile Interiors");
    const head = screen.getByRole("banner");
    expect(within(head).getByText("Official Store")).toBeInTheDocument();
    expect(screen.queryByText(/call|whatsapp|phone|contact/i)).toBeNull();
  });

  it("shows the closed and the missing-showroom states", () => {
    const { unmount } = en(<ClosedState locale="en" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The store is temporarily closed");
    unmount();
    en(<ClosedState locale="en" kind="seller_missing" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This showroom is not available");
  });
});
