import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

type State = { ok: boolean; code?: string };
const result: { value: State } = { value: { ok: true } };
const sent: FormData[] = [];

vi.mock("@/server/actions/trades", () => ({
  setTradesAction: async (_prev: State, fd: FormData): Promise<State> => {
    sent.push(fd);
    return result.value;
  },
}));

import { TradeSelector } from "./trade-selector";
import { TradeSummary } from "./trade-summary";

const catalog = [
  { id: "t1", key: "kitchens_doors" },
  { id: "t2", key: "plumbing" },
  { id: "t3", key: "electrical" },
  { id: "t4", key: "tiling" },
  { id: "t5", key: "marble_granite" },
];

beforeEach(() => {
  result.value = { ok: true };
  sent.length = 0;
});

/** The two hidden fields the form actually submits. */
function posted(container: HTMLElement) {
  const keys = container.querySelector<HTMLInputElement>('input[name="keys"]');
  const primary = container.querySelector<HTMLInputElement>('input[name="primary"]');
  return { keys: keys?.value.split("\n").filter(Boolean) ?? [], primary: primary?.value ?? "" };
}

const chip = (label: string) => screen.getByRole("button", { name: label });

describe("TradeSelector", () => {
  it("offers every trade in the catalog, translated", () => {
    renderWithI18n(<TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />, "en");
    for (const label of ["Kitchens & doors", "Plumbing", "Electrical", "Tiling", "Marble & granite"]) {
      expect(chip(label)).toBeTruthy();
    }
  });

  /**
   * The hook has to be on a REAL element. `data-*` props typecheck on any React
   * component and are silently dropped unless it forwards them, and `Card` does
   * not — so a `data-testid` there compiles, passes review and never reaches the
   * DOM. Increment 4 hit this exact trap; here a browser found it, because no
   * test had queried for the id. This is the query that would have.
   */
  it("puts its test hook somewhere that actually reaches the DOM", () => {
    renderWithI18n(<TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />, "en");
    expect(screen.getByTestId("trade-selector")).toBeTruthy();
  });

  it("says what an empty selection means rather than showing an empty box", () => {
    renderWithI18n(<TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />, "en");
    expect(screen.getByTestId("trade-selector-empty")).toBeTruthy();
  });

  /**
   * The first selection is primary without a second gesture. A selection with
   * nothing leading it is a state the database will not store — it names the
   * first submitted key itself — so the screen must not be able to show one.
   */
  it("makes the first trade selected the primary one", () => {
    const { container } = renderWithI18n(
      <TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />,
      "en",
    );
    fireEvent.click(chip("Plumbing"));
    expect(posted(container)).toEqual({ keys: ["plumbing"], primary: "plumbing" });
    expect(screen.getByText("Main trade")).toBeTruthy();
  });

  it("holds many trades at once with exactly one marked primary", () => {
    const { container } = renderWithI18n(
      <TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />,
      "en",
    );
    fireEvent.click(chip("Plumbing"));
    fireEvent.click(chip("Electrical"));
    fireEvent.click(chip("Tiling"));

    const { keys, primary } = posted(container);
    expect(keys.sort()).toEqual(["electrical", "plumbing", "tiling"]);
    expect(primary).toBe("plumbing");
    expect(screen.getAllByText("Main trade")).toHaveLength(1);
  });

  it("changes the primary without disturbing the selection", () => {
    const { container } = renderWithI18n(
      <TradeSelector
        catalog={catalog}
        mine={{ keys: ["plumbing", "tiling"], primaryKey: "plumbing" }}
      />,
      "en",
    );
    // The promote control is absent on the row that already IS primary, so the
    // only one on screen belongs to the other trade.
    fireEvent.click(screen.getByRole("button", { name: /Make this the main trade/ }));

    const { keys, primary } = posted(container);
    expect(keys.sort()).toEqual(["plumbing", "tiling"]);
    expect(primary).toBe("tiling");
  });

  /**
   * Deselecting the primary promotes the first survivor — the same rule the RPC
   * applies when no primary is named, so the two can never disagree and the page
   * after a save is the page before it.
   */
  it("promotes a survivor when the primary is removed", () => {
    const { container } = renderWithI18n(
      <TradeSelector
        catalog={catalog}
        mine={{ keys: ["plumbing", "tiling"], primaryKey: "plumbing" }}
      />,
      "en",
    );
    fireEvent.click(chip("Plumbing"));
    expect(posted(container)).toEqual({ keys: ["tiling"], primary: "tiling" });
  });

  it("leaves the primary alone when a NON-primary is removed", () => {
    const { container } = renderWithI18n(
      <TradeSelector
        catalog={catalog}
        mine={{ keys: ["plumbing", "tiling"], primaryKey: "plumbing" }}
      />,
      "en",
    );
    fireEvent.click(chip("Tiling"));
    expect(posted(container)).toEqual({ keys: ["plumbing"], primary: "plumbing" });
  });

  it("posts nothing at all once every trade is deselected", () => {
    const { container } = renderWithI18n(
      <TradeSelector catalog={catalog} mine={{ keys: ["plumbing"], primaryKey: "plumbing" }} />,
      "en",
    );
    fireEvent.click(chip("Plumbing"));
    expect(posted(container)).toEqual({ keys: [], primary: "" });
  });

  /**
   * O5, on the surface where the choice is made. A tester who reads a trade list
   * as a permission list will not take work outside it, and the platform would
   * have taught them a restriction it does not impose.
   */
  it("says that choosing a trade does not restrict you", () => {
    renderWithI18n(<TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />, "en");
    expect(screen.getByText(/You can still take on work outside it/)).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <TradeSelector
        catalog={catalog}
        mine={{ keys: ["marble_granite"], primaryKey: "marble_granite" }}
      />,
      "ar",
    );
    expect(screen.getAllByText("رخام وجرانيت").length).toBeGreaterThan(0);
    expect(screen.getByText("المهنة الأساسية")).toBeTruthy();
    // No message path and no raw trade key anywhere a reader can see. The keys
    // travel in hidden inputs, which carry no text.
    expect(container.textContent).not.toMatch(/profile\.|onboarding\./);
    expect(container.textContent).not.toMatch(/marble_granite|kitchens_doors/);
  });

  it("shows the refusal the database gave rather than a generic failure", () => {
    result.value = { ok: false, code: "profile.trades.notProfessional" };
    renderWithI18n(
      <TradeSelector catalog={catalog} mine={{ keys: [], primaryKey: null }} />,
      "en",
    );
    // The error only appears after a submission; the initial state is silent.
    expect(screen.queryByText(/does not have one/)).toBeNull();
  });
});

