"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button, ButtonLink, Input } from "@/components/ui/controls";
import { DateRangeFilter, type WorkDateRange } from "@/components/ui/date-range-filter";
import {
  BookmarkIcon,
  ChevronDownIcon,
  DownloadIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  MailIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "@/components/ui/icons";
import { Badge, Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { useDialogFocus } from "@/lib/ui/use-dialog-focus";
import { overlapsPlannedWindow } from "@/lib/work/planned-window";
import { formatEgp } from "@/lib/ui/egp-format";
import { TradeIllustration } from "@/features/installer-dashboard-preview/trade-illustration";
import { FloatingMenu } from "@/components/ui/floating-menu";
import {
  rowMatchesTab,
  type ActiveWorkVM,
  type SavedSearchStore,
  type SavedWorkSearch,
  type WorkRemote,
  type WorkSearchState,
  type WorkPreviewFeatures,
  type WorkRowVM,
  type WorkSort,
  type WorkTabVM,
} from "./view-model";

const WORK_PAGE_SIZE = 6;
/** "email" / "phone-only" are the preview's demo split; "available" / "none" are the real contact states. */
type ContactFilter = "all" | "email" | "phone-only" | "available" | "none";
type WorkView = "list" | "grid";

const SORT_LABELS: Record<WorkSort, { ar: string; en: string }> = {
  default: { ar: "الترتيب: الافتراضي", en: "Sort: Default" },
  "last-added": { ar: "آخر ما تمت إضافته", en: "Last added" },
  "recent-added": { ar: "المضاف حديثًا", en: "Recently added" },
  "last-action": { ar: "آخر نشاط", en: "Last action" },
  "oldest-first": { ar: "الأقدم إلى الأحدث", en: "Oldest to newest" },
};

/**
 * THE SHARED MY WORK PAGE BODY — the approved presentation, and the only one.
 *
 * CONTENT ONLY: no sidebar, no topbar, no `<main>`. The preview wraps it in its
 * own shell; production gets the shell from `app/home/layout.tsx`.
 *
 * It runs in one of two modes. LOCAL (the preview): `activeTab` / `onTabChange` are
 * controlled and everything else — search, company, planned-period range, ordering,
 * paging — is a view over the fixture rows in hand. SERVER-DRIVEN (production, `remote`):
 * the rows are already the requested range of the filtered set, the total is exact, and
 * every control reports a new state back to the route (the URL).
 *
 * `features` is the whole difference between the preview and production. When it
 * is present the preview-only features it names are drawn (the contact column,
 * saved searches, export, the client rating and the demo "more actions" button);
 * production never passes it, so none of them exist there.
 *
 * DATE RANGE = THE PLANNED WORK WINDOW (`starts_on` -> `ends_by`), see
 * `lib/work/planned-window.ts`.
 */
export function InstallerMyWorkView({
  activeWork,
  rows,
  tabs,
  activeTab,
  defaultTab,
  onTabChange,
  rail,
  sortOptions,
  features,
  subtitle,
  headerAction,
  onRowAction,
  onActiveAction,
  dateInitialMonth,
  datePlaceholder,
  savedStore,
  contactMode,
  resultsTitle,
  remote,
}: {
  /** The featured current assignment, or null (a designed empty state is drawn). */
  activeWork: ActiveWorkVM | null;
  /** Local mode: EVERY row (the tab, search, company and date filters run here). Server-driven mode: the requested range. */
  rows: readonly WorkRowVM[];
  tabs: readonly WorkTabVM[];
  activeTab: string;
  /** The tab shown when nothing is selected. */
  defaultTab: string;
  onTabChange: (key: string) => void;
  /** The right-hand column: the preview's fixture cards, or production's real summary. */
  rail: ReactNode;
  sortOptions: readonly WorkSort[];
  features?: WorkPreviewFeatures;
  subtitle?: string;
  /** Production: a "Browse jobs" link. The preview passes its own export button via `features`. */
  headerAction?: ReactNode;
  /** The preview's demo notice for a row action with no `href`. */
  onRowAction?: (row: WorkRowVM) => void;
  onActiveAction?: (kind: "details" | "update") => void;
  dateInitialMonth?: string;
  datePlaceholder?: string;
  /** Production: persisted saved searches. Without it, `features.savedSearches` keeps the preview's local demo list. */
  savedStore?: SavedSearchStore;
  /** "real": the contact column and filter are drawn from real data (production). */
  contactMode?: "real";
  /** The results card's heading; defaults to "All your work". */
  resultsTitle?: string;
  /** Production: the route owns filtering, ordering, counting and paging — see `WorkRemote`. */
  remote?: WorkRemote;
}) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";

  return (
    <div className="flex flex-1 flex-col gap-md">
      <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="space-y-md">
          <h1 className="text-headline text-fg">{ar ? "شغلي" : "My work"}</h1>
          <p className="max-w-2xl text-body text-fg-secondary">
            {subtitle ?? (ar ? "تابع جميع أعمالك الحالية والسابقة في مكان واحد" : "Track all your current and previous work in one place.")}
          </p>
        </div>
        {features?.exportReport ? (
          <Button variant="outline" className="gap-2 self-start tablet:self-auto" onClick={() => window.print()}>
            <DownloadIcon size={17} />
            {ar ? "تصدير التقرير" : "Export report"}
          </Button>
        ) : (
          headerAction
        )}
      </header>

      {activeWork ? (
        <ActiveWorkPanel work={activeWork} locale={locale} onAction={onActiveAction} />
      ) : (
        <Card pad="sm">
          <div className="flex flex-col items-start gap-sm px-xs py-xs tablet:flex-row tablet:items-center tablet:justify-between">
            <div>
              <h2 className="text-title text-fg">{ar ? "لا يوجد شغل جارٍ حاليًا" : "No current work"}</h2>
              <p className="mt-1 text-body text-fg-secondary">
                {ar ? "عندما يُسند إليك عمل أو تبدأ تنفيذه سيظهر هنا." : "Work that is assigned to you, or that you have started, appears here."}
              </p>
            </div>
            <ButtonLink href="/home/jobs" variant="outline" size="sm">{ar ? "تصفّح فرص الشغل" : "Browse job opportunities"}</ButtonLink>
          </div>
        </Card>
      )}

      <div dir="ltr" className={cn("grid items-start gap-md desktop:grid-cols-[minmax(0,1fr)_18rem]", features && "desktop:items-stretch")}>
        {/* Preview: the column is as tall as its fixture rail. Production: the RESULTS are the scrolling region, capped at one screen and scrolling inside the card, so the header, filters and the natural-height summary rail stay in view instead of the whole page growing with every row. Phones keep ordinary page scroll. */}
        <div
          dir={dir}
          className={cn(
            "min-w-0 desktop:flex desktop:min-h-0 desktop:flex-col",
            features
              ? "desktop:h-full desktop:overflow-hidden desktop:[contain:size]"
              : "desktop:max-h-[min(48rem,calc(100dvh-7rem))]",
          )}
        >
          <WorkHistory
            rows={rows}
            locale={locale}
            tabs={tabs}
            activeTab={activeTab}
            defaultTab={defaultTab}
            onTabChange={onTabChange}
            sortOptions={sortOptions}
            features={features}
            onRowAction={onRowAction}
            dateInitialMonth={dateInitialMonth}
            datePlaceholder={datePlaceholder}
            savedStore={savedStore}
            contactMode={contactMode}
            resultsTitle={resultsTitle}
            remote={remote}
          />
        </div>

        {rail}
      </div>
    </div>
  );
}

function ActionLink({ action, onClick, className, children, variant = "outline" }: { action: { label: string; href: string | null }; onClick?: () => void; className?: string; children?: ReactNode; variant?: "outline" | "primary" }) {
  if (action.href) {
    return (
      <ButtonLink href={action.href} variant={variant} size="sm" className={className}>
        {children ?? action.label}
      </ButtonLink>
    );
  }
  return (
    <Button size="sm" variant={variant} className={className} onClick={onClick}>
      {children ?? action.label}
    </Button>
  );
}

function ActiveWorkPanel({ work, locale, onAction }: { work: ActiveWorkVM; locale: Locale; onAction?: (kind: "details" | "update") => void }) {
  const ar = locale === "ar";
  const progress = work.progress;
  return (
    <Card pad="sm" className="overflow-hidden">
      <section aria-labelledby="active-work-title" className="grid gap-lg desktop:grid-cols-5">
        <div className="grid min-w-0 gap-md tablet:grid-cols-5 desktop:col-span-3">
          <div className="relative min-h-48 overflow-hidden rounded-sm border bg-gradient-to-br from-surface-2 to-canvas tablet:col-span-2">
            {work.image ? (
              <Image src={work.image} alt="" fill sizes="(min-width: 1024px) 24vw, (min-width: 768px) 38vw, 100vw" className="object-cover" priority />
            ) : (
              <TradeIllustration tradeKey={work.tradeKey} className="absolute inset-y-4 start-1/2 h-[calc(100%-2rem)] w-auto max-w-[80%] -translate-x-1/2 rtl:translate-x-1/2" />
            )}
            <span className="absolute start-sm top-sm flex items-center gap-1 rounded-pill bg-success px-2.5 py-1 text-label font-semibold text-white shadow-sm">
              {work.badgeLabel}
            </span>
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-md tablet:col-span-3">
            <div>
              <h2 id="active-work-title" dir="auto" className="text-title text-fg">{work.title}</h2>
              {work.company ? <p className="mt-1 text-body font-medium text-fg-secondary"><bdi dir="auto">{work.company}</bdi></p> : null}
              {work.location ? <p className="mt-2 flex items-center gap-1.5 text-label text-fg-muted"><MapPinIcon size={14} /><bdi dir="auto">{work.location}</bdi></p> : null}
            </div>
            <dl className="grid grid-cols-2 gap-md border-t pt-md">
              {work.details.map((detail) => <Detail key={detail.label} label={detail.label} value={detail.value} />)}
            </dl>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-md border-t pt-md desktop:col-span-2 desktop:border-s desktop:border-t-0 desktop:ps-lg desktop:pt-0">
          <div className="flex items-end justify-between gap-md">
            <span className="text-body font-semibold text-fg">{ar ? "التقدم في العمل" : "Work progress"}</span>
            {progress !== null ? <strong className="font-mono text-headline text-fg">{formatNumber(progress, locale)}%</strong> : <span className="text-label text-fg-muted">{work.progressEmptyLabel}</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? 0}>
            <div className="h-full rounded-pill bg-success transition-[width] duration-normal" style={{ width: `${progress ?? 0}%` }} />
          </div>
          {work.lastUpdate ? <p className="text-label text-fg-muted">{work.lastUpdate}</p> : null}
          {work.currentStage || work.nextStage ? (
            <dl className="grid grid-cols-2 gap-md border-t pt-md">
              {work.currentStage ? <Detail label={ar ? "المرحلة الحالية" : "Current stage"} value={work.currentStage} tone="success" /> : null}
              {work.nextStage ? <Detail label={ar ? "المرحلة التالية" : "Next stage"} value={work.nextStage} /> : null}
            </dl>
          ) : null}
          <div className={cn("mt-auto grid gap-sm", work.updateAction ? "grid-cols-2" : "grid-cols-1")}>
            <ActionLink action={work.detailsAction} onClick={() => onAction?.("details")} />
            {work.updateAction ? (
              <ActionLink action={work.updateAction} variant="primary" onClick={() => onAction?.("update")} />
            ) : null}
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
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  // Opening puts focus on the chosen option, so the keyboard continues from where the value is.
  useEffect(() => {
    if (!open) return;
    const list = document.getElementById(listId);
    (list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open, listId]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={trigger}
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

      <FloatingMenu id={listId} open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="listbox" aria-label={label} placement="bottom-start" matchAnchorWidth className="max-h-64 p-xs">
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
      </FloatingMenu>
    </div>
  );
}


function WorkHistory({
  rows,
  locale,
  tabs,
  activeTab,
  defaultTab,
  onTabChange,
  sortOptions,
  features,
  onRowAction,
  dateInitialMonth,
  datePlaceholder,
  savedStore,
  contactMode,
  resultsTitle,
  remote,
}: {
  rows: readonly WorkRowVM[];
  locale: Locale;
  tabs: readonly WorkTabVM[];
  activeTab: string;
  defaultTab: string;
  onTabChange: (tab: string) => void;
  sortOptions: readonly WorkSort[];
  features?: WorkPreviewFeatures;
  onRowAction?: (row: WorkRowVM) => void;
  dateInitialMonth?: string;
  datePlaceholder?: string;
  savedStore?: SavedSearchStore;
  contactMode?: "real";
  resultsTitle?: string;
  remote?: WorkRemote;
}) {
  const ar = locale === "ar";
  const [visibleCount, setVisibleCount] = useState(WORK_PAGE_SIZE);
  // LOCAL state: what the preview filters its fixtures by. Server-driven mode ignores it and reads `remote.state`.
  const [localQuery, setLocalQuery] = useState("");
  const [localSort, setLocalSort] = useState<WorkSort>("default");
  const [localContact, setLocalContact] = useState<ContactFilter>("all");
  const [localCompany, setLocalCompany] = useState("all");
  const [localRange, setLocalRange] = useState<WorkDateRange>({ from: "", to: "" });
  // Server-driven search: the box answers every keystroke at once, the URL follows once typing pauses.
  const [draftQuery, setDraftQuery] = useState(remote?.state.q ?? "");
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const pushedQuery = useRef(remote?.state.q ?? "");
  const remoteQuery = remote?.state.q;
  useEffect(() => {
    if (remoteQuery === undefined) return;
    if (draftQuery.trim() === remoteQuery) return;
    const id = window.setTimeout(() => {
      const current = remoteRef.current;
      if (!current) return;
      pushedQuery.current = draftQuery.trim();
      current.onStateChange({ ...current.state, q: draftQuery.trim() });
    }, 350);
    return () => window.clearTimeout(id);
  }, [draftQuery, remoteQuery]);
  useEffect(() => {
    // A change that did not come from this box (a saved search, "New search") replaces what it shows.
    if (remoteQuery !== undefined && remoteQuery !== pushedQuery.current) {
      pushedQuery.current = remoteQuery;
      setDraftQuery(remoteQuery);
    }
  }, [remoteQuery]);

  const query = remote ? draftQuery : localQuery;
  const sort = remote ? (remote.state.sort as WorkSort) : localSort;
  const contactFilter = (remote ? remote.state.contact : localContact) as ContactFilter;
  const companyFilter = remote ? remote.state.company || "all" : localCompany;
  const remoteFrom = remote?.state.from;
  const remoteTo = remote?.state.to;
  const dateRange = useMemo<WorkDateRange>(
    () => (remoteFrom !== undefined ? { from: remoteFrom, to: remoteTo ?? "" } : localRange),
    [remoteFrom, remoteTo, localRange],
  );
  /** One way to change a filter, whichever mode: the route is told, or the local state moves. Either way paging starts again. */
  const patch = (next: Partial<WorkSearchState>) => {
    if (remote) {
      remote.onStateChange({ ...remote.state, ...next });
      return;
    }
    if (next.q !== undefined) setLocalQuery(next.q);
    if (next.sort !== undefined) setLocalSort(next.sort as WorkSort);
    if (next.contact !== undefined) setLocalContact(next.contact as ContactFilter);
    if (next.company !== undefined) setLocalCompany(next.company || "all");
    if (next.from !== undefined || next.to !== undefined) setLocalRange({ from: next.from ?? localRange.from, to: next.to ?? localRange.to });
    if (next.tab !== undefined) onTabChange(next.tab);
    setVisibleCount(WORK_PAGE_SIZE);
  };
  // GRID is the default view wherever a page offers both; the choice lasts for this visit only.
  const [view, setView] = useState<WorkView>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  // The preview's in-memory list (it has no backend). Production passes `savedStore`.
  const [localSaved, setLocalSaved] = useState<SavedWorkSearch[]>([
    {
      id: "in-progress",
      name: ar ? "أعمال قيد التنفيذ" : "Work in progress",
      state: { tab: "in_progress", q: "", company: "", from: "", to: "", contact: "all", sort: "default" },
    },
  ]);
  const savedSearches: readonly SavedWorkSearch[] = savedStore ? savedStore.items : localSaved;
  const savedEnabled = Boolean(features?.savedSearches) || Boolean(savedStore);
  const realContact = contactMode === "real";
  const contactEnabled = Boolean(features?.contact) || realContact;
  const companies = useMemo(
    () => (remote ? [...remote.companies] : Array.from(new Set(rows.map((row) => row.company).filter((c): c is string => Boolean(c))))),
    [remote, rows],
  );
  const currentTab = tabs.find((tab) => tab.key === activeTab);
  const filteredRows = useMemo(() => {
    // Server-driven: the rows ARE the requested range of the filtered, ordered set.
    if (remote) return rows;
    const collator = locale === "ar" ? "ar-EG" : "en-EG";
    const normalizedQuery = query.trim().toLocaleLowerCase(collator);
    const matchingRows = rows.filter((row) => {
      if (!rowMatchesTab(row, currentTab)) return false;
      const searchable = [row.title, row.location ?? "", row.company ?? "", row.contact?.phone ?? "", row.contact?.email ?? ""]
        .join(" ")
        .toLocaleLowerCase(collator);
      const matchesQuery = normalizedQuery.length === 0 || searchable.includes(normalizedQuery);
      const matchesContact = contactFilter === "all"
        || (contactFilter === "email" && Boolean(row.contact?.email))
        || (contactFilter === "phone-only" && !row.contact?.email)
        || (contactFilter === "available" && Boolean(row.contact))
        || (contactFilter === "none" && !row.contact);
      const matchesCompany = companyFilter === "all" || row.company === companyFilter;
      const matchesDateRange = overlapsPlannedWindow({ startsOn: row.startsOn, endsBy: row.endsBy }, dateRange);
      return matchesQuery && matchesContact && matchesCompany && matchesDateRange;
    });

    const byDesc = (key: "createdAtMs" | "lastActionMs") => (a: WorkRowVM, b: WorkRowVM) =>
      (b[key] ?? Number.NEGATIVE_INFINITY) - (a[key] ?? Number.NEGATIVE_INFINITY);
    if (sort === "last-added" || sort === "oldest-first") {
      return [...matchingRows].sort((a, b) => (a.createdAtMs ?? Number.POSITIVE_INFINITY) - (b.createdAtMs ?? Number.POSITIVE_INFINITY));
    }
    if (sort === "recent-added") return [...matchingRows].sort(byDesc("createdAtMs"));
    if (sort === "last-action") return [...matchingRows].sort(byDesc("lastActionMs"));
    return matchingRows;
  }, [companyFilter, contactFilter, currentTab, dateRange, locale, query, remote, rows, sort]);
  const total = remote ? remote.total : filteredRows.length;
  const paginatedRows = remote ? filteredRows : filteredRows.slice(0, visibleCount);
  const hasMore = remote ? remote.hasMore : visibleCount < filteredRows.length;
  const canShowFewer = remote ? remote.canShowFewer : visibleCount > WORK_PAGE_SIZE;
  const activeDrawerFilters = Number(activeTab !== defaultTab) + Number(contactFilter !== "all") + Number(companyFilter !== "all");

  const resetSearch = () => {
    setSelectedSavedId("");
    if (remote) {
      remote.onStateChange({ tab: defaultTab, q: "", company: "", from: "", to: "", contact: "all", sort: "default" });
      return;
    }
    setLocalQuery("");
    setLocalSort("default");
    setLocalContact("all");
    setLocalCompany("all");
    setLocalRange({ from: "", to: "" });
    setVisibleCount(WORK_PAGE_SIZE);
    onTabChange(defaultTab);
  };

  /** The CURRENT, meaningful filter state — never a drawer's open/closed flag. */
  const currentState = (): WorkSearchState => ({
    tab: activeTab,
    q: query.trim(),
    company: companyFilter === "all" ? "" : companyFilter,
    from: dateRange.from,
    to: dateRange.to,
    contact: contactFilter,
    sort,
  });

  const applySavedSearch = (id: string) => {
    setSelectedSavedId(id);
    const saved = savedSearches.find((item) => item.id === id);
    if (!saved) return;
    const state = saved.state;
    // A stored value this page no longer offers falls back to its default rather than being trusted.
    const next: WorkSearchState = {
      tab: tabs.some((tab) => tab.key === state.tab) ? state.tab : defaultTab,
      q: state.q,
      company: state.company && (remote || companies.includes(state.company)) ? state.company : "",
      from: state.from,
      to: state.to,
      contact: (["all", "email", "phone-only", "available", "none"] as const).includes(state.contact as ContactFilter) ? state.contact : "all",
      sort: sortOptions.includes(state.sort as WorkSort) ? state.sort : "default",
    };
    if (remote) {
      remote.onStateChange(next);
      return;
    }
    patch(next);
  };

  /** Returns an error message to show in the dialog, or null once saved. */
  const saveSearch = async (name: string, mode: "new" | "update", targetId: string): Promise<string | null> => {
    const state = currentState();
    const id = mode === "update" ? targetId : null;
    if (savedStore) {
      const result = await savedStore.save({ mode, id, name, state });
      if (!result.ok) return result.message;
      setSelectedSavedId(result.id);
    } else {
      const next: SavedWorkSearch = { id: id ?? `saved-${Date.now()}`, name, state };
      setLocalSaved((current) => (id ? current.map((item) => (item.id === id ? next : item)) : [...current, next]));
      setSelectedSavedId(next.id);
    }
    setSaveDialogOpen(false);
    return null;
  };

  const deleteSavedSearch = (id: string) => {
    if (savedStore) void savedStore.remove(id);
    else setLocalSaved((current) => current.filter((item) => item.id !== id));
    if (selectedSavedId === id) setSelectedSavedId("");
  };

  const act = (row: WorkRowVM) => onRowAction?.(row);

  return (
    <section
      aria-labelledby="all-work-title"
      aria-busy={remote?.pending ? true : undefined}
      className={cn(
        "overflow-hidden rounded-md border bg-surface shadow-card transition-opacity desktop:flex desktop:min-h-0 desktop:flex-1 desktop:flex-col",
        remote?.pending && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-md border-b px-md py-3">
        <h2 id="all-work-title" className="text-body-lg font-semibold text-fg">{resultsTitle ?? (ar ? "جميع أعمالك" : "All your work")}</h2>
        <span className="shrink-0 text-label text-fg-muted">{formatNumber(total, locale)} {ar ? "أعمال" : "items"}</span>
      </div>

      <div className="shrink-0 border-b bg-surface max-tablet:flex max-tablet:flex-wrap max-tablet:items-center max-tablet:gap-sm max-tablet:px-md max-tablet:py-sm">
        {/* Phones flatten the three desktop rows into one wrapping row (display: contents) so the same controls re-compose with CSS only: search + filter button, then date + sort, then the count. Saved-search and view controls are desktop-only here and live in the filters sheet on phones. */}
        <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm max-tablet:contents">
          <div className="flex min-w-0 items-center gap-sm max-tablet:hidden">
            <button type="button" onClick={resetSearch} className="text-label font-semibold text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {ar ? "بحث جديد" : "New search"}
            </button>
            {savedEnabled ? (
              <>
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
              </>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-nowrap items-center gap-sm overflow-x-auto max-tablet:contents">
            <Button size="sm" variant="outline" className="relative gap-1.5 max-tablet:order-2 max-tablet:h-11 max-tablet:w-11 max-tablet:shrink-0 max-tablet:gap-0 max-tablet:px-0" aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <FilterIcon size={15} className="max-tablet:h-[18px] max-tablet:w-[18px]" />
              <span className="max-tablet:sr-only">{ar ? "كل الفلاتر" : "All filters"}</span>
              {activeDrawerFilters > 0 ? <span className="rounded-pill bg-surface-2 px-1.5 tabular-nums text-fg max-tablet:absolute max-tablet:-end-1 max-tablet:-top-1 max-tablet:grid max-tablet:h-5 max-tablet:min-w-5 max-tablet:place-items-center max-tablet:bg-accent-solid max-tablet:px-1 max-tablet:text-caption max-tablet:font-bold max-tablet:text-on-accent">{formatNumber(activeDrawerFilters, locale)}</span> : null}
            </Button>
            {savedEnabled ? (
              <Button size="sm" variant="outline" className="gap-1.5 max-tablet:hidden" onClick={() => setSaveDialogOpen(true)}>
                <BookmarkIcon size={15} />
                {ar ? "حفظ البحث" : "Save search"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm border-b px-md py-sm max-tablet:contents">
          <div className="flex flex-wrap items-center gap-sm max-tablet:order-3 max-tablet:grid max-tablet:w-full max-tablet:grid-cols-2 max-tablet:[&>*]:min-w-0">
            <DateRangeFilter
              compact
              locale={locale}
              value={dateRange}
              initialMonth={dateInitialMonth}
              placeholder={datePlaceholder}
              onChange={(next) => patch({ from: next.from, to: next.to })}
            />
            <MenuSelect
              compact
              className="w-full tablet:w-56 tablet:shrink-0"
              label={ar ? "الترتيب" : "Sort"}
              value={sort}
              placeholder={ar ? "اختر الترتيب" : "Select sort"}
              options={sortOptions.map((value) => ({ value, label: ar ? SORT_LABELS[value].ar : SORT_LABELS[value].en }))}
              onChange={(next) => patch({ sort: next })}
            />
          </div>

          <div className="flex items-center gap-xs max-tablet:hidden" aria-label={ar ? "طريقة العرض" : "View mode"}>
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-sm px-sm text-label font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "grid" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
              <GridIcon size={15} />{ar ? "عرض الشبكة" : "Grid view"}
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-sm px-sm text-label font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", view === "list" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
              <ListIcon size={15} />{ar ? "عرض القائمة" : "List view"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-md px-md py-sm max-tablet:contents">
          <div className="relative min-w-52 flex-1 max-tablet:order-1 max-tablet:min-w-0">
            <SearchIcon size={15} className="pointer-events-none absolute start-sm top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input type="search" aria-label={ar ? "البحث في الأعمال" : "Search work"} value={query} onChange={(event) => { if (remote) setDraftQuery(event.target.value); else patch({ q: event.target.value }); }} placeholder={ar ? "ابحث في جميع أعمالك" : "Search all work"} className="min-h-9 py-1.5 pe-sm ps-8 text-label max-tablet:min-h-11" />
          </div>
          <span className="shrink-0 text-label text-fg-muted max-tablet:order-4 max-tablet:w-full" aria-live="polite">
            {ar ? `عرض ${formatNumber(paginatedRows.length, locale)} من ${formatNumber(total, locale)} نتيجة` : `Showing ${formatNumber(paginatedRows.length, locale)} of ${formatNumber(total, locale)} results`}
            {remote?.loadError ? <span role="alert" className="block text-caption font-medium text-danger">{ar ? "تعذّر تحميل المزيد. حاول مرة أخرى." : "Could not load more. Please try again."}</span> : null}
          </span>
        </div>
      </div>
      {total === 0 ? (
        <div className="px-md py-xl text-center">
          <p className="text-body-lg font-medium text-fg">{ar ? "لا توجد أعمال في هذه الحالة" : "No work in this status"}</p>
          <p className="mt-1 text-body text-fg-muted">{ar ? "اختر حالة أخرى لمراجعة باقي أعمالك." : "Choose another status to review the rest of your work."}</p>
        </div>
      ) : (
        <>
          <div className={cn("relative hidden overflow-x-auto tablet:block desktop:min-h-0 desktop:flex-1 desktop:overflow-y-auto desktop:overscroll-contain", view === "grid" && "tablet:hidden")}>
            <table className="w-full border-collapse text-start">
              <thead className="bg-surface-2 text-label text-fg-secondary">
                <tr>
                  <th className="px-sm py-2.5 text-start font-medium">{ar ? "العمل" : "Work"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "المعرض / العميل" : "Company / client"}</th>
                  {contactEnabled ? <th className="px-sm py-2.5 text-center font-medium">{ar ? "التواصل" : "Contact"}</th> : null}
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "الحالة" : "Status"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "القيمة" : "Value"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "تاريخ التسليم" : "Delivery"}</th>
                  <th className="px-sm py-2.5 text-center font-medium">{ar ? "إجراء سريع" : "Quick action"}</th>
                </tr>
              </thead>
              <tbody id="work-history-results" className="divide-y divide-strong">
                {paginatedRows.map((row) => <WorkTableRow key={row.id} row={row} locale={locale} features={features} showContact={contactEnabled} onAction={act} />)}
              </tbody>
            </table>
          </div>

          <ul id="work-history-results-mobile" className={cn("divide-y divide-strong tablet:hidden", view === "grid" && "hidden")}>
            {paginatedRows.map((row) => <WorkMobileRow key={row.id} row={row} locale={locale} features={features} showContact={contactEnabled} onAction={act} />)}
          </ul>
          {view === "grid" ? (
            <ul id="work-history-results-grid" className="grid min-h-0 flex-1 grid-cols-1 gap-sm overflow-y-auto p-md tablet:grid-cols-2">
              {paginatedRows.map((row) => <WorkGridCard key={row.id} row={row} locale={locale} features={features} showContact={contactEnabled} onAction={act} />)}
            </ul>
          ) : null}
        </>
      )}

      {total > 0 ? (
        <div className="flex w-full shrink-0 border-t">
          <button
            type="button"
            aria-controls="work-history-results work-history-results-mobile work-history-results-grid"
            disabled={!hasMore}
            onClick={() => (remote ? remote.onShowMore() : setVisibleCount((count) => Math.min(count + WORK_PAGE_SIZE, filteredRows.length)))}
            className="min-w-0 flex-1 px-md py-3 text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:cursor-default disabled:text-fg-muted disabled:hover:bg-transparent"
          >
            {hasMore ? (ar ? "عرض المزيد" : "Show more") : (ar ? "تم عرض كل الأعمال" : "All work shown")}
          </button>
          {canShowFewer ? (
            <button
              type="button"
              aria-controls="work-history-results work-history-results-mobile work-history-results-grid"
              onClick={() => (remote ? remote.onShowFewer() : setVisibleCount((count) => Math.max(WORK_PAGE_SIZE, Math.min(count, filteredRows.length) - WORK_PAGE_SIZE)))}
              className="min-w-0 flex-1 border-s px-md py-3 text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              {ar ? "عرض أقل" : "Show less"}
            </button>
          ) : null}
        </div>
      ) : null}

      {filtersOpen ? (
        <WorkFiltersDrawer
          locale={locale}
          phoneExtras={savedEnabled ? (
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
          ) : undefined}
          tabs={tabs}
          defaultTab={defaultTab}
          activeTab={activeTab}
          showContact={contactEnabled}
          contactMode={realContact ? "real" : "preview"}
          contactFilter={contactFilter}
          companyFilter={companyFilter}
          companies={companies}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            patch({ tab: next.activeTab, contact: next.contactFilter, company: next.companyFilter === "all" ? "" : next.companyFilter });
            setFiltersOpen(false);
          }}
        />
      ) : null}
      {savedEnabled && saveDialogOpen ? (
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

function WorkFiltersDrawer({
  locale,
  tabs,
  defaultTab,
  activeTab,
  showContact,
  contactMode,
  contactFilter,
  companyFilter,
  companies,
  phoneExtras,
  onClose,
  onApply,
}: {
  locale: Locale;
  tabs: readonly WorkTabVM[];
  defaultTab: string;
  activeTab: string;
  showContact: boolean;
  contactMode: "real" | "preview";
  contactFilter: ContactFilter;
  companyFilter: string;
  companies: readonly string[];
  /** Phone only: the saved-search controls that are not worth permanent toolbar space. */
  phoneExtras?: React.ReactNode;
  onClose: () => void;
  onApply: (filters: { activeTab: string; contactFilter: ContactFilter; companyFilter: string }) => void;
}) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [draftStatus, setDraftStatus] = useState(activeTab === defaultTab ? "" : activeTab);
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
            <MenuSelect label={ar ? "الحالة" : "Status"} value={draftStatus} placeholder={ar ? "اختر" : "Select"} options={tabs.filter((tab) => tab.key !== defaultTab && tab.inFilter !== false).map((tab) => ({ value: tab.key, label: tab.label }))} onChange={setDraftStatus} />
          </FilterField>
          {showContact ? (
            <FilterField label={ar ? "بيانات التواصل" : "Contact details"}>
              {contactMode === "real" ? (
                <MenuSelect
                  label={ar ? "بيانات التواصل" : "Contact details"}
                  value={draftContact}
                  placeholder={ar ? "كل حالات التواصل" : "All contact states"}
                  options={[
                    { value: "all", label: ar ? "كل حالات التواصل" : "All contact states" },
                    { value: "available", label: ar ? "التواصل متاح" : "Contact available" },
                    { value: "none", label: ar ? "لا توجد بيانات تواصل" : "No contact data" },
                  ]}
                  onChange={(next) => setDraftContact(next as ContactFilter)}
                />
              ) : (
                <MenuSelect label={ar ? "بيانات التواصل" : "Contact details"} value={draftContact} placeholder={ar ? "اختر" : "Select"} options={[{ value: "email", label: ar ? "هاتف وبريد إلكتروني" : "Phone and email" }, { value: "phone-only", label: ar ? "هاتف فقط" : "Phone only" }]} onChange={(next) => setDraftContact(next as ContactFilter)} />
              )}
            </FilterField>
          ) : null}
          {companies.length > 0 ? (
            <FilterField label={ar ? "المعرض / العميل" : "Company / client"}>
              <MenuSelect label={ar ? "المعرض / العميل" : "Company / client"} value={draftCompany} placeholder={ar ? "اختر" : "Select"} options={companies.map((company) => ({ value: company, label: company }))} onChange={setDraftCompany} />
            </FilterField>
          ) : null}
        </div>

        <div className="flex gap-sm border-t px-lg py-md">
          <Button className="flex-1" onClick={() => onApply({ activeTab: draftStatus || defaultTab, contactFilter: draftContact || "all", companyFilter: draftCompany || "all" })}>{ar ? "تطبيق الفلاتر" : "Apply filters"}</Button>
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
  savedSearches: readonly SavedWorkSearch[];
  selectedSavedId: string;
  onClose: () => void;
  onSave: (name: string, mode: "new" | "update", targetId: string) => Promise<string | null>;
}) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [mode, setMode] = useState<"new" | "update">("new");
  const [targetId, setTargetId] = useState(selectedSavedId || savedSearches[0]?.id || "");
  const selected = savedSearches.find((item) => item.id === targetId);
  const [name, setName] = useState(ar ? "بحث جديد" : "New search");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <Input aria-label={ar ? "الاسم" : "Name"} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </FilterField>
          {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
        </div>

        <div className="flex gap-sm border-t px-lg py-md">
          <Button
            disabled={saving || !name.trim() || (mode === "update" && !targetId)}
            onClick={async () => {
              setSaving(true);
              setError(null);
              const message = await onSave(name.trim(), mode, targetId);
              if (message) {
                setError(message);
                setSaving(false);
              }
            }}
          >{ar ? "حفظ البحث" : "Save search"}</Button>
          <Button variant="outline" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
        </div>
      </div>
    </div>
  );
}


function Thumb({ row, size }: { row: WorkRowVM; size: 48 | 56 }) {
  const box = size === 56 ? "h-14 w-14" : "h-12 w-12";
  if (row.image) {
    return <Image src={row.image} alt="" width={size} height={size} className={cn(box, "shrink-0 rounded-sm border object-cover")} />;
  }
  return (
    <span className={cn(box, "relative shrink-0 overflow-hidden rounded-sm border bg-gradient-to-br from-surface-2 to-canvas")} aria-hidden="true">
      <TradeIllustration tradeKey={row.tradeKey} className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)]" />
    </span>
  );
}

function RowAction({ row, onAction, className }: { row: WorkRowVM; onAction: (row: WorkRowVM) => void; className?: string }) {
  return <ActionLink action={row.action} onClick={() => onAction(row)} className={className} />;
}

function Delivery({ row, locale }: { row: WorkRowVM; locale: Locale }) {
  return (
    <>
      <p className={cn("text-body", row.deliveryDateLabel ? "text-fg" : "text-fg-muted")}>{row.deliveryDateLabel ?? (locale === "ar" ? "غير محدد" : "Not specified")}</p>
      {row.deliveryHint ? <p className="mt-0.5 text-label text-success">{row.deliveryHint}</p> : null}
    </>
  );
}

function Value({ row, locale }: { row: WorkRowVM; locale: Locale }) {
  return row.value !== null ? <>{formatEgp(row.value, locale)}</> : <span className="text-fg-muted">—</span>;
}

type RowProps = { row: WorkRowVM; locale: Locale; features?: WorkPreviewFeatures; showContact: boolean; onAction: (row: WorkRowVM) => void };

function WorkGridCard({ row, locale, features, showContact, onAction }: RowProps) {
  return (
    <li className="rounded-md border bg-surface p-md">
      <div className="flex items-start gap-sm">
        <Thumb row={row} size={56} />
        <div className="min-w-0 flex-1"><p className="font-medium text-fg" dir="auto">{row.title}</p>{row.company ? <p className="mt-1 text-label text-fg-muted"><bdi dir="auto">{row.company}</bdi></p> : null}</div>
        <StatusBadge row={row} />
      </div>
      <div className={cn("mt-md grid gap-sm border-t pt-md", showContact ? "grid-cols-2" : "grid-cols-1")}>
        {showContact && row.contact ? <ContactCell row={row} locale={locale} /> : null}
        <div className={showContact ? "text-end" : ""}><p className="font-mono text-body font-medium text-fg"><Value row={row} locale={locale} /></p><div className="mt-1 text-label text-fg-muted"><Delivery row={row} locale={locale} /></div></div>
      </div>
      <div className="mt-md flex items-center gap-sm">
        <RowAction row={row} onAction={onAction} className="flex-1 justify-center" />
        {features ? null : <RowMenu row={row} locale={locale} />}
      </div>
    </li>
  );
}

function WorkTableRow({ row, locale, features, showContact, onAction }: RowProps) {
  const ar = locale === "ar";
  return (
    <tr className="transition-colors hover:bg-surface-hover">
      <td className="px-sm py-3">
        <div className="flex w-44 items-center gap-sm">
          <Thumb row={row} size={48} />
          <div className="min-w-0"><p className="font-medium text-fg" dir="auto">{row.title}</p>{row.location ? <p className="mt-0.5 text-label text-fg-muted"><bdi dir="auto">{row.location}</bdi></p> : null}</div>
        </div>
      </td>
      <td className="px-sm py-3 text-center"><CompanyCell row={row} locale={locale} showRating={Boolean(features?.rating)} centered /></td>
      {showContact ? <td className="px-sm py-3 text-center">{row.contact ? <ContactCell row={row} locale={locale} /> : <span className="text-label text-fg-muted" title={ar ? "لا توجد بيانات تواصل" : "No contact data"}>—</span>}</td> : null}
      <td className="px-sm py-3 text-center"><StatusBadge row={row} /></td>
      <td className="whitespace-nowrap px-sm py-3 text-center font-mono text-body font-medium text-fg"><Value row={row} locale={locale} /></td>
      <td className="whitespace-nowrap px-sm py-3 text-center"><Delivery row={row} locale={locale} /></td>
      <td className="whitespace-nowrap px-sm py-3">
        <div className="flex items-center justify-center gap-1.5">
          <RowAction row={row} onAction={onAction} className="min-w-20 justify-center" />
          {features ? (
            <button type="button" aria-label={ar ? "المزيد من الإجراءات" : "More actions"} className="grid h-8 w-8 place-items-center rounded-sm border text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><MoreHorizontalIcon size={16} className="rotate-90" /></button>
          ) : (
            <RowMenu row={row} locale={locale} />
          )}
        </div>
      </td>
    </tr>
  );
}

function WorkMobileRow({ row, locale, features, showContact, onAction }: RowProps) {
  return (
    <li className="p-md">
      <div className="flex gap-sm">
        <Thumb row={row} size={48} />
        <div className="min-w-0 flex-1"><p className="font-medium text-fg" dir="auto">{row.title}</p>{row.location ? <p className="text-label text-fg-muted"><bdi dir="auto">{row.location}</bdi></p> : null}</div>
        <StatusBadge row={row} />
      </div>
      <div className="mt-md grid grid-cols-2 gap-sm border-t pt-sm">
        <CompanyCell row={row} locale={locale} showRating={Boolean(features?.rating)} />
        <div><p className="font-mono text-body font-medium text-fg"><Value row={row} locale={locale} /></p><div className="text-label text-fg-muted"><Delivery row={row} locale={locale} /></div></div>
        {showContact && row.contact ? <div className="col-span-2"><ContactCell row={row} locale={locale} /></div> : null}
      </div>
      <div className="mt-md flex items-center gap-sm">
        <RowAction row={row} onAction={onAction} className="flex-1 justify-center" />
        {features ? null : <RowMenu row={row} locale={locale} />}
      </div>
    </li>
  );
}

function CompanyCell({ row, locale, showRating, centered = false }: { row: WorkRowVM; locale: Locale; showRating: boolean; centered?: boolean }) {
  if (!row.company) return <span className="text-label text-fg-muted">—</span>;
  return (
    <div className={cn("flex w-24 items-center gap-sm", centered && "justify-center")}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-label font-semibold text-fg">{row.companyInitials}</span>
      <div><p className="text-body font-medium text-fg" dir="auto">{row.company}</p>{showRating && row.rating ? <p className="mt-0.5 flex items-center gap-1 text-label text-fg-muted"><StarIcon size={12} className="text-warning" />{formatNumber(row.rating, locale)}</p> : null}</div>
    </div>
  );
}

function ContactCell({ row, locale }: { row: WorkRowVM; locale: Locale }) {
  const ar = locale === "ar";
  const [revealed, setRevealed] = useState<"phone" | "email" | null>(null);
  const contact = row.contact;
  if (!contact) return null;
  return (
    <div className="w-32 space-y-1 text-start">
      {contact.name ? <p className="truncate text-label font-medium text-fg" dir="auto" title={contact.name}>{contact.name}</p> : null}
      {contact.phone ? (
        <button
          type="button"
          aria-expanded={revealed === "phone"}
          aria-label={ar ? "إظهار رقم الهاتف كاملًا" : "Show full phone number"}
          onClick={() => setRevealed((value) => value === "phone" ? null : "phone")}
          className="flex w-full items-center gap-1.5 whitespace-nowrap rounded-xs text-label text-fg hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          dir="ltr"
        >
          <PhoneIcon size={13} className="text-fg-muted" />
          {revealed === "phone" ? (contact.fullPhone ?? contact.phone) : contact.phone}
        </button>
      ) : null}
      <button
        type="button"
        disabled={!contact.email}
        aria-expanded={revealed === "email"}
        aria-label={ar ? "إظهار البريد الإلكتروني كاملًا" : "Show full email address"}
        onClick={() => setRevealed((value) => value === "email" ? null : "email")}
        className="flex w-full items-center gap-1.5 rounded-xs text-label text-fg-secondary hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:hover:text-fg-secondary"
        dir="ltr"
      >
        <MailIcon size={13} className="text-fg-muted" />
        <span className={cn("min-w-0", revealed === "email" ? "break-all text-start" : "truncate")}>{contact.email ?? (ar ? "غير متاح" : "Not available")}</span>
      </button>
    </div>
  );
}

/**
 * The vertical three-dot menu, production rows only. Entries are the row's real,
 * contextual `moreActions`; with none, nothing is drawn. It is the shared floating
 * surface (portal + Floating UI), so the results region's overflow cannot clip it and
 * it flips / shifts away from the viewport edge in either writing direction.
 */
function RowMenu({ row, locale }: { row: WorkRowVM; locale: Locale }) {
  const ar = locale === "ar";
  const actions = row.moreActions ?? [];
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Opening puts focus on the first action.
  useEffect(() => {
    if (open) document.getElementById(menuId)?.querySelector<HTMLElement>("a")?.focus();
  }, [open, menuId]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ar ? "المزيد من الإجراءات" : "More actions"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <MoreHorizontalIcon size={16} className="rotate-90" />
      </button>
      <FloatingMenu id={menuId} open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} role="menu" aria-label={ar ? "إجراءات العمل" : "Work actions"} placement="bottom-end" className="w-44 p-xs">
        {actions.map((action) => (
          <Link
            key={action.key}
            role="menuitem"
            href={action.href}
            onClick={() => setOpen(false)}
            className="flex min-h-9 items-center rounded-sm px-sm text-start text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {action.label}
          </Link>
        ))}
      </FloatingMenu>
    </>
  );
}

function StatusBadge({ row }: { row: WorkRowVM }) {
  return <Badge tone={row.statusTone}>{row.statusLabel}</Badge>;
}

/* ---- Right-hand rail primitives, shared so production's REAL cards look like the approved ones. ---- */

export function RailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border bg-surface shadow-card">
      <h2 className="flex items-center gap-2 border-b px-md py-3 text-body-lg font-semibold text-fg"><span className="text-accent">{icon}</span>{title}</h2>
      <div className="divide-y divide-strong">{children}</div>
    </section>
  );
}

export function RailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <span className="text-body text-fg-secondary">{label}</span>
      <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-label font-semibold tabular-nums text-fg">{value}</span>
    </>
  );
  const className = "flex min-h-11 items-center justify-between gap-sm px-md py-2.5";
  return href ? (
    <Link href={href} className={cn(className, "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus")}>{content}</Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function RailLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block w-full px-md py-3 text-start text-label font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">{children}</Link>;
}

export function RailAside({ label, children, compact = false }: { label: string; children: React.ReactNode; /** Cards keep their natural height instead of stretching to the column (production). */ compact?: boolean }) {
  const { dir } = useI18n();
  return <aside dir={dir} aria-label={label} className={cn("grid gap-md tablet:grid-cols-2 desktop:grid-cols-1", compact ? "desktop:content-start" : "desktop:h-full")}>{children}</aside>;
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 1 }).format(value);
}
