"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/controls";
import { CountryPicker } from "@/components/ui/country-picker";
import { DEFAULT_PHONE_COUNTRY, toCanonicalPhone, type CanonicalPhone } from "@/lib/contact/phone";
import { useI18n } from "@/lib/i18n/context";
import type { CountryCode } from "libphonenumber-js";

/**
 * Installer phone field: the same canonical parsing as the shared `PhoneField` (libphonenumber-js, Egypt first), with
 * the same searchable country picker (`components/ui/country-picker`) — the project's rounded listbox on the shared
 * floating surface, never a native select whose popup the OS draws with square corners.
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
  const { t } = useI18n();
  const [country, setCountry] = useState<CountryCode>((defaultCountryIso2 as CountryCode) || DEFAULT_PHONE_COUNTRY);
  const [national, setNational] = useState("");

  const canonical = useMemo(() => (national.trim() === "" ? null : toCanonicalPhone(national, country)), [national, country]);
  const invalid = national.trim() !== "" && canonical === null;

  const emit = (nextCountry: CountryCode, nextNational: string) => {
    setCountry(nextCountry);
    setNational(nextNational);
    onChange(nextNational.trim() === "" ? null : toCanonicalPhone(nextNational, nextCountry));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <CountryPicker value={country} onChange={(next) => emit(next, national)} className="shrink-0" />
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
      </div>
      {error ? (
        <p role="alert" className="text-label text-danger">{error}</p>
      ) : invalid ? (
        <p className="text-label text-danger">{t("phoneField.invalid")}</p>
      ) : null}
    </div>
  );
}
