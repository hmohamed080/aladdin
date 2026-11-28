import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  lifecycle: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/server/actions/purchase-requests", () => ({
  savePurchaseRequestAction: mocks.save,
  purchaseRequestLifecycleAction: mocks.lifecycle,
  removeRequestImageAction: vi.fn(),
}));
// The one reviewed upload path (ADR-0032): reserve, send to private storage through uploadWithGrant, verify.
vi.mock("@/features/purchase-requests/upload-request-image", () => ({ uploadRequestImage: mocks.upload }));
import { RequestComposer, RequestLifecycle } from "./request-composer";

beforeEach(() => vi.clearAllMocks());
describe("engineer quotation journey", () => {
  it("keeps the summary in sync and lets the user return to an item", () => {
    renderWithI18n(<RequestComposer sample />, "en");
    expect(screen.getByText(/Local example requirements/)).toBeInTheDocument();
    const name = screen.getAllByLabelText("Product name")[0]!;
    fireEvent.change(name, { target: { value: "Acoustic wall panels" } });
    expect(screen.getByRole("button", { name: "Edit item 1" })).toHaveTextContent("Acoustic wall panels");
    fireEvent.click(screen.getByRole("button", { name: "Edit item 1" }));
    expect(name).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    expect(screen.getAllByLabelText("Product name")).toHaveLength(3);
    expect(screen.getByText("3 items in this request")).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
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
  it("attaches a reference photo only through the shared request upload path", async () => {
    mocks.upload.mockResolvedValue("image-id");
    const existing = {
      request: { id: "request-id", version: 1, title: "Villa", notes: "", needed_by: null },
      items: [{ id: "item-id", name: "Wall panels", categoryCode: "wood_alternative", quantity: 2, unit: "square_meter", specs: null, code: null, colors: [], images: [] }],
    };
    const { container } = renderWithI18n(<RequestComposer existing={existing as never} />, "en");
    expect(screen.getByText(/up to 10 MB each/)).toBeInTheDocument();
    const file = new File(["x"], "wall.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("item-id", file));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
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
