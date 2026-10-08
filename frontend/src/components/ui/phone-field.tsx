"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/controls";
import { CountryPicker } from "@/components/ui/country-picker";
import {
  DEFAULT_PHONE_COUNTRY,
  toCanonicalPhone,
  type CanonicalPhone,
} from "@/lib/contact/phone";
import type { CountryCode } from "libphonenumber-js";

/**
 * `[ Egypt 🇪🇬 +20 ] [ 1012345678 ]` — a real ISO-3166 country/calling-code
 * picker (Egypt pre-selected, every other numbering plan still reachable; searchable, on the shared floating surface),
 * parsed and validated client-side by `libphonenumber-js` before the already-
 * canonical E.164 value is ever sent to the server (see `lib/contact/phone.ts`
 * and `profile_set_phone`, which never re-derives it).
 *
 * Country names come from `lib/contact/country-names` — DATA, the same string on
 * the server and in the browser. They are deliberately NOT `Intl.DisplayNames`:
 * that API answers per ICU build, and Node and Chromium disagree for a handful of
 * countries, which made the server's `<option>` text differ from the client's first
 * render (hydration error #418) on every page that draws this field.
 */
export function PhoneField({
  defaultCountryIso2,
  defaultNational,
  onChange,
  onInvalidChange,
  error,
  id,
  placeholder,
  compact = false,
}: {
  defaultCountryIso2?: string | null;
  defaultNational?: string | null;
  /** Fires with the canonical result on every valid keystroke, null while invalid/empty. */
  onChange: (value: CanonicalPhone | null) => void;
  /** Fires when typed digits stop (or start) being a valid number — lets a form refuse to silently drop them. */
  onInvalidChange?: (invalid: boolean) => void;
  error?: string;
  id?: string;
  placeholder?: string;
  /**
   * A narrow country picker for forms where the number itself is the point: the closed picker shows only the flag and
   * calling code of the chosen country (a clipped name reads badly, most of all in Arabic), so the number input gets the room.
   */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [countryIso2, setCountryIso2] = useState<CountryCode>(
    (defaultCountryIso2 as CountryCode) || DEFAULT_PHONE_COUNTRY,
  );
  const [national, setNational] = useState(defaultNational ?? "");

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
    onInvalidChange?.(nextNational.trim() !== "" && result === null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <CountryPicker
          value={countryIso2}
          onChange={(next) => emit(next, national)}
          compact={compact}
          className={compact ? "w-[7rem] shrink-0" : "w-[9.5rem] shrink-0"}
        />
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
