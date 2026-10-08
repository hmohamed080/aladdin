"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import {
  BuildingIcon,
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  PackageIcon,
  PaintRollerIcon,
  SendIcon,
  StorefrontIcon,
} from "@/components/ui/icons";
import { menuItemClass } from "@/components/ui/menu";
import dynamic from "next/dynamic";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import {
  INSTALLER_CONTENT_FRAME_CLASS,
  INSTALLER_SHELL_GUTTER_CLASS,
} from "@/features/installer-dashboard-preview/installer-layout";
import { useI18n } from "@/lib/i18n/context";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import {
  CITIES_BY_GOVERNORATE,
  GOVERNORATE_OPTIONS,
} from "@/lib/installer/location-data";
import { cn } from "@/lib/ui/cn";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { FloatingMenu } from "@/components/ui/floating-menu";

// Intl country names differ between Node and browser ICU versions; keep the
// shared control client-rendered here (same approach as the settings preview).
const PhoneField = dynamic(() => import("@/features/installer-dashboard-preview/installer-phone-field").then((module) => module.InstallerPhoneField), {
  ssr: false,
  loading: () => <div className="h-11 rounded-md border bg-canvas" aria-busy="true" />,
});

const SHOWROOM_ACTIVITIES = [
  "decor_showroom",
  "paint_showroom",
  "decor_and_paint_showroom",
  "building_and_finishing_supplies_retailer",
] as const;

type ShowroomActivity = (typeof SHOWROOM_ACTIVITIES)[number];
type FieldName = "name" | "governorate" | "city" | "activity" | "phone";
type Errors = Partial<Record<FieldName, string>>;

const copy = {
  ar: {
    heroTitle: "أضف معرضًا أعرفه",
    heroSubtitle: "ساعدنا في توسيع شبكة المعارض على علاء الدين",
    sectionTitle: "بيانات المعرض",
    sectionBody: "أدخل بيانات المعرض بدقة لتساعدنا في مراجعته والتواصل معه",
    name: "اسم المعرض *",
    namePlaceholder: "اكتب اسم المعرض كما هو معروف",
    governorate: "المحافظة *",
    city: "المدينة *",
    chooseGovernorate: "اختر المحافظة",
    chooseCity: "اختر المدينة",
    cityFirst: "اختر المحافظة أولًا",
    activity: "نوع المعرض *",
    phone: "رقم هاتف المعرض *",
    phonePlaceholder: "مثال: 01012345678",
    customCityLabel: "اسم المدينة *",
    customCityPlaceholder: "اكتب اسم المدينة",
    confirmCity: "تأكيد",
    note: "ملاحظة (اختياري)",
    notePlaceholder: "أضف أي معلومات تساعدنا في الوصول إلى المعرض",
    submit: "إرسال الطلب",
    submitted: "تمت محاكاة إرسال الطلب",
    success: "تمت محاكاة الإرسال داخل المعاينة فقط، ولم تُحفظ أي بيانات.",
    required: "هذا الحقل مطلوب.",
    phoneError: "أدخل رقم هاتف صحيحًا.",
    activities: {
      decor_showroom: "معرض ديكور",
      paint_showroom: "معرض دهانات",
      decor_and_paint_showroom: "ديكور ودهانات",
      building_and_finishing_supplies_retailer: "موان",
    },
  },
  en: {
    heroTitle: "Add a showroom I know",
    heroSubtitle: "Help us grow Aladdin's trusted showroom network",
    sectionTitle: "Showroom details",
    sectionBody: "Enter accurate details so we can review and contact the showroom",
    name: "Showroom name *",
    namePlaceholder: "Enter the name customers know",
    governorate: "Governorate *",
    city: "City *",
    chooseGovernorate: "Choose a governorate",
    chooseCity: "Choose a city",
    cityFirst: "Choose a governorate first",
    activity: "Showroom type *",
    phone: "Showroom phone number *",
    phonePlaceholder: "e.g. 01012345678",
    customCityLabel: "City name *",
    customCityPlaceholder: "Enter the city name",
    confirmCity: "Confirm",
    note: "Note (optional)",
    notePlaceholder: "Add any information that will help us reach the showroom",
    submit: "Send request",
    submitted: "Request simulated",
    success: "Submission was simulated in this preview only. No data was saved.",
    required: "This field is required.",
    phoneError: "Enter a valid phone number.",
    activities: {
      decor_showroom: "Decor showroom",
      paint_showroom: "Paint showroom",
      decor_and_paint_showroom: "Decor and paint",
      building_and_finishing_supplies_retailer: "Building supplies",
    },
  },
} as const;

