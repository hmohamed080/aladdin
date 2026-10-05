"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button, Input } from "@/components/ui/controls";
import {
  CalendarIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  MailIcon,
  MapPinIcon,
  MessageIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PhoneIcon,
  ReceiptIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";
import { Badge, Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import {
  ACTIVE_WORK,
  DOCUMENT_ROWS,
  WORK_ROWS,
  WORK_TABS,
  pick,
  type WorkRow,
  type WorkStatus,
  type WorkTabKey,
} from "./preview-data";

const WORK_PAGE_SIZE = 6;
type WorkSort = "default" | "last-added" | "recent-added" | "last-action" | "oldest-first";
type ContactFilter = "all" | "email" | "phone-only";
type WorkView = "list" | "grid";
export type WorkDateRange = { from: string; to: string };
type SavedSearch = {
  id: string;
  name: string;
  activeTab: WorkTabKey;
  contact: ContactFilter;
  sort: WorkSort;
  dateRange: WorkDateRange;
};

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
  const [activeTab, setActiveTab] = useState<WorkTabKey>("current");
  const [progress, setProgress] = useState<number>(ACTIVE_WORK.progress);
  const [notice, setNotice] = useState("");

  const visibleRows = useMemo(() => {
    if (activeTab === "current") {
      return WORK_ROWS.filter((row) => row.status !== "review");
    }
    return WORK_ROWS.filter((row) => row.status === activeTab);
  }, [activeTab]);

  const announce = (arText: string, enText: string) => {
    setNotice(ar ? arText : enText);
  };

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
          <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
            <div className="space-y-md">
              <h1 className="text-headline text-fg">{ar ? "شغلي" : "My work"}</h1>
              <p className="max-w-2xl text-body text-fg-secondary">
                {ar ? "تابع جميع أعمالك الحالية والسابقة في مكان واحد" : "Track all your current and previous work in one place."}
              </p>
            </div>
            <Button variant="outline" className="gap-2 self-start tablet:self-auto" onClick={() => window.print()}>
              <DownloadIcon size={17} />
              {ar ? "تصدير التقرير" : "Export report"}
            </Button>
          </header>

          <ActiveWorkPanel
            locale={locale}
            progress={progress}
            onUpdate={() => {
              setProgress((value) => Math.min(100, value + 10));
              announce("تم تحديث تقدم العمل التجريبي", "Demo work progress updated");
            }}
            onDetails={() => announce("تم فتح تفاصيل العمل التجريبية", "Demo work details opened")}
          />

          <div dir="ltr" className="grid items-start gap-md desktop:items-stretch desktop:grid-cols-[minmax(0,1fr)_18rem]">
            <div dir={dir} className="min-w-0 desktop:flex desktop:h-full desktop:min-h-0 desktop:flex-col desktop:overflow-hidden desktop:[contain:size]">
              <WorkHistory
                rows={visibleRows}
                locale={locale}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onAction={(messageAr, messageEn) => announce(messageAr, messageEn)}
              />
            </div>

            <InformationRail locale={locale} onAction={announce} />
          </div>

          <p className="sr-only" aria-live="polite">{notice}</p>
        </main>
      </div>
    </div>
  );
}

function ActiveWorkPanel({
  locale,
  progress,
  onUpdate,
  onDetails,
}: {
  locale: Locale;
  progress: number;
  onUpdate: () => void;
  onDetails: () => void;
}) {
  const ar = locale === "ar";
  return (
    <Card pad="sm" className="overflow-hidden">
      <section aria-labelledby="active-work-title" className="grid gap-lg desktop:grid-cols-5">
        <div className="grid min-w-0 gap-md tablet:grid-cols-5 desktop:col-span-3">
          <div className="relative min-h-48 overflow-hidden rounded-sm border bg-surface-2 tablet:col-span-2">
            <Image src={ACTIVE_WORK.image} alt="" fill sizes="(min-width: 1024px) 24vw, (min-width: 768px) 38vw, 100vw" className="object-cover" priority />
            <span className="absolute start-sm top-sm flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
              {ar ? "جاري الآن" : "Live now"}
            </span>
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-md tablet:col-span-3">
            <div>
              <h2 id="active-work-title" className="text-title text-fg">{pick(locale, ACTIVE_WORK.title)}</h2>
              <p className="mt-1 text-body font-medium text-fg-secondary">{ACTIVE_WORK.company}</p>
              <p className="mt-2 flex items-center gap-1.5 text-label text-fg-muted"><MapPinIcon size={14} />{pick(locale, ACTIVE_WORK.location)}</p>
            </div>
            <dl className="grid grid-cols-2 gap-md border-t pt-md">
              <Detail label={ar ? "قيمة العمل" : "Work value"} value={formatMoney(ACTIVE_WORK.value, locale)} />
              <Detail label={ar ? "وقت التسليم" : "Delivery time"} value={pick(locale, ACTIVE_WORK.deliveryTime)} />
              <Detail label={ar ? "تاريخ التسليم" : "Delivery date"} value={pick(locale, ACTIVE_WORK.deliveryDate)} />
            </dl>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-md border-t pt-md desktop:col-span-2 desktop:border-s desktop:border-t-0 desktop:ps-lg desktop:pt-0">
          <div className="flex items-end justify-between gap-md">
            <span className="text-body font-semibold text-fg">{ar ? "التقدم في العمل" : "Work progress"}</span>
            <strong className="font-mono text-headline text-fg">{formatNumber(progress, locale)}%</strong>
          </div>
          <div className="h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-pill bg-success transition-[width] duration-normal" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-label text-fg-muted">{pick(locale, ACTIVE_WORK.lastUpdate)}</p>
          <dl className="grid grid-cols-2 gap-md border-t pt-md">
            <Detail label={ar ? "المرحلة الحالية" : "Current stage"} value={pick(locale, ACTIVE_WORK.currentStage)} tone="success" />
            <Detail label={ar ? "المرحلة التالية" : "Next stage"} value={pick(locale, ACTIVE_WORK.nextStage)} />
          </dl>
          <div className="mt-auto grid grid-cols-2 gap-sm">
            <Button variant="outline" onClick={onDetails}>{ar ? "عرض التفاصيل" : "View details"}</Button>
            <Button onClick={onUpdate}>{ar ? "تحديث التقدم" : "Update progress"}</Button>
          </div>
        </div>
      </section>
    </Card>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 break-words text-body font-medium", tone === "success" ? "text-success" : "text-fg")}>{value}</dd>
    </div>
  );
}

