import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { KpiCustomizeDialog } from "./kpi-customize-dialog";
import { SHOWROOM_KPI_CATALOG, SHOWROOM_KPI_DEFAULT_ORDER } from "@/features/showroom-shell/home/kpi-catalog";
import { SYSTEM_DEFAULT_KPI_ORDER } from "@/lib/workspace/dashboard-kpi-catalog";

/** Every card the suite offers (eleven); the default layout shows only the reference five of them. */
const ALL_KEYS = SHOWROOM_KPI_CATALOG.map((entry) => entry.key);

const actions = vi.hoisted(() => ({
  setPersonal: vi.fn(async () => ({ ok: true as const })),
  resetPersonal: vi.fn(async () => ({ ok: true as const })),
  setTeam: vi.fn(async () => ({ ok: true as const })),
  resetTeam: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/server/actions/dashboard-kpi-layout", () => ({
  setPersonalKpiLayoutAction: actions.setPersonal,
  resetPersonalKpiLayoutAction: actions.resetPersonal,
  setTeamDefaultKpiLayoutAction: actions.setTeam,
  resetTeamDefaultKpiLayoutAction: actions.resetTeam,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function renderDialog(props: Partial<React.ComponentProps<typeof KpiCustomizeDialog>> = {}) {
  render(
    <I18nProvider locale="en" dir="ltr">
      <KpiCustomizeDialog
        orgId="org-1"
        availableKeys={ALL_KEYS}
        initialOrder={[...ALL_KEYS]}
        hasPersonal={false}
        hasTeamDefault={false}
        canManageTeamDefault
        surface="showroom_suite"
        {...props}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId("kpi-customize-trigger"));
}

beforeEach(() => vi.clearAllMocks());

describe("KpiCustomizeDialog on the showroom suite surface", () => {
  it("lists the eleven suite cards with their direction spelled out", () => {
    renderDialog();
    expect(screen.getByText("Direct RFQs (purchasing)")).toBeTruthy();
    expect(screen.getByText("Orders awaiting execution (purchasing)")).toBeTruthy();
    expect(screen.getByText("Completed purchase orders (purchasing)")).toBeTruthy();
    expect(screen.queryByText(/purchase requests/i)).toBeNull();
    expect(screen.getByText("Customer RFQs received (sales)")).toBeTruthy();
    expect(screen.getByText("Total sales (sales)")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
  });

  it("opens on the reference five with the other six available to add", () => {
    renderDialog({ initialOrder: [...SHOWROOM_KPI_DEFAULT_ORDER] });
    expect(screen.getAllByRole("button", { name: "Show" })).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: "Hide" })).toHaveLength(5);
  });

  it("allows a hidden card to be re-enabled up to eleven, never past it", () => {
    renderDialog({ initialOrder: ALL_KEYS.slice(0, 10) });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
  });

  it("saves the member's layout for the showroom_suite surface, in the displayed order", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalledTimes(1));
    expect(actions.setPersonal).toHaveBeenCalledWith("org-1", [...ALL_KEYS], "showroom_suite");
  });

  it("persists a hide + reorder exactly as the member left it", async () => {
    renderDialog();
    const row = (label: string) => screen.getByText(label).closest("li")!;
    fireEvent.click(within(row("Saved products")).getByRole("button", { name: "Hide" }));
    fireEvent.click(within(row("Total sales (sales)")).getByRole("button", { name: "Move up" }));
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalled());
    const saved = (actions.setPersonal.mock.calls[0] as unknown as [string, string[], string])[1];
    expect(saved).not.toContain("saved_products");
    expect(saved.indexOf("total_sales")).toBe(ALL_KEYS.indexOf("total_sales") - 1);
  });

  it("publishes the team default for the same surface, owners only", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("kpi-customize-save-team-default"));
    await waitFor(() => expect(actions.setTeam).toHaveBeenCalledWith("org-1", [...ALL_KEYS], "showroom_suite"));
  });

  it("hides the team-default controls from an ordinary member", () => {
    renderDialog({ canManageTeamDefault: false });
    expect(screen.queryByTestId("kpi-customize-save-team-default")).toBeNull();
  });

  it("resets the personal layout for this surface only", async () => {
    renderDialog({ hasPersonal: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset to team default" }));
    await waitFor(() => expect(actions.resetPersonal).toHaveBeenCalledWith("org-1", "showroom_suite"));
  });
});

describe("KpiCustomizeDialog on the production home surface (unchanged default)", () => {
  it("still caps at eight and saves against the home surface", async () => {
    renderDialog({
      surface: undefined,
      availableKeys: SYSTEM_DEFAULT_KPI_ORDER,
      initialOrder: SYSTEM_DEFAULT_KPI_ORDER,
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByTestId("kpi-customize-save-personal"));
    await waitFor(() => expect(actions.setPersonal).toHaveBeenCalled());
    expect(actions.setPersonal).toHaveBeenCalledWith("org-1", SYSTEM_DEFAULT_KPI_ORDER, "home");
  });
});
