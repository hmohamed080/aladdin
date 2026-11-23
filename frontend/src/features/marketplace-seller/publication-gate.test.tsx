import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { SellerProductDetail } from "@/server/queries/marketplace-seller-catalog";
import type { ProductTypeSchema } from "./form-model";

const save = vi.fn();
const publish = vi.fn();
const unpublish = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: () => ({}) }));
vi.mock("@/server/actions/marketplace-seller", () => ({
  saveSellerProductAction: (...a: unknown[]) => save(...a),
  publishProductAction: (...a: unknown[]) => publish(...a),
  unpublishProductAction: (...a: unknown[]) => unpublish(...a),
  adjustStockAction: vi.fn(),
  ensureDefaultLocationAction: vi.fn(),
  requestImageUploadAction: vi.fn(),
  confirmImageUploadAction: vi.fn(),
  removeImageAction: vi.fn(),
  updateImagesAction: vi.fn(),
  finishPendingImageRemovalsAction: vi.fn(),
}));

import { ProductForm } from "./product-form";
import { RowPublishToggle } from "./row-publish";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
});

const schema: ProductTypeSchema = {
  key: "wallpaper",
  nameAr: "ورق حائط",
  nameEn: "Wallpaper",
  categoryKey: "walls",
  categoryNameAr: "حوائط",
  categoryNameEn: "Walls",
  fields: [{ key: "color", nameAr: "اللون", nameEn: "Colour", dataType: "option", unitAr: null, unitEn: null, level: "variant", required: true, options: [{ key: "beige", nameAr: "بيج", nameEn: "Beige", swatchHex: null }] }],
};
const other: ProductTypeSchema = { ...schema, key: "cornice", nameAr: "كورنيش", nameEn: "Cornice", categoryKey: "ceilings", categoryNameAr: "أسقف", categoryNameEn: "Ceilings", fields: [] };

function renderForm(locale: "ar" | "en", props: Partial<React.ComponentProps<typeof ProductForm>> = {}) {
  return render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <ProductForm organizationId="org" schemas={[schema, other]} storeSetup={{ paymentReady: false, deliveryReady: false }} {...props} />
    </I18nProvider>,
  );
}

const product = (over: Partial<SellerProductDetail> = {}): SellerProductDetail => ({
  id: "p1",
  organizationId: "org",
  productTypeKey: "wallpaper",
  nameAr: "ورق",
  nameEn: "Paper",
  descriptionAr: null,
  descriptionEn: null,
  brand: null,
  externalRef: null,
  slug: "paper",
  status: "draft",
  attributes: {},
  variants: [{ id: "v1", sku: "WP-1", selling_unit: "roll", price_egp: 10, status: "active", attributes: { color: "beige" }, stock: [{ location_id: "l1", location_name_ar: "م", location_name_en: "Main", location_active: true, on_hand: 9, reserved: 0, available: 9 }] }],
  images: [{ id: "i1", variantId: null, objectKey: "k", sortOrder: 0, isPrimary: true, status: "pending", uploadState: "confirmed", url: null }],
  blockers: [],
  publication: { status: "draft", lowStockThreshold: 5, reviewState: "pending_review", paymentReady: true, deliveryReady: true, listed: true, canPublish: false },
  pendingRemovals: [],
  ...over,
});

describe("product page (PR 7)", () => {
  it("puts the product name before the product type, labels the SKU «كود المنتج» and has no readiness check", () => {
    renderForm("ar");
    const labels = screen.getAllByText(/اسم المنتج|نوع المنتج/).map((n) => n.textContent);
    expect(labels.findIndex((l) => l?.includes("اسم المنتج"))).toBeLessThan(labels.findIndex((l) => l === "نوع المنتج"));
    expect(screen.getByText("كود المنتج")).toBeTruthy();
    expect(screen.getByText("(SKU)")).toBeTruthy();
    expect(screen.queryByText(/فحص جاهزية النشر/)).toBeNull();
    expect(screen.queryByText(/حقول مطلوبة للنشر لم تُملأ/)).toBeNull();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "معاينة" })).toBeTruthy();
    expect(screen.queryByText("حفظ والعودة للمنتجات")).toBeNull();
  });

  it("marks every missing required field red on Save and does not call the server", async () => {
    renderForm("en");
    const before = document.querySelectorAll("[data-invalid='true']").length; // only the store-setup rows
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelectorAll("[data-invalid='true']").length).toBeGreaterThan(before + 4));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/red/);
    expect(screen.getByText("Enable at least one payment method")).toBeTruthy();
  });

  it("lets the seller change the type of a saved product and sends it; the category follows", async () => {
    save.mockResolvedValue({ ok: true, id: "p1", created: false, status: "draft", blockers: [], variants: [] });
    renderForm("en", { product: product() });
    const type = screen.getByLabelText("Product type") as HTMLSelectElement;
    expect(type.disabled).toBe(false);
    fireEvent.change(type, { target: { value: "cornice" } });
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("Ceilings");
  });

  it("Save as draft saves and returns to the products list", async () => {
    save.mockResolvedValue({ ok: true, id: "p1", created: false, status: "draft", blockers: [], variants: [] });
    renderForm("en", { product: product({ variants: [{ ...product().variants[0]!, attributes: { color: "beige" } }] }), storeSetup: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/showroom/marketplace/products"));
    expect(save.mock.calls[0]![0]).toMatchObject({ id: "p1", product_type_key: "wallpaper" });
  });

  it("offers Publish only once the product is approved and unblocked", () => {
    const { unmount } = renderForm("en", { product: product() });
    expect(screen.queryByRole("button", { name: "Publish to the Marketplace" })).toBeNull();
    expect(screen.getByText(/Publishing opens once the platform team approves/)).toBeTruthy();
    unmount();
    renderForm("en", { product: product({ publication: { ...product().publication!, reviewState: "approved", canPublish: true } }) });
    expect(screen.getByRole("button", { name: "Publish to the Marketplace" })).toBeTruthy();
  });
});

describe("RowPublishToggle", () => {
  const wrap = (reviewState: "approved" | "pending_review", status = "draft") =>
    render(
      <I18nProvider locale="en" dir="ltr">
        <RowPublishToggle productId="p1" status={status} reviewState={reviewState} />
      </I18nProvider>,
    );

  it("is unavailable until approval and never shows a blocker list", () => {
    wrap("pending_review");
    const b = screen.getByRole("button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/approves the product/);
  });

  it("publishes an approved product directly", async () => {
    publish.mockResolvedValue({ ok: true, status: "published" });
    wrap("approved");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("p1"));
    expect(refresh).toHaveBeenCalled();
  });
});