type MenuOption = { value: string; label: string };

function MenuSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  onDeleteOption,
  deleteLabel = "Delete",
  compact = false,
  className,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly MenuOption[];
  onChange: (value: string) => void;
  onDeleteOption?: (value: string) => void;
  deleteLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          compact ? "h-8 text-label" : "min-h-11",
          !selected && "text-fg-muted",
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon size={15} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div id={listId} role="listbox" aria-label={label} className="absolute start-0 top-full z-popover mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border bg-surface p-xs shadow-lg">
          {options.map((option) => (
            <div key={option.value} className="flex items-center gap-xs rounded-sm hover:bg-surface-2">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn("min-h-9 min-w-0 flex-1 px-sm text-start text-label text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", option.value === value && "font-semibold text-info")}
              >
                {option.label}
              </button>
              {onDeleteOption ? (
                <button
                  type="button"
                  aria-label={`${deleteLabel}: ${option.label}`}
                  onClick={() => onDeleteOption(option.value)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <TrashIcon size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkHistory({
  rows,
  locale,
  activeTab,
  onTabChange,
  onAction,
}: {
  rows: readonly WorkRow[];
  locale: Locale;
  activeTab: WorkTabKey;
  onTabChange: (tab: WorkTabKey) => void;
  onAction: (ar: string, en: string) => void;
}) {
  const ar = locale === "ar";
  const [visibleCount, setVisibleCount] = useState(WORK_PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorkSort>("default");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [dateRange, setDateRange] = useState<WorkDateRange>({ from: "", to: "" });
  const [view, setView] = useState<WorkView>("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([
    {
      id: "in-progress",
      name: ar ? "أعمال قيد التنفيذ" : "Work in progress",
      activeTab: "in_progress",
      contact: "all",
      sort: "default",
      dateRange: { from: "", to: "" },
    },
  ]);
  const companies = useMemo(() => Array.from(new Set(WORK_ROWS.map((row) => row.company))), []);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale === "ar" ? "ar-EG" : "en-EG");
    const matchingRows = rows.filter((row) => {
      const searchable = [
        pick(locale, row.title),
        pick(locale, row.location),
        row.company,
        row.contact.phone,
        row.contact.email ?? "",
      ].join(" ").toLocaleLowerCase(locale === "ar" ? "ar-EG" : "en-EG");
      const matchesQuery = normalizedQuery.length === 0 || searchable.includes(normalizedQuery);
      const matchesContact = contactFilter === "all"
        || (contactFilter === "email" && Boolean(row.contact.email))
        || (contactFilter === "phone-only" && !row.contact.email);
      const matchesCompany = companyFilter === "all" || row.company === companyFilter;
      const matchesDateRange = (!dateRange.from || row.deliveryDateIso >= dateRange.from)
        && (!dateRange.to || row.deliveryDateIso <= dateRange.to);
      return matchesQuery && matchesContact && matchesCompany && matchesDateRange;
    });

    if (sort === "last-added" || sort === "oldest-first") return [...matchingRows].reverse();
    if (sort === "last-action") {
      const priority: Record<WorkStatus, number> = { in_progress: 0, review: 1, accepted: 2, paused: 3, completed: 4, cancelled: 5, archived: 6 };
      return [...matchingRows].sort((a, b) => priority[a.status] - priority[b.status]);
    }
    return matchingRows;
  }, [companyFilter, contactFilter, dateRange.from, dateRange.to, locale, query, rows, sort]);
  const paginatedRows = filteredRows.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRows.length;
  const activeDrawerFilters = Number(activeTab !== "current") + Number(contactFilter !== "all") + Number(companyFilter !== "all");

  const resetSearch = () => {
    setQuery("");
    setSort("default");
    setContactFilter("all");
    setCompanyFilter("all");
    setDateRange({ from: "", to: "" });
    setVisibleCount(WORK_PAGE_SIZE);
    setSelectedSavedId("");
    onTabChange("current");
  };

  const applySavedSearch = (id: string) => {
    setSelectedSavedId(id);
    const saved = savedSearches.find((item) => item.id === id);
    if (!saved) return;
    setSort(saved.sort);
    setContactFilter(saved.contact);
    setCompanyFilter("all");
    setDateRange(saved.dateRange);
    setVisibleCount(WORK_PAGE_SIZE);
    onTabChange(saved.activeTab);
  };

  const saveSearch = (name: string, mode: "new" | "update") => {
    const next: SavedSearch = {
      id: mode === "update" && selectedSavedId ? selectedSavedId : `saved-${Date.now()}`,
      name,
      activeTab,
      contact: contactFilter,
      sort,
      dateRange,
    };
    setSavedSearches((current) => mode === "update" && selectedSavedId
      ? current.map((item) => item.id === selectedSavedId ? next : item)
      : [...current, next]);
    setSelectedSavedId(next.id);
    setSaveDialogOpen(false);
    onAction("تم حفظ البحث التجريبي", "Demo search saved");
  };

  const deleteSavedSearch = (id: string) => {
    setSavedSearches((current) => current.filter((item) => item.id !== id));
    if (selectedSavedId === id) setSelectedSavedId("");
    onAction("تم حذف البحث المحفوظ", "Saved search deleted");
  };

  return (
    <section
      aria-labelledby="all-work-title"
      className="overflow-hidden rounded-md border bg-surface shadow-card desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col"
    >
      <div className="flex items-center justify-between gap-md border-b px-md py-3">
        <h2 id="all-work-title" className="text-body-lg font-semibold text-fg">{ar ? "جميع أعمالك" : "All your work"}</h2>
        <span className="shrink-0 text-label text-fg-muted">{formatNumber(filteredRows.length, locale)} {ar ? "أعمال" : "items"}</span>
      </div>

      <div className="shrink-0 border-b bg-surface max-tablet:flex max-tablet:flex-wrap max-tablet:items-center max-tablet:gap-sm max-tablet:px-md max-tablet:py-sm">
        {/* Phones flatten the three desktop rows into one wrapping row (display: contents) so the same controls re-compose with CSS only: search + filter button, then date + sort, then the count. Saved-search and view controls are desktop-only here and live in the filters sheet on phones. */}
        <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm max-tablet:contents">
          <div className="flex min-w-0 items-center gap-sm max-tablet:hidden">
            <button type="button" onClick={resetSearch} className="text-label font-semibold text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {ar ? "بحث جديد" : "New search"}
            </button>
            <span className="h-5 border-s" aria-hidden="true" />
            <MenuSelect
              compact
              className="w-40"
              label={ar ? "عمليات البحث المحفوظة" : "Saved searches"}
              value={selectedSavedId}
              placeholder={ar ? "المحفوظة" : "Saved"}
              options={savedSearches.map((item) => ({ value: item.id, label: item.name }))}
              onChange={applySavedSearch}
              onDeleteOption={deleteSavedSearch}
              deleteLabel={ar ? "حذف" : "Delete"}
            />
          </div>

          <div className="flex min-w-0 flex-nowrap items-center gap-sm overflow-x-auto max-tablet:contents">
            <Button size="sm" variant="outline" className="relative gap-1.5 max-tablet:order-2 max-tablet:h-11 max-tablet:w-11 max-tablet:shrink-0 max-tablet:gap-0 max-tablet:px-0" aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <FilterIcon size={15} className="max-tablet:h-[18px] max-tablet:w-[18px]" />
              <span className="max-tablet:sr-only">{ar ? "كل الفلاتر" : "All filters"}</span>
              {activeDrawerFilters > 0 ? <span className="rounded-pill bg-surface-2 px-1.5 tabular-nums text-fg max-tablet:absolute max-tablet:-end-1 max-tablet:-top-1 max-tablet:grid max-tablet:h-5 max-tablet:min-w-5 max-tablet:place-items-center max-tablet:bg-accent-solid max-tablet:px-1 max-tablet:text-caption max-tablet:font-bold max-tablet:text-on-accent">{formatNumber(activeDrawerFilters, locale)}</span> : null}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 max-tablet:hidden" onClick={() => setSaveDialogOpen(true)}>
              <BookmarkIcon size={15} />
              {ar ? "حفظ البحث" : "Save search"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm max-tablet:contents">
          <div className="flex flex-wrap items-center gap-sm max-tablet:order-3 max-tablet:grid max-tablet:w-full max-tablet:grid-cols-2 max-tablet:[&>*]:min-w-0">
            <DateRangeFilter
              compact
              locale={locale}
              value={dateRange}
              onChange={(next) => { setDateRange(next); setVisibleCount(WORK_PAGE_SIZE); }}
            />
            <MenuSelect
              compact
              className="w-full tablet:w-56 tablet:shrink-0"
              label={ar ? "الترتيب" : "Sort"}
              value={sort}
              placeholder={ar ? "اختر الترتيب" : "Select sort"}
              options={[
                { value: "default", label: ar ? "الترتيب: الافتراضي" : "Sort: Default" },
                { value: "last-added", label: ar ? "آخر ما تمت إضافته" : "Last added" },
                { value: "recent-added", label: ar ? "المضاف حديثًا" : "Recently added" },
                { value: "last-action", label: ar ? "آخر نشاط" : "Last action" },
                { value: "oldest-first", label: ar ? "الأقدم إلى الأحدث" : "Oldest to newest" },
              ]}
              onChange={(next) => setSort(next as WorkSort)}
            />
          </div>

          <div className="flex items-center gap-xs max-tablet:hidden" aria-label={ar ? "طريقة العرض" : "View mode"}>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-sm px-sm text-label font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "list" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
              <ListIcon size={15} />{ar ? "قائمة" : "List"}
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-sm px-sm text-label font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "grid" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
              <GridIcon size={15} />{ar ? "شبكة" : "Grid"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-md px-md py-sm max-tablet:contents">
          <div className="relative min-w-52 flex-1 max-tablet:order-1 max-tablet:min-w-0">
            <SearchIcon size={15} className="pointer-events-none absolute start-sm top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input type="search" aria-label={ar ? "البحث في الأعمال" : "Search work"} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(WORK_PAGE_SIZE); }} placeholder={ar ? "ابحث في جميع أعمالك" : "Search all work"} className="min-h-9 py-1.5 pe-sm ps-8 text-label max-tablet:min-h-11" />
          </div>
          <span className="shrink-0 text-label text-fg-muted max-tablet:order-4 max-tablet:w-full" aria-live="polite">
            {ar ? `عرض ${formatNumber(paginatedRows.length, locale)} من ${formatNumber(filteredRows.length, locale)} نتيجة` : `Showing ${formatNumber(paginatedRows.length, locale)} of ${formatNumber(filteredRows.length, locale)} results`}
          </span>
        </div>
      </div>
      {filteredRows.length === 0 ? (
        <div className="px-md py-xl text-center">
          <p className="text-body-lg font-medium text-fg">{ar ? "لا توجد أعمال في هذه الحالة" : "No work in this status"}</p>
          <p className="mt-1 text-body text-fg-muted">{ar ? "اختر حالة أخرى لمراجعة باقي أعمالك." : "Choose another status to review the rest of your work."}</p>
        </div>
      ) : (
        <>
          <div className={cn("hidden overflow-x-auto tablet:block desktop:min-h-0 desktop:flex-1 desktop:overflow-y-auto desktop:overscroll-contain", view === "grid" && "tablet:hidden")}>
            <table className="w-full border-collapse text-start">
              <thead className="bg-surface-2 text-label text-fg-secondary">
                <tr>
                  <th className="px-sm py-2.5 text-start font-medium">{ar ? "العمل" : "Work"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "المعرض / العميل" : "Company / client"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "التواصل" : "Contact"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "الحالة" : "Status"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "القيمة" : "Value"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "تاريخ التسليم" : "Delivery"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "إجراء سريع" : "Quick action"}</th>
                </tr>
              </thead>
              <tbody id="work-history-results" className="divide-y divide-strong">
                {paginatedRows.map((row) => <WorkTableRow key={row.id} row={row} locale={locale} onAction={onAction} />)}
              </tbody>
            </table>
          </div>

          <ul id="work-history-results-mobile" className={cn("divide-y divide-strong tablet:hidden", view === "grid" && "hidden")}>
            {paginatedRows.map((row) => <WorkMobileRow key={row.id} row={row} locale={locale} onAction={onAction} />)}
          </ul>
          {view === "grid" ? (
            <ul id="work-history-results-grid" className="grid min-h-0 flex-1 grid-cols-1 gap-sm overflow-y-auto p-md tablet:grid-cols-2">
              {paginatedRows.map((row) => <WorkGridCard key={row.id} row={row} locale={locale} onAction={onAction} />)}
            </ul>
          ) : null}
        </>
      )}

      {filteredRows.length > 0 ? (
        <button
          type="button"
          aria-controls="work-history-results work-history-results-mobile work-history-results-grid"
          disabled={!hasMore}
          onClick={() => setVisibleCount((count) => Math.min(count + WORK_PAGE_SIZE, filteredRows.length))}
          className="w-full shrink-0 border-t px-md py-3 text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:cursor-default disabled:text-fg-muted disabled:hover:bg-transparent"
        >
          {hasMore ? (ar ? "عرض المزيد" : "Show more") : (ar ? "تم عرض كل الأعمال" : "All work shown")}
        </button>
      ) : null}

      {filtersOpen ? (
        <WorkFiltersDrawer
          locale={locale}
          phoneExtras={(
            <div className="space-y-lg tablet:hidden">
              <FilterField label={ar ? "عمليات البحث المحفوظة" : "Saved searches"}>
                <MenuSelect
                  label={ar ? "عمليات البحث المحفوظة" : "Saved searches"}
                  value={selectedSavedId}
                  placeholder={ar ? "المحفوظة" : "Saved"}
                  options={savedSearches.map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(id) => { applySavedSearch(id); setFiltersOpen(false); }}
                  onDeleteOption={deleteSavedSearch}
                  deleteLabel={ar ? "حذف" : "Delete"}
                />
              </FilterField>
              <div className="grid grid-cols-2 gap-sm">
                <Button variant="outline" className="gap-1.5" onClick={() => { resetSearch(); setFiltersOpen(false); }}>{ar ? "بحث جديد" : "New search"}</Button>
                <Button variant="outline" className="gap-1.5" onClick={() => { setFiltersOpen(false); setSaveDialogOpen(true); }}><BookmarkIcon size={15} />{ar ? "حفظ البحث" : "Save search"}</Button>
              </div>
            </div>
          )}
          activeTab={activeTab}
          contactFilter={contactFilter}
          companyFilter={companyFilter}
          companies={companies}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            onTabChange(next.activeTab);
            setContactFilter(next.contactFilter);
            setCompanyFilter(next.companyFilter);
            setVisibleCount(WORK_PAGE_SIZE);
            setFiltersOpen(false);
          }}
        />
      ) : null}
      {saveDialogOpen ? (
        <SaveSearchDialog
          locale={locale}
          savedSearches={savedSearches}
          selectedSavedId={selectedSavedId}
          onClose={() => setSaveDialogOpen(false)}
          onSave={saveSearch}
        />
      ) : null}
    </section>
  );
}

function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(
      'button, input, select, [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute("disabled"));
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return ref;
}

export function DateRangeFilter({ locale, value, onChange, compact = false }: { locale: Locale; value: WorkDateRange; onChange: (value: WorkDateRange) => void; compact?: boolean }) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const label = value.from || value.to
    ? [value.from, value.to].filter(Boolean).map((date) => new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))).join(" – ")
    : (ar ? "اختر التاريخ" : "Select date");

  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={cn("flex items-center justify-between gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", compact ? "h-10 w-full min-w-0 shrink-0 text-label tablet:w-44" : "min-h-11 w-full text-body")}>
        <span className="flex min-w-0 items-center gap-sm leading-normal"><CalendarIcon size={17} className="shrink-0 text-fg-muted" /><span className="truncate">{label}</span></span>
        <ChevronDownIcon size={15} className="shrink-0 text-fg-muted" />
      </button>
      {open ? <DateRangeDialog locale={locale} value={value} onClose={() => setOpen(false)} onApply={(next) => { onChange(next); setOpen(false); }} /> : null}
    </>
  );
}

