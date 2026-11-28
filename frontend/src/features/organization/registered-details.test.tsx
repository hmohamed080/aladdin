import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";

const saveLegalName = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/organization-profile", () => ({
  saveLegalNameAction: (...args: unknown[]) => saveLegalName(...args),
  setBranchLocationAction: vi.fn(),
}));
vi.mock("@/server/actions/contacts", () => ({ saveOrganizationContactAction: vi.fn(async () => ({ ok: true })) }));

import { OrganizationLegalNameField } from "./organization-legal-name-field";
import { OrganizationContactCard } from "./organization-contact-card";

const L = en.showroomSettings.legalName;
const C = en.showroomSettings.contact;

beforeEach(() => vi.clearAllMocks());

describe("OrganizationLegalNameField", () => {
  it("lets a manager of an unverified business correct the name and saves the trimmed value", async () => {
    saveLegalName.mockResolvedValue({ ok: true, value: "Alpha Trading Co." });
    renderWithI18n(<OrganizationLegalNameField orgId="o1" legalName="Alpha Trading" canManage locked={false} />, "en");
    const input = screen.getByLabelText(L.label) as HTMLInputElement;
    expect(input.value).toBe("Alpha Trading");
    const save = screen.getByTestId("organization-legal-name-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  Alpha Trading Co.  " } });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(saveLegalName).toHaveBeenCalledWith("o1", "  Alpha Trading Co.  ");
    expect(screen.getByText(L.saved)).toBeTruthy();
  });

  it("refuses a one-character name in the form and shows the database's refusal", async () => {
    saveLegalName.mockResolvedValue({ ok: false, code: "forbidden" });
    renderWithI18n(<OrganizationLegalNameField orgId="o1" legalName="Alpha Trading" canManage locked={false} />, "en");
    const input = screen.getByLabelText(L.label);
    fireEvent.change(input, { target: { value: "x" } });
    expect((screen.getByTestId("organization-legal-name-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Alpha Co." } });
    await act(async () => { fireEvent.click(screen.getByTestId("organization-legal-name-save")); });
    expect(screen.getByText(L.error.forbidden)).toBeTruthy();
  });

  it("is read-only once the identity is verified, and says why", () => {
    renderWithI18n(<OrganizationLegalNameField orgId="o1" legalName="Alpha Trading" canManage locked />, "en");
    expect(screen.queryByTestId("organization-legal-name-save")).toBeNull();
    expect(screen.getByTestId("organization-legal-name-readonly").textContent).toBe("Alpha Trading");
    expect(screen.getByText(L.lockedNote)).toBeTruthy();
  });

  it("is read-only for a member without org.manage", () => {
    renderWithI18n(<OrganizationLegalNameField orgId="o1" legalName={null} canManage={false} locked={false} />, "en");
    expect(screen.queryByTestId("organization-legal-name-save")).toBeNull();
    expect(screen.getByTestId("organization-legal-name-readonly").textContent).toBe("—");
  });
});

describe("OrganizationContactCard", () => {
  const contact = { phone: "+201012345678", whatsapp: null, email: "owner@shop.example", showPhone: false, showWhatsapp: false, showEmail: false };

  it("shows the registered phone and e-mail in an editable form for a manager", () => {
    renderWithI18n(<OrganizationContactCard orgId="o1" contact={contact} canManage phoneRequired />, "en");
    expect((screen.getByLabelText(new RegExp(`^${C.email}`)) as HTMLInputElement).value).toBe("owner@shop.example");
    expect((screen.getByTestId("organization-contact-form").querySelector('input[name="phone"]') as HTMLInputElement).value).toBe("+201012345678");
    expect(screen.getByText(C.phoneRequired)).toBeTruthy();
    expect((screen.getByTestId("organization-contact-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps every visibility box off until the owner turns it on", () => {
    renderWithI18n(<OrganizationContactCard orgId="o1" contact={contact} canManage phoneRequired />, "en");
    expect((screen.getByLabelText(C.showPhone) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(C.showEmail) as HTMLInputElement).checked).toBe(false);
  });

  it("is a read-only summary for a member without org.manage", () => {
    renderWithI18n(<OrganizationContactCard orgId="o1" contact={contact} canManage={false} phoneRequired />, "en");
    expect(screen.queryByTestId("organization-contact-form")).toBeNull();
    expect(screen.getByTestId("organization-contact-readonly").textContent).toContain("+201012345678");
    expect(screen.getByTestId("organization-contact-readonly").textContent).toContain("owner@shop.example");
  });
});
