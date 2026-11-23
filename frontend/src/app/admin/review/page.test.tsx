import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * Review Center: an operational queue of REAL records only. The Organization Request samples ("Preview only", no backend)
 * were removed; the header count, the "All" tab and the listed rows come from the same list, so they cannot disagree, and no
 * copy names an environment ("Production") or claims sample data.
 */
const previewReviewQueue = vi.fn();
const locale = { value: "en" };

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => locale })) }));
vi.mock("@/server/queries/admin-preview", () => ({ previewReviewQueue: (...a: unknown[]) => previewReviewQueue(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/review",
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

describe("Review Center - real records only", () => {
  it("lists exactly the real items: the header count, the All tab and the rows agree", async () => {
    previewReviewQueue.mockResolvedValue([verification(1), verification(2), verification(3)]);
    const { container } = await renderPage();
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.all}`))).toBe("3");
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.verifications}`))).toBe("3");
    const header = container.querySelector("h1")?.parentElement?.textContent ?? "";
    expect(header).toMatch(/3/);
    expect(screen.getAllByText(/Real person \d/)).toHaveLength(3);
  });

  it("shows no sample organization requests, no Organization Requests tab and no Preview-only badge", async () => {
    previewReviewQueue.mockResolvedValue([verification(1)]);
    const { container } = await renderPage();
    expect(screen.queryByText(en.admin.preview.previewOnlyBadge)).toBeNull();
    expect(screen.getAllByRole("link").some((a) => /Organization Requests/i.test(a.textContent ?? ""))).toBe(false);
    for (const sample of ["Nile Home Showroom", "Delta Build Contracting", "Alex Glass"]) expect(container.textContent).not.toContain(sample);
    expect(container.querySelector('a[href*="org-request"]')).toBeNull();
  });

  it("an empty queue is an empty state with a zero count, not sample cards", async () => {
    previewReviewQueue.mockResolvedValue([]);
    const { container } = await renderPage();
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.all}`))).toBe("0");
    expect(screen.getByText(en.admin.preview.review.empty)).toBeTruthy();
    expect(container.querySelectorAll('a[href^="/admin/review/"]').length).toBe(0);
  });

  it("names no environment in its copy (English and Arabic)", () => {
    for (const review of [en.admin.preview.review, ar.admin.preview.review]) {
      expect(JSON.stringify(review)).not.toMatch(/Production|الإنتاج/);
    }
  });

  it("works in Arabic with the same counts and no Preview-only badge", async () => {
    locale.value = "ar";
    previewReviewQueue.mockResolvedValue([verification(1), verification(2)]);
    await renderPage();
    expect(tabCount(new RegExp(`^${ar.admin.preview.review.tabs.all}`))).toMatch(/^(2|٢)$/);
    expect(screen.queryByText(ar.admin.preview.previewOnlyBadge)).toBeNull();
  });
});

describe("Review Center - count semantics under search, tabs and pagination", () => {
  const network = (n: number) => ({
    kind: "networkReferral" as const,
    row: {
      id: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
      displayName: `Net shop ${n}`,
      referrerName: "Ref",
      matchId: null,
      createdAt: `2026-08-${String(n).padStart(2, "0")}T10:00:00Z`,
    },
  });
  const verifications = () =>
    Array.from({ length: 12 }, (_, i) => {
      const v = verification((i % 9) + 1);
      return { ...v, row: { ...v.row, id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, subjectName: `Real person ${i}` } };
    });
  const many = () => [...verifications(), network(1), network(2)];
  const header = (c: HTMLElement) => c.querySelector("h1")?.parentElement?.textContent ?? "";
  const headCount = (c: HTMLElement) => header(c).replace(en.admin.preview.review.title, "").match(/[\d٠-٩]+/)?.[0] ?? null;
  const cards = (c: HTMLElement, kind?: string) =>
    c.querySelectorAll(kind ? `a[href*="/admin/review/${kind}/"]` : 'a[href*="/admin/review/verification/"], a[href*="/admin/review/network-referral/"]');
  const ALL_TAB = () => tabCount(new RegExp(`^${en.admin.preview.review.tabs.all}`));

  it("tab counts are whole-queue totals; the header is the filtered total; rows are one page of the filtered set", async () => {
    previewReviewQueue.mockResolvedValue(many());
    const { container } = await renderPage({ pageSize: "10" });
    expect(ALL_TAB()).toBe("14");
    expect(headCount(container)).toBe("14");
    expect(cards(container)).toHaveLength(10);
  });

  it("a tab filter changes the header and rows, never the tab counts", async () => {
    previewReviewQueue.mockResolvedValue(many());
    const { container } = await renderPage({ tab: "networkReferrals" });
    expect(headCount(container)).toBe("2");
    expect(cards(container, "network-referral")).toHaveLength(2);
    expect(cards(container, "verification")).toHaveLength(0);
    expect(ALL_TAB()).toBe("14");
    expect(tabCount(new RegExp(`^${en.admin.preview.review.tabs.verifications}`))).toBe("12");
  });

  it("a search changes the header and rows (across every page), never the tab counts", async () => {
    previewReviewQueue.mockResolvedValue(many());
    const { container } = await renderPage({ q: "net shop 2", pageSize: "10" });
    expect(headCount(container)).toBe("1");
    expect(cards(container)).toHaveLength(1);
    expect(ALL_TAB()).toBe("14");
  });

  it("page 2 shows the remainder of the same filtered set; the header still counts all of it", async () => {
    previewReviewQueue.mockResolvedValue(many());
    const { container } = await renderPage({ page: "2", pageSize: "10" });
    expect(headCount(container)).toBe("14");
    expect(cards(container)).toHaveLength(4);
  });

  it("a search with no match is an empty state with a zero header and unchanged tab counts", async () => {
    previewReviewQueue.mockResolvedValue(many());
    const { container } = await renderPage({ q: "zzz-no-match" });
    expect(screen.getByText(en.admin.preview.review.empty)).toBeTruthy();
    expect(headCount(container)).toBe("0");
    expect(ALL_TAB()).toBe("14");
  });
});
