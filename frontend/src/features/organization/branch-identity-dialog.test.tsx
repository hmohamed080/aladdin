import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { BranchIdentityDialog } from "./branch-identity-dialog";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/organization-i18n", () => ({
  updateBranchI18nAction: vi.fn(async () => ({ ok: true })),
}));

describe("BranchIdentityDialog", () => {
  it("shows the branch name in the dialog title and pre-fills every field", () => {
    renderWithI18n(
      <BranchIdentityDialog
        m={ar}
        branchId="branch-1"
        branchName="Nasr City Showroom"
        nameAr="فرع مدينة نصر"
        nameEn="Nasr City Showroom"
        addressAr="مدينة نصر، القاهرة"
        addressEn="Nasr City, Cairo"
        timezone="Africa/Cairo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: ar.common.edit }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(ar.settings.editBranchTitle.replace("{name}", "Nasr City Showroom"));

    expect((screen.getByLabelText(ar.settings.field.nameAr, { exact: false }) as HTMLInputElement).value).toBe("فرع مدينة نصر");
    expect((screen.getByLabelText(ar.settings.field.addressEn, { exact: false }) as HTMLTextAreaElement).value).toBe(
      "Nasr City, Cairo",
    );
    expect((dialog.querySelector('input[name="branchId"]') as HTMLInputElement).value).toBe("branch-1");
  });

  it("falls back to the not-set label when no timezone is configured", () => {
    renderWithI18n(
      <BranchIdentityDialog
        m={ar}
        branchId="branch-2"
        branchName="Another Branch"
        nameAr={null}
        nameEn={null}
        addressAr={null}
        addressEn={null}
        timezone={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: ar.common.edit }));
    expect((screen.getByLabelText(ar.settings.field.timezone, { exact: false }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(ar.settings.timezoneUnset)).toBeInTheDocument();
  });
});
