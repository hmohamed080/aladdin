"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/controls";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@/components/ui/icons";
import { menuItemClass, menuSurfaceClass } from "@/components/ui/menu";
import {
  DEFAULT_PHONE_COUNTRY,
  listPhoneCountries,
  toCanonicalPhone,
  type CanonicalPhone,
} from "@/lib/contact/phone";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { CountryCode } from "libphonenumber-js";

const COUNTRIES = listPhoneCountries();

/** `EG` -> 🇪🇬 via regional-indicator code points — no flag assets. */
function flagEmoji(iso2: string): string {
  return iso2.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/**
 * Installer phone field: the same canonical parsing as the shared `PhoneField`
 * (libphonenumber-js, Egypt first), but the country picker is the project's
 * rounded listbox surface (`menuSurfaceClass` / `menuItemClass`) instead of a
 * native select, whose popup the OS draws with square corners. It is
 * client-only for the same reason as the shared field: Intl country names
 * differ between Node and browser ICU builds.
 */
export function InstallerPhoneField({
  id,
  defaultCountryIso2,
  placeholder,
  onChange,
  error,
}: {
  id?: string;
  defaultCountryIso2?: string | null;
  placeholder?: string;
  /** Canonical result on every keystroke; null while empty or invalid. */
  onChange: (value: CanonicalPhone | null) => void;
  error?: string;
}) {
  const { t, locale } = useI18n();
  const ar = locale === "ar";
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [country, setCountry] = useState<CountryCode>((defaultCountryIso2 as CountryCode) || DEFAULT_PHONE_COUNTRY);
  const [national, setNational] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);

  const canonical = useMemo(() => (national.trim() === "" ? null : toCanonicalPhone(national, country)), [national, country]);
  const invalid = national.trim() !== "" && canonical === null;
  const callingCode = COUNTRIES.find((c) => c.iso2 === country)?.callingCode ?? "";

  const visible = useMemo(() => {
    const label = (iso2: string) => names?.of(iso2) ?? iso2;
    const needle = query.trim().toLowerCase();
    const digits = needle.replace("+", "");
    const rows = COUNTRIES.map((c) => ({ ...c, name: label(c.iso2) }));
    if (!needle) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(needle) || c.iso2.toLowerCase() === needle || (digits !== "" && c.callingCode.startsWith(digits)));
  }, [query, names]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const emit = (nextCountry: CountryCode, nextNational: string) => {
    setCountry(nextCountry);
    setNational(nextNational);
    onChange(nextNational.trim() === "" ? null : toCanonicalPhone(nextNational, nextCountry));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={rootRef} className="relative flex gap-2">
        <button
          type="button"
          aria-label={t("phoneField.countryLabel")}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            setQuery("");
            setOpen((current) => !current);
          }}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-field-line bg-field px-3 text-body text-field-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span aria-hidden="true">{flagEmoji(country)}</span>
          <span dir="ltr" className="tabular-nums">+{callingCode}</span>
          <ChevronDownIcon size={15} className={cn("shrink-0 text-fg-secondary transition-transform", open && "rotate-180")} />
        </button>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          className="min-w-0 flex-1"
          value={national}
          onChange={(event) => emit(country, event.target.value)}
          placeholder={placeholder ?? t("phoneField.nationalPlaceholder")}
          aria-invalid={invalid || Boolean(error) ? true : undefined}
        />
        {open ? (
          <div className={cn(menuSurfaceClass, "absolute start-0 top-full z-popover mt-2 w-72 p-1")}>
            <div className="relative p-1">
              <SearchIcon size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={ar ? "ابحث عن دولة" : "Search country"}
                aria-label={ar ? "ابحث عن دولة" : "Search country"}
                className="ps-9"
              />
            </div>
            <div id={listId} role="listbox" aria-label={t("phoneField.countryLabel")} className="max-h-60 overflow-y-auto">
              {visible.map((c) => {
                const selected = c.iso2 === country;
                return (
                  <button
                    key={c.iso2}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      emit(c.iso2, national);
                      setOpen(false);
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
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-label text-danger">{error}</p>
      ) : invalid ? (
        <p className="text-label text-danger">{t("phoneField.invalid")}</p>
      ) : null}
    </div>
  );
}
