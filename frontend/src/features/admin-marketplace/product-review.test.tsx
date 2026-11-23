import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { ProductReview, type ReviewImage, type ReviewPreset, type ReviewProduct } from "./product-review";

const approveProduct = vi.fn();
const approveImages = vi.fn();
const rejectProduct = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/admin-marketplace", () => ({
  approveProductAction: (...a: unknown[]) => approveProduct(...a),
  approveImagesAction: (...a: unknown[]) => approveImages(...a),
  rejectProductAction: (...a: unknown[]) => rejectProduct(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const img = (id: string, status: ReviewImage["status"], over: Partial<ReviewImage> = {}): ReviewImage => ({
  id, variant_id: null, sku: null, object_key: `k/${id}`, byte_size: 2048, is_primary: false, status, content_valid: true,
  content_format: "png", width_px: 800, height_px: 600, moderation_reason: null, replaces_image_id: null, previewUrl: `/p/${id}`, ...over,
});
const product = (over: Partial<ReviewProduct> = {}): ReviewProduct => ({
  id: "p1", name_ar: "ورق جدران", name_en: "Wallpaper", brand: "Acme", status: "draft", organization_name: "Nile Showroom",
  pending: 2, verified: 1, rejected: 0,
  images: [img("i1", "verified", { is_primary: true }), img("i2", "pending"), img("i3", "pending", { replaces_image_id: "i1" })],
  ...over,
});
const presets: ReviewPreset[] = [
  { id: "pr1", label_ar: "غير واضحة", label_en: "Blurry", text_ar: "الصورة غير واضحة.", text_en: "The image is blurry.", is_active: true },
  { id: "pr2", label_ar: "مخفية", label_en: "Hidden one", text_ar: "رسالة مخفية.", text_en: "Hidden message.", is_active: false },
];
const counts = { pending: 1, approved: 4, rejected: 2 };

function view(over: { products?: ReviewProduct[]; locale?: "en" | "ar"; tab?: "pending" | "approved" | "rejected" } = {}) {
  return renderWithI18n(
    <ProductReview tab={over.tab ?? "pending"} page={1} pages={1} counts={counts} products={over.products ?? [product()]}
      presets={presets} />,
    over.locale ?? "en",
  );
}

beforeEach(() => {
  for (const f of [approveProduct, approveImages, rejectProduct, refresh]) f.mockReset();
});

describe("Product review", () => {
  it("shows a product with ALL its images side by side in one scrollable strip", () => {
    view();
    const strip = screen.getByRole("list", { name: "Images of Wallpaper" });
    expect(strip).toHaveAttribute("tabindex", "0");
    expect(within(strip).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("Replaces an approved image")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("tabs show product counts and link to their status", () => {
    view();
    expect(screen.getByRole("link", { name: /Approved/ })).toHaveAttribute("href", "/admin/marketplace/media?status=approved");
    expect(screen.getByRole("link", { name: /Pending/ })).toHaveAttribute("aria-current", "page");
  });

  it("the tick approves the whole product and refreshes", async () => {
    approveProduct.mockResolvedValue({ ok: true, results: [{ id: "i2", result: "approved" }, { id: "i3", result: "validation_required" }] });
    view();
    fireEvent.click(screen.getByRole("button", { name: /Approve all pending images/ }));
    await waitFor(() => expect(approveProduct).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText(/1 approved · 1 needs a valid file check/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("the cross needs an internal reason AND an owner message before it can be sent", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: /Reject all pending images/ }));
    const confirm = screen.getByRole("button", { name: "Reject and notify the owner" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Internal reason (admin only)"), { target: { value: "stock photo" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Message to the showroom owner (Arabic)"), { target: { value: "استخدم صورتك." } });
    expect(confirm).toBeDisabled(); // one language alone is not enough
    fireEvent.change(screen.getByLabelText("Message to the showroom owner (English)"), { target: { value: "Use your own photo." } });
    expect(confirm).toBeEnabled();
  });

  it("rejects ALL pending images with a custom message in both languages", async () => {
    rejectProduct.mockResolvedValue({ ok: true, results: [{ id: "i2", result: "rejected" }, { id: "i3", result: "rejected" }] });
    view();
    fireEvent.click(screen.getByRole("button", { name: /Reject all pending images/ }));
    fireEvent.change(screen.getByLabelText("Internal reason (admin only)"), { target: { value: "stock photo" } });
    fireEvent.change(screen.getByLabelText("Message to the showroom owner (Arabic)"), { target: { value: "استخدم صورتك." } });
    fireEvent.change(screen.getByLabelText("Message to the showroom owner (English)"), { target: { value: "Use your own photo." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject and notify the owner" }));
    await waitFor(() =>
      expect(rejectProduct).toHaveBeenCalledWith({
        productId: "p1", imageIds: null, reason: "stock photo", presetId: null, messageAr: "استخدم صورتك.", messageEn: "Use your own photo.",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("excludes ONE image: only ACTIVE presets are offered and the panel targets just that image", async () => {
    rejectProduct.mockResolvedValue({ ok: true, results: [{ id: "i1", result: "rejected" }] });
    view({ products: [product({ pending: 0, images: [img("i1", "verified", { is_primary: true }), img("i2", "verified")] })] });
    fireEvent.click(screen.getAllByRole("button", { name: /Exclude this image/ })[0]!);
    expect(screen.getByRole("form", { name: "Reject 1 image(s) of Wallpaper" })).toBeInTheDocument();
    const select = document.querySelector("form select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Write my own message", "Blurry"]);
    fireEvent.change(select, { target: { value: "pr1" } });
    expect(screen.getByText("The image is blurry.")).toBeInTheDocument();
    expect(screen.getByText("الصورة غير واضحة.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message to the showroom owner (English)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Internal reason (admin only)"), { target: { value: "not sharp" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject and notify the owner" }));
    await waitFor(() =>
      expect(rejectProduct).toHaveBeenCalledWith({ productId: "p1", imageIds: ["i1"], reason: "not sharp", presetId: "pr1", messageAr: "", messageEn: "" }),
    );
  });

  it("a rejected image can be approved again (no final rejection)", async () => {
    approveImages.mockResolvedValue({ ok: true, results: [{ id: "i9", result: "approved" }] });
    view({ tab: "rejected", products: [product({ pending: 0, verified: 0, rejected: 1, images: [img("i9", "rejected", { moderation_reason: "blurry" })] })] });
    expect(screen.getByText("Internal reason: blurry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Exclude this image/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve again/ }));
    await waitFor(() => expect(approveImages).toHaveBeenCalledWith(["i9"]));
  });

  it("shows a translated refusal, never the raw code", async () => {
    approveProduct.mockResolvedValue({ ok: false, code: "no_pending_images" });
    view();
    fireEvent.click(screen.getByRole("button", { name: /Approve all pending images/ }));
    expect(await screen.findByText("This product has no pending images.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not offer the media on/off switch any more", () => {
    view();
    expect(screen.queryByText(/Public image delivery/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn (on|off)/ })).not.toBeInTheDocument();
  });

  it("is bilingual: Arabic names, labels and RTL-safe strip", () => {
    view({ locale: "ar" });
    expect(screen.getByRole("heading", { name: "ورق جدران" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "صور ورق جدران" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /معتمدة/ })).toBeInTheDocument();
  });
});
