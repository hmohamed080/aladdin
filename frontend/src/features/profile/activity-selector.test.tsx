import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ActivitySelector } from "./activity-selector";

const noop = async () => ({ ok: true });

function posted(container: HTMLElement) {
  return (container.querySelector<HTMLInputElement>('input[name="keys"]')?.value ?? "").split("\n").filter(Boolean);
}

const SHOWROOM = ["decor_showroom", "paint_showroom", "decor_and_paint_showroom", "building_and_finishing_supplies_retailer"];

describe("ActivitySelector", () => {
  it("offers exactly the approved Showroom subtypes, with Mawan on its own retail key", () => {
    renderWithI18n(<ActivitySelector catalog={SHOWROOM} selected={[]} action={noop} orgId="org-1" />, "ar");
    for (const label of ["معرض ديكور", "معرض دهانات", "معرض ديكور ودهانات", "موان"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // Mawan is never the Supplier `distributor` concept.
    expect(screen.queryByRole("button", { name: "موزع" })).toBeNull();
  });

  it("posts the whole selection and the org id", () => {
    const { container } = renderWithI18n(
      <ActivitySelector catalog={SHOWROOM} selected={[]} action={noop} orgId="org-1" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Building & finishing supplies retailer" }));
    fireEvent.click(screen.getByRole("button", { name: "Paint showroom" }));
    expect(posted(container).sort()).toEqual(["building_and_finishing_supplies_retailer", "paint_showroom"]);
    expect(container.querySelector<HTMLInputElement>('input[name="orgId"]')?.value).toBe("org-1");
  });

  it("never submits a key outside the active catalog, even if previously held", () => {
    const { container } = renderWithI18n(
      <ActivitySelector catalog={["sales_rep", "sales_manager"]} selected={["retired_key", "sales_rep"]} action={noop} />,
      "en",
    );
    expect(posted(container)).toEqual(["sales_rep"]);
  });

  it("renders nothing for an audience with no subtypes", () => {
    const { container } = renderWithI18n(<ActivitySelector catalog={[]} selected={[]} action={noop} />, "en");
    expect(container.textContent).toBe("");
  });
});