function DateRangeDialog({ locale, value, onClose, onApply }: { locale: Locale; value: WorkDateRange; onClose: () => void; onApply: (value: WorkDateRange) => void }) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [draft, setDraft] = useState(value);
  const [firstMonth, setFirstMonth] = useState(() => new Date(Date.UTC(2025, 4, 1)));
  const secondMonth = addUtcMonths(firstMonth, 1);
  const presets = getDatePresets(ar ? "ar" : "en");

  const selectDate = (iso: string) => {
    setDraft((current) => {
      if (!current.from || current.to) return { from: iso, to: "" };
      return iso < current.from ? { from: iso, to: current.from } : { from: current.from, to: iso };
    });
  };

  return (
    <div className="fixed inset-0 z-popover flex items-center justify-center bg-brand-basalt/40 p-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-md border bg-surface shadow-lg">
        <div className="flex items-center justify-between gap-md border-b px-lg py-md">
          <h3 id={titleId} className="text-title text-fg">{ar ? "اختر نطاق التاريخ" : "Select date range"}</h3>
          <button type="button" onClick={onClose} aria-label={ar ? "إغلاق" : "Close"} className="grid h-9 w-9 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><XIcon size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto desktop:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col border-b p-md desktop:border-b-0 desktop:border-e">
            {presets.map((preset) => (
              <button key={preset.label} type="button" onClick={() => setDraft(preset.value)} className="min-h-10 rounded-sm px-sm text-start text-body text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{preset.label}</button>
            ))}
          </div>
          <CalendarMonth locale={locale} month={firstMonth} range={draft} onSelect={selectDate} onPrevious={() => setFirstMonth((current) => addUtcMonths(current, -1))} />
          <CalendarMonth locale={locale} month={secondMonth} range={draft} onSelect={selectDate} onNext={() => setFirstMonth((current) => addUtcMonths(current, 1))} />
        </div>

        <div className="flex flex-col gap-md border-t px-lg py-md tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex items-center gap-sm" dir="ltr">
            <Input type="date" aria-label={ar ? "من تاريخ" : "From date"} value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="min-h-9 py-1.5 text-label" />
            <span className="text-fg-muted">–</span>
            <Input type="date" aria-label={ar ? "إلى تاريخ" : "To date"} value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="min-h-9 py-1.5 text-label" />
          </div>
          <div className="flex justify-end gap-sm">
            <Button variant="outline" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => onApply(draft)}>{ar ? "تطبيق" : "Apply"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarMonth({ locale, month, range, onSelect, onPrevious, onNext }: { locale: Locale; month: Date; range: WorkDateRange; onSelect: (iso: string) => void; onPrevious?: () => void; onNext?: () => void }) {
  const ar = locale === "ar";
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstOffset = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = [...Array.from({ length: firstOffset }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const weekday = ar ? ["اث", "ث", "أر", "خ", "ج", "س", "ح"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <section className="border-b p-md last:border-b-0 desktop:border-b-0 desktop:border-e desktop:last:border-e-0">
      <div className="flex min-h-9 items-center justify-between gap-sm">
        {onPrevious ? <button type="button" aria-label={ar ? "الشهر السابق" : "Previous month"} onClick={onPrevious} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronLeftIcon size={16} /></button> : <span className="h-8 w-8" />}
        <h4 className="text-body font-semibold text-fg">{new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}</h4>
        {onNext ? <button type="button" aria-label={ar ? "الشهر التالي" : "Next month"} onClick={onNext} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronRightIcon size={16} /></button> : <span className="h-8 w-8" />}
      </div>
      <div className="mt-sm grid grid-cols-7 gap-xs text-center">
        {weekday.map((day) => <span key={day} className="py-1 text-label font-medium text-fg-muted">{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const edge = iso === range.from || iso === range.to;
          const within = Boolean(range.from && range.to && iso > range.from && iso < range.to);
          return (
            <button key={iso} type="button" aria-label={iso} aria-pressed={edge} onClick={() => onSelect(iso)} className={cn("grid aspect-square min-h-8 place-items-center rounded-sm text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", within && "bg-info/10", edge && "bg-info text-white hover:bg-info")}>
              {formatNumber(day, locale)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function getDatePresets(locale: "ar" | "en"): readonly { label: string; value: WorkDateRange }[] {
  const anchor = new Date();
  const day = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const iso = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
  const monthStart = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  const monthEnd = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0);
  const yearStart = Date.UTC(anchor.getUTCFullYear(), 0, 1);
  const yearEnd = Date.UTC(anchor.getUTCFullYear(), 11, 31);
  const weekday = (anchor.getUTCDay() + 6) % 7;
  const labels = locale === "ar"
    ? ["اليوم", "أمس", "هذا الأسبوع", "الأسبوع الماضي", "هذا الشهر", "الشهر الماضي", "هذا العام", "العام الماضي", "كل الوقت"]
    : ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "Last year", "All time"];
  return [
    { label: labels[0]!, value: { from: iso(day), to: iso(day) } },
    { label: labels[1]!, value: { from: iso(day - 86400000), to: iso(day - 86400000) } },
    { label: labels[2]!, value: { from: iso(day - weekday * 86400000), to: iso(day + (6 - weekday) * 86400000) } },
    { label: labels[3]!, value: { from: iso(day - (weekday + 7) * 86400000), to: iso(day - (weekday + 1) * 86400000) } },
    { label: labels[4]!, value: { from: iso(monthStart), to: iso(monthEnd) } },
    { label: labels[5]!, value: { from: iso(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)), to: iso(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0)) } },
    { label: labels[6]!, value: { from: iso(yearStart), to: iso(yearEnd) } },
    { label: labels[7]!, value: { from: iso(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1)), to: iso(Date.UTC(anchor.getUTCFullYear() - 1, 11, 31)) } },
    { label: labels[8]!, value: { from: "", to: "" } },
  ];
}

function WorkFiltersDrawer({
  locale,
  activeTab,
  contactFilter,
  companyFilter,
  companies,
  phoneExtras,
  onClose,
  onApply,
}: {
  locale: Locale;
  activeTab: WorkTabKey;
  contactFilter: ContactFilter;
  companyFilter: string;
  companies: readonly string[];
  /** Phone only: the saved-search controls that are not worth permanent toolbar space. */
  phoneExtras?: React.ReactNode;
  onClose: () => void;
  onApply: (filters: { activeTab: WorkTabKey; contactFilter: ContactFilter; companyFilter: string }) => void;
}) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [draftStatus, setDraftStatus] = useState<WorkTabKey | "">(activeTab === "current" ? "" : activeTab);
  const [draftContact, setDraftContact] = useState<ContactFilter | "">(contactFilter === "all" ? "" : contactFilter);
  const [draftCompany, setDraftCompany] = useState(companyFilter === "all" ? "" : companyFilter);

  const reset = () => {
    setDraftStatus("");
    setDraftContact("");
    setDraftCompany("");
  };

  return (
    <div className="fixed inset-0 z-modal bg-brand-basalt/60" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] w-full flex-col rounded-t-lg border-t bg-surface shadow-lg tablet:inset-x-auto tablet:inset-y-0 tablet:end-0 tablet:max-h-none tablet:max-w-sm tablet:rounded-none tablet:border-s tablet:border-t-0">
        <div className="flex items-center justify-between gap-md border-b px-lg py-md">
          <h3 id={titleId} className="text-title text-fg">{ar ? "الفلاتر" : "Filters"}</h3>
          <button type="button" onClick={onClose} aria-label={ar ? "إغلاق الفلاتر" : "Close filters"} className="grid h-9 w-9 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><XIcon size={18} /></button>
        </div>

        <div className="flex-1 space-y-lg overflow-y-auto px-lg py-lg">
          {phoneExtras}
          <FilterField label={ar ? "الحالة" : "Status"}>
            <MenuSelect label={ar ? "الحالة" : "Status"} value={draftStatus} placeholder={ar ? "اختر" : "Select"} options={WORK_TABS.filter((tab) => tab.key !== "current").map((tab) => ({ value: tab.key, label: pick(locale, tab.label) }))} onChange={(next) => setDraftStatus(next as WorkTabKey)} />
          </FilterField>
          <FilterField label={ar ? "بيانات التواصل" : "Contact details"}>
            <MenuSelect label={ar ? "بيانات التواصل" : "Contact details"} value={draftContact} placeholder={ar ? "اختر" : "Select"} options={[{ value: "email", label: ar ? "هاتف وبريد إلكتروني" : "Phone and email" }, { value: "phone-only", label: ar ? "هاتف فقط" : "Phone only" }]} onChange={(next) => setDraftContact(next as ContactFilter)} />
          </FilterField>
          <FilterField label={ar ? "المعرض / العميل" : "Company / client"}>
            <MenuSelect label={ar ? "المعرض / العميل" : "Company / client"} value={draftCompany} placeholder={ar ? "اختر" : "Select"} options={companies.map((company) => ({ value: company, label: company }))} onChange={setDraftCompany} />
          </FilterField>
        </div>

        <div className="flex gap-sm border-t px-lg py-md">
          <Button className="flex-1" onClick={() => onApply({ activeTab: draftStatus || "current", contactFilter: draftContact || "all", companyFilter: draftCompany || "all" })}>{ar ? "تطبيق الفلاتر" : "Apply filters"}</Button>
          <Button variant="outline" onClick={reset}>{ar ? "إعادة ضبط" : "Reset"}</Button>
        </div>
      </aside>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-xs"><span className="block text-label font-medium text-fg-secondary">{label}</span>{children}</div>;
}

function SaveSearchDialog({
  locale,
  savedSearches,
  selectedSavedId,
  onClose,
  onSave,
}: {
  locale: Locale;
  savedSearches: readonly SavedSearch[];
  selectedSavedId: string;
  onClose: () => void;
  onSave: (name: string, mode: "new" | "update") => void;
}) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [mode, setMode] = useState<"new" | "update">("new");
  const [targetId, setTargetId] = useState(selectedSavedId || savedSearches[0]?.id || "");
  const selected = savedSearches.find((item) => item.id === targetId);
  const [name, setName] = useState(ar ? "بحث جديد" : "New search");

  useEffect(() => {
    if (mode === "new") setName(ar ? "بحث جديد" : "New search");
    else setName(selected?.name ?? "");
  }, [ar, mode, selected?.name]);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-brand-basalt/60 p-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-md border bg-surface shadow-lg">
        <div className="flex items-center justify-between gap-md px-lg pb-md pt-lg">
          <h3 id={titleId} className="text-title text-fg">{ar ? "حفظ بحث" : "Save a new search"}</h3>
          <button type="button" onClick={onClose} aria-label={ar ? "إغلاق" : "Close"} className="grid h-9 w-9 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><XIcon size={18} /></button>
        </div>

        <div className="grid grid-cols-2 border-b px-lg" role="tablist" aria-label={ar ? "نوع الحفظ" : "Save mode"}>
          <button type="button" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")} className={cn("border-b-2 px-sm py-3 text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", mode === "new" ? "border-info text-info" : "border-transparent text-fg-muted hover:text-fg")}>{ar ? "حفظ كبحث جديد" : "Save as new search"}</button>
          <button type="button" role="tab" aria-selected={mode === "update"} disabled={savedSearches.length === 0} onClick={() => setMode("update")} className={cn("border-b-2 px-sm py-3 text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50", mode === "update" ? "border-info text-info" : "border-transparent text-fg-muted hover:text-fg")}>{ar ? "تحديث بحث محفوظ" : "Update existing search"}</button>
        </div>

        <div className="space-y-lg overflow-y-auto px-lg py-lg">
          {mode === "update" ? (
            <FilterField label={ar ? "البحث المحفوظ" : "Saved search"}>
              <MenuSelect label={ar ? "البحث المحفوظ" : "Saved search"} value={targetId} placeholder={ar ? "اختر بحثًا" : "Select a search"} options={savedSearches.map((item) => ({ value: item.id, label: item.name }))} onChange={setTargetId} />
            </FilterField>
          ) : null}
          <FilterField label={ar ? "الاسم" : "Name"}>
            <Input aria-label={ar ? "الاسم" : "Name"} value={name} onChange={(event) => setName(event.target.value)} />
          </FilterField>
        </div>

        <div className="flex gap-sm border-t px-lg py-md">
          <Button disabled={!name.trim() || (mode === "update" && !targetId)} onClick={() => onSave(name.trim(), mode)}>{ar ? "حفظ البحث" : "Save search"}</Button>
          <Button variant="outline" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
        </div>
      </div>
    </div>
  );
}

function WorkGridCard({ row, locale, onAction }: { row: WorkRow; locale: Locale; onAction: (ar: string, en: string) => void }) {
  const ar = locale === "ar";
  return (
    <li className="rounded-md border bg-surface p-md">
      <div className="flex items-start gap-sm">
        <Image src={row.image} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-sm border object-cover" />
        <div className="min-w-0 flex-1"><p className="font-medium text-fg" dir="auto">{pick(locale, row.title)}</p><p className="mt-1 text-label text-fg-muted">{row.company}</p></div>
        <StatusBadge status={row.status} locale={locale} />
      </div>
      <div className="mt-md grid grid-cols-2 gap-sm border-t pt-md">
        <ContactCell row={row} locale={locale} />
        <div className="text-end"><p className="font-mono text-body font-medium text-fg">{formatMoney(row.value, locale)}</p><p className="mt-1 text-label text-fg-muted">{pick(locale, row.deliveryDate)}</p></div>
      </div>
      <Button size="sm" variant="outline" className="mt-md w-full" onClick={() => onAction("تم فتح العمل التجريبي", "Demo work opened")}>{ar ? "عرض" : "View"}</Button>
    </li>
  );
}

function WorkTableRow({ row, locale, onAction }: { row: WorkRow; locale: Locale; onAction: (ar: string, en: string) => void }) {
  const ar = locale === "ar";
  return (
    <tr className="transition-colors hover:bg-surface-hover">
      <td className="px-sm py-3">
        <div className="flex w-44 items-center gap-sm">
          <Image src={row.image} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-sm border object-cover" />
          <div className="min-w-0"><p className="font-medium text-fg" dir="auto">{pick(locale, row.title)}</p><p className="mt-0.5 text-label text-fg-muted">{pick(locale, row.location)}</p></div>
        </div>
      </td>
      <td className="px-sm py-3 text-center"><CompanyCell row={row} locale={locale} centered /></td>
      <td className="px-sm py-3"><ContactCell row={row} locale={locale} /></td>
      <td className="px-sm py-3 text-center"><StatusBadge status={row.status} locale={locale} /></td>
      <td className="whitespace-nowrap px-sm py-3 text-center font-mono text-body font-medium text-fg">{formatMoney(row.value, locale)}</td>
      <td className="whitespace-nowrap px-sm py-3 text-center"><p className="text-body text-fg">{pick(locale, row.deliveryDate)}</p><p className="mt-0.5 text-label text-success">{pick(locale, row.deliveryHint)}</p></td>
      <td className="whitespace-nowrap px-sm py-3">
        <div className="flex items-center justify-center gap-1.5">
          <Button size="sm" variant="outline" className="w-20 justify-center" onClick={() => onAction(row.reviewAvailable ? "تم فتح التقييم التجريبي" : "تم فتح العمل التجريبي", row.reviewAvailable ? "Demo review opened" : "Demo work opened")}>
            {row.reviewAvailable ? (ar ? "عرض التقييم" : "View review") : (ar ? "عرض" : "View")}
          </Button>
          <button type="button" aria-label={ar ? "المزيد من الإجراءات" : "More actions"} className="grid h-8 w-8 place-items-center rounded-sm border text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><MoreHorizontalIcon size={16} className="rotate-90" /></button>
        </div>
      </td>
    </tr>
  );
}

function WorkMobileRow({ row, locale, onAction }: { row: WorkRow; locale: Locale; onAction: (ar: string, en: string) => void }) {
  const ar = locale === "ar";
  return (
    <li className="p-md">
      <div className="flex gap-sm">
        <Image src={row.image} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-sm border object-cover" />
        <div className="min-w-0 flex-1"><p className="font-medium text-fg" dir="auto">{pick(locale, row.title)}</p><p className="text-label text-fg-muted">{pick(locale, row.location)}</p></div>
        <StatusBadge status={row.status} locale={locale} />
      </div>
      <div className="mt-md grid grid-cols-2 gap-sm border-t pt-sm"><CompanyCell row={row} locale={locale} /><div><p className="font-mono text-body font-medium text-fg">{formatMoney(row.value, locale)}</p><p className="text-label text-fg-muted">{pick(locale, row.deliveryDate)}</p></div><div className="col-span-2"><ContactCell row={row} locale={locale} /></div></div>
      <Button size="sm" variant="outline" className="mt-md w-full" onClick={() => onAction("تم فتح العمل التجريبي", "Demo work opened")}>{ar ? "عرض" : "View"}</Button>
    </li>
  );
}

function CompanyCell({ row, locale, centered = false }: { row: WorkRow; locale: Locale; centered?: boolean }) {
  return (
    <div className={cn("flex w-24 items-center gap-sm", centered && "justify-center")}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-label font-semibold text-fg">{row.companyInitials}</span>
      <div><p className="text-body font-medium text-fg" dir="auto">{row.company}</p>{row.rating ? <p className="mt-0.5 flex items-center gap-1 text-label text-fg-muted"><StarIcon size={12} className="text-warning" />{formatNumber(row.rating, locale)}</p> : null}</div>
    </div>
  );
}

function ContactCell({ row, locale }: { row: WorkRow; locale: Locale }) {
  const ar = locale === "ar";
  const [revealed, setRevealed] = useState<"phone" | "email" | null>(null);
  return (
    <div className="w-32 space-y-1 text-start">
      <button
        type="button"
        aria-expanded={revealed === "phone"}
        aria-label={ar ? "إظهار رقم الهاتف كاملًا" : "Show full phone number"}
        onClick={() => setRevealed((value) => value === "phone" ? null : "phone")}
        className="flex w-full items-center gap-1.5 whitespace-nowrap rounded-xs text-label text-fg hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        dir="ltr"
      >
        <PhoneIcon size={13} className="text-fg-muted" />
        {revealed === "phone" ? row.contact.fullPhone : row.contact.phone}
      </button>
      <button
        type="button"
        disabled={!row.contact.email}
        aria-expanded={revealed === "email"}
        aria-label={ar ? "إظهار البريد الإلكتروني كاملًا" : "Show full email address"}
        onClick={() => setRevealed((value) => value === "email" ? null : "email")}
        className="flex w-full items-center gap-1.5 rounded-xs text-label text-fg-secondary hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:hover:text-fg-secondary"
        dir="ltr"
      >
        <MailIcon size={13} className="text-fg-muted" />
        <span className={cn("min-w-0", revealed === "email" ? "break-all text-start" : "truncate")}>{row.contact.email ?? (ar ? "غير متاح" : "Not available")}</span>
      </button>
    </div>
  );
}

function StatusBadge({ status, locale }: { status: WorkStatus; locale: Locale }) {
  const labels: Record<WorkStatus, { ar: string; en: string }> = {
    accepted: { ar: "مقبول", en: "Accepted" },
    in_progress: { ar: "في التنفيذ", en: "In progress" },
    paused: { ar: "معلّق", en: "Paused" },
    review: { ar: "في المراجعة", en: "In review" },
    completed: { ar: "مكتمل", en: "Completed" },
    cancelled: { ar: "ملغي / مرفوض", en: "Cancelled / rejected" },
    archived: { ar: "مؤرشف", en: "Archived" },
  };
  const tone = status === "in_progress" ? "success" : status === "accepted" ? "info" : status === "review" || status === "paused" ? "warning" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{pick(locale, labels[status])}</Badge>;
}

function InformationRail({ locale, onAction }: { locale: Locale; onAction: (ar: string, en: string) => void }) {
  const ar = locale === "ar";
  return (
    <aside dir={locale === "ar" ? "rtl" : "ltr"} aria-label={ar ? "معلومات الشغل" : "Work information"} className="grid gap-md tablet:grid-cols-2 desktop:h-full desktop:grid-cols-1">
      <RailCard title={ar ? "المستندات والملفات" : "Documents and files"} icon={<FileTextIcon size={19} />}>
        {DOCUMENT_ROWS.map((row) => <RailRow key={row.label.en} label={pick(locale, row.label)} value={formatNumber(row.count, locale)} />)}
        <RailAction onClick={() => onAction("تم فتح إدارة الملفات التجريبية", "Demo file manager opened")}>{ar ? "إدارة الملفات" : "Manage files"}</RailAction>
      </RailCard>

      <RailCard title={ar ? "أدوات سريعة" : "Quick tools"} icon={<ReceiptIcon size={19} />}>
        <QuickAction icon={<UploadIcon size={17} />} label={ar ? "رفع صور للعمل الحالي" : "Upload current-work photos"} onClick={() => onAction("تم فتح رفع الصور التجريبي", "Demo photo upload opened")} />
        <QuickAction icon={<PackageIcon size={17} />} label={ar ? "طلب مواد من المعرض" : "Request materials from showroom"} onClick={() => onAction("تم فتح طلب المواد التجريبي", "Demo material request opened")} />
        <QuickAction icon={<MessageIcon size={17} />} label={ar ? "مراسلة المعرض" : "Message the showroom"} onClick={() => onAction("تم فتح المحادثة التجريبية", "Demo conversation opened")} />
        <QuickAction icon={<CalendarIcon size={17} />} label={ar ? "طلب تمديد موعد" : "Request deadline extension"} onClick={() => onAction("تم فتح طلب التمديد التجريبي", "Demo extension request opened")} />
      </RailCard>
    </aside>
  );
}

function RailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border bg-surface shadow-card">
      <h2 className="flex items-center gap-2 border-b px-md py-3 text-body-lg font-semibold text-fg"><span className="text-accent">{icon}</span>{title}</h2>
      <div className="divide-y divide-strong">{children}</div>
    </section>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-sm px-md py-2.5"><span className="text-body text-fg-secondary">{label}</span><span className="rounded-pill bg-surface-2 px-2 py-0.5 text-label font-semibold tabular-nums text-fg">{value}</span></div>;
}

function RailAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-full px-md py-3 text-start text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{children}</button>;
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-sm px-md py-3 text-start text-body font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"><span className="text-accent">{icon}</span><span>{label}</span></button>;
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number, locale: Locale) {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 0 }).format(value);
  return locale === "ar" ? `${amount} جنيه` : `EGP ${amount}`;
}
