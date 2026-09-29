"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CommandIcon, EnterKeyIcon, SearchIcon } from "@/components/ui/icons";
import {
  flattenResults,
  moveActive,
  searchPalette,
  type PaletteGroup,
  type PaletteItem,
} from "@/features/admin-preview/command-palette-search";

/** Admin pages the palette can jump to. Local definitions — no request is made to build them. */
const NAV: { key: string; href: string }[] = [
  { key: "dashboard", href: "/admin/preview" },
  { key: "users", href: "/admin/preview/users" },
  { key: "organizations", href: "/admin/preview/organizations" },
  { key: "review", href: "/admin/preview/review" },
  { key: "points", href: "/admin/preview/points" },
  { key: "staff", href: "/admin/preview/staff" },
  { key: "analytics", href: "/admin/preview/analytics" },
  { key: "audit", href: "/admin/preview/audit" },
  { key: "settings", href: "/admin/preview/settings" },
];

const DEBOUNCE_MS = 150;

/**
 * Global Admin Command Palette — PREVIEW (Phase 0D). Ctrl+K / Cmd+K from any
 * Admin Preview page (or the visible trigger) opens a dialog with debounced
 * search across Users · Organizations · Review requests · Network referrals ·
 * Admin Staff · Admin pages. ↑/↓ move (wrapping), Enter opens, Esc closes, and
 * opening a result is a client-side navigation — no page reload.
 *
 * Scope boundary (PD-016 / Product Owner decision B): there is NO new
 * server-side search here. `items` are rows the Preview already loaded through
 * existing queries (plus isolated fixtures such as Organization Requests); this
 * component only filters them locally. Real cross-entity server search belongs
 * to the later Admin Core backend-wiring phase.
 */
export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [isMac, setIsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // Ctrl+K / Cmd+K anywhere in Admin Preview toggles THIS palette.
  //
  // The app shell's own header search (`components/layout/global-search.tsx`)
  // listens for the same chord on `window`, in the bubble phase. This handler is
  // registered in the CAPTURE phase and stops the event, so inside Admin Preview
  // the shortcut opens the Admin palette only — never both dialogs at once. The
  // header field itself is untouched and still opens the shell's search on click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (open) {
      const previous = document.activeElement as HTMLElement | null;
      setQuery("");
      setDebounced("");
      setActive(0);
      inputRef.current?.focus();
      return () => previous?.focus();
    }
  }, [open]);

  const all = useMemo<PaletteItem[]>(() => {
    const nav = NAV.map(
      (n): PaletteItem => ({
        id: `nav-${n.key}`,
        group: "navigation",
        label: t(`admin.preview.nav.${n.key}`),
        secondary: t(`admin.preview.palette.desc.${n.key}`),
        href: n.href,
      }),
    );
    return [...items, ...nav];
  }, [items, t]);

  const groups = useMemo(() => searchPalette(all, debounced), [all, debounced]);
  const flat = useMemo(() => flattenResults(groups), [groups]);

  useEffect(() => setActive(0), [debounced]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => moveActive(i, 1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => moveActive(i, -1, flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog: the input is the only tab stop.
      e.preventDefault();
    }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, uid]);

  const groupLabel = (g: PaletteGroup) => t(`admin.preview.palette.groups.${g}`);
  let index = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          "flex min-h-9 w-full max-w-xs items-center gap-2 rounded-md border border-strong bg-canvas px-3 text-label text-fg-muted transition-colors",
          "hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        )}
      >
        <SearchIcon size={16} />
        <span className="flex-1 truncate text-start">{t("admin.preview.palette.title")}</span>
        <kbd className="inline-flex items-center gap-0.5 rounded-sm border bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-secondary" dir="ltr">
          {isMac ? <CommandIcon size={11} /> : "Ctrl"}
          <span>{isMac ? "" : " "}K</span>
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 flex items-start justify-center bg-brand-basalt/60 p-md pt-[12vh]"
          style={{ zIndex: 600 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("admin.preview.palette.title")}
            onKeyDown={onKeyDown}
            className="flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-md border bg-surface shadow-lg"
          >
            <div className="flex items-center gap-2 border-b px-md">
              <SearchIcon size={18} />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={flat.length > 0 ? `${uid}-opt-${active}` : undefined}
                aria-autocomplete="list"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("admin.preview.palette.placeholder")}
                className="min-h-12 flex-1 bg-transparent text-body-lg text-fg placeholder:text-fg-muted focus:outline-none"
              />
              <kbd className="rounded-sm border bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">Esc</kbd>
            </div>

            <div id={listId} role="listbox" aria-label={t("admin.preview.palette.title")} className="overflow-y-auto p-sm">
              {groups.length === 0 ? (
                <p className="px-md py-lg text-center text-body text-fg-muted" role="status">
                  {t("admin.preview.users.empty")}
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.group} role="group" aria-label={groupLabel(g.group)} className="mb-1">
                    <p className="px-md pb-1 pt-2 text-[0.6875rem] font-medium uppercase tracking-wide text-fg-muted">{groupLabel(g.group)}</p>
                    {g.items.map((item) => {
                      index += 1;
                      const i = index;
                      const isActive = i === active;
                      return (
                        <div
                          key={item.id}
                          id={`${uid}-opt-${i}`}
                          role="option"
                          aria-selected={isActive}
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(item)}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-md rounded-sm px-md py-2",
                            isActive ? "bg-accent-solid/10" : "hover:bg-surface-2",
                          )}
                        >
                          <span className="min-w-0">
                            <span dir="auto" className="block truncate text-body font-medium text-fg">
                              {item.label}
                            </span>
                            {item.secondary ? (
                              <span dir="auto" className="block truncate text-label text-fg-muted">
                                {item.secondary}
                              </span>
                            ) : null}
                          </span>
                          {isActive ? <EnterKeyIcon size={14} /> : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <p className="border-t px-md py-2 text-label text-fg-muted">{t("admin.preview.palette.previewNote")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
