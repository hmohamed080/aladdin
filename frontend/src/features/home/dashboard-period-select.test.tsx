import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardPeriodSelect } from "./dashboard-period-select";
import { DASHBOARD_PERIOD_ORDER, DEFAULT_DASHBOARD_PERIOD, type DashboardPeriodKey } from "@/lib/workspace/dashboard-period";

const push = vi.fn();
let currentQuery = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const LABELS: Record<DashboardPeriodKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  thisMonth: "This month",
  thisQuarter: "This quarter",
  custom: "Custom period",
};

const OPTIONS = DASHBOARD_PERIOD_ORDER.map((value) => ({ value, label: LABELS[value] }));

function renderSelect(value: DashboardPeriodKey = DEFAULT_DASHBOARD_PERIOD, query = "", from?: string, to?: string) {
  currentQuery = query;
  return render(
    <DashboardPeriodSelect
      value={value}
      from={from}
      to={to}
      basePath="/b2b"
      label="Period"
      options={OPTIONS}
      fromLabel="From"
      toLabel="To"
      applyLabel="Apply"
    />,
  );
}

function open() {
  fireEvent.click(screen.getByTestId("dashboard-period-select"));
}

beforeEach(() => {
  push.mockReset();
  currentQuery = "";
});

describe("DashboardPeriodSelect — rolling/calendar options", () => {
  it("shows the current selection's label on the trigger", () => {
    renderSelect("thisMonth");
    expect(screen.getByTestId("dashboard-period-select")).toHaveTextContent("This month");
  });

  it("navigates to the base path with no query when the default is chosen", () => {
    renderSelect("90d", "?period=90d");
    open();
    fireEvent.click(screen.getByTestId(`dashboard-period-option-${DEFAULT_DASHBOARD_PERIOD}`));
    expect(push).toHaveBeenCalledWith("/b2b");
  });

  it("writes ?period=<key> for a non-default option, preserving other params", () => {
    renderSelect(DEFAULT_DASHBOARD_PERIOD, "?stage=won");
    open();
    fireEvent.click(screen.getByTestId("dashboard-period-option-thisQuarter"));
    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("period")).toBe("thisQuarter");
    expect(url.searchParams.get("stage")).toBe("won");
  });

  it("clears from/to when switching away from a custom period", () => {
    renderSelect("custom", "?period=custom&from=2026-01-01&to=2026-01-10");
    open();
    fireEvent.click(screen.getByTestId("dashboard-period-option-7d"));
    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("period")).toBe("7d");
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
  });
});

describe("DashboardPeriodSelect — custom range", () => {
  it("choosing 'custom' does not navigate — it stays open for the date inputs", () => {
    renderSelect(DEFAULT_DASHBOARD_PERIOD);
    open();
    fireEvent.click(screen.getByTestId("dashboard-period-option-custom"));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("dashboard-period-custom-from")).toBeInTheDocument();
  });

  it("Apply is disabled until both dates are present and ordered", () => {
    renderSelect(DEFAULT_DASHBOARD_PERIOD);
    open();
    const apply = screen.getByTestId("dashboard-period-custom-apply");
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByTestId("dashboard-period-custom-from"), { target: { value: "2026-02-01" } });
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByTestId("dashboard-period-custom-to"), { target: { value: "2026-01-01" } });
    expect(apply).toBeDisabled(); // inverted range

    fireEvent.change(screen.getByTestId("dashboard-period-custom-to"), { target: { value: "2026-02-15" } });
    expect(apply).not.toBeDisabled();
  });

  it("Apply navigates with period=custom and the chosen from/to", () => {
    renderSelect(DEFAULT_DASHBOARD_PERIOD);
    open();
    fireEvent.change(screen.getByTestId("dashboard-period-custom-from"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByTestId("dashboard-period-custom-to"), { target: { value: "2026-02-15" } });
    fireEvent.click(screen.getByTestId("dashboard-period-custom-apply"));

    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("period")).toBe("custom");
    expect(url.searchParams.get("from")).toBe("2026-02-01");
    expect(url.searchParams.get("to")).toBe("2026-02-15");
  });

  it("pre-fills the date inputs from the active custom range", () => {
    renderSelect("custom", "?period=custom&from=2026-03-01&to=2026-03-10", "2026-03-01", "2026-03-10");
    open();
    expect(screen.getByTestId("dashboard-period-custom-from")).toHaveValue("2026-03-01");
    expect(screen.getByTestId("dashboard-period-custom-to")).toHaveValue("2026-03-10");
  });
});
