"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CommandIcon, EnterKeyIcon, SearchIcon, XIcon } from "@/components/ui/icons";
import { pick } from "./mock-data";
import { INSTALLER_PRIMARY_NAV, INSTALLER_QUICK_NAV, type InstallerNavItem } from "./installer-nav";
import type { InstallerOpportunityVM } from "./view-model";
import styles from "./installer-search.module.css";

type Hit = {
  id: string;
  label: string;
  meta?: string;
  Icon: ComponentType<{ size?: number }>;
  /** In-page scroll target — the preview's only navigation mechanism. */
  anchor?: string;
  /** A real route — production navigates here instead of scrolling. */
  href?: string;
};

/**
 * The topbar's search field — a centered command palette portaled to
 * `document.body`, with a dimmed + blurred backdrop, matching the staging
 * GlobalSearch pattern. SHARED between the preview (`production=false`,
 * anchors scroll the single mock page) and the real installer `/home`
 * (`production=true`, hits navigate to real routes via the router) — the
 * jobs it searches are always passed in by the caller
 * (`mockOpportunities()` for the preview, the caller's own real, bounded
 * `listJobOpportunities` read for production), never read from this file.
 */
export function InstallerSearch({
  jobs,
  production = false,
}: {
  jobs: readonly InstallerOpportunityVM[];
  production?: boolean;
}) {
  const { locale, dir } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const navHits: Hit[] = useMemo(
    () =>
      [...INSTALLER_PRIMARY_NAV, ...INSTALLER_QUICK_NAV]
        .filter((item: InstallerNavItem) => !production || Boolean(item.href))
        .map((item: InstallerNavItem) => ({
          id: `nav-${item.id}`,
          label: pick(locale, item.label),
          Icon: item.Icon,
          anchor: item.anchor,
          href: item.href,
        })),
    [locale, production],
  );

  const jobHits: Hit[] = useMemo(
    () =>
      jobs.map((job) => ({
        id: `job-${job.id}`,
        label: pick(locale, job.title),
        meta: job.org ? pick(locale, job.org) : undefined,
        Icon: SearchIcon,
        anchor: "opportunities",
        href: job.href,
      })),
    [jobs, locale],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { nav: navHits.slice(0, 4), jobs: [] as Hit[] };
    const match = (h: Hit) => h.label.toLowerCase().includes(q) || h.meta?.toLowerCase().includes(q);
    return { nav: navHits.filter(match), jobs: jobHits.filter(match) };
  }, [query, navHits, jobHits]);

  const flat = [...results.nav, ...results.jobs];

  useEffect(() => setActive(0), [query]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Control/Meta+K opens the palette from anywhere, matching staging
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes the palette
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function select(hit: Hit | undefined) {
    if (!hit) return;
    if (production && hit.href) {
      router.push(hit.href);
    } else if (hit.anchor) {
      document.getElementById(hit.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => Math.min(v + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(flat[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  // Scroll active row into view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      {/* THE HEADER TRIGGER — styled as a field, matching staging's global-search */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="installer-search-trigger"
        aria-label={locale === "ar" ? "بحث" : "Search"}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          styles.trigger,
          "group flex items-center gap-2 border border-field-line bg-field text-field-fg",
          "transition-[background-color,border-color,box-shadow,color] duration-fast ease-standard motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-field-focus",
          "h-7 w-8 shrink-0 rounded-sm px-2 text-label",
          "tablet:h-10 tablet:w-full tablet:min-w-0 tablet:rounded-lg tablet:px-3.5 tablet:text-body",
        )}
      >
        <SearchIcon
          size={18}
          className={cn(styles.hint, "shrink-0 text-field-hint")}
        />
        <span className={cn(styles.placeholder, "hidden truncate text-field-placeholder tablet:inline")}>
          {locale === "ar" ? "ابحث عن فرص، رسائل، أو أدوات…" : "Search jobs, messages, or tools…"}
        </span>
        <kbd
          className={cn(
            styles.hint,
            "ms-auto hidden shrink-0 rounded-xs border border-field-line bg-surface px-1.5 py-0.5 font-sans text-[0.6875rem] text-field-hint tablet:inline",
          )}
        >
          Ctrl K
        </kbd>
      </button>

      {/* THE COMMAND PALETTE — portaled to body, centered, matching staging */}
      {open && mounted
        ? createPortal(
            <div className="fixed inset-0" style={{ zIndex: 500 }} role="presentation">
              {/* BACKDROP — dimmed + blurred, matching staging */}
              <button
                type="button"
                tabIndex={-1}
                aria-label={locale === "ar" ? "إغلاق" : "Close"}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
                className="absolute inset-0 bg-brand-basalt/60 backdrop-blur-[2px]"
              />

              {/* THE PANEL — centered, detached, matching staging */}
              <div
                role="dialog"
                aria-modal="true"
                aria-label={locale === "ar" ? "بحث" : "Search"}
                data-testid="installer-search-panel"
                dir={dir}
                className={cn(
                  "absolute inset-x-3 top-[8vh] mx-auto flex max-h-[78vh] max-w-2xl flex-col overflow-hidden",
                  "rounded-md border border-strong bg-surface shadow-lg",
                )}
              >
                {/* HEADER — search input area, matching staging */}
                <div className="flex items-center gap-2.5 border-b px-md py-3">
                  <span className="shrink-0 text-fg-muted" aria-hidden="true">
                    <CommandIcon size={18} />
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="installer-search-input"
                    placeholder={locale === "ar" ? "ابحث عن فرص، رسائل، أو أدوات…" : "Search jobs, messages, or tools…"}
                    aria-label={locale === "ar" ? "بحث" : "Search"}
                    className="min-w-0 flex-1 bg-transparent text-body-lg text-field-fg outline-none placeholder:text-field-placeholder"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                    aria-label={locale === "ar" ? "إغلاق" : "Close"}
                    className="shrink-0 rounded-sm p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <XIcon size={18} />
                  </button>
                </div>

                {/* RESULTS LIST, matching staging */}
                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
                  {flat.length === 0 ? (
                    <p className="px-md py-4 text-center text-caption text-fg-muted">
                      {locale === "ar" ? "لا توجد نتائج" : "No results"}
                    </p>
                  ) : (
                    <>
                      {results.nav.length > 0 ? (
                        <ResultGroup label={locale === "ar" ? "التنقل" : "Navigation"}>
                          {results.nav.map((hit, i) => (
                            <ResultRow key={hit.id} hit={hit} selected={i === active} onSelect={() => select(hit)} />
                          ))}
                        </ResultGroup>
                      ) : null}
                      {results.jobs.length > 0 ? (
                        <ResultGroup label={locale === "ar" ? "فرص الشغل" : "Job opportunities"}>
                          {results.jobs.map((hit, i) => (
                            <ResultRow
                              key={hit.id}
                              hit={hit}
                              selected={results.nav.length + i === active}
                              onSelect={() => select(hit)}
                            />
                          ))}
                        </ResultGroup>
                      ) : null}
                    </>
                  )}
                </div>

                {/* FOOTER — keyboard hints, matching staging */}
                <div className="flex items-center gap-md border-t px-md py-2 text-label text-fg-muted">
                  <span className="flex items-center gap-1.5">
                    <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">↑↓</kbd>
                    {locale === "ar" ? "تنقل" : "Navigate"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">Enter</kbd>
                    {locale === "ar" ? "فتح" : "Select"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="rounded-xs border px-1 py-0.5 font-sans text-[0.6875rem]">Esc</kbd>
                    {locale === "ar" ? "إغلاق" : "Close"}
                  </span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-md pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}

function ResultRow({ hit, selected, onSelect }: { hit: Hit; selected: boolean; onSelect: () => void }) {
  const Icon = hit.Icon;
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onMouseMove={() => {}}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 px-md py-2 text-start transition-colors",
          selected ? "bg-surface-2" : "hover:bg-surface-2/50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-sm border",
            selected ? "border-accent-solid/40 bg-accent-solid/15 text-accent" : "bg-canvas text-fg-muted",
          )}
        >
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-fg">{hit.label}</span>
          {hit.meta ? <span className="block truncate text-label text-fg-muted">{hit.meta}</span> : null}
        </span>
        {selected ? <EnterKeyIcon size={14} className="shrink-0 text-fg-muted" /> : null}
      </button>
    </li>
  );
}
