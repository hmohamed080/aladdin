import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PeriodSelect } from "./period-select";
import { PERIOD_ORDER, DEFAULT_PERIOD, type PeriodKey } from "@/lib/workspace/period";
import { en } from "@/lib/i18n/messages/en";

/**
 * THE CLICK BEHAVIOUR LIVES HERE RATHER THAN IN THE E2E SPEC, AND NOT BY
 * PREFERENCE.
 *
 * `/b2b` currently commits NO client-side navigation — not from `router.push`
 * and not from a plain `<Link>` either. Clicking the dashboard's own stage chips
 * has the same result, which is why the supply-dashboard UAT spec asserts their
 * `href` attributes and never clicks them, and why every navigation in these
 * specs is a `page.goto`. That is a pre-existing route-level defect and it is
 * not this control's to fix.
 *
 * It does mean the browser cannot demonstrate what this control DOES on a click.
 * So the contract the component actually owns — which URL it asks for — is
 * asserted directly against the router, where the route defect cannot mask a
 * regression in it. Everything the browser can still prove (default, deep link,
 * invalid fallback, reload, back/forward, placement, RTL) stays in the E2E spec.
 */

const push = vi.fn();
let currentQuery = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const OPTIONS = PERIOD_ORDER.map((value) => ({ value, label: en.supply.period[value] }));

function renderSelect(value: PeriodKey = DEFAULT_PERIOD, query = "") {
  currentQuery = query;
  return renderWithI18n(
    <PeriodSelect value={value} basePath="/b2b" label={en.supply.period.scope} options={OPTIONS} />,
  );
}

/** Open the menu and press one window. */
function choose(value: PeriodKey) {
  fireEvent.click(screen.getByTestId("period-select"));
  fireEvent.click(screen.getByTestId(`period-option-${value}`));
}

beforeEach(() => {
  push.mockReset();
  currentQuery = "";
});

describe("PeriodSelect writes the existing ?period= contract", () => {
  it("names a non-default window in the query string", () => {
    renderSelect();
    choose("90d");
    expect(push).toHaveBeenCalledWith("/b2b?period=90d");
  });

  it("offers every window the resolver accepts, and no others", () => {
    renderSelect();
    fireEvent.click(screen.getByTestId("period-select"));
    for (const { value } of OPTIONS) {
      expect(screen.getByTestId(`period-option-${value}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(PERIOD_ORDER.length);
  });

  it("expresses the DEFAULT as absence, so the plain dashboard URL stays clean", () => {
    // Arriving on a named window and going back to the default must DELETE the
    // parameter rather than write `?period=30d` — otherwise every shared link
    // carries a period nobody deliberately chose.
    renderSelect("90d", "period=90d");
    choose(DEFAULT_PERIOD);
    expect(push).toHaveBeenCalledWith("/b2b");
  });

  it("edits `period` and leaves the rest of the query standing", () => {
    /* The queue's stage filter and its sort ride in the same query string. A
       period change that dropped them would make the two controls fight each
       other — the dashboard's `carry` object exists to prevent exactly that on
       the server side, and this is the client half of the same rule. */
    renderSelect("90d", "period=90d&stage=price&sort=due");
    choose("all");
    const url = new URL(push.mock.calls[0]![0] as string, "http://localhost");
    expect(url.pathname).toBe("/b2b");
    expect(url.searchParams.get("period")).toBe("all");
    expect(url.searchParams.get("stage")).toBe("price");
    expect(url.searchParams.get("sort")).toBe("due");
  });

  it("keeps the other parameters even when clearing back to the default", () => {
    renderSelect("90d", "period=90d&stage=price");
    choose(DEFAULT_PERIOD);
    expect(push).toHaveBeenCalledWith("/b2b?stage=price");
  });
});

describe("PeriodSelect announces itself as a set of exclusive choices", () => {
  it("marks exactly the current window as checked", () => {
    renderSelect("90d", "period=90d");
    fireEvent.click(screen.getByTestId("period-select"));
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute("data-testid", "period-option-90d");
  });

  it("shows the chosen window on the trigger, under the scoped accessible name", () => {
    renderSelect("365d", "period=365d");
    const trigger = screen.getByTestId("period-select");
    // The NAME is the scope ("Metrics period"), the TEXT is the value — the chip
    // shows only what is selected, and assistive tech gets what it selects.
    expect(trigger).toHaveAttribute("aria-label", en.supply.period.scope);
    expect(trigger).toHaveTextContent(en.supply.period["365d"]);
  });

  it("closes on Escape without navigating", () => {
    renderSelect();
    fireEvent.click(screen.getByTestId("period-select"));
    expect(screen.getByTestId("period-menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("period-menu")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
