import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { LandingMarketplaceGate } from "./landing-marketplace-gate";
import { LandingMarketplaceLoader } from "./landing-marketplace-loader";

const state = vi.hoisted(() => ({ flag: undefined as string | undefined, loads: 0 }));
vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_MARKETPLACE_PREVIEW: state.flag }),
}));
vi.mock("@/server/queries/marketplace-public", () => ({
  loadPublicCatalogPage: async () => {
    state.loads += 1;
    return {
      total: 1,
      limit: 24,
      offset: 0,
      items: [
        {
          slug: "suzuki-518",
          name_ar: "ورق حائط سوزوكي 518",
          name_en: "Suzuki 518 wallpaper",
          brand: null,
          product_type_key: "wallpaper",
          product_type_name_ar: "ورق حائط",
          product_type_name_en: "Wallpaper",
          category_key: "wall_coverings_panels",
          category_name_ar: "أغطية الجدران",
          category_name_en: "Wall coverings",
          seller_name: "Decore Store",
          from_price_egp: 1175,
          in_stock: true,
          variant_count: 7,
          image_id: "00000000-0000-4000-8000-000000000001",
          colors: [],
        },
      ],
    };
  },
}));

/** Resolves the async loader the way the server does, then renders the result. */
const renderGate = async () => {
  const gate = LandingMarketplaceGate();
  const tree = gate && gate.type === LandingMarketplaceLoader ? await LandingMarketplaceLoader() : gate;
  return render(
    <I18nProvider locale="ar" dir="rtl">
      {tree}
    </I18nProvider>,
  );
};

describe("LandingMarketplaceGate (release flag + real data)", () => {
  beforeEach(() => {
    state.flag = undefined;
    state.loads = 0;
  });

  it.each([undefined, "false", "TRUE", "1", ""])("renders nothing and reads nothing when the flag is %j", async (flag) => {
    state.flag = flag;
    const { container } = await renderGate();
    expect(container.querySelector("#marketplace")).toBeNull();
    expect(state.loads).toBe(0);
  });

  it("renders the published products from the database, never sample data", async () => {
    state.flag = "true";
    const { container, getByText } = await renderGate();
    expect(container.querySelector("#marketplace")).not.toBeNull();
    expect(getByText("ورق حائط سوزوكي 518")).toBeTruthy();
    expect(container.querySelector('a[href="/marketplace/products/suzuki-518"]')).not.toBeNull();
    expect(container.querySelector('img[src="/marketplace/media/00000000-0000-4000-8000-000000000001"]')).not.toBeNull();
    // no sample prices, offers, countdown or cart
    expect(container.textContent).not.toMatch(/550|750|عروض خاطفة|أضف للسلة|بيانات تجريبية/);
    expect(container.querySelector('[role="timer"]')).toBeNull();
  });
});
