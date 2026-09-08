import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { OrganizationIdentityDialog } from "./organization-identity-dialog";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/organization-i18n", () => ({
  updateOrganizationI18nAction: vi.fn(async () => ({ ok: true })),
}));

describe("OrganizationIdentityDialog", () => {
  it("opens on the Edit trigger and shows labelled AR/EN name fields + timezone, pre-filled", () => {
    renderWithI18n(
      <OrganizationIdentityDialog
        m={ar}
        orgId="org-1"
        nameAr="معرض سيراميك القاهرة"
        nameEn="Cairo Ceramics Showroom"
        timezone="Africa/Cairo"
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ar.common.edit }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(ar.settings.editOrgTitle);

    const nameAr = screen.getByLabelText(ar.settings.field.nameAr, { exact: false }) as HTMLInputElement;
    const nameEn = screen.getByLabelText(ar.settings.field.nameEn, { exact: false }) as HTMLInputElement;
    const timezone = screen.getByLabelText(ar.settings.field.timezone, { exact: false }) as HTMLSelectElement;
    expect(nameAr.value).toBe("معرض سيراميك القاهرة");
    expect(nameEn.value).toBe("Cairo Ceramics Showroom");
    expect(timezone.value).toBe("Africa/Cairo");

    // The hidden field the server action keys its update on.
    expect((dialog.querySelector('input[name="orgId"]') as HTMLInputElement).value).toBe("org-1");
  });

  it("renders empty fields honestly when no translation has been entered yet", () => {
    renderWithI18n(<OrganizationIdentityDialog m={ar} orgId="org-1" nameAr={null} nameEn={null} timezone={null} />);
    fireEvent.click(screen.getByRole("button", { name: ar.common.edit }));
    expect((screen.getByLabelText(ar.settings.field.nameAr, { exact: false }) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(ar.settings.field.timezone, { exact: false }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(ar.settings.timezoneUnset)).toBeInTheDocument();
  });
});
