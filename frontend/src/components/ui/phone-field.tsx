"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select } from "@/components/ui/controls";
import {
  DEFAULT_PHONE_COUNTRY,
  listPhoneCountries,
  toCanonicalPhone,
  type CanonicalPhone,
} from "@/lib/contact/phone";
import type { CountryCode } from "libphonenumber-js";

/** `EG` -> 🇪🇬, via the regional-indicator Unicode trick — no flag image assets. */
function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const COUNTRIES = listPhoneCountries();

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
}: {
  defaultCountryIso2?: string | null;
  defaultNational?: string | null;
  /** Fires with the canonical result on every valid keystroke, null while invalid/empty. */
  onChange: (value: CanonicalPhone | null) => void;
  error?: string;
  id?: string;
}) {
  const { t, locale } = useI18n();
  const [countryIso2, setCountryIso2] = useState<CountryCode>(
    (defaultCountryIso2 as CountryCode) || DEFAULT_PHONE_COUNTRY,
  );
  const [national, setNational] = useState(defaultNational ?? "");

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);

  const countryLabel = (iso2: string) => displayNames?.of(iso2) ?? iso2;

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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Select
          aria-label={t("phoneField.countryLabel")}
          value={countryIso2}
          onChange={(e) => emit(e.target.value as CountryCode, national)}
          className="w-[9.5rem] shrink-0"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {flagEmoji(c.iso2)} {countryLabel(c.iso2)} +{c.callingCode}
            </option>
          ))}
        </Select>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          dir="ltr"
          className="flex-1"
          value={national}
          onChange={(e) => emit(countryIso2, e.target.value)}
          placeholder={t("phoneField.nationalPlaceholder")}
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
