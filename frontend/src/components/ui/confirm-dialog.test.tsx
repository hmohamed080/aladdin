import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ConfirmDialog } from "./confirm-dialog";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { Toaster, resetToasts } from "./toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function noop() {}

afterEach(() => {
  act(() => resetToasts());
  vi.useRealTimers();
});

describe("ConfirmDialog (accessible destructive confirmation)", () => {
  it("is closed until the trigger is pressed, then shows a labelled modal", () => {
    renderWithI18n(
      <ConfirmDialog trigger="أرشفة" title={ar.confirm.archiveCustomerTitle} body={ar.confirm.archiveCustomerBody} confirmLabel="أرشفة" action={noop}>
        <input type="hidden" name="customerId" value="c1" />
      </ConfirmDialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(ar.confirm.archiveCustomerTitle)).toBeInTheDocument();
    // The wrapped form still carries the hidden inputs the server action needs.
    expect((dialog.querySelector('input[name="customerId"]') as HTMLInputElement).value).toBe("c1");
  });

  it("closes on Escape and on the Cancel button", () => {
    renderWithI18n(
      <ConfirmDialog trigger="حذف" title={ar.confirm.cancelFollowUpTitle} confirmLabel="تأكيد" action={noop} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    fireEvent.click(screen.getByRole("button", { name: ar.common.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the dialog when opened", () => {
    renderWithI18n(<ConfirmDialog trigger="حذف" title="X" confirmLabel="تأكيد" action={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("stateful formAction: stays open and shows localized feedback on error", async () => {
    // A formAction that rejects with a field-error code — the dialog must NOT
    // close and must surface the error (so a required reason can be corrected).
    const formAction = vi.fn(async () => ({ ok: false, code: "leads.lostReasonRequired" as const }));
    let renderedState: { fieldErrors?: Record<string, string> } | null = null;
    renderWithI18n(
      <ConfirmDialog trigger="خسارة" title="X" confirmLabel="تأكيد" formAction={formAction}>
        {(s) => {
          renderedState = s;
          return <textarea name="lostReason" aria-label="reason" defaultValue="" />;
        }}
      </ConfirmDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "خسارة" }));
    // Submit through React's synthetic path (not a native submit-button click) —
    // a React 19 form with a function action carries a javascript:throw
    // native-submit guard that can race preventDefault under full-suite timing.
    fireEvent.submit(screen.getByRole("button", { name: "تأكيد" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(ar.leads.lostReasonRequired);
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // did not close on error
    expect(formAction).toHaveBeenCalled();
    // The render receives the returned state, so callers can show per-field errors
    // and keep a controlled field's value across the error.
    expect(renderedState).not.toBeNull();
  });

  it("stateful formAction success: closes, and its done message survives the close as a polite toast", async () => {
    const formAction = vi.fn(async () => ({ ok: true, code: "phoneCooldown.done" }));
    renderWithI18n(
      <>
        <ConfirmDialog trigger="رفع" title="X" confirmLabel="تأكيد" formAction={formAction}>
          <input type="hidden" name="phone" value="+201012345678" />
        </ConfirmDialog>
        <Toaster dismissLabel={ar.common.close} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "رفع" }));
    fireEvent.submit(screen.getByRole("button", { name: "تأكيد" }).closest("form")!);

    const toast = await screen.findByTestId("toast");
    expect(toast).toHaveTextContent(ar.phoneCooldown.done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Announced: the toast sits inside the always-mounted polite live region, and is not colour-only.
    const region = toast.closest('[role="status"]')!;
    expect(region).toHaveAttribute("aria-live", "polite");
    // Dismissable by keyboard-reachable, labelled button.
    fireEvent.click(within(toast).getByRole("button", { name: ar.common.close }));
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("the success toast outlives the dialog's own unmount (the refreshed data removed the trigger)", async () => {
    const formAction = vi.fn(async () => ({ ok: true, code: "businessVerification.admin.done.start" }));
    function Harness() {
      const [show, setShow] = useState(true);
      return (
        <>
          {show ? <ConfirmDialog trigger="Start" title="X" confirmLabel="Go" formAction={formAction} /> : null}
          <button type="button" onClick={() => setShow(false)}>unmount</button>
          <Toaster dismissLabel={en.common.close} />
        </>
      );
    }
    renderWithI18n(<Harness />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.submit(screen.getByRole("button", { name: "Go" }).closest("form")!);
    await screen.findByTestId("toast");
    fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByTestId("toast")).toHaveTextContent(en.businessVerification.admin.done.start);
  });

  it("a success without a code shows no toast, and a toast auto-dismisses unless hovered", async () => {
    const formAction = vi.fn(async () => ({ ok: true }));
    renderWithI18n(
      <>
        <ConfirmDialog trigger="Do" title="X" confirmLabel="Go" formAction={formAction} />
        <Toaster dismissLabel="Close" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Do" }));
    fireEvent.submit(screen.getByRole("button", { name: "Go" }).closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("toast")).toBeNull();

    vi.useFakeTimers();
    const { showToast } = await import("./toast");
    act(() => showToast("Saved."));
    const toast = screen.getByTestId("toast");
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("toast")).toBeInTheDocument(); // paused while hovered
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.queryByTestId("toast")).toBeNull();
  });
});
