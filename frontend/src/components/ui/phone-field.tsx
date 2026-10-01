"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/controls";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { menuItemClass, menuSurfaceClass } from "@/components/ui/menu";
import {
  DEFAULT_PHONE_COUNTRY,
  listPhoneCountries,
  toCanonicalPhone,
  type CanonicalPhone,
} from "@/lib/contact/phone";
import type { CountryCode } from "libphonenumber-js";
import { cn } from "@/lib/ui/cn";

const COUNTRIES = listPhoneCountries();
const COUNTRY_MENU_WIDTH = 288;
const COUNTRY_MENU_MAX_HEIGHT = 224;
const COUNTRY_MENU_GAP = 8;
const VIEWPORT_GUTTER = 12;

type CountryMenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

/**
 * `[ Egypt 🇪🇬 +20 ] [ 1012345678 ]` — a real ISO-3166 country/calling-code
 * picker (Egypt pre-selected, every other numbering plan still reachable),
 * parsed and validated client-side by `libphonenumber-js` before the already-
 * canonical E.164 value is ever sent to the server (see `lib/contact/phone.ts`
 * and `profile_set_phone`, which never re-derives it).
 *
 * Country display names come from `Intl.DisplayNames` (a platform API) rather
 * than a hand-maintained label table, so they follow the current locale for
 * every one of the ~240 countries libphonenumber-js knows, not just Egypt.
 */
