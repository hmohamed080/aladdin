import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import type { AdminDirectoryUser } from "@/features/admin-preview/directory-mappers";

/**
 * Phase 1B-A — the Users directory page against its server read:
 * the URL is sanitized before it reaches `admin_users_list`, a failed read
 * shows a safe error state (never raw database text), and View on Platform
 * links the PROFILE id, never the user id.
 */
const loadUsersDirectory = vi.fn();

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("@/server/queries/admin-directory", () => ({ loadUsersDirectory: (...a: unknown[]) => loadUsersDirectory(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/users",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewUsersPage } = await import("./page");

const USER_ID = "70000001-0000-4000-8000-000000000001";
const PROFILE_ID = "aed52a4d-7757-447f-82f2-8a7b2dc7ef1e";

function user(over: Partial<AdminDirectoryUser> = {}): AdminDirectoryUser {
  return {
    id: USER_ID,
    displayName: { name: "Hana Mansour", nameAr: null, nameEn: null },
    username: null,
    email: "hana@example.test",
    phone: null,
    accountType: null,
    status: "active",
    isVerified: false,
    createdAt: "2026-09-30T10:00:00Z",
    verificationState: "unverified",
    governorate: null,
    city: null,
    completion: 25,
    organization: null,
    organizationCount: 0,
    profileId: PROFILE_ID,
    publicProfileAvailable: true,
    flags: [],
    ...over,
  };
}

async function renderPage(searchParams: Record<string, string>) {
  const ui = await PreviewUsersPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const okPage = (rows: AdminDirectoryUser[], total = rows.length) => ({
  ok: true,
  data: { rows, total, page: 1, pageSize: 10, counts: { all: total, pending: 0, verified: 0, suspended: 0, rejected: 0 } },
});

beforeEach(() => loadUsersDirectory.mockReset());
afterEach(cleanup);

describe("Users directory page", () => {
  it("sends only sanitized arguments to the server read", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([]));
    await renderPage({ page: "-4", pageSize: "13", sort: "name:asc", status: "deleted", q: "  hana ", governorate: "giza" });
    expect(loadUsersDirectory.mock.calls[0]?.[1]).toEqual({
      search: "hana",
      status: null,
      accountType: null,
      verification: null,
      governorate: "giza",
      sort: "registered:desc",
      page: 1,
      pageSize: 10,
    });
  });

  it("links View on Platform to the profile id, never the user id", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user()]));
    const { container } = await renderPage({});
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/p/${PROFILE_ID}`);
    expect(hrefs).not.toContain(`/p/${USER_ID}`);
  });

  it("never links an unlisted profile", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user({ publicProfileAvailable: false })]));
    const { container } = await renderPage({});
    expect(Array.from(container.querySelectorAll("a")).some((a) => a.getAttribute("href")?.startsWith("/p/"))).toBe(false);
  });

  it("shows the server's total, not the number of rows on the page", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user()], 213));
    await renderPage({});
    expect(screen.getAllByText(/213/).length).toBeGreaterThan(0);
  });

  it("renders a safe error state when the read fails", async () => {
    loadUsersDirectory.mockResolvedValue({ ok: false });
    await renderPage({});
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
