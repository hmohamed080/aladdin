import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerSettingsPreview } from "./installer-settings-preview";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/preview/installer-settings", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/dynamic", async () => {
  const { InstallerPhoneField } = await import("@/features/installer-dashboard-preview/installer-phone-field");
  return { default: () => InstallerPhoneField };
});

describe("installer settings preview", () => {
  it("renders the Arabic reference sections and shared phone control", () => {
    renderWithI18n(<InstallerSettingsPreview theme="light" sidebarMode="expanded" />);
    expect(screen.getByRole("heading", { name: "الإعدادات", level: 1 })).toBeInTheDocument();
    for (const name of ["البيانات الشخصية", "الخصوصية والأمان", "الإشعارات", "إعدادات الحساب", "طرق تسجيل الدخول", "الجلسات النشطة", "الأجهزة الموثوقة", "استعادة الحساب", "تغيير كلمة المرور"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByLabelText("اسم المستخدم")).toHaveValue("ahmed123");
    expect(screen.getByLabelText("رقم الهاتف")).toHaveAttribute("type", "tel");
    fireEvent.click(screen.getAllByRole("button", { name: "الدولة" })[0]!);
    expect(within(screen.getByRole("listbox", { name: "الدولة" })).getAllByRole("option").length).toBeGreaterThan(200);
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getAllByText("متصل")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "إيقاف الحساب مؤقتًا" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف الحساب" })).toBeInTheDocument();
  });

  it("keeps switches and save feedback local and supports an optional second phone", () => {
    renderWithI18n(<InstallerSettingsPreview theme="dark" sidebarMode="collapsed" />, "en");
    const notifications = screen.getByRole("switch", { name: "Enable notifications" });
    fireEvent.click(notifications);
    expect(notifications).toHaveAttribute("aria-checked", "false");
    const security = screen.getByRole("switch", { name: "Enable two-step verification" });
    fireEvent.click(security);
    expect(security).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid phone number");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "01012345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another phone" }));
    expect(screen.getByLabelText(/Additional phone number/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove additional phone" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Changes saved in this preview only. Your real account has not changed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByText(/No security settings were changed and no account was suspended or deleted/)).toBeInTheDocument();
  });

  it("preserves the production settings destination", () => {
    renderWithI18n(<InstallerSidebar initialMode="expanded" mobileOpen={false} onCloseMobile={() => {}} production />, "en");
    for (const link of screen.getAllByRole("link", { name: "Settings" })) expect(link).toHaveAttribute("href", "/home/settings");
    expect(screen.queryByRole("link", { name: "Settings", current: "page" })).not.toBeInTheDocument();
  });
});
