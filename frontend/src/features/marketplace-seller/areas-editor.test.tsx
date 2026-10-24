import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { AreasEditor } from "./areas-editor";

const saveAreas = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-seller", () => ({
  saveSellerAreasAction: (...a: unknown[]) => saveAreas(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const selects = () => Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
const govBox = (name: string) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  saveAreas.mockReset();
  refresh.mockReset();
});

describe("delivery areas editor", () => {
  it("shows what is covered: ticked governorates and single areas", () => {
    renderWithI18n(
      <AreasEditor
        organizationId={ORG}
        initialRates={[
          { governorate_key: "cairo", area_key: null, fee_egp: 80 },
          { governorate_key: "giza", area_key: "dokki", fee_egp: null },
        ]}
        unpriced={1}
      />,
      "en",
    );
    expect(govBox("Cairo")).toBeChecked();
    expect(govBox("Giza")).not.toBeChecked();
    expect(selects().map((s) => s.value)).toEqual(["giza", "dokki"]);
    expect(screen.getByText("1 governorates · 1 areas")).toBeInTheDocument();
  });

  it("points to the prices page while places still have no price", () => {
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[{ governorate_key: "cairo", area_key: null, fee_egp: null }]} unpriced={1} />, "en");
    expect(screen.getByText(/1 places have no price yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set delivery prices" })).toHaveAttribute("href", "/b2c/seller/delivery");
  });

  it("saves the ticked governorates (no area) and then the single areas", async () => {
    saveAreas.mockResolvedValue({ ok: true, saved: 3 });
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[]} unpriced={0} />, "en");
    fireEvent.click(govBox("Cairo"));
    fireEvent.click(govBox("Alexandria"));
    fireEvent.click(screen.getByRole("button", { name: "Add an area" }));
    fireEvent.change(selects()[0]!, { target: { value: "giza" } });
    fireEvent.change(selects()[1]!, { target: { value: "dokki" } });
    fireEvent.click(screen.getByRole("button", { name: "Save areas" }));
    await waitFor(() => expect(saveAreas).toHaveBeenCalledTimes(1));
    expect(saveAreas).toHaveBeenCalledWith(ORG, [
      { governorate_key: "cairo", area_key: null },
      { governorate_key: "alexandria", area_key: null },
      { governorate_key: "giza", area_key: "dokki" },
    ]);
    expect(await screen.findByText("Areas saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("selects and clears every governorate at once", () => {
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[]} unpriced={0} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getAllByRole("checkbox").some((c) => (c as HTMLInputElement).checked)).toBe(false);
  });

  it("refuses an area line with no governorate or no area, and sends nothing", () => {
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[]} unpriced={0} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Add an area" }));
    fireEvent.click(screen.getByRole("button", { name: "Save areas" }));
    expect(screen.getByText("Area 1: choose a governorate.")).toBeInTheDocument();
    fireEvent.change(selects()[0]!, { target: { value: "giza" } });
    fireEvent.click(screen.getByRole("button", { name: "Save areas" }));
    expect(screen.getByText("Area 1: choose an area.")).toBeInTheDocument();
    expect(saveAreas).not.toHaveBeenCalled();
  });

  it("removes a single area from the list", () => {
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[{ governorate_key: "giza", area_key: "dokki", fee_egp: 50 }]} unpriced={0} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Remove this area (Area 1)" }));
    expect(selects()).toHaveLength(0);
    expect(screen.getByText("No single areas added.")).toBeInTheDocument();
  });

  it("shows the database's refusal in the showroom's language", async () => {
    saveAreas.mockResolvedValue({ ok: false, code: "delivery_duplicate", detail: "cairo/" });
    renderWithI18n(<AreasEditor organizationId={ORG} initialRates={[]} unpriced={0} />, "ar");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المناطق" }));
    expect(await screen.findByText("المكان نفسه مكرر في القائمة: cairo/.")).toBeInTheDocument();
  });
});
