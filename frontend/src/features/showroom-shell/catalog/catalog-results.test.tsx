import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { CATALOG_VIEW_COOKIE } from "@/lib/ui/catalog-view";
import type { CatalogRow } from "@/server/queries/commerce";
import { CatalogResults } from "./catalog-results";

const eng = vi.hoisted(() => ({ change: vi.fn<(input: unknown) => Promise<{ ok: boolean; code?: string }>>(async () => ({ ok: true })) }));
vi.mock("@/server/actions/engineer-collections", () => ({ changeEngineerCollection: eng.change }));
vi.mock("@/server/actions/saved-products", () => ({
  toggleSavedProductAction: vi.fn(async () => ({ ok: true })),
}));
const feed = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/server/actions/catalog-feed", () => ({ loadCatalogBatchAction: feed.load }));

const row = (over: Partial<CatalogRow> & { id: string }): CatalogRow => ({
  brand: "NileCeramics",
  category: "finishing",
  image_ref: null,
  name: "Porcelain Floor Tile 60x60",
  organization_id: "org-s",
  published_at: "2026-10-01T00:00:00Z",
  short_description: null,
  sku: "TILE-1",
  supplier_name: "Cairo Ceramics Showroom",
  supplier_slug: "cairo",
  supplier_verified: true,
  unit: "square_meter",
  category_code: null,
  colors: [],
  color_items: [],
  weight_kg: null,
  size_label: null,
  primary_image_key: null,
  ...over,
});

const products = [row({ id: "p1" }), row({ id: "p2", name: "Marble Slab", brand: null, category: "construction", supplier_verified: false })];

