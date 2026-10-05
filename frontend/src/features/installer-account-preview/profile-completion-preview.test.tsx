import { fireEvent, screen, within } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerProfileCompletionPreview } from "./profile-completion-preview";

vi.mock("next/navigation", () => ({ usePathname: () => "/preview/installer-account", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string; unoptimized?: boolean }) => {
    void _fill; void _priority; void _sizes; void _unoptimized;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

describe("InstallerProfileCompletionPreview", () => {
  it("renders the Arabic profile-completion hierarchy and all specialties", () => {
    renderWithI18n(<InstallerProfileCompletionPreview theme="light" sidebarMode="expanded" />, "ar");

    expect(screen.getByRole("heading", { name: "كمّل ملفك الشخصي", level: 1 })).toBeTruthy();
    expect(screen.queryByText("ملفك المهني على علاء الدين")).toBeNull();
    expect(screen.getByRole("button", { name: "تغيير صورة الملف" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ضبط صورة الملف الحالية" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تغيير صورة الغلاف" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ضبط الصورة الحالية" })).toBeTruthy();
    expect(screen.getByLabelText("رفع صورة الغلاف")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "المعلومات الأساسية" }).length).toBeGreaterThan(0);
    expect(screen.getByText("أضف بياناتك المهنية الأساسية ليمكن للعملاء التعرف عليك.")).toBeTruthy();
    expect(screen.getAllByText("إتاحة العمل").length).toBeGreaterThan(0);
    expect(screen.getAllByText("سابقة الأعمال").length).toBeGreaterThan(0);
    expect(screen.getAllByText("نطاق العمل").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100%")).toHaveLength(2); // phone summary + tablet-up ring
    const about = screen.getByRole("textbox", { name: "تعريف عني (اختياري)" });
    expect(about).toHaveAttribute("maxlength", "250");
    expect(screen.getByText("0/250")).toBeTruthy();
    fireEvent.change(about, { target: { value: "اتصل بي على 01012345678" } });
    expect(about).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("لا تضع أرقام تليفونات في تعريف عنك.");
    fireEvent.change(about, { target: { value: "خبرة 8 سنوات في التشطيبات" } });
    expect(about).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "خلال أسبوع" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "خلال شهر" }));
    expect(screen.getAllByText("100%")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "خلال شهر" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "تركيب أرضيات خشبية" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تشطيب فيلا خاصة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حفظ ومتابعة" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "اختيار التخصصات" }));
    const specialties = within(screen.getByRole("listbox", { name: "قائمة التخصصات" }));
    expect(specialties.getAllByRole("option")).toHaveLength(14);
    expect(specialties.getByRole("option", { name: /تركيب ورق حائط/ })).toBeTruthy();
    expect(specialties.getByRole("option", { name: /تركيب فيوتك/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /المحافظة.*القاهرة/ }));
    const governorates = within(screen.getByRole("listbox", { name: "المحافظة *" }));
    expect(governorates.getAllByRole("option")).toHaveLength(27);
    fireEvent.click(governorates.getByRole("option", { name: /الإسكندرية/ }));

    fireEvent.click(screen.getByRole("button", { name: /المدينة.*الإسكندرية/ }));
    const cities = within(screen.getByRole("listbox", { name: "المدينة *" }));
    fireEvent.click(cities.getByRole("option", { name: /مدينة أخرى/ }));
    const customCity = screen.getByRole("textbox", { name: "اسم المدينة *" });
    expect(customCity).toBeTruthy();
    expect(screen.getAllByText("90%")).toHaveLength(2);
    fireEvent.change(customCity, { target: { value: "سموحة" } });
    expect(screen.getAllByText("100%")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(screen.getByRole("button", { name: /المدينة.*سموحة/ })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "اسم المدينة *" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ إضافة محافظة" }));
    const coverageAreas = within(screen.getByRole("listbox", { name: "اختر محافظة إضافية" }));
    expect(coverageAreas.getAllByRole("option")).toHaveLength(24);
    fireEvent.click(coverageAreas.getByRole("option", { name: /الإسكندرية/ }));
    expect(screen.getAllByText("الإسكندرية").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("checkbox", { name: "أعمل في محافظات أخرى" }));
    expect(screen.queryByRole("button", { name: "+ إضافة محافظة" })).toBeNull();

    for (const deleteButton of screen.getAllByRole("button", { name: "حذف المشروع" })) fireEvent.click(deleteButton);
    expect(screen.getAllByText("90%")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /إضافة مشروع جديد/ }));
    expect(screen.getAllByText("100%")).toHaveLength(2);
  });

  it("keeps the complete flow localized in English", () => {
    renderWithI18n(<InstallerProfileCompletionPreview theme="dark" sidebarMode="expanded" />, "en");

    expect(screen.getByRole("heading", { name: "Complete your profile", level: 1 })).toBeTruthy();
    expect(screen.getAllByText("Basic information").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "About me (optional)" })).toBeTruthy();
    expect(screen.getAllByText("Work availability").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Work history").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Work coverage").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeTruthy();
    expect(screen.queryByText("كمّل ملفك الشخصي")).toBeNull();
  });
});
