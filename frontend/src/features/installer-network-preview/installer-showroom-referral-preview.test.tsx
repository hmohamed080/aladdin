import { fireEvent, screen, within } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerShowroomReferralPreview } from "./installer-showroom-referral-preview";

vi.mock("next/dynamic", async () => {
  const { InstallerPhoneField } = await import("@/features/installer-dashboard-preview/installer-phone-field");
  return { default: () => InstallerPhoneField };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-network/refer",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill;
    void _priority;
    void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

describe("InstallerShowroomReferralPreview", () => {
  it("renders the complete Arabic referral form with dependent city selection", () => {
    renderWithI18n(
      <InstallerShowroomReferralPreview theme="light" sidebarMode="expanded" />,
      "ar",
    );

    expect(screen.getByRole("heading", { name: "أضف معرضًا أعرفه", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("اسم المعرض *")).toBeTruthy();
    expect(screen.getByLabelText("المحافظة *")).toBeTruthy();
    expect(screen.getByLabelText("المدينة *")).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "موان" })).toBeTruthy();
    expect(screen.getByLabelText("رقم هاتف المعرض *")).toBeTruthy();
    const countryTrigger = screen.getByRole("button", { name: "الدولة" });
    expect(countryTrigger).toHaveTextContent("+20");
    fireEvent.click(countryTrigger);
    expect(screen.getByRole("option", { name: /مصر/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /الولايات المتحدة/ })).toBeTruthy();
    fireEvent.click(countryTrigger);
    expect(screen.getByLabelText("ملاحظة (اختياري)")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("المحافظة *"));
    expect(within(screen.getByRole("listbox", { name: "المحافظة *" })).getAllByRole("option")).toHaveLength(27);
    fireEvent.click(screen.getByRole("option", { name: "القاهرة" }));
    expect(screen.getByLabelText("المدينة *")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("المدينة *"));
    expect(screen.getByRole("option", { name: "القاهرة الجديدة" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "مدينة أخرى" }));
    expect(screen.getByLabelText("اسم المدينة *")).toBeTruthy();
  });

  it("validates locally and reports an honest preview-only success state", () => {
    renderWithI18n(
      <InstallerShowroomReferralPreview theme="light" sidebarMode="expanded" />,
      "en",
    );

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getAllByText("This field is required.").length).toBeGreaterThan(0);
    expect(screen.getByText("Enter a valid phone number.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Showroom name *"), { target: { value: "Al Noor Decor" } });
    fireEvent.click(screen.getByLabelText("Governorate *"));
    fireEvent.click(screen.getByRole("option", { name: "Cairo" }));
    fireEvent.click(screen.getByLabelText("City *"));
    fireEvent.click(screen.getByRole("option", { name: "New Cairo" }));
    fireEvent.click(screen.getByRole("radio", { name: "Decor showroom" }));
    fireEvent.change(screen.getByLabelText("Showroom phone number *"), { target: { value: "01012345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(screen.getByRole("status")).toHaveTextContent("No data was saved");
    expect(screen.getByRole("button", { name: "Request simulated" })).toBeDisabled();
  });

  it("keeps the English preview free of Arabic form labels", () => {
    renderWithI18n(
      <InstallerShowroomReferralPreview theme="dark" sidebarMode="expanded" />,
      "en",
    );

    expect(screen.getByRole("heading", { name: "Add a showroom I know", level: 1 })).toBeTruthy();
    expect(screen.queryByText("بيانات المعرض")).toBeNull();
    expect(screen.getByText("Showroom details")).toBeTruthy();
  });
});
