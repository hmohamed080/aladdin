import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { CardRail } from "./card-rail";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";

/**
 * The rail's behaviour is entirely geometric, and happy-dom lays nothing out —
 * every box is 0×0. So the scroll geometry is MODELLED here rather than stubbed
 * flat: the track is a 400px window, cards are 200px wide, and each card's rect
 * is derived from its index and the current scroll travel. That is what lets the
 * one-card-per-click rule be tested at all, because the component now reads
 * where the adjacent card IS instead of multiplying a width by a count.
 *
 * The RTL model is the mirror of the LTR one: the rail rests at scrollLeft 0 and
 * travels NEGATIVE, and a card's distance from the start is measured from the
 * track's RIGHT edge inward.
 */
const TRACK = 400;
const CARD = 200;

const geometry = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
/** Which writing direction the current render is in — mirrors the locale used. */
let rtl = true;

const scrolls: ScrollToOptions[] = [];
const scrollBy = vi.fn((opts: ScrollToOptions) => {
  scrolls.push(opts);
});

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, height: 100, top: 0, bottom: 100, x: left, y: 0 } as DOMRect;
}

beforeEach(() => {
  geometry.scrollWidth = 1000;
  geometry.clientWidth = TRACK;
  geometry.scrollLeft = 0;
  rtl = true;
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

  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const parent = this.parentElement;
    const isCard = parent?.getAttribute("role") === "group";
    if (!isCard) return rect(0, TRACK);
    const i = Array.prototype.indexOf.call(parent!.children, this);
    const travelled = Math.abs(geometry.scrollLeft);
    // Distance of this card's LOGICAL start edge from the track's, then placed
    // physically according to direction.
    const lead = i * CARD - travelled;
    return rtl ? rect(TRACK - lead - CARD, CARD) : rect(lead, CARD);
  };
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
      <div>four</div>
      <div>five</div>
    </>
  );
}

describe("CardRail", () => {
  it("shows no controls and adds no tab stop when the cards already fit", () => {
    geometry.scrollWidth = TRACK;
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

  it("advances exactly ONE card per click in LTR, whatever fits on screen", () => {
    rtl = false;
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    fireEvent.click(screen.getByLabelText(en.rail.next));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Two cards fit in the 400px window. A pager would move 400; a swipe moves
    // one card — and that is the whole point of this component's arrows.
    expect(scrolls[0]?.left).toBe(CARD);
  });

  it("advances exactly ONE card per click in RTL, with the opposite sign", () => {
    renderWithI18n(
      <CardRail label="مجموعة">
        <Cards />
      </CardRail>,
    );
    fireEvent.click(screen.getByLabelText(ar.rail.next));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Same logical intent, opposite physical sign. Getting this wrong makes the
    // Arabic rail jump to the end on the first "next".
    expect(scrolls[0]?.left).toBe(-CARD);
  });

  it("keeps advancing one card at a time from a mid-rail position", () => {
    rtl = false;
    geometry.scrollLeft = CARD; // parked on card 2
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    fireEvent.click(screen.getByLabelText(en.rail.next));
    // Card 3 is one card ahead — not the last card, not two ahead.
    expect(scrolls[0]?.left).toBe(CARD);
  });

  it("steps back exactly one card", () => {
    rtl = false;
    geometry.scrollLeft = CARD * 2; // parked on card 3
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    fireEvent.scroll(screen.getByRole("group"));
    fireEvent.click(screen.getByLabelText(en.rail.previous));
    expect(scrolls[0]?.left).toBe(-CARD);
  });
});
