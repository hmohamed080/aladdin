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

  /**
   * THE REGRESSION THIS COMPONENT KEEPS HAVING.
   *
   * A smooth scroll takes a few hundred milliseconds, and a user clicking an
   * arrow twice does not wait for it. Mid-animation the cards are at drifting,
   * meaningless positions, so a second click that reasons purely from live
   * geometry finds that "the next card from here" is the one the FIRST click is
   * already travelling to — and commands a move that merely finishes it. Three
   * fast clicks then advanced one card. The rail must reason from where it is
   * HEADED, while still measuring the distance it commands from where it IS.
   */
  it("advances one card per click when clicks arrive faster than the scroll animates", () => {
    rtl = false;
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    const next = screen.getByLabelText(en.rail.next);

    fireEvent.click(next);
    expect(scrolls[0]?.left).toBe(CARD); // committed to card 2, at travel 200

    // 120px in — the animation to card 2 is still running.
    geometry.scrollLeft = 120;
    fireEvent.click(next);

    // Card 3 sits 280px ahead of the LIVE position (200 to finish the first
    // move, 200 more for the second, less the 120 already travelled). A rail
    // that ignored the in-flight commitment would ask for 80 and land back on
    // card 2 — the same card, one click wasted.
    expect(scrolls[1]?.left).toBe(280);
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("resumes from the settled position once a committed scroll has arrived", () => {
    rtl = false;
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    const next = screen.getByLabelText(en.rail.next);
    fireEvent.click(next);

    // The scroll completes and the rail reports it. The commitment must be
    // released here, or every later click would keep adding a phantom card.
    geometry.scrollLeft = CARD;
    fireEvent.scroll(screen.getByRole("group"));

    fireEvent.click(next);
    expect(scrolls[1]?.left).toBe(CARD);
  });

  it("does not overrun the end of the rail on repeated fast clicks", () => {
    rtl = false;
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    const next = screen.getByLabelText(en.rail.next);
    // Five cards: four steps exist, the fifth click has nowhere left to go and
    // must be a no-op rather than a jump past the last card.
    for (let i = 0; i < 6; i += 1) fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledTimes(4);
    // The last committed move lands card 5 at the start edge, and no further.
    expect(scrolls[3]?.left).toBe(CARD * 4);
  });

  it("hands control back to the user after a manual scroll gesture", () => {
    rtl = false;
    renderWithI18n(
      <CardRail label="group">
        <Cards />
      </CardRail>,
      "en",
    );
    const rail = screen.getByRole("group");
    fireEvent.click(screen.getByLabelText(en.rail.next));

    // The user swipes past the arrow's destination. Whatever the arrow was
    // heading for is now stale — the next click must step from where the user
    // actually is, not from an abandoned target.
    // Two cards past the arrow's destination — but deliberately NOT to the end
    // of the rail, or `next` would be disabled and the click under test would
    // never reach the component.
    fireEvent.wheel(rail);
    geometry.scrollLeft = CARD * 2;
    fireEvent.scroll(rail);

    fireEvent.click(screen.getByLabelText(en.rail.next));
    expect(scrolls[1]?.left).toBe(CARD);
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
