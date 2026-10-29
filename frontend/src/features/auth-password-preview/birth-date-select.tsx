"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Select } from "@/components/ui/controls";
import { MINIMUM_SIGN_UP_AGE } from "./password-policy";

const OLDEST_YEAR = 1900;

function daysIn(month: number, year: number): number {
  // Day 0 of the next month is the last day of this one; a leap year only matters once the year is chosen.
  return new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();
}

/**
 * Birthday as three site-styled dropdowns (Month · Day · Year, Instagram style)
 * instead of the browser's date picker, whose calendar pop-up cannot be themed.
 * The form submits ONE hidden `birthDate` (YYYY-MM-DD) once all three are
 * chosen; the server re-checks it (parseBirthDate: real date, 18+).
 */
export function BirthDateSelect({ invalid, describedBy }: { invalid?: boolean; describedBy?: string }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en", { month: "long", timeZone: "UTC" }).format(Date.UTC(2000, i, 1)),
  );
  const latestYear = new Date().getFullYear() - MINIMUM_SIGN_UP_AGE;
  const years = Array.from({ length: latestYear - OLDEST_YEAR + 1 }, (_, i) => latestYear - i);
  const dayCount = month ? daysIn(Number(month), Number(year)) : 31;
  const value = month && day && year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";

  const onMonthOrYear = (nextMonth: string, nextYear: string) => {
    // Keep the day valid when the month (or a leap year) shortens it.
    if (day && nextMonth && Number(day) > daysIn(Number(nextMonth), Number(nextYear))) setDay("");
  };

  const common = { required: true, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  return (
    <div role="group" aria-labelledby="birthDateLabel" className="grid grid-cols-[1.4fr_1fr_1.2fr] gap-xs" dir="ltr">
      <input type="hidden" name="birthDate" value={value} />
      <Select
        id="birthMonth"
        aria-label={t("authPasswordPreview.signUp.birthMonth")}
        value={month}
        onChange={(e) => { setMonth(e.target.value); onMonthOrYear(e.target.value, year); }}
        {...common}
      >
        <option value="" disabled>{t("authPasswordPreview.signUp.birthMonth")}</option>
        {monthNames.map((name, i) => (
          <option key={name} value={String(i + 1)}>{name}</option>
        ))}
      </Select>
      <Select id="birthDay" aria-label={t("authPasswordPreview.signUp.birthDay")} value={day} onChange={(e) => setDay(e.target.value)} {...common}>
        <option value="" disabled>{t("authPasswordPreview.signUp.birthDay")}</option>
        {Array.from({ length: dayCount }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
        ))}
      </Select>
      <Select
        id="birthYear"
        aria-label={t("authPasswordPreview.signUp.birthYear")}
        value={year}
        onChange={(e) => { setYear(e.target.value); onMonthOrYear(month, e.target.value); }}
        {...common}
      >
        <option value="" disabled>{t("authPasswordPreview.signUp.birthYear")}</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </Select>
    </div>
  );
}