const ACTIVITY_ICONS = {
  decor_showroom: LayersIcon,
  paint_showroom: PaintRollerIcon,
  decor_and_paint_showroom: BuildingIcon,
  building_and_finishing_supplies_retailer: PackageIcon,
} as const;

function ReferralLocationSelect({
  id,
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled,
  error,
  customEntry,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  customEntry?: {
    optionValue: string;
    value: string;
    onChange: (value: string) => void;
    inputLabel: string;
    placeholder: string;
    confirmLabel: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const customEntryActive = customEntry?.optionValue === value;
  const displayedLabel = customEntryActive && customEntry.value.trim()
    ? customEntry.value.trim()
    : selected?.label ?? placeholder;

  useEffect(() => {
    if (open && customEntryActive) customInputRef.current?.focus();
  }, [customEntryActive, open]);

  return (
    <div className="relative flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label font-medium text-fg-secondary">{label}</span>
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-sm rounded-md border border-strong bg-canvas px-3 text-start text-body-lg text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={cn("truncate", !selected && !customEntryActive && "text-fg-muted")}>{displayedLabel}</span>
        <ChevronDownIcon size={17} className={cn("shrink-0 text-fg-secondary transition-transform", open && "rotate-180")} />
      </button>
      <FloatingMenu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={trigger}
          role="listbox"
          aria-labelledby={`${id}-label`}
          placement="bottom-start"
          matchAnchorWidth
          className="max-h-72 overflow-y-auto p-1"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={menuItemClass(active, "min-h-10 rounded-sm")}
                onClick={() => {
                  onChange(option.value);
                  if (option.value !== customEntry?.optionValue) setOpen(false);
                }}
              >
                <span className="flex-1">{option.label}</span>
                {active ? <CheckIcon size={16} className="shrink-0 text-accent" /> : null}
              </button>
            );
          })}
          {customEntryActive ? (
            <div className="mt-1 border-t border-strong p-2">
              <label htmlFor={`${id}-custom-entry`} className="mb-1.5 block text-caption font-medium text-fg-secondary">{customEntry.inputLabel}</label>
              <div className="flex items-center gap-2">
                <Input
                  ref={customInputRef}
                  id={`${id}-custom-entry`}
                  value={customEntry.value}
                  onChange={(event) => customEntry.onChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && customEntry.value.trim()) {
                      event.preventDefault();
                      setOpen(false);
                    }
                  }}
                  placeholder={customEntry.placeholder}
                  className="min-w-0 flex-1"
                />
                <Button type="button" size="sm" disabled={!customEntry.value.trim()} onClick={() => setOpen(false)}>{customEntry.confirmLabel}</Button>
              </div>
            </div>
          ) : null}
        </FloatingMenu>
      {error ? <p id={`${id}-error`} role="alert" className="text-label text-danger">{error}</p> : null}
    </div>
  );
}

