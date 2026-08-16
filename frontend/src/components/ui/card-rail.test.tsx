import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { CardRail } from "./card-rail";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";

/**
 * The rail's behaviour is entirely geometric, and happy-dom lays nothing out —
 * every box is 0×0. So the scroll geometry is stubbed on the prototype to
 * describe the two situations that actually matter: content that fits, and
 * content that does not. What is being tested is the DECISION the component
 * makes from that geometry, which is the part that can regress.
 */
const geometry = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
const scrolls: ScrollToOptions[] = [];
const scrollBy = vi.fn((opts: ScrollToOptions) => {
  scrolls.push(opts);
});

beforeEach(() => {
  geometry.scrollWidth = 1000;
  geometry.clientWidth = 400;
  geometry.scrollLeft = 0;
  scrolls.length = 0;
  scrollBy.mockClear();

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

  for (const key of ["scrollWidth", "clientWidth"] as const) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => geometry[key],
    });
  }
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get: () => geometry.scrollLeft,
    set: (v: number) => {
      geometry.scrollLeft = v;
    },
  });
  // `scrollBy` is overloaded (options OR x,y); the rail only ever calls the
  // options form, so the spy is narrowed to it and cast into the slot.
  HTMLElement.prototype.scrollBy = scrollBy as unknown as HTMLElement["scrollBy"];
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 200, height: 100 }) as DOMRect;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Cards() {
  return (
    <>
      <div>one</div>
      <div>two</div>
      <div>three</div>
    </>
  );
}

describe("CardRail", () => {
  it("shows no controls and adds no tab stop when the cards already fit", () => {
    geometry.scrollWidth = 400;
    geometry.clientWidth = 400;
    renderWithI18n(
      <CardRail label="مجموعة">
        <Cards />
      </CardRail>,
    );
    expect(screen.queryByTestId("rail-prev")).toBeNull();
    expect(screen.queryByTestId("rail-next")).toBeNull();
    // A rail that fits must not steal a tab stop from the cards inside it.
    expect(screen.getByRole("group")).not.toHaveAttribute("tabindex");
  });

  it("shows controls when the content overflows, with previous disabled at the start", () => {
    renderWithI18n(
      <CardRail label="مجموعة">
        <Cards />
      </CardRail>,
    );
    expect(screen.getByLabelText(ar.rail.previous)).toBeDisabled();
    expect(screen.getByLabelText(ar.rail.next)).toBeEnabled();
    expect(screen.getByRole("group")).toHaveAttribute("tabindex", "0");
  });

  it("disables next once the rail has reached the end", () => {
    // RTL rests at 0 and travels NEGATIVE — the component must read the distance,
    // not the raw value, or the end is never detected in Arabic.
    geometry.scrollLeft = -600;
    renderWithI18n(
      <CardRail label="مجموعة">
        <Cards />
      </CardRail>,
    );
    fireEvent.scroll(screen.getByRole("group"));
    expect(screen.getByLabelText(ar.rail.next)).toBeDisabled();
    expect(screen.getByLabelText(ar.rail.previous)).toBeEnabled();
  });

  it("scrolls toward increasing scrollLeft for next in LTR", () => {
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    fireEvent.click(screen.getByLabelText(en.rail.next));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrolls[0]?.left).toBeGreaterThan(0);
  });

  it("scrolls toward decreasing scrollLeft for next in RTL", () => {
    renderWithI18n(
      <CardRail label="مجموعة">
        <Cards />
      </CardRail>,
    );
    fireEvent.click(screen.getByLabelText(ar.rail.next));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Same logical intent, opposite physical sign. Getting this wrong makes the
    // Arabic rail jump to the end on the first "next".
    expect(scrolls[0]?.left).toBeLessThan(0);
  });

  it("moves by whole cards rather than an arbitrary pixel amount", () => {
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    fireEvent.click(screen.getByLabelText(en.rail.next));
    // 400px viewport / 200px cards = 2 per view; gap is 0 in the stubbed style.
    expect(scrolls[0]?.left).toBe(400);
  });
});
