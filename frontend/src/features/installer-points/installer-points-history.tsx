"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/controls";
import { CalendarIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CrownIcon, DownloadIcon, GiftIcon, ListIcon } from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { InlineError } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { derivePointsLevel } from "@/lib/network/points-level";
import { POINTS_LEVEL_BADGE_ASSET } from "@/lib/network/points-level-assets";
import { cn } from "@/lib/ui/cn";
import type { PointsEntryView } from "@/features/points/view-model";
import type { PointsHistoryCursor, PointsHistoryFilter } from "@/server/queries/points";
import { IconBubble, PointsBadge, PointsHero } from "./installer-points";

export type PointsHistoryLoad = (filter: PointsHistoryFilter, cursor: PointsHistoryCursor | null) => Promise<
  { ok: true; views: PointsEntryView[]; next: PointsHistoryCursor | null; total: number } | { ok: false }
>;

type Option<T extends string> = { value: T; label: string };

/**
 * `/home/points/history` for an Installer: the APPROVED Points history design on the real ledger. Every filter runs in
 * SQL; pages move by keyset (`created_at DESC, id DESC`) with the exact matching total, so there is no ceiling and no
 * row is skipped or repeated. "Export history" downloads every row matching the current filters as CSV.
 */
export function InstallerPointsHistory({
  balance,
  months,
  initial,
  load,
}: {
  balance: number;
  /** "YYYY-MM" values, newest first (the last twelve Africa/Cairo months). */
  months: readonly string[];
  initial: { views: PointsEntryView[]; next: PointsHistoryCursor | null; total: number };
  load: PointsHistoryLoad;
}) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";
  const [filter, setFilter] = useState<PointsHistoryFilter>({ month: null, event: null, result: "all" });
  const [rows, setRows] = useState(initial.views);
  const [total, setTotal] = useState(initial.total);
  // The cursor that opened each page: [null] is page 1. "Next" pushes, "previous" pops.
  const [stack, setStack] = useState<(PointsHistoryCursor | null)[]>([null]);
  const [next, setNext] = useState(initial.next);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  const fetchPage = (f: PointsHistoryFilter, cursor: PointsHistoryCursor | null, nextStack: (PointsHistoryCursor | null)[]) => {
    startTransition(async () => {
      const result = await load(f, cursor);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setRows(result.views);
      setTotal(result.total);
      setNext(result.next);
      setStack(nextStack);
    });
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fetchPage(filter, null, [null]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a filter change always restarts from page 1
  }, [filter]);

  const [exporting, startExport] = useTransition();
  const exportCsv = () => {
    startExport(async () => {
      const all: PointsEntryView[] = [];
      let cursor: PointsHistoryCursor | null = null;
      for (let i = 0; i < 500; i++) {
        const result = await load(filter, cursor);
        if (!result.ok) {
          setFailed(true);
          return;
        }
        all.push(...result.views);
        cursor = result.next;
        if (!cursor) break;
      }
      download(all, locale);
    });
  };

  const page = stack.length;
  const info = derivePointsLevel(balance);
  const monthLabel = (m: string) => new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));
  const monthOptions: Option<string>[] = [{ value: "all", label: ar ? "كل الفترات" : "All periods" }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))];
  const activityOptions: Option<string>[] = [
    { value: "all", label: ar ? "الكل" : "All" },
    { value: "referral.organization_approved", label: ar ? "إحالة شركة معتمدة" : "Approved business referral" },
    { value: "admin.adjustment", label: ar ? "تصحيح من الدعم" : "Support correction" },
  ];
  const resultOptions: Option<PointsHistoryFilter["result"]>[] = [
    { value: "all", label: ar ? "الكل" : "All" },
    { value: "earned", label: ar ? "نقاط مكتسبة" : "Points earned" },
    { value: "deducted", label: ar ? "نقاط مخصومة" : "Points deducted" },
  ];
  const shownFrom = total === 0 ? 0 : (page - 1) * 20 + 1;
  const shownTo = (page - 1) * 20 + rows.length;

  return (
    <div dir={dir} data-installer-points-history className="flex w-full min-w-0 flex-col gap-md">
      <PointsHero locale={locale} title={ar ? "سجل النقاط" : "Points history"} subtitle={ar ? "تعرّف على كل الأنشطة التي منحتك نقاطًا" : "Explore every activity on your points"} />

      <section aria-label={ar ? "ملخص سجل النقاط" : "Points history summary"} className="grid min-w-0 gap-md desktop:grid-cols-3" dir="ltr">
        <article dir={dir} className="flex min-h-36 items-center justify-between gap-md rounded-md border border-strong bg-surface p-lg shadow-card">
          <IconBubble large><GiftIcon size={27} /></IconBubble>
          <div className="text-end"><h2 className="text-body-lg font-semibold text-fg">{ar ? "إجمالي النقاط" : "Total points"}</h2><strong className="mt-2 block text-[2.75rem] font-bold leading-none tabular-nums text-accent-solid">{fmt(balance, locale)}</strong><span className="mt-1 block text-label font-semibold text-accent-solid">{ar ? "نقطة" : "points"}</span></div>
        </article>
        <article dir={dir} className="grid min-h-36 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-md rounded-md border border-strong bg-surface p-md shadow-card">
          <Image src={POINTS_LEVEL_BADGE_ASSET[info.level]} alt="" width={130} height={130} className="h-28 w-28 object-contain" />
          <div><h2 className="text-body text-fg-secondary">{ar ? "المستوى الحالي" : "Current level"}</h2><strong className="mt-1 block text-title font-bold text-fg">{ar ? `المستوى ${fmt(info.level, locale)}` : `Level ${info.level}`}</strong>{info.remainingToNextLevel !== null ? <p className="mt-sm flex items-center gap-1 text-label text-fg-secondary"><ChevronLeftIcon size={15} className="text-accent-solid rtl:rotate-0 ltr:rotate-180" />{ar ? `${fmt(info.remainingToNextLevel, locale)} نقطة للمستوى التالي` : `${info.remainingToNextLevel} points to the next level`}</p> : null}</div>
        </article>
        <article dir={dir} className="flex min-h-36 items-center justify-between gap-md rounded-md border border-strong bg-surface p-lg shadow-card">
          <IconBubble large><CrownIcon size={27} /></IconBubble>
          <div className="text-end"><h2 className="text-body text-fg-secondary">{ar ? "المستوى التالي" : "Next level"}</h2><strong className="mt-1 block text-title font-bold text-fg">{info.isMaxLevel ? (ar ? "أعلى مستوى" : "Top level") : ar ? `المستوى ${fmt(info.level + 1, locale)}` : `Level ${info.level + 1}`}</strong>{info.remainingToNextLevel !== null ? <p className="mt-sm text-label text-fg-secondary">{ar ? `${fmt(Math.max(0, balance) + info.remainingToNextLevel, locale)} نقطة مطلوبة` : `${Math.max(0, balance) + info.remainingToNextLevel} points required`}</p> : null}</div>
        </article>
      </section>

      <section aria-label={ar ? "فلاتر سجل النقاط" : "Points history filters"} className="rounded-md border border-strong bg-surface p-md shadow-card">
        <div className="grid min-w-0 gap-sm tablet:grid-cols-2 desktop:grid-cols-[minmax(16rem,1.35fr)_minmax(12rem,1fr)_minmax(10rem,.72fr)_auto] desktop:items-end">
          <FilterMenu label={ar ? "الفترة الزمنية" : "Date range"} value={filter.month ?? "all"} options={monthOptions} onChange={(v) => setFilter({ ...filter, month: v === "all" ? null : v })} icon={<CalendarIcon size={18} />} />
          <FilterMenu label={ar ? "نوع النشاط" : "Activity type"} value={filter.event ?? "all"} options={activityOptions} onChange={(v) => setFilter({ ...filter, event: v === "all" ? null : (v as PointsHistoryFilter["event"]) })} />
          <FilterMenu label={ar ? "النتيجة" : "Result"} value={filter.result} options={resultOptions} onChange={(v) => setFilter({ ...filter, result: v })} />
          <Button variant="outline" className="h-11 w-full gap-sm desktop:w-auto" onClick={exportCsv} disabled={exporting || total === 0} aria-busy={exporting} data-testid="points-export">
            <DownloadIcon size={18} />{exporting ? (ar ? "جارٍ التصدير…" : "Exporting…") : ar ? "تصدير السجل" : "Export history"}
          </Button>
        </div>
      </section>

      {failed ? <InlineError>{ar ? "تعذّر تحميل سجل النقاط. حاول مرة أخرى." : "Points history could not be loaded. Try again."}</InlineError> : null}

      <section aria-label={ar ? "جدول سجل النقاط" : "Points history table"} aria-busy={pending} className="overflow-hidden rounded-md border border-strong bg-surface shadow-card">
        <div className="hidden tablet:block">
          <table className="w-full table-fixed border-collapse text-start">
            <thead className="bg-surface-2">
              <tr className="border-b border-strong text-label font-semibold text-fg-secondary">
                <th scope="col" className="w-[20%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><CalendarIcon size={16} />{ar ? "التاريخ" : "Date"}</span></th>
                <th scope="col" className="w-[26%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><GiftIcon size={16} />{ar ? "نوع النشاط" : "Activity type"}</span></th>
                <th scope="col" className="w-[38%] px-md py-3 text-start"><span className="inline-flex items-center gap-sm"><ListIcon size={16} />{ar ? "التفاصيل" : "Details"}</span></th>
                <th scope="col" className="w-[16%] px-md py-3 text-center"><span className="inline-flex items-center gap-sm"><GiftIcon size={16} />{ar ? "النقاط" : "Points"}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-strong">
              {rows.map((v) => (
                <tr key={v.id} className="bg-canvas transition-colors hover:bg-surface-2/60" data-testid="points-row">
                  <td className="px-md py-2.5 text-label tabular-nums text-fg-secondary"><time dateTime={v.timestamp}>{v.dateLabel}</time></td>
                  <td className="px-md py-2.5"><span className="flex items-center gap-sm text-label font-semibold text-fg"><GiftIcon size={19} className="shrink-0 text-accent-solid" />{v.title}</span></td>
                  <td className="truncate px-md py-2.5 text-label text-fg-secondary">{[v.organizationName, v.body].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-md py-2.5 text-center"><PointsBadge view={v} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-strong tablet:hidden">
          {rows.map((v) => (
            <li key={v.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-sm bg-canvas px-md py-3">
              <span className="grid h-9 w-9 place-items-center rounded-sm bg-accent-solid/10 text-accent-solid"><GiftIcon size={19} /></span>
              <div className="min-w-0"><h3 className="text-label font-semibold text-fg">{v.title}</h3>{v.organizationName || v.body ? <p className="truncate text-caption text-fg-secondary">{v.organizationName ?? v.body}</p> : null}<time dateTime={v.timestamp} className="mt-1 block text-caption tabular-nums text-fg-secondary">{v.dateLabel}</time></div>
              <PointsBadge view={v} />
            </li>
          ))}
        </ul>
        {rows.length === 0 ? <p className="px-md py-xl text-center text-body text-fg-secondary" data-testid="points-empty">{ar ? "لا توجد أنشطة مطابقة للفلاتر المختارة." : "No activities match the selected filters."}</p> : null}
        <footer dir="ltr" className="flex flex-col gap-md border-t border-strong px-md py-md tablet:flex-row tablet:items-center tablet:justify-between">
          <p dir={dir} className="text-label text-fg-secondary" aria-live="polite" data-testid="points-count">{ar ? `عرض ${fmt(shownFrom, locale)}–${fmt(shownTo, locale)} من ${fmt(total, locale)} نتيجة` : `Showing ${shownFrom}–${shownTo} of ${total} results`}</p>
          <nav aria-label={ar ? "صفحات سجل النقاط" : "Points history pages"} dir="ltr" className="flex items-center gap-1">
            <button type="button" aria-label={ar ? "الصفحة السابقة" : "Previous page"} disabled={page === 1 || pending} onClick={() => { const s = stack.slice(0, -1); fetchPage(filter, s[s.length - 1] ?? null, s); }} className="grid h-9 w-9 place-items-center rounded-sm border border-strong bg-canvas text-fg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronLeftIcon size={17} /></button>
            <span aria-current="page" className="grid h-9 min-w-9 place-items-center rounded-sm border border-primary bg-primary px-2 text-label font-semibold tabular-nums text-primary-foreground">{page}</span>
            <button type="button" aria-label={ar ? "الصفحة التالية" : "Next page"} disabled={!next || pending} onClick={() => next && fetchPage(filter, next, [...stack, next])} className="grid h-9 w-9 place-items-center rounded-sm border border-strong bg-canvas text-fg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="points-next"><ChevronRightIcon size={17} /></button>
          </nav>
        </footer>
      </section>
    </div>
  );
}

function fmt(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(value);
}

function FilterMenu<T extends string>({ label, value, options, onChange, icon }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(options.findIndex((o) => o.value === value), 0);
  useEffect(() => {
    if (!open) return;
    document.getElementById(listId)?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[selectedIndex]?.focus();
  }, [open, listId, selectedIndex]);
  return (
    <div className="relative min-w-0">
      <span className="mb-1.5 block text-label text-fg-secondary">{label}</span>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((c) => !c)} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }} className="flex h-11 w-full items-center gap-sm rounded-md border border-strong bg-canvas px-md text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {icon ? <span className="shrink-0 text-fg-secondary">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-start">{options[selectedIndex]?.label}</span>
        <ChevronDownIcon size={16} className="shrink-0 text-fg-secondary" />
      </button>
      <FloatingMenu id={listId} open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="menu" aria-label={label} placement="bottom-start" matchAnchorWidth className="max-h-60">
        {options.map((o) => (
          <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} onClick={() => { onChange(o.value); setOpen(false); trigger.current?.focus(); }} className={cn("flex w-full items-center gap-sm px-md py-2 text-start text-label transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2", o.value === value ? "font-semibold text-fg" : "text-fg-secondary")}>
            <span className="min-w-0 flex-1 truncate">{o.label}</span>{o.value === value ? <CheckIcon size={15} className="shrink-0 text-accent-solid" /> : null}
          </button>
        ))}
      </FloatingMenu>
    </div>
  );
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function pointsCsv(rows: readonly PointsEntryView[], locale: Locale): string {
  const ar = locale === "ar";
  const header = ar ? ["التاريخ", "النشاط", "التفاصيل", "النقاط"] : ["Date", "Activity", "Details", "Points"];
  return [header, ...rows.map((v) => [v.timestamp.slice(0, 10), v.title, [v.organizationName, v.body].filter(Boolean).join(" · "), v.deltaLabel])]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}

function download(rows: readonly PointsEntryView[], locale: Locale) {
  const blob = new Blob(["﻿" + pointsCsv(rows, locale)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aladdin-points-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