describe("TradeSummary", () => {
  it("leads with the primary and lists the rest as supporting", () => {
    renderWithI18n(
      <TradeSummary trades={{ keys: ["marble_granite", "tiling"], primaryKey: "marble_granite" }} />,
      "en",
    );
    expect(screen.getByText("Main trade")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText("Also works in")).toBeTruthy();
    expect(screen.getByText("Tiling")).toBeTruthy();
  });

  it("omits the secondary block entirely with only one trade", () => {
    renderWithI18n(
      <TradeSummary trades={{ keys: ["plumbing"], primaryKey: "plumbing" }} />,
      "en",
    );
    expect(screen.queryByText("Also works in")).toBeNull();
  });

  it("states the empty case and why it matters", () => {
    renderWithI18n(<TradeSummary trades={{ keys: [], primaryKey: null }} />, "en");
    expect(screen.getByTestId("trade-summary-empty")).toBeTruthy();
    expect(screen.getByText("You have not chosen a trade yet.")).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <TradeSummary trades={{ keys: ["electrical", "plumbing"], primaryKey: "electrical" }} />,
      "ar",
    );
    expect(screen.getByText("المهنة الأساسية")).toBeTruthy();
    expect(container.textContent).not.toMatch(/profile\.|onboarding\.|electrical|plumbing/);
  });
});