function renderResults(props: Partial<React.ComponentProps<typeof CatalogResults>> = {}) {
  return render(
    <I18nProvider locale="en" dir="ltr">
      <CatalogResults products={products} total={products.length} filters={{}} orgId="org-1" savedIds={["p2"]} initialView="grid" {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  feed.load.mockReset();
  document.cookie = `${CATALOG_VIEW_COOKIE}=; max-age=0; path=/`;
});

describe("showroom catalog results", () => {
  it("renders the grid by default, one card per product, and no price it does not have", () => {
    renderResults();
    expect(screen.getByTestId("showroom-catalog-grid")).toBeTruthy();
    expect(screen.getByTestId("showroom-catalog-grid").className).toMatch(/grid-cols-2.*tablet:grid-cols-3.*desktop:grid-cols-4.*wide:grid-cols-5/);
    expect(screen.queryByTestId("showroom-catalog-list")).toBeNull();
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(2);
    expect(screen.getByTestId("showroom-catalog-count").textContent).toBe("2 products");
    expect(document.body.textContent).not.toMatch(/EGP|ج\.م|price/i);
  });

  it("shows name, code, category, supplier and unit on a card", () => {
    renderResults();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    expect(within(card).getByText("Porcelain Floor Tile 60x60")).toBeTruthy();
    expect(within(card).getByTestId("card-code").textContent).toContain("TILE-1");
    expect(within(card).getByText("Finishing")).toBeTruthy();
    expect(within(card).getByText("Cairo Ceramics Showroom")).toBeTruthy();
    expect(within(card).getByText("Square meter")).toBeTruthy();
  });

  it("draws the real color swatches from color_items, then +N, with the name as the accessible label", () => {
    const hex = (v: string) => `#${v}`;
    const many = ["B96F52", "D8C7A6", "F2E9D8", "071A2D", "8FA88A", "6B7A8F", "A1887F"].map((v, i) => ({ name: `C${i}`, hex: hex(v) }));
    renderResults({ products: [row({ id: "p1", color_items: many, colors: many.map((c) => c.name) })] });
    const swatches = within(screen.getByTestId("card-colors")).getAllByTestId("color-swatch");
    expect(swatches).toHaveLength(5);
    expect(swatches[0]!.getAttribute("aria-label")).toBe("C0");
    expect(screen.getByTestId("card-colors").textContent).toContain("+2");
  });

  it("falls back to the legacy names as unset swatches and never invents a value", () => {
    renderResults({ products: [row({ id: "p1", colors: ["Sand"], color_items: [] })] });
    const sw = screen.getByTestId("color-swatch");
    expect(sw.getAttribute("aria-label")).toMatch(/^Sand/);
    expect(sw.getAttribute("style") ?? "").not.toMatch(/background/);
  });

  it("renders unit • size • weight with only the values that exist", () => {
    renderResults({ products: [row({ id: "p1", unit: "roll", size_label: "10 m", weight_kg: 1.2 })] });
    expect(screen.getByTestId("card-meta").textContent).toBe("Roll • 10 m • 1.2 kg");
  });

  it("leaves no empty separator when the size or weight is missing", () => {
    renderResults({ products: [row({ id: "p1", unit: "roll", size_label: null, weight_kg: 1.2 })] });
    expect(screen.getByTestId("card-meta").textContent).toBe("Roll • 1.2 kg");
    renderResults({ products: [row({ id: "p2", unit: "roll" })] });
    expect(screen.getAllByTestId("card-meta").at(-1)!.textContent).toBe("Roll");
    expect(document.body.textContent).not.toMatch(/•\s*(•|$)/);
  });

  it("opens the suite's own product detail, not the production catalog shell", () => {
    renderResults();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/showroom/catalog/p1");
    expect(hrefs.some((h) => h?.startsWith("/b2b"))).toBe(false);
  });

  it("starts in list mode when the remembered preference is list", () => {
    renderResults({ initialView: "list" });
    expect(screen.getByTestId("showroom-catalog-list")).toBeTruthy();
    expect(screen.queryByTestId("showroom-catalog-grid")).toBeNull();
    expect(screen.getAllByTestId("showroom-catalog-row")).toHaveLength(2);
  });

  it("switches between grid and list, remembers the choice, and reports the pressed state", () => {
    renderResults();
    fireEvent.click(screen.getByTestId("showroom-catalog-view-list"));
    expect(screen.getByTestId("showroom-catalog-list")).toBeTruthy();
    expect(screen.getByTestId("showroom-catalog-view-list").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("showroom-catalog-view-grid").getAttribute("aria-pressed")).toBe("false");
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=list`);

    fireEvent.click(screen.getByTestId("showroom-catalog-view-grid"));
    expect(screen.getByTestId("showroom-catalog-grid")).toBeTruthy();
    expect(document.cookie).toContain(`${CATALOG_VIEW_COOKIE}=grid`);
  });

  it("gives a list row a thumbnail slot, category, supplier, unit, save control and primary action", () => {
    renderResults({ initialView: "list" });
    const r = screen.getAllByTestId("showroom-catalog-row")[0]!;
    expect(within(r).getByText("Finishing")).toBeTruthy();
    expect(within(r).getByText("Cairo Ceramics Showroom")).toBeTruthy();
    expect(within(r).getByText("Square meter")).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Save product" })).toBeTruthy();
    expect(within(r).getByRole("link", { name: "View details" }).getAttribute("href")).toBe("/showroom/catalog/p1");
  });

  it.each(["grid", "list"] as const)("reflects saved state per product in %s mode and keeps the control outside links", (initialView) => {
    renderResults({ initialView });
    const items = screen.getAllByTestId(initialView === "grid" ? "showroom-catalog-card" : "showroom-catalog-row");
    expect(within(items[0]!).getByRole("button", { name: "Save product" }).getAttribute("aria-pressed")).toBe("false");
    const saved = within(items[1]!).getByRole("button", { name: "Remove from saved" });
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(saved.closest("a")).toBeNull();
  });

  it("posts the active organization and product with the save form", () => {
    renderResults();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    const form = card.querySelector("form")!;
    expect((form.querySelector("input[name=orgId]") as HTMLInputElement).value).toBe("org-1");
    expect((form.querySelector("input[name=productId]") as HTMLInputElement).value).toBe("p1");
    expect((form.querySelector("input[name=saved]") as HTMLInputElement).value).toBe("0");
  });

  it("never renders a row the view could not describe", () => {
    renderResults({ products: [...products, row({ id: "p3", category: null })] });
    expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(2);
  });

  describe("bounded batches", () => {
    const batchOf = (from: number, n: number) => Array.from({ length: n }, (_, i) => row({ id: `p${from + i}`, name: `Product ${from + i}` }));
    const ok = (rows: CatalogRow[], total: number) => ({ ok: true, products: rows, total, imageUrls: {}, savedIds: [] });

    it("shows the first batch and its total, then ONE batch per Show more, at the right offset", async () => {
      renderResults({ products: batchOf(0, 10), total: 27, filters: { q: "tile", category: "paints" } });
      expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
      expect(screen.getByTestId("showroom-catalog-count").textContent).toBe("27 products");
      expect(screen.getByTestId("showroom-catalog-shown").textContent).toBe("Showing 10 of 27");
      expect(screen.queryByTestId("showroom-catalog-show-less")).toBeNull();
      feed.load.mockResolvedValueOnce(ok(batchOf(10, 10), 27));
      fireEvent.click(screen.getByTestId("showroom-catalog-show-more"));
      await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(20));
      expect(feed.load).toHaveBeenCalledWith({ q: "tile", category: "paints" }, 10);
    });

    it("walks 10 -> 20 -> 27 and back 27 -> 20 -> 10 one batch at a time", async () => {
      renderResults({ products: batchOf(0, 10), total: 27 });
      feed.load.mockResolvedValueOnce(ok(batchOf(10, 10), 27)).mockResolvedValueOnce(ok(batchOf(20, 7), 27));
      fireEvent.click(screen.getByTestId("showroom-catalog-show-more"));
      await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(20));
      fireEvent.click(screen.getByTestId("showroom-catalog-show-more"));
      await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(27));
      expect(screen.queryByTestId("showroom-catalog-show-more")).toBeNull();
      fireEvent.click(screen.getByTestId("showroom-catalog-show-less"));
      expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(20);
      fireEvent.click(screen.getByTestId("showroom-catalog-show-less"));
      expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
      expect(screen.queryByTestId("showroom-catalog-show-less")).toBeNull();
    });

    it("offers no pager when everything fits in the first batch", () => {
      renderResults({ products: batchOf(0, 4), total: 4 });
      expect(screen.queryByTestId("showroom-catalog-pager")).toBeNull();
    });

    it("keeps what is shown and says so when a batch fails", async () => {
      renderResults({ products: batchOf(0, 10), total: 27 });
      feed.load.mockResolvedValueOnce({ ok: false });
      fireEvent.click(screen.getByTestId("showroom-catalog-show-more"));
      await waitFor(() => expect(screen.getByTestId("showroom-catalog-load-error")).toBeTruthy());
      expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(10);
    });
  });
});

describe("engineer mode - the showroom's cards for an audience with no organization", () => {
  const engineerRender = (props: Partial<React.ComponentProps<typeof CatalogResults>> = {}) =>
    renderResults({ mode: "engineer", orgId: null, ...props });

  beforeEach(() => eng.change.mockClear());

  it("keeps the showroom design: same grid, same card fields", () => {
    engineerRender();
    expect(screen.getByTestId("showroom-catalog-grid")).toBeTruthy();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    expect(within(card).getByText("Porcelain Floor Tile 60x60")).toBeTruthy();
    expect(within(card).getByTestId("card-code").textContent).toContain("TILE-1");
    expect(within(card).getByText("Cairo Ceramics Showroom")).toBeTruthy();
  });

  it("has no showroom detail page to open - it offers a quote request for that product instead", () => {
    engineerRender();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.startsWith("/showroom"))).toBe(false);
    expect(hrefs).toContain("/home/engineer/requests/new?product=p1");
    expect(hrefs).toContain("/home/engineer/requests/new?product=p2");
  });

  it("uses the same quote action in list mode", () => {
    engineerRender({ initialView: "list" });
    const row = screen.getAllByTestId("showroom-catalog-row")[0]!;
    expect(within(row).getByRole("link", { name: "Request quote" }).getAttribute("href")).toBe("/home/engineer/requests/new?product=p1");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("/showroom"))).toBe(false);
  });

  it("posts no organization - saving goes to the engineer's own collection", async () => {
    engineerRender();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    expect(card.querySelector("input[name=orgId]")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /save|add/i }));
    await waitFor(() => expect(eng.change).toHaveBeenCalledWith({ action: "save", entityType: "product", entityId: "p1" }));
  });

  it("starts from the engineer's saved products and unsaves them", async () => {
    engineerRender();
    const second = screen.getAllByTestId("showroom-catalog-card")[1]!;
    const toggle = within(second).getByRole("button", { pressed: true });
    fireEvent.click(toggle);
    await waitFor(() => expect(eng.change).toHaveBeenCalledWith({ action: "unsave", entityType: "product", entityId: "p2" }));
    await waitFor(() => expect(within(second).queryByRole("button", { pressed: true })).toBeNull());
  });

  it("leaves the card as it was when the save is refused, and says so", async () => {
    eng.change.mockResolvedValueOnce({ ok: false, code: "states.genericRetry" });
    engineerRender();
    const card = screen.getAllByTestId("showroom-catalog-card")[0]!;
    fireEvent.click(within(card).getByRole("button", { name: /save|add/i }));
    await waitFor(() => expect(within(card).getByRole("alert")).toBeTruthy());
    expect(within(card).queryByRole("button", { pressed: true })).toBeNull();
  });

  it("reads further batches through the loader it is given, never the showroom's", async () => {
    const loadMore = vi.fn(async () => ({
      ok: true as const,
      products: [row({ id: "p9", name: "Extra Product" })],
      total: 3,
      imageUrls: {},
      savedIds: [],
    }));
    engineerRender({ total: 3, filters: { q: "tile" }, loadMore });
    fireEvent.click(screen.getByTestId("showroom-catalog-show-more"));
    await waitFor(() => expect(screen.getAllByTestId("showroom-catalog-card")).toHaveLength(3));
    expect(loadMore).toHaveBeenCalledWith({ q: "tile" }, 2);
    expect(feed.load).not.toHaveBeenCalled();
  });
});
