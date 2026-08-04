import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ConfirmDialog } from "./confirm-dialog";
import { ar } from "@/lib/i18n/messages/ar";

function noop() {}

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
});