export function PhoneField({
  defaultCountryIso2,
  defaultNational,
  onChange,
  error,
  id,
  placeholder,
}: {
  defaultCountryIso2?: string | null;
  defaultNational?: string | null;
  /** Fires with the canonical result on every valid keystroke, null while invalid/empty. */
  onChange: (value: CanonicalPhone | null) => void;
  error?: string;
  id?: string;
  placeholder?: string;
}) {
  const { t, locale } = useI18n();
  const [countryIso2, setCountryIso2] = useState<CountryCode>(
    (defaultCountryIso2 as CountryCode) || DEFAULT_PHONE_COUNTRY,
  );
  const [national, setNational] = useState(defaultNational ?? "");
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryMenuPosition, setCountryMenuPosition] = useState<CountryMenuPosition | null>(null);
  const countryRootRef = useRef<HTMLDivElement>(null);
  const countryMenuRef = useRef<HTMLDivElement>(null);
  const countryTriggerRef = useRef<HTMLButtonElement>(null);
  const countryOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeCountryIndex, setActiveCountryIndex] = useState(0);

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);

  const countryLabel = (iso2: string) => displayNames?.of(iso2) ?? iso2;
  const selectedCountry = COUNTRIES.find((country) => country.iso2 === countryIso2) ?? COUNTRIES[0]!;

  useEffect(() => {
    if (!countryOpen) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!countryRootRef.current?.contains(target) && !countryMenuRef.current?.contains(target)) {
        setCountryOpen(false);
        countryTriggerRef.current?.focus();
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCountryOpen(false);
        countryTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [countryOpen]);

  useEffect(() => {
    if (!countryOpen) return;
    const frame = requestAnimationFrame(() => countryOptionRefs.current[activeCountryIndex]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [countryOpen, activeCountryIndex]);

  const canonical = useMemo(
    () => (national.trim() === "" ? null : toCanonicalPhone(national, countryIso2)),
    [national, countryIso2],
  );
  const invalid = national.trim() !== "" && canonical === null;

  const emit = (nextCountry: CountryCode, nextNational: string) => {
    setCountryIso2(nextCountry);
    setNational(nextNational);
    const result = nextNational.trim() === "" ? null : toCanonicalPhone(nextNational, nextCountry);
    onChange(result);
  };

  const toggleCountryMenu = () => {
    if (countryOpen) {
      setCountryOpen(false);
      countryTriggerRef.current?.focus();
      return;
    }

    const trigger = countryRootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(COUNTRY_MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_GUTTER),
      window.innerWidth - width - VIEWPORT_GUTTER,
    );
    const roomBelow = window.innerHeight - rect.bottom - COUNTRY_MENU_GAP - VIEWPORT_GUTTER;
    const roomAbove = rect.top - COUNTRY_MENU_GAP - VIEWPORT_GUTTER;
    const opensAbove = roomBelow < 176 && roomAbove > roomBelow;
    const availableHeight = opensAbove ? roomAbove : roomBelow;

    setCountryMenuPosition({
      left,
      width,
      maxHeight: Math.max(112, Math.min(COUNTRY_MENU_MAX_HEIGHT, availableHeight)),
      ...(opensAbove
        ? { bottom: window.innerHeight - rect.top + COUNTRY_MENU_GAP }
        : { top: rect.bottom + COUNTRY_MENU_GAP }),
    });
    setActiveCountryIndex(Math.max(0, COUNTRIES.findIndex((country) => country.iso2 === countryIso2)));
    setCountryOpen(true);
  };

  const countryMenuStyle: CSSProperties | undefined = countryMenuPosition
    ? {
        left: countryMenuPosition.left,
        width: countryMenuPosition.width,
        maxHeight: countryMenuPosition.maxHeight,
        top: countryMenuPosition.top,
        bottom: countryMenuPosition.bottom,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div dir="ltr" className="flex gap-2">
        <div ref={countryRootRef} className="relative w-24 shrink-0">
          <button
            ref={countryTriggerRef}
            type="button"
            aria-label={t("phoneField.countryLabel")}
            aria-haspopup="listbox"
            aria-expanded={countryOpen}
            onClick={toggleCountryMenu}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!countryOpen) toggleCountryMenu();
              }
            }}
            className="flex min-h-11 w-full items-center justify-between gap-1 rounded-md border border-strong bg-canvas px-3 text-body text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span dir="ltr" className="whitespace-nowrap tabular-nums">+{selectedCountry.callingCode}</span>
            <ChevronDownIcon size={15} className={cn("shrink-0 text-fg-secondary transition-transform", countryOpen && "rotate-180")} />
          </button>
          {countryOpen && countryMenuPosition ? createPortal(
            <div
              ref={countryMenuRef}
              dir={locale === "ar" ? "rtl" : "ltr"}
              className={cn(menuSurfaceClass, "fixed z-popover overflow-y-auto p-1")}
              style={countryMenuStyle}
              role="listbox"
              aria-label={t("phoneField.countryLabel")}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveCountryIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + COUNTRIES.length) % COUNTRIES.length);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  setActiveCountryIndex(event.key === "Home" ? 0 : COUNTRIES.length - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setCountryOpen(false);
                  countryTriggerRef.current?.focus();
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  const country = COUNTRIES[activeCountryIndex];
                  if (country) { emit(country.iso2, national); setCountryOpen(false); countryTriggerRef.current?.focus(); }
                }
              }}
            >
              {COUNTRIES.map((country, index) => {
                const selected = country.iso2 === countryIso2;
                return (
                  <button
                    ref={(element) => { countryOptionRefs.current[index] = element; }}
                    key={country.iso2}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={index === activeCountryIndex ? 0 : -1}
                    onFocus={() => setActiveCountryIndex(index)}
                    className={menuItemClass(selected, "min-h-10 rounded-sm")}
                    onClick={() => {
                      emit(country.iso2, national);
                      setCountryOpen(false);
                      countryTriggerRef.current?.focus();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{countryLabel(country.iso2)}</span>
                    <span dir="ltr" className="shrink-0 tabular-nums text-fg-secondary">+{country.callingCode}</span>
                    {selected ? <CheckIcon size={15} className="shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          ) : null}
        </div>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          className="min-w-0 flex-1"
          value={national}
          onChange={(e) => emit(countryIso2, e.target.value)}
          placeholder={placeholder ?? t("phoneField.nationalPlaceholder")}
          aria-invalid={invalid || Boolean(error) ? true : undefined}
        />
      </div>
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : invalid ? (
        <p className="text-label text-danger">{t("phoneField.invalid")}</p>
      ) : null}
    </div>
  );
}
