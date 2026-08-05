import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * Sprint 6.2 — SalesRealtime timer teardown + dirty-form deferral.
 * The Supabase browser client, router, and pathname are stubbed so the component
 * renders in jsdom; the mocked channel captures the change handler and the
 * subscribe callback so a real "event" can be driven.
 */
const refresh = vi.fn();
let onChangeHandlers: Array<() => void> = [];
let subscribeCb: ((s: string) => void) | undefined;
const removeChannel = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/b2b/customers/x/edit",
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    realtime: { setAuth: vi.fn() },
    channel: () => {
      const ch: Record<string, unknown> = {
        on: (_e: string, _o: unknown, h: () => void) => {
          onChangeHandlers.push(h);
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          subscribeCb = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel,
  }),
}));

import { SalesRealtime } from "./sales-realtime";

const wrap = (branchId: string | null) => (
  <I18nProvider locale="ar" dir="rtl">
    <SalesRealtime orgId="org-1" branchId={branchId} />
  </I18nProvider>
);

async function setup(branchId: string | null = null) {
  const result = render(wrap(branchId));
  // Flush the async getSession → channel subscribe.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => subscribeCb?.("SUBSCRIBED"));
  const rerenderBranch = (b: string | null) => result.rerender(wrap(b));
  return { ...result, rerenderBranch };
}

beforeEach(() => {
  onChangeHandlers = [];
  subscribeCb = undefined;
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SalesRealtime — timer teardown", () => {
  it("starts the flash timer on refresh and clears it on unmount (no post-unmount work)", async () => {
    const { unmount } = await setup();
    act(() => onChangeHandlers[0]!()); // schedule the 400ms debounce
    act(() => vi.advanceTimersByTime(400)); // debounce → doRefresh
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/تم التحديث/)).toBeInTheDocument(); // flash on

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unmount();
    act(() => vi.advanceTimersByTime(3000)); // past the 2500ms flash timer
    expect(refresh).toHaveBeenCalledTimes(1); // no further work after unmount
    expect(errSpy).not.toHaveBeenCalled(); // no state-after-unmount warning
    errSpy.mockRestore();
  });

  it("clears a pending debounce timer when the branch changes", async () => {
    const { rerenderBranch } = await setup(null);
    act(() => onChangeHandlers[0]!()); // schedule debounce
    act(() => vi.advanceTimersByTime(100)); // not yet fired
    await act(async () => rerenderBranch("branch-1")); // cleanup clears the old timer
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled(); // the stale debounce did not fire
  });
});

describe("SalesRealtime — dirty-form deferral", () => {
  it("defers a refresh while a form is dirty even after focus leaves; manual apply refreshes", async () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    form.appendChild(input);
    document.body.appendChild(form);
    try {
      await setup();
      input.focus();
      fireEvent.input(input, { target: { value: "typed" } }); // marks the form dirty
      input.blur(); // focus leaves → activeElement is body
      act(() => onChangeHandlers[0]!());
      act(() => vi.advanceTimersByTime(400));
      expect(refresh).not.toHaveBeenCalled(); // deferred because a form is dirty

      const btn = screen.getByTestId("realtime-refresh");
      act(() => fireEvent.click(btn)); // manual apply
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(form);
    }
  });

  it("does NOT defer for a search/filter form marked data-no-dirty", async () => {
    const form = document.createElement("form");
    form.setAttribute("data-no-dirty", "");
    const input = document.createElement("input");
    form.appendChild(input);
    document.body.appendChild(form);
    try {
      await setup();
      fireEvent.input(input, { target: { value: "search term" } });
      act(() => onChangeHandlers[0]!());
      act(() => vi.advanceTimersByTime(400));
      expect(refresh).toHaveBeenCalledTimes(1); // not deferred — search form is not an edit
    } finally {
      document.body.removeChild(form);
    }
  });
});
