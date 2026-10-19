import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import type { CatalogRow } from "@/server/queries/commerce";
import { SavedResults } from "./saved-results";

const actions = vi.hoisted(() => ({ toggle: vi.fn(), feed: vi.fn() }));
vi.mock("@/server/actions/saved-products", () => ({ toggleSavedProductAction: actions.toggle }));
vi.mock("@/server/actions/showroom-saved-feed", () => ({ loadShowroomSavedBatchAction: actions.feed }));

const row = (n: number): CatalogRow => ({
  brand: null, category: "finishing", image_ref: null, name: `Product ${n}`, organization_id: "org-s", published_at: "2026-10-01T00:00:00Z",
  short_description: null, sku: `SKU-${n}`, supplier_name: "Supplier", supplier_slug: "s", supplier_verified: false, unit: "piece", id: `p${n}`,
  category_code: null, colors: [], color_items: [], weight_kg: null, size_label: null, primary_image_key: null,
});
const batch = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(from + i));

const mount = (n = 10, total = 25, locale: "en" | "ar" = "en") =>
  render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <SavedResults products={batch(1, n)} total={total} filters={{}} orgId="org-1" initialView="grid" />
    </I18nProvider>,
  );

beforeEach(() => {
  actions.toggle.mockReset().mockResolvedValue({ ok: true });
  actions.feed.mockReset();
});

describe("showroom Saved Products results", () => {
  it("shows the first batch with the whole-shortlist count, every card bookmarked, and no price", () => {
    mount();
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
    expect(screen.getByTestId("showroom-saved-count").textContent).toBe("25 saved");
    for (const b of screen.getAllByRole("button", { name: /remove from saved|إزالة|saved/i }).slice(0, 1)) expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toMatch(/EGP|ج\.م/);
  });

  it("Show more asks for the next 10 from the current offset; Show less removes exactly one batch", async () => {
    actions.feed.mockResolvedValueOnce({ ok: true, products: batch(11, 10), total: 25, imageUrls: {} });
    mount();
    fireEvent.click(screen.getByTestId("showroom-saved-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(20));
    expect(actions.feed).toHaveBeenCalledWith({}, 10);
    fireEvent.click(screen.getByTestId("showroom-saved-show-less"));
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
    expect(screen.queryByTestId("showroom-saved-show-less")).toBeNull();
  });

  it("un-saving a card removes it in place and shrinks the total", async () => {
    mount();
    const first = screen.getAllByTestId("showroom-catalog-card")[0]!;
    fireEvent.click(first.querySelector("button[aria-pressed]")!);
    await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(9));
    expect(screen.getByTestId("showroom-saved-count").textContent).toBe("24 saved");
    expect(screen.queryByText("Product 1")).toBeNull();
    const [, fd] = actions.toggle.mock.calls[0]!;
    expect((fd as FormData).get("saved")).toBe("1");
    expect((fd as FormData).get("productId")).toBe("p1");
  });

  it("a failed un-save keeps the card", async () => {
    actions.toggle.mockResolvedValue({ ok: false, code: "states.genericRetry" });
    mount();
    fireEvent.click(screen.getAllByTestId("showroom-catalog-card")[0]!.querySelector("button[aria-pressed]")!);
    await waitFor(() => expect(actions.toggle).toHaveBeenCalled());
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
  });

  it("switches to the list presentation with the same cards' data", () => {
    mount();
    fireEvent.click(screen.getByTestId("showroom-saved-view-list"));
    expect(screen.getByTestId("showroom-saved-list")).toBeTruthy();
    expect(screen.getAllByTestId("showroom-catalog-row")).toHaveLength(10);
  });

  it("renders in Arabic", () => {
    mount(10, 25, "ar");
    expect(screen.getByTestId("showroom-saved-count").textContent).toBe("25 منتج محفوظ");
  });
});