export function InstallerShowroomReferralPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const c = copy[locale];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [governorate, setGovernorate] = useState("");
  const [city, setCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [activity, setActivity] = useState<ShowroomActivity | "">("");
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const cityOptions = governorate ? CITIES_BY_GOVERNORATE[governorate] ?? [] : [];

  const clearError = (field: FieldName) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Errors = {};

    if (!String(data.get("showroomName") ?? "").trim()) next.name = c.required;
    if (!governorate) next.governorate = c.required;
    if (!city || (city === "other" && !customCity.trim())) next.city = c.required;
    if (!activity) next.activity = c.required;
    if (!phone) next.phone = c.phoneError;

    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = event.currentTarget.querySelector<HTMLElement>("[aria-invalid='true']");
      first?.focus();
      return;
    }

    setSubmitted(true);
  };

  return (
    <div data-installer-showroom-referral-preview="" dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="my-showrooms"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-4 pb-8 pt-2 tablet:pb-10 tablet:pt-3`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md`}>
          <section className="relative isolate overflow-hidden rounded-lg border border-strong bg-surface" aria-labelledby="referral-page-title">
            <div dir="ltr" className="relative flex flex-col overflow-hidden tablet:block tablet:min-h-48 desktop:min-h-52">
              {/* Phones: a short artwork strip with the title on a solid surface
                  beneath it, because the baked-in text panel only exists at wider crops. */}
              <div className="relative h-32 tablet:absolute tablet:inset-0 tablet:h-auto">
                <Image
                  src="/assets/installer-network/showroom-referral-hero.png"
                  alt=""
                  fill
                  priority
                  sizes="100vw"
                  className="object-cover object-left"
                />
              </div>
              <div dir={dir} className="relative z-raised flex w-full flex-col justify-center px-md py-md text-start tablet:absolute tablet:inset-y-0 tablet:right-0 tablet:w-[44%] tablet:px-xl tablet:text-center desktop:px-12">
                <h1 id="referral-page-title" className="text-title font-bold tracking-tight text-fg tablet:text-headline desktop:text-display">
                  {c.heroTitle}
                </h1>
                <p className="mt-xs text-label leading-relaxed text-fg-secondary tablet:text-body-lg">{c.heroSubtitle}</p>
              </div>
            </div>
          </section>

          <section className="relative isolate overflow-visible bg-canvas py-sm tablet:py-md desktop:py-lg" aria-labelledby="showroom-data-title">
            <span className="pointer-events-none absolute end-0 top-28 h-64 w-64 rounded-pill border border-accent/20" aria-hidden="true" />
            <span className="pointer-events-none absolute end-0 top-40 h-48 w-48 rounded-pill border border-accent/30" aria-hidden="true" />

            <div dir="ltr" className="relative grid items-center gap-lg desktop:grid-cols-[minmax(0,2.15fr)_minmax(18rem,.85fr)] desktop:gap-xl">
              <div dir={dir} className="rounded-lg border border-strong bg-surface p-md shadow-card tablet:p-lg">
                <header className="mb-md flex items-center gap-md">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-accent-solid/10 text-accent-solid">
                    <StorefrontIcon size={27} />
                  </span>
                  <div>
                    <h2 id="showroom-data-title" className="text-title font-bold text-fg">{c.sectionTitle}</h2>
                    <p className="mt-1 text-label leading-relaxed text-fg-secondary">{c.sectionBody}</p>
                  </div>
                </header>

                <form noValidate className="space-y-sm" onSubmit={submit}>
                  <LabeledField label={c.name} htmlFor="showroomName" error={errors.name}>
                    <Input
                      id="showroomName"
                      name="showroomName"
                      placeholder={c.namePlaceholder}
                      maxLength={120}
                      aria-invalid={Boolean(errors.name) || undefined}
                      onChange={() => clearError("name")}
                    />
                  </LabeledField>

                  <div className="grid gap-md tablet:grid-cols-2">
                    <ReferralLocationSelect
                        id="referralGovernorate"
                        label={c.governorate}
                        value={governorate}
                        placeholder={c.chooseGovernorate}
                        error={errors.governorate}
                        options={GOVERNORATE_OPTIONS.map((option) => ({ value: option.value, label: pick(locale, option) }))}
                        onChange={(value) => {
                          setGovernorate(value);
                          setCity("");
                          setCustomCity("");
                          clearError("governorate");
                          clearError("city");
                        }}
                      />

                    <ReferralLocationSelect
                        id="referralCity"
                        label={c.city}
                        value={city}
                        placeholder={governorate ? c.chooseCity : c.cityFirst}
                        disabled={!governorate}
                        error={errors.city}
                        options={cityOptions.map((option) => ({ value: option.value, label: pick(locale, option) }))}
                        onChange={(value) => {
                          setCity(value);
                          if (value !== "other") setCustomCity("");
                          clearError("city");
                        }}
                        customEntry={{
                          optionValue: "other",
                          value: customCity,
                          onChange: (value) => {
                            setCustomCity(value);
                            if (value.trim()) clearError("city");
                          },
                          inputLabel: c.customCityLabel,
                          placeholder: c.customCityPlaceholder,
                          confirmLabel: c.confirmCity,
                        }}
                      />
                  </div>

                  <fieldset aria-invalid={Boolean(errors.activity) || undefined} className="space-y-1.5">
                    <legend className="text-label font-medium text-fg-secondary">{c.activity}</legend>
                    <div className="grid grid-cols-2 gap-sm desktop:grid-cols-4">
                      {SHOWROOM_ACTIVITIES.map((option) => {
                        const Icon = ACTIVITY_ICONS[option];
                        const selected = activity === option;
                        return (
                          <label
                            key={option}
                            className={cn(
                              "relative flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border bg-canvas px-sm py-sm text-center transition-[border-color,background-color,color] focus-within:ring-2 focus-within:ring-focus",
                              selected ? "border-accent-solid bg-accent-solid/10 text-fg" : "border-strong text-fg-secondary hover:bg-surface-2",
                            )}
                          >
                            <input
                              type="radio"
                              name="showroomActivity"
                              value={option}
                              checked={selected}
                              onChange={() => {
                                setActivity(option);
                                clearError("activity");
                              }}
                              className="sr-only"
                            />
                            <span className={cn("absolute end-2 top-2 grid h-5 w-5 place-items-center rounded-pill border", selected ? "border-accent-solid bg-accent-solid text-on-accent" : "border-strong bg-surface")}>
                              {selected ? <CheckIcon size={12} /> : null}
                            </span>
                            <Icon size={25} className="text-accent-solid" />
                            <span className="text-label font-semibold leading-snug">{c.activities[option]}</span>
                          </label>
                        );
                      })}
                    </div>
                    {errors.activity ? <p role="alert" className="text-label text-danger">{errors.activity}</p> : null}
                  </fieldset>

                  <div className="space-y-1.5">
                    <label htmlFor="showroomPhone" className="text-label font-medium text-fg-secondary">{c.phone}</label>
                    <PhoneField
                      id="showroomPhone"
                      placeholder={c.phonePlaceholder}
                      onChange={(value) => {
                        setPhone(value);
                        if (value) clearError("phone");
                      }}
                      error={errors.phone}
                    />
                  </div>

                  <LabeledField label={c.note} htmlFor="showroomNote">
                    <Textarea id="showroomNote" name="note" maxLength={600} placeholder={c.notePlaceholder} className="min-h-24 resize-y" />
                  </LabeledField>

                  {submitted ? (
                    <div role="status" className="flex items-start gap-sm rounded-md border border-accent/45 bg-accent/10 p-md text-body text-fg">
                      <CheckIcon size={18} className="mt-0.5 shrink-0 text-accent" />
                      <span>{c.success}</span>
                    </div>
                  ) : null}

                  <Button type="submit" disabled={submitted} className="min-h-12 w-full text-body-lg">
                    <SendIcon size={19} />
                    {submitted ? c.submitted : c.submit}
                  </Button>
                </form>
              </div>

              <div dir={dir} className="relative hidden h-full min-h-72 items-center justify-center tablet:flex tablet:min-h-80 desktop:min-h-0" aria-hidden="true">
                <span className="absolute h-64 w-64 rounded-pill bg-accent-solid/10 desktop:h-72 desktop:w-72" />
                <span className="absolute h-72 w-72 rounded-pill border border-accent/35 desktop:h-80 desktop:w-80" />
                <Image
                  src="/assets/installer-network/showroom-referral-building.png"
                  alt=""
                  width={768}
                  height={512}
                  sizes="34vw"
                  className="relative z-raised h-auto w-full max-w-[40rem] object-contain desktop:w-[135%]"
                />
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
