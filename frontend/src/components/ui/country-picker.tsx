"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/controls";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { menuItemClass } from "@/components/ui/menu";
import { useI18n } from "@/lib/i18n/context";
import { countryName } from "@/lib/contact/country-names";
import { listPhoneCountries } from "@/lib/contact/phone";
import { cn } from "@/lib/ui/cn";
import type { CountryCode } from "libphonenumber-js";

const COUNTRIES = listPhoneCountries();

/** `EG` -> 🇪🇬, via the regional-indicator Unicode trick — no flag image assets. */
export function flagEmoji(iso2: string): string {
  return iso2.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/**
 * THE COUNTRY / CALLING-CODE PICKER shared by every phone field.
 *
 * A native <select> cannot be themed or searched, and on Firefox / Safari it cannot even be rounded; a list of ~200
 * countries needs a search box. So this is a button that opens a searchable `listbox` on the shared floating surface
 * (portal + Floating UI): it is never clipped by the form's card, it flips / shifts away from the screen edge in
 * either writing direction, and it is fully keyboard-operable — Arrow Down from the search box (or the button) reaches
 * the list, Arrow Up / Down / Home / End move, Enter chooses, Escape closes and returns focus to the button.
 *
 * Country names come from `lib/contact/country-names` — DATA, the same string on the server and in the browser —
 * never `Intl.DisplayNames`, which differs between Node and Chromium and caused a hydration mismatch.
 */
export function CountryPicker({
  value,
  onChange,
  compact = false,
  className,
}: {
  value: CountryCode;
  onChange: (iso2: CountryCode) => void;
  /** Closed state shows only flag + calling code (the number input gets the room). */
  compact?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const callingCode = COUNTRIES.find((c) => c.iso2 === value)?.callingCode ?? "";

  // Opening puts the caret in the search box, so typing a country name or code starts filtering at once.
  useEffect(() => {
    if (open) search.current?.focus({ preventScroll: true });
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace("+", "");
    const rows = COUNTRIES.map((c) => ({ ...c, name: countryName(locale, c.iso2) }));
    if (!needle) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(needle) || c.iso2.toLowerCase() === needle || (digits !== "" && c.callingCode.startsWith(digits)));
  }, [query, locale]);

  const options = () => Array.from(document.getElementById(listId)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  const moveFromList = (event: ReactKeyboardEvent<HTMLElement>) => {
    const items = options();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 || index === items.length - 1 ? 0 : index + 1;
    else if (event.key === "ArrowUp") {
      if (index <= 0) {
        event.preventDefault();
        search.current?.focus();
        return;
      }
      next = index - 1;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={t("phoneField.countryLabel")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        className={cn(
          "flex min-h-11 w-full items-center gap-1.5 rounded-md border border-field-line bg-field px-3 text-body text-field-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          compact && "px-2.5",
        )}
      >
        <span aria-hidden="true">{flagEmoji(value)}</span>
        <span dir="ltr" className="tabular-nums">+{callingCode}</span>
        <ChevronDownIcon size={15} aria-hidden="true" className={cn("ms-auto shrink-0 text-fg-secondary transition-transform", open && "rotate-180")} />
      </button>

      <FloatingMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        role="dialog"
        aria-label={t("phoneField.countryLabel")}
        placement="bottom-start"
        className="w-72 p-1"
      >
        <div className="relative p-1">
          <SearchIcon size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                options()[0]?.focus();
              }
            }}
            placeholder={ar ? "ابحث عن دولة" : "Search country"}
            aria-label={ar ? "ابحث عن دولة" : "Search country"}
            className="ps-9"
          />
        </div>
        <div id={listId} role="listbox" aria-label={t("phoneField.countryLabel")} onKeyDown={moveFromList} className="max-h-60 overflow-y-auto">
          {visible.map((c) => {
            const selected = c.iso2 === value;
            return (
              <button
                key={c.iso2}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(c.iso2);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={menuItemClass(selected, "min-h-10 rounded-sm")}
              >
                <span aria-hidden="true">{flagEmoji(c.iso2)}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span dir="ltr" className="text-fg-secondary tabular-nums">+{c.callingCode}</span>
                {selected ? <CheckIcon size={16} className="text-accent" /> : null}
              </button>
            );
          })}
          {visible.length === 0 ? <p className="px-3 py-2 text-label text-fg-secondary">{ar ? "لا توجد نتائج" : "No results"}</p> : null}
        </div>
      </FloatingMenu>
    </div>
  );
}
