import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  lifecycle: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/server/actions/purchase-requests", () => ({
  savePurchaseRequestAction: mocks.save,
  purchaseRequestLifecycleAction: mocks.lifecycle,
  requestRequestImageUploadAction: vi.fn(),
  confirmRequestImageUploadAction: vi.fn(),
  removeRequestImageAction: vi.fn(),
  abortRequestImageUploadAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: vi.fn(),
}));
import { RequestComposer, RequestLifecycle } from "./request-composer";

beforeEach(() => vi.clearAllMocks());
describe("engineer quotation journey", () => {
  it("rejects invalid quantities before saving and focuses the field", () => {
    const { container } = renderWithI18n(<RequestComposer />, "en");
    const quantity = screen.getByLabelText("Quantity");
    for (const value of ["0", "-1", "1000001", "1.2345", "abc"]) {
      fireEvent.change(quantity, { target: { value } });
      fireEvent.submit(container.querySelector("form")!);
      expect(quantity).toHaveAttribute("aria-invalid", "true");
      expect(quantity).toHaveFocus();
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("accepts Arabic quantities and prevents duplicate saves while awaiting a response", async () => {
    let resolveSave!: (value: { ok: boolean }) => void;
    mocks.save.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { container } = renderWithI18n(<RequestComposer />, "en");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "١٢٫٥" } });
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.submit(container.querySelector("form")!);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    resolveSave({ ok: false });
    await waitFor(() => expect(screen.getByLabelText("Quantity")).not.toBeDisabled());
    expect(screen.getByLabelText("Quantity")).toHaveValue("١٢٫٥");
  });
  it("saves selected showrooms and location as a draft without publishing", async () => {
    mocks.save.mockResolvedValue({ ok: true, id: "request-id" });
    const { container } = renderWithI18n(
      <RequestComposer
        context={{ location: "Cairo", showroomIds: ["showroom-id"] }}
        showrooms={[{ id: "showroom-id", name: "Local showroom" }]}
      />,
      "en",
    );
    fireEvent.change(screen.getByLabelText("Project or request title"), {
      target: { value: "Villa finishing" },
    });
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Wall panels" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/home/engineer/requests/request-id",
      ),
    );
    const fd = mocks.save.mock.calls[0]![1] as FormData;
    expect(fd.get("location")).toBe("Cairo");
    expect(JSON.parse(String(fd.get("showroomIds")))).toEqual(["showroom-id"]);
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
  it("retains entered requirements and shows a retry message when saving fails", async () => {
    mocks.save.mockRejectedValue(new Error("offline"));
    const { container } = renderWithI18n(<RequestComposer />, "en");
    fireEvent.change(screen.getByLabelText("Project or request title"), {
      target: { value: "Villa finishing" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your input is still here",
      ),
    );
    expect(screen.getByLabelText("Project or request title")).toHaveValue(
      "Villa finishing",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("requires confirmation before publication", async () => {
    mocks.lifecycle.mockResolvedValue({ ok: true });
    renderWithI18n(
      <RequestLifecycle id="request-id" version={3} action="publish" />,
      "en",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Publish quotation request" }),
    );
    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Materials cannot be edited",
    );
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await waitFor(() => expect(mocks.lifecycle).toHaveBeenCalled());
    expect(
      (mocks.lifecycle.mock.calls[0]![1] as FormData).get("expectedVersion"),
    ).toBe("3");
  });
});
