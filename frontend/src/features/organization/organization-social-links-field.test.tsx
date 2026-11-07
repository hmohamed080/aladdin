import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { renderWithI18n } from "@/test/render";
import { OrganizationSocialLinksField } from "./organization-social-links-field";
import { saveSocialLinksAction } from "@/server/actions/organization-profile";
import { ar } from "@/lib/i18n/messages/ar";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/server/actions/organization-profile", () => ({
  saveSocialLinksAction: vi.fn(),
}));

const save = vi.mocked(saveSocialLinksAction);
const none = { facebook: null, instagram: null, tiktok: null, website: null };
const some = { ...none, instagram: "https://www.instagram.com/alpha.showroom" };
const saveButton = () => screen.getByTestId("organization-social-links-save") as HTMLButtonElement;
const instagramInput = () => document.getElementById("settings-links-instagram") as HTMLInputElement;

describe("OrganizationSocialLinksField", () => {
  beforeEach(() => {
    save.mockReset();
    refresh.mockClear();
  });

  it("keeps Save disabled until a valid change", () => {
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage />);
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(instagramInput(), { target: { value: "not a link !!" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(instagramInput(), { target: { value: "" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(instagramInput(), { target: { value: "alpha.new" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("sends canonical-able input, then shows the saved links and refreshes", async () => {
    save.mockResolvedValue({ ok: true, links: { ...none, instagram: "https://www.instagram.com/alpha.new" } });
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage />);
    fireEvent.change(instagramInput(), { target: { value: "@alpha.new" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("org-1", expect.objectContaining({ instagram: "@alpha.new" })));
    expect(await screen.findByText(ar.showroomSettings.links.saved)).toBeInTheDocument();
    expect(instagramInput().value).toBe("https://www.instagram.com/alpha.new");
    expect(refresh).toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
  });

  it("shows the mapped message when the save fails", async () => {
    save.mockResolvedValue({ ok: false, code: "forbidden" });
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage />);
    fireEvent.change(instagramInput(), { target: { value: "alpha.new" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(ar.showroomSettings.links.error.forbidden)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows an empty state, not an error, for a showroom with no links", () => {
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={none} canManage />);
    expect(screen.getByTestId("organization-social-links-empty")).toHaveTextContent(ar.showroomSettings.links.empty);
    expect(screen.queryByText(ar.onboarding.error.linksRequired)).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("does not leave Save stuck busy when the action throws", async () => {
    save.mockRejectedValueOnce(new Error("network"));
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage />);
    fireEvent.change(instagramInput(), { target: { value: "alpha.new" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(ar.showroomSettings.links.error.failed)).toBeInTheDocument();
    expect(saveButton().disabled).toBe(false);
    expect(saveButton()).toHaveTextContent(ar.showroomSettings.links.save);
  });

  it("shows the required message only once the last saved link is cleared, and hides it on re-entry", () => {
    const { unmount } = renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={none} canManage />);
    expect(screen.queryByText(ar.onboarding.error.linksRequired)).toBeNull();
    unmount();

    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage />);
    expect(screen.queryByText(ar.onboarding.error.linksRequired)).toBeNull();
    fireEvent.change(instagramInput(), { target: { value: "" } });
    expect(screen.getByText(ar.onboarding.error.linksRequired)).toBeInTheDocument();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(instagramInput(), { target: { value: "alpha.new" } });
    expect(screen.queryByText(ar.onboarding.error.linksRequired)).toBeNull();
  });

  it("renders a non-https stored value as inert text, never an href", () => {
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={{ ...none, website: "javascript:alert(1)" }} canManage={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("follows the links prop for a non-manager and hides the unverified note when empty", () => {
    const { rerender } = render(
      <I18nProvider locale="ar" dir="rtl">
        <OrganizationSocialLinksField orgId="org-1" links={none} canManage={false} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(ar.showroomSettings.links.unverifiedNote)).toBeNull();
    rerender(
      <I18nProvider locale="ar" dir="rtl">
        <OrganizationSocialLinksField orgId="org-1" links={some} canManage={false} />
      </I18nProvider>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", some.instagram);
    expect(screen.getByText(ar.showroomSettings.links.unverifiedNote)).toBeInTheDocument();
  });

  it("lists links as safe anchors for a non-manager", () => {
    renderWithI18n(<OrganizationSocialLinksField orgId="org-1" links={some} canManage={false} />);
    const a = screen.getByRole("link");
    expect(a).toHaveAttribute("href", some.instagram);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(a).toHaveAttribute("dir", "ltr");
    expect(screen.queryByTestId("organization-social-links-save")).toBeNull();
  });
});
