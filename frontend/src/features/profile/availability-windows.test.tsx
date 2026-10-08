import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

const actions = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock("@/server/actions/service-areas", () => ({
  addAvailabilityWindowAction: actions.add,
  removeAvailabilityWindowAction: actions.remove,
  setServiceAreasAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { AvailabilityWindows } from "./availability-windows";

const windows = [
  { id: "w1", from: "2027-05-01", to: "2027-05-31" },
  { id: "w2", from: "2027-07-01", to: null },
];

beforeEach(() => {
  actions.add.mockReset();
  actions.remove.mockReset();
  actions.add.mockResolvedValue({ ok: true });
  actions.remove.mockResolvedValue({ ok: true });
});

describe("AvailabilityWindows — when you are free", () => {
  it("says so plainly when no dates were added", () => {
    renderWithI18n(<AvailabilityWindows windows={[]} />, "en");
    expect(screen.getByText("No dates added yet.")).toBeTruthy();
    expect(screen.queryAllByTestId("availability-window")).toHaveLength(0);
  });

  it("lists the caller's own windows — a range, and an open-ended one", () => {
    renderWithI18n(<AvailabilityWindows windows={windows} />, "en");
    const rows = screen.getAllByTestId("availability-window");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/to/);
    expect(rows[1]!.textContent).toMatch(/onward/);
  });

  it("each window can be removed, through the shared action, by its own id", async () => {
    renderWithI18n(<AvailabilityWindows windows={windows} />, "en");
    const row = screen.getAllByTestId("availability-window")[1]!;
    fireEvent.click(within(row).getByRole("button", { name: /Remove the window starting/ }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("w2"));
  });

  it("a failed removal says so and changes nothing on screen", async () => {
    actions.remove.mockResolvedValue({ ok: false });
    renderWithI18n(<AvailabilityWindows windows={windows} />, "en");
    fireEvent.click(within(screen.getAllByTestId("availability-window")[0]!).getByRole("button", { name: /Remove/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save those dates/i);
    expect(screen.getAllByTestId("availability-window")).toHaveLength(2);
  });

  it("'No end date' makes the window open-ended and takes the end date out of the form", () => {
    renderWithI18n(<AvailabilityWindows windows={[]} />, "en");
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(to.disabled).toBe(false);
    expect(to.required).toBe(true);
    fireEvent.click(screen.getByLabelText("No end date"));
    expect(to.disabled).toBe(true);
    expect(to.required).toBe(false);
  });

  it("uses the browser's own date pickers (native date dialogs stay native)", () => {
    renderWithI18n(<AvailabilityWindows windows={[]} />, "en");
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("To")).toHaveAttribute("type", "date");
  });

  it("states that the dates count only while the person is marked available, and that they never stop an offer", () => {
    renderWithI18n(<AvailabilityWindows windows={[]} />, "en");
    expect(screen.getByText(/only count while you are marked as available for work/i)).toBeTruthy();
    expect(screen.getByText(/do not stop anyone from offering you a job/i)).toBeTruthy();
  });

  it("is worded in Arabic", () => {
    renderWithI18n(<AvailabilityWindows windows={[]} />, "ar");
    expect(screen.getByText("متى تكون متفرغًا")).toBeTruthy();
    expect(screen.getByLabelText("بدون تاريخ انتهاء")).toBeTruthy();
  });
});
