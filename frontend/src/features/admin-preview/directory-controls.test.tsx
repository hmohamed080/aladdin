import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/context";
import { AutoFilters, SortableHeader } from "./auto-filters";
import { TablePagination } from "./table-pagination";

/**
 * Phase 1B-A — the URL contract between the directory controls and the
 * server-side directory reads: every search / filter / sort change starts again
 * at page 1, and paging keeps every active search, filter and sort. All
 * navigation is `router.replace` (no full reload).
 */
const replace = vi.fn();
let currentQuery = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/users",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const wrap = (ui: ReactNode) => (
  <I18nProvider locale="en" dir="ltr">
    {ui}
  </I18nProvider>
);

function lastUrl(): URL {
  const call = replace.mock.calls.at(-1);
  if (!call) throw new Error("no navigation happened");
  return new URL(String(call[0]), "http://x");
}

beforeEach(() => {
  replace.mockClear();
  currentQuery = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AutoFilters", () => {
  const fields = [
    { kind: "text" as const, name: "q", placeholder: "Search" },
    { kind: "select" as const, name: "verification", anyLabel: "Any", options: [{ value: "pending", label: "Pending" }] },
  ];

  it("a search change resets to page 1 and keeps the other filters, tab and sort", () => {
    vi.useFakeTimers();
    currentQuery = "status=suspended&verification=pending&sort=completeness:asc&page=7";
    render(wrap(<AutoFilters fields={fields} />));
    replace.mockClear(); // the initial debounced sync
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "hana" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const url = lastUrl();
    expect(url.searchParams.get("q")).toBe("hana");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("status")).toBe("suspended");
    expect(url.searchParams.get("verification")).toBe("pending");
    expect(url.searchParams.get("sort")).toBe("completeness:asc");
    expect(replace.mock.calls.at(-1)?.[1]).toEqual({ scroll: false });
  });

  it("a filter change resets to page 1", () => {
    currentQuery = "q=hana&page=4";
    render(wrap(<AutoFilters fields={fields} />));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pending" } });
    const url = lastUrl();
    expect(url.searchParams.get("verification")).toBe("pending");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("q")).toBe("hana");
  });

  it("clearing a filter removes it from the URL", () => {
    currentQuery = "verification=pending&page=2";
    render(wrap(<AutoFilters fields={fields} />));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(lastUrl().searchParams.has("verification")).toBe(false);
  });
});

describe("SortableHeader", () => {
  it("a sort change resets to page 1 and keeps search and filters", () => {
    currentQuery = "q=hana&governorate=giza&page=9";
    render(wrap(<SortableHeader field="completeness" label="Profile completion" />));
    fireEvent.click(screen.getByRole("button"));
    const url = lastUrl();
    expect(url.searchParams.get("sort")).toBe("completeness:desc");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("q")).toBe("hana");
    expect(url.searchParams.get("governorate")).toBe("giza");
  });

  it("the default Registered column flips to oldest first on the first click", () => {
    render(wrap(<SortableHeader field="registered" label="Registered" isDefault />));
    fireEvent.click(screen.getByRole("button"));
    expect(lastUrl().searchParams.get("sort")).toBe("registered:asc");
  });
});

describe("TablePagination", () => {
  const props = { page: 2, totalPages: 22, pageSize: 10 as const, from: 11, to: 20, total: 213 };

  it("moving between pages keeps search, filters, tab and sort", () => {
    currentQuery = "q=hana&status=pending&type=engineer&sort=registered:asc&page=2";
    render(wrap(<TablePagination {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const url = lastUrl();
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("q")).toBe("hana");
    expect(url.searchParams.get("status")).toBe("pending");
    expect(url.searchParams.get("type")).toBe("engineer");
    expect(url.searchParams.get("sort")).toBe("registered:asc");
  });

  it("can reach the last page, far beyond row 200", () => {
    currentQuery = "page=2";
    render(wrap(<TablePagination {...props} />));
    fireEvent.click(screen.getByRole("button", { name: /22$/ }));
    expect(lastUrl().searchParams.get("page")).toBe("22");
  });

  it("changing the page size returns to page 1", () => {
    currentQuery = "q=hana&page=5";
    render(wrap(<TablePagination {...props} />));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    const url = lastUrl();
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("q")).toBe("hana");
  });

  it("shows the server's full total, not a page count", () => {
    render(wrap(<TablePagination {...props} />));
    expect(screen.getByText(/213/)).toBeTruthy();
  });
});
