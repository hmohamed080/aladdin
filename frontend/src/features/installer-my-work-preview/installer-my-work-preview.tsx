"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, FileTextIcon, MessageIcon, PackageIcon, ReceiptIcon, UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { InstallerMyWorkView, RailAside, RailCard, RailRow } from "./installer-my-work-view";
import { PREVIEW_WORK_FEATURES, previewActiveWork, previewWorkRows, previewWorkTabs } from "./preview-adapter";
import { ACTIVE_WORK, DOCUMENT_ROWS, pick } from "./preview-data";
import type { WorkSort } from "./view-model";

const PREVIEW_SORTS: readonly WorkSort[] = ["default", "last-added", "recent-added", "last-action", "oldest-first"];

/**
 * THE PREVIEW WRAPPER: the preview's own shell, fixtures, demo notices and demo
 * rail around the shared `InstallerMyWorkView`. Production never imports this
 * file — it supplies its own shell, real rows and a real rail.
 */
export function InstallerMyWorkPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("current");
  const [progress, setProgress] = useState<number>(ACTIVE_WORK.progress);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => previewWorkRows(locale), [locale]);
  const tabs = useMemo(() => previewWorkTabs(locale), [locale]);
  const announce = (arText: string, enText: string) => setNotice(ar ? arText : enText);

  return (
    <div data-installer-my-work-preview="" dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="my-work"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-sm pb-lg pt-sm`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md pb-xl pt-md tablet:pt-lg`}>
          <InstallerMyWorkView
            activeWork={previewActiveWork(locale, progress)}
            rows={rows}
            tabs={tabs}
            activeTab={activeTab}
            defaultTab="current"
            onTabChange={setActiveTab}
            sortOptions={PREVIEW_SORTS}
            features={PREVIEW_WORK_FEATURES}
            dateInitialMonth="2025-05"
            onRowAction={(row) =>
              row.action.label === "View review" || row.action.label === "عرض التقييم"
                ? announce("تم فتح التقييم التجريبي", "Demo review opened")
                : announce("تم فتح العمل التجريبي", "Demo work opened")
            }
            onActiveAction={(kind) => {
              if (kind === "update") {
                setProgress((value) => Math.min(100, value + 10));
                announce("تم تحديث تقدم العمل التجريبي", "Demo work progress updated");
              } else {
                announce("تم فتح تفاصيل العمل التجريبية", "Demo work details opened");
              }
            }}
            rail={<InformationRail locale={locale} onAction={announce} />}
          />
          <p className="sr-only" aria-live="polite">{notice}</p>
        </main>
      </div>
    </div>
  );
}

/** The demo rail: fixture file counts and four tools that have no backend. Preview only. */
function InformationRail({ locale, onAction }: { locale: Locale; onAction: (ar: string, en: string) => void }) {
  const ar = locale === "ar";
  return (
    <RailAside label={ar ? "معلومات الشغل" : "Work information"}>
      <RailCard title={ar ? "المستندات والملفات" : "Documents and files"} icon={<FileTextIcon size={19} />}>
        {DOCUMENT_ROWS.map((row) => (
          <RailRow key={row.label.en} label={pick(locale, row.label)} value={new Intl.NumberFormat(ar ? "ar-EG" : "en-EG").format(row.count)} />
        ))}
        <RailAction onClick={() => onAction("تم فتح إدارة الملفات التجريبية", "Demo file manager opened")}>{ar ? "إدارة الملفات" : "Manage files"}</RailAction>
      </RailCard>

      <RailCard title={ar ? "أدوات سريعة" : "Quick tools"} icon={<ReceiptIcon size={19} />}>
        <QuickAction icon={<UploadIcon size={17} />} label={ar ? "رفع صور للعمل الحالي" : "Upload current-work photos"} onClick={() => onAction("تم فتح رفع الصور التجريبي", "Demo photo upload opened")} />
        <QuickAction icon={<PackageIcon size={17} />} label={ar ? "طلب مواد من المعرض" : "Request materials from showroom"} onClick={() => onAction("تم فتح طلب المواد التجريبي", "Demo material request opened")} />
        <QuickAction icon={<MessageIcon size={17} />} label={ar ? "مراسلة المعرض" : "Message the showroom"} onClick={() => onAction("تم فتح المحادثة التجريبية", "Demo conversation opened")} />
        <QuickAction icon={<CalendarIcon size={17} />} label={ar ? "طلب تمديد موعد" : "Request deadline extension"} onClick={() => onAction("تم فتح طلب التمديد التجريبي", "Demo extension request opened")} />
      </RailCard>
    </RailAside>
  );
}

function RailAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-full px-md py-3 text-start text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{children}</button>;
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-sm px-md py-3 text-start text-body font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"><span className="text-accent">{icon}</span><span>{label}</span></button>;
}
