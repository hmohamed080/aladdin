import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * Only Admin pages that still show demo data carry the Preview banner; real pages show none.
 */
const pathname = { value: "/admin" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/features/admin-preview/command-palette", () => ({ CommandPalette: () => null }));

const { PreviewShell } = await import("./preview-shell");
const P = en.admin.preview;

function titleAt(path: string, locale: "en" | "ar" = "en"): string {
  pathname.value = path;
  render(
    <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <PreviewShell paletteItems={[]}>
        <p>content</p>
      </PreviewShell>
    </I18nProvider>,
  );
  const note = screen.queryByRole("note");
  const text = note?.querySelector("p")?.textContent ?? "";
  cleanup();
  return text;
}
afterEach(cleanup);

describe("PreviewShell banners", () => {
  it("pages that still show demo data keep the Preview banner", () => {
    for (const path of ["/admin/analytics", "/admin/points", "/admin/settings"]) {
      expect(titleAt(path)).toBe(P.bannerTitle);
      expect(titleAt(path, "ar")).toBe(ar.admin.preview.bannerTitle);
    }
  });

  it.each([
    "/admin",
    "/admin/review",
    "/admin/users",
    "/admin/organizations/abc",
    "/admin/staff",
    "/admin/business-verification/abc",
    "/admin/marketplace",
    "/admin/marketplace/media",
    "/admin/verifications",
  ])("%s is real data and carries no banner", (path) => {
    expect(titleAt(path)).toBe("");
  });
});
