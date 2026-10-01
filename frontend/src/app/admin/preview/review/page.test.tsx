import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { PREVIEW_ORG_REQUESTS } from "@/features/admin-preview/fixtures";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * Review Center counts (Admin Core stabilization): the queue lists REAL Production items plus fixture cards for the
 * Organization Request workflow, which has no backend yet. A counter must never imply a fixture is a real request:
 * "All" and the header count only real items, the fixture tab carries a "Preview only" label instead of a number,
 * and the fixture cards stay listed (each badged) for design review.
 */
const previewReviewQueue = vi.fn();
const locale = { value: "en" };

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => locale })) }));
vi.mock("@/server/queries/admin-preview", () => ({ previewReviewQueue: (...a: unknown[]) => previewReviewQueue(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/review",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewReviewQueuePage } = await import("./page");

const verification = (n: number) => ({
  kind: "verification" as const,
  row: {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    subjectType: "user" as const,
    subjectName: `Real person ${n}`,
    verificationType: "professional_upgrade",
    requestedAccountType: null,
    status: "submitted",
    reason: null,
    submittedAt: `2026-09-2${n}T10:00:00Z`,
    decidedAt: null,
  },
});

async function renderPage(searchParams: Record<string, string> = {}) {
  const ui = await PreviewReviewQueuePage({ searchParams: Promise.resolve(searchParams) });
  const isAr = locale.value === "ar";
  return render(
    <I18nProvider locale={isAr ? "ar" : "en"} dir={isAr ? "rtl" : "ltr"}>
      {ui}
    </I18nProvider>,
  );
}

/** The numeric pill of a tab link, by the tab's label. */
function tabCount(label: RegExp): string | null {
  const tab = screen.getAllByRole("link").find((a) => label.test(a.textContent ?? ""));
  if (!tab) throw new Error(`tab ${label} not found`);
  return tab.textContent?.replace(label, "").match(/[\d٠-٩]+/)?.[0] ?? null;
}

beforeEach(() => {
  previewReviewQueue.mockReset();
  locale.value = "en";
});
afterEach(cleanup);

describe("Review Center - real vs Preview-only counts", () => {
  it("'All' counts only real items; the fixture org requests are not in it", async () => {
    previewReviewQueue.mockResolvedValue([verification(1), verification(2)]);
    await renderPage();
    expect(PREVIEW_ORG_REQUESTS.length).toBeGreaterThan(0);
    // 2 real items, never 2 + fixtures
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.all}`))).toBe("2");
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.verifications}`))).toBe("2");
  });

  it("the Organization requests tab shows 'Preview only' instead of a number", async () => {
    previewReviewQueue.mockResolvedValue([verification(1)]);
    await renderPage();
    const tab = screen.getAllByRole("link").find((a) => a.textContent?.includes(en.admin.preview.review.tabs.orgRequests));
    expect(tab?.textContent).toContain(en.admin.preview.previewOnlyBadge);
    expect(tab?.textContent).not.toMatch(/\d/);
  });

  it("the fixture cards stay listed, each badged, and a note explains they are never counted", async () => {
    previewReviewQueue.mockResolvedValue([]);
    const { container } = await renderPage();
    expect(screen.getByText(en.admin.preview.review.fixtureNote)).toBeTruthy();
    const badges = within(container).getAllByText(en.admin.preview.previewOnlyBadge);
    expect(badges.length).toBeGreaterThanOrEqual(PREVIEW_ORG_REQUESTS.length);
    // with zero real items the real count is 0 even though fixture cards are listed
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.all}`))).toBe("0");
  });

  it("the page header count is the real count too", async () => {
    previewReviewQueue.mockResolvedValue([verification(1), verification(2), verification(3)]);
    const { container } = await renderPage();
    const header = container.querySelector("h1")?.parentElement?.textContent ?? "";
    expect(header).toMatch(/3/);
    expect(header).not.toMatch(new RegExp(String(3 + PREVIEW_ORG_REQUESTS.length)));
  });

  it("works in Arabic: localized note and label, no numeric count on the Preview-only tab", async () => {
    locale.value = "ar";
    previewReviewQueue.mockResolvedValue([verification(1)]);
    await renderPage();
    expect(screen.getByText(ar.admin.preview.review.fixtureNote)).toBeTruthy();
    const tab = screen.getAllByRole("link").find((a) => a.textContent?.includes(ar.admin.preview.review.tabs.orgRequests));
    expect(tab?.textContent).toContain(ar.admin.preview.previewOnlyBadge);
    expect(tab?.textContent).not.toMatch(/[\d٠-٩]/);
  });
});
