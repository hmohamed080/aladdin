import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { FilterBar } from "./filter-bar";
import { LIVE_SEARCH_DEBOUNCE_MS, normalizeSearchInput } from "@/lib/search/normalize";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const bar = (value = "", extra: Partial<React.ComponentProps<typeof FilterBar>> = {}) => (
  <I18nProvider locale="en" dir="ltr">
    <FilterBar basePath="/catalog" liveSearch search={{ name: "q", value, placeholder: "Search products" }} clearLabel="Clear" {...extra} />
  </I18nProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
});
afterEach(() => vi.useRealTimers());

describe("normalizeSearchInput", () => {
  it("trims, collapses whitespace and keeps the letter case (the database matches case-insensitively)", () => {
    expect(normalizeSearchInput("  Interior   Wall \t Paint ")).toBe("Interior Wall Paint");
    expect(normalizeSearchInput("iNtErIoR")).toBe("iNtErIoR");
    expect(normalizeSearchInput("FX-SARA-58")).toBe("FX-SARA-58");
    expect(normalizeSearchInput(undefined)).toBe("");
    expect(normalizeSearchInput("x".repeat(300))).toHaveLength(100);
  });
});

describe("FilterBar live search", () => {
  it("has no Search button — the field applies itself", () => {
    render(bar());
    expect(screen.queryByRole("button", { name: /^search$/i })).toBeNull();
    expect(document.querySelector('form[role="search"] button[type="submit"]')).toBeNull();
  });

  it("waits for typing to pause (debounce), then sends ONE normalized request", () => {
    render(bar());
    const input = screen.getByTestId("live-search-input");
    fireEvent.change(input, { target: { value: "i" } });
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.change(input, { target: { value: "in" } });
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.change(input, { target: { value: "  iNtErIoR   paint " } });
    act(() => void vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS - 1));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/catalog?q=iNtErIoR+paint");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("keeps the other active filters and drops q when the box is cleared", () => {
    nav.params = new URLSearchParams("category=paint&q=wall");
    render(bar("wall"));
    const input = screen.getByTestId("live-search-input");
    fireEvent.change(input, { target: { value: "wall paint" } });
    act(() => void vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS + 1));
    expect(nav.replace).toHaveBeenLastCalledWith("/catalog?category=paint&q=wall+paint");
    fireEvent.change(input, { target: { value: "" } });
    act(() => void vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS + 1));
    expect(nav.replace).toHaveBeenLastCalledWith("/catalog?category=paint");
  });

  it("does not re-send a query that is already applied, and Enter applies at once", () => {
    render(bar("wall"));
    const input = screen.getByTestId("live-search-input");
    fireEvent.change(input, { target: { value: "wall " } });
    act(() => void vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS + 1));
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "tile" } });
    fireEvent.submit(input.closest("form")!);
    expect(nav.replace).toHaveBeenCalledWith("/catalog?q=tile");
  });

  it("follows an outside URL change (e.g. Clear) without overwriting what is being typed", () => {
    const { rerender } = render(bar("wall"));
    const input = screen.getByTestId("live-search-input") as HTMLInputElement;
    rerender(bar(""));
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "ti" } });
    act(() => void vi.advanceTimersByTime(LIVE_SEARCH_DEBOUNCE_MS + 1));
    fireEvent.change(input, { target: { value: "til" } });
    rerender(bar("ti"));
    expect(input.value).toBe("til");
  });

  it("the classic (non-live) bar still has its Search button and submits on demand", () => {
    render(bar("", { liveSearch: false }));
    expect(screen.getByRole("button", { name: /search/i })).toBeTruthy();
  });
});
