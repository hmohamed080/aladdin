import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/provider";
export default function ShowroomLayout({ children }: {
    children: ReactNode;
}) {
    return <I18nProvider locale="ar" dir="rtl">{children}</I18nProvider>;
}
