import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const setVisibility = vi.fn();
const move = vi.fn();
vi.mock("@/server/actions/portfolio", () => ({
  startPortfolioUpload: vi.fn(),
  finishPortfolioUpload: vi.fn(),
  updatePortfolioItemAction: vi.fn(),
  setPortfolioVisibilityAction: (...a: unknown[]) => setVisibility(...a),
  movePortfolioItemAction: (...a: unknown[]) => move(...a),
  deletePortfolioItemAction: vi.fn(),
}));

import { PortfolioManager, type PortfolioCard } from "./portfolio-manager";

const item = (over: Partial<PortfolioCard> = {}): PortfolioCard => ({
  id: "i1",
  objectKey: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png",
  contentType: "image/png",
  title: "Marble staircase",
  description: "Fifth Settlement",
  isPublic: false,
  pending: false,
  sortOrder: 0,
  createdAt: "2026-09-01T00:00:00Z",
  previewUrl: "/signed/one.png",
  ...over,
});

beforeEach(() => {
  setVisibility.mockReset();
  move.mockReset();
});

describe("PortfolioManager", () => {
  it("shows a designed empty state rather than an empty grid", () => {
    renderWithI18n(<PortfolioManager items={[]} />, "en");
    expect(screen.getByText("No work added yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  /**
   * The rule a person needs BEFORE they upload, not after. It is the single most
   * consequential fact on the page and it survives the empty state, because
   * somebody deciding whether to add their first photo is exactly who needs it.
   */
  it("states that new work starts private, even with nothing added", () => {
    renderWithI18n(<PortfolioManager items={[]} />, "en");
    expect(screen.getByText(/New work starts private/)).toBeTruthy();
  });

  it("renders the image as the subject of each card, with its title as alt text", () => {
    renderWithI18n(<PortfolioManager items={[item()]} />, "en");
    const image = screen.getByAltText("Marble staircase") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/signed/one.png");
  });

  it("marks a new item Private and offers Publish", () => {
    renderWithI18n(<PortfolioManager items={[item()]} />, "en");
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
  });

  it("marks a published item Published and offers Unpublish", () => {
    renderWithI18n(<PortfolioManager items={[item({ isPublic: true })]} />, "en");
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
  });

  /**
   * The reorder controls are inert at the ends rather than absent. A control that
   * disappears at the boundary makes the row jump, and a person who reaches the
   * top loses the affordance they were just using.
   */
  it("disables Move earlier on the first item and Move later on the last", () => {
    renderWithI18n(
      <PortfolioManager items={[item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]} />,
      "en",
    );
    const earlier = screen.getAllByRole("button", { name: "Move earlier" }) as HTMLButtonElement[];
    const later = screen.getAllByRole("button", { name: "Move later" }) as HTMLButtonElement[];
    expect(earlier[0]!.disabled).toBe(true);
    expect(earlier[1]!.disabled).toBe(false);
    expect(later[2]!.disabled).toBe(true);
    expect(later[1]!.disabled).toBe(false);
  });

  it("renders items in the order it was given, which is the order the public sees", () => {
    renderWithI18n(
      <PortfolioManager
        items={[item({ id: "a", title: "First" }), item({ id: "b", title: "Second" })]}
      />,
      "en",
    );
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["First", "Second"]);
  });

  /**
   * MIXED DIRECTION, and the shape of the fix is the assertion.
   *
   * Increment 11 put `dir="auto"` on the h3 and the p. That solved clipping —
   * the Increment 9 lesson — but introduced a second defect Increment 12 found
   * on the review card: `dir="auto"` sets the direction of the PARAGRAPH, so an
   * English title flips the whole block to LTR and `text-align: start` then
   * resolves to LEFT, stranding the title at the far edge of an otherwise
   * right-aligned card.
   *
   * `<bdi>` isolates the RUN instead. These assertions therefore pin BOTH halves
   * — the block carries no direction of its own, and the text is isolated inside
   * it — because an assertion that only read `dir` off the element would keep
   * passing after a revert to the thing that was wrong.
   */
  it("isolates user-entered text with <bdi> rather than turning the block", () => {
    for (const locale of ["en", "ar"] as const) {
      const { container, unmount } = renderWithI18n(<PortfolioManager items={[item()]} />, locale);

      const title = container.querySelector("h3")!;
      expect(title.getAttribute("dir")).toBeNull();
      expect(title.querySelector("bdi")?.getAttribute("dir")).toBe("auto");

      const description = container.querySelector("p.line-clamp-2")!;
      expect(description.getAttribute("dir")).toBeNull();
      expect(description.querySelector("bdi")?.getAttribute("dir")).toBe("auto");

      unmount();
    }
  });

  /**
   * The case the defect was found on: a Latin title in the Arabic workspace,
   * beside an Arabic one. Both must be isolated, and neither may set a direction
   * on the element that holds it.
   */
  it("handles a Latin and an Arabic title side by side in the Arabic workspace", () => {
    const { container } = renderWithI18n(
      <PortfolioManager
        items={[
          item({ id: "en", title: "Marble staircase - Fifth Settlement" }),
          item({ id: "ar", title: "تكسية مطبخ - الشيخ زايد" }),
        ]}
      />,
      "ar",
    );
    const headings = [...container.querySelectorAll("h3")];
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading.getAttribute("dir")).toBeNull();
      expect(heading.querySelector("bdi")?.getAttribute("dir")).toBe("auto");
    }
    // The text itself is untouched — isolation is about direction, not content.
    expect(headings[0]!.textContent).toBe("Marble staircase - Fifth Settlement");
    expect(headings[1]!.textContent).toBe("تكسية مطبخ - الشيخ زايد");
  });

  /**
   * A FORM CONTROL KEEPS `dir="auto"`. There it sets the typing direction, which
   * is what the attribute is for, and `<bdi>` does not apply to an input. The
   * distinction is easy to lose in a sweep, so it is pinned.
   */
  it("leaves dir=auto on the inputs, where it is the right answer", () => {
    const { container } = renderWithI18n(<PortfolioManager items={[]} />, "ar");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عمل" }));
    const title = container.querySelector('input[name="title"]');
    const description = container.querySelector('textarea[name="description"]');
    expect(title?.getAttribute("dir")).toBe("auto");
    expect(description?.getAttribute("dir")).toBe("auto");
  });

  it("never renders a storage key or an item id", () => {
    const { container } = renderWithI18n(<PortfolioManager items={[item()]} />, "en");
    expect(container.textContent).not.toContain("aaaaaaaa-1111");
    expect(container.textContent).not.toContain("i1");
  });
});

/**
 * The recovery surface (§7). An upload that failed leaves a row, and the person
 * has to be able to see and resolve it — otherwise they try again and accumulate
 * rows nobody ever cleans.
 */
describe("unfinished uploads", () => {
  it("separates them from the gallery and offers Finish and Discard", () => {
    renderWithI18n(<PortfolioManager items={[item({ pending: true, previewUrl: null })]} />, "en");
    const section = screen.getByRole("region", { name: "Unfinished uploads" });
    expect(within(section).getByRole("button", { name: "Finish upload" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Discard" })).toBeTruthy();
    // It is not in the gallery, so it carries no publish control at all.
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("counts a pending item as neither published nor private work", () => {
    renderWithI18n(
      <PortfolioManager items={[item({ id: "p", pending: true, previewUrl: null })]} />,
      "en",
    );
    expect(screen.getByText("No work added yet")).toBeTruthy();
  });

  it("says nothing about unfinished uploads when there are none", () => {
    renderWithI18n(<PortfolioManager items={[item()]} />, "en");
    expect(screen.queryByText("Unfinished uploads")).toBeNull();
  });
});
