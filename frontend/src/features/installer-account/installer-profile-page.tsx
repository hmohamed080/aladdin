"use client";

import { accountTypeLabel } from "@/lib/i18n/account-type-label";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { menuItemClass } from "@/components/ui/menu";
import {
  BookmarkIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CrownIcon,
  InfinityIcon,
  LightbulbIcon,
  MapPinIcon,
  MinusCircleIcon,
  PlusIcon,
  UserIcon,
} from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import {
  AVAILABILITY_OPTIONS,
  CITIES_BY_GOVERNORATE,
  GOVERNORATE_OPTIONS,
  PROFILE_STEPS,
  QUICK_TIPS,
  SPECIALTIES,
} from "@/features/installer-account-preview/profile-completion-data";
import { InstallerProfileHero } from "@/features/installer-account/installer-profile-hero";
import { PortfolioProjects } from "@/features/installer-account/portfolio-projects";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { saveInstallerProfileAction, type InstallerProfileResult } from "@/server/actions/installer-profile";
import type { PortfolioProject } from "@/server/queries/portfolio-projects";

/** The approved specialty list (design values) and the catalogue trade each one saves as. */
const TRADE_KEY_BY_SPECIALTY: Record<string, string> = {
  "wallpaper-installation": "wallpaper_installation",
  "gypsum-board-installation": "gypsum_board_installation",
  "wood-alternative-installation": "wood_alternative_installation",
  "marble-alternative-installation": "marble_alternative_installation",
  "vinyl-flooring-installation": "vinyl_flooring_installation",
  "hdf-flooring-installation": "hdf_flooring_installation",
  "painter-decorator": "painting",
  "spray-painting": "spray_paint_and_foundation",
  "decorative-finishes": "decorative_paints",
  "wood-finishing": "astarji",
  "plastering-gypsum": "plastering_and_gypsum",
  "epoxy-flooring": "epoxy_flooring",
  "door-installation": "door_installation",
  "futec-installation": "foutek_installation",
};
const SPECIALTY_BY_TRADE_KEY = Object.fromEntries(Object.entries(TRADE_KEY_BY_SPECIALTY).map(([s, t]) => [t, s]));

/** Design availability options and the stored values (`individual_onboarding.prof_availability`). */
const AVAILABILITY_VALUE = { week: "within_week", month: "within_month", "on-demand": "flexible" } as const;
type AvailabilityId = keyof typeof AVAILABILITY_VALUE;
const AVAILABILITY_ID = Object.fromEntries(Object.entries(AVAILABILITY_VALUE).map(([id, v]) => [v, id])) as Record<string, AvailabilityId>;

const PHONE_LIKE_SEQUENCE = /(?:\+?\d[\s-]?){7,}/;

export type InstallerProfileData = {
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  yearsExperience: number;
  tradeKeys: string[];
  bio: string;
  availability: string | null;
  governorate: string | null;
  /** A catalogue city key, or the free text saved when the list did not have the city. */
  city: string | null;
  otherGovernorates: string[];
  projects: PortfolioProject[];
  maxProjects: number;
  maxMedia: number;
  videoEnabled: boolean;
  /** The database's completion (`my_profile_completion`), the same figure the dashboard banner shows. */
  completion: { percent: number; missing: readonly string[] };
  /** `/p/<profile id>` once the profile is public, else null. */
  publicProfileHref: string | null;
};

type FormState = {
  name: string;
  experience: number;
  specialties: string[];
  governorate: string;
  city: string;
  customCity: string;
  about: string;
  availability: AvailabilityId | null;
  otherAreas: boolean;
  areas: string[];
};

function initialState(data: InstallerProfileData): FormState {
  const governorate = data.governorate ?? "";
  const cities = CITIES_BY_GOVERNORATE[governorate] ?? [];
  const known = data.city && cities.some((c) => c.value === data.city);
  return {
    name: data.displayName,
    experience: data.yearsExperience,
    specialties: data.tradeKeys.flatMap((k) => (SPECIALTY_BY_TRADE_KEY[k] ? [SPECIALTY_BY_TRADE_KEY[k]] : [])),
    governorate,
    city: known ? data.city! : data.city ? "other" : cities[0]?.value ?? "",
    customCity: known ? "" : data.city ?? "",
    about: data.bio,
    availability: data.availability ? AVAILABILITY_ID[data.availability] ?? null : null,
    otherAreas: data.otherGovernorates.length > 0,
    areas: data.otherGovernorates,
  };
}

const SAVE_ERROR: Record<Exclude<InstallerProfileResult, { ok: true }>["code"], { ar: string; en: string }> = {
  invalid: { ar: "راجع البيانات وحاول مرة أخرى.", en: "Check the details and try again." },
  phoneInBio: { ar: "لا تضع أرقام تليفونات في تعريف عنك.", en: "Do not include phone numbers in your introduction." },
  name: { ar: "تعذر حفظ الاسم المهني.", en: "The professional name could not be saved." },
  trades: { ar: "تعذر حفظ التخصصات.", en: "The specialties could not be saved." },
  profile: { ar: "تعذر حفظ بيانات الملف.", en: "The profile could not be saved." },
  areas: { ar: "تعذر حفظ نطاق العمل.", en: "The work coverage could not be saved." },
};

/**
 * `/home/profile` for an Installer: the approved "Complete your profile" page (`/preview/installer-account`) on real
 * data. The hero edits the real cover and photo; the four numbered sections are the design's own controls, filled
 * from the saved profile and saved together by "Save" (`saveInstallerProfileAction`); "Work history" is the real
 * portfolio-projects editor. The completion ring is the database's figure (the dashboard banner's too).
 */
export function InstallerProfilePage({ data }: { data: InstallerProfileData }) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(data));
  const [saving, setSaving] = useState<"draft" | "continue" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set: SetField = (key, value) =>
    setForm((f) => ({ ...f, [key]: typeof value === "function" ? (value as (v: FormState[typeof key]) => FormState[typeof key])(f[key]) : value }));

  // The ring and the steps show the saved profile, exactly as the dashboard banner does; they move after a save.
  const missing = new Set(data.completion.missing);
  const percent = data.completion.percent;
  const completedStepIds = new Set<string>([
    ...(["display_name", "years_experience", "activities", "location"].some((k) => missing.has(k)) ? [] : ["basic"]),
    ...(missing.has("availability") ? [] : ["availability"]),
    ...(missing.has("portfolio") ? [] : ["portfolio"]),
    ...(missing.has("location") ? [] : ["coverage"]),
  ]);

  async function save(kind: "draft" | "continue") {
    setSaving(kind);
    setMessage(null);
    const result = await saveInstallerProfileAction({
      displayName: form.name,
      yearsExperience: form.experience,
      tradeKeys: form.specialties.flatMap((s) => (TRADE_KEY_BY_SPECIALTY[s] ? [TRADE_KEY_BY_SPECIALTY[s]] : [])),
      governorate: form.governorate || null,
      city: form.city || null,
      customCity: form.city === "other" ? form.customCity.trim() || null : null,
      bio: form.about,
      availability: form.availability ? AVAILABILITY_VALUE[form.availability] : null,
      otherGovernorates: form.otherAreas ? form.areas : [],
    }).catch(() => ({ ok: false as const, code: "profile" as const }));
    setSaving(null);
    if (!result.ok) {
      setMessage({ ok: false, text: pick(locale, SAVE_ERROR[result.code]) });
      return;
    }
    if (kind === "continue") router.push("/home");
    else {
      setMessage({ ok: true, text: ar ? "تم حفظ ملفك." : "Your profile was saved." });
      router.refresh();
    }
  }

  return (
    <div dir={dir} className="flex w-full min-w-0 flex-col gap-md" data-installer-profile>
      <InstallerProfileHero
        displayName={form.name || data.displayName}
        avatarUrl={data.avatarUrl}
        coverUrl={data.coverUrl}
        title={ar ? "كمّل ملفك الشخصي" : "Complete your profile"}
        subtitle={ar ? "خلّي شغلك يوصل للناس المناسبة" : "Help your work reach the right people"}
        publicProfileHref={data.publicProfileHref}
      />
      <div className="grid min-w-0 gap-md desktop:grid-cols-5">
        <aside className="order-1 flex min-w-0 flex-col gap-md desktop:order-2">
          <ProfileProgress locale={locale} percent={percent} completedStepIds={completedStepIds} name={form.name || data.displayName} avatarUrl={data.avatarUrl} />
          <PremiumProfileCard locale={locale} />
          <QuickTipsCard locale={locale} />
        </aside>

        <form className="order-2 min-w-0 space-y-md desktop:order-1 desktop:col-span-4" onSubmit={(e) => { e.preventDefault(); void save("continue"); }}>
          <BasicInformationSection locale={locale} form={form} set={set} />
          <AvailabilitySection locale={locale} value={form.availability} onChange={(v) => set("availability", v)} />
          <ProfileSection id="portfolio" step={3} title={ar ? "سابقة الأعمال" : "Work history"} description={ar ? "أضف مشاريعك السابقة ليتمكن العملاء من التعرّف على خبرتك وأعمالك." : "Add past projects so clients can understand your experience."}>
            <PortfolioProjects projects={data.projects} maxProjects={data.maxProjects} maxMedia={data.maxMedia} videoEnabled={data.videoEnabled} />
          </ProfileSection>
          <CoverageSection locale={locale} form={form} set={set} />
          <div className="flex flex-col gap-sm rounded-md border border-strong bg-surface p-md shadow-card">
            {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-label", message.ok ? "text-success" : "text-danger")} data-testid="profile-save-message">{message.text}</p> : null}
            <div className="flex flex-col-reverse gap-sm tablet:flex-row tablet:justify-end">
              <Button type="button" variant="outline" className="min-w-44 gap-sm" disabled={saving !== null} onClick={() => void save("draft")} data-testid="profile-save-draft"><BookmarkIcon size={18} />{saving === "draft" ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ كمسودة" : "Save as draft")}</Button>
              <Button type="submit" className="min-w-44 gap-sm" disabled={saving !== null} data-testid="profile-save">{saving === "continue" ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ ومتابعة" : "Save and continue")}<CheckIcon size={18} /></Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Sets one field to a value, or to the result of an updater over its CURRENT value (safe for rapid clicks). */
type SetField = <K extends keyof FormState>(key: K, value: FormState[K] | ((current: FormState[K]) => FormState[K])) => void;

function BasicInformationSection({ locale, form, set }: { locale: Locale; form: FormState; set: SetField }) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const aboutHasPhoneNumber = PHONE_LIKE_SEQUENCE.test(form.about);
  const aboutPhoneError = ar ? "لا تضع أرقام تليفونات في تعريف عنك." : "Do not include phone numbers in your introduction.";

  function toggleSpecialty(value: string) {
    set("specialties", (current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  return (
    <ProfileSection
      id="basic"
      step={1}
      title={ar ? "المعلومات الأساسية" : "Basic information"}
      description={ar ? "أضف بياناتك المهنية الأساسية ليمكن للعملاء التعرف عليك." : "Add the essentials so clients can learn about you."}
    >
      <div className="grid gap-md tablet:grid-cols-12">
        <div className="tablet:col-span-4">
          <LabeledField label={ar ? "الاسم المهني *" : "Professional name *"} htmlFor="professional-name">
            <div className="relative">
              <UserIcon size={20} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-secondary" />
              <Input id="professional-name" className="ps-11" value={form.name} maxLength={80} onChange={(event) => set("name", event.target.value)} />
            </div>
          </LabeledField>
        </div>

        <div className="flex flex-col gap-1.5 tablet:col-span-2">
          <span className="text-label font-medium text-fg-secondary">{ar ? "سنوات الخبرة *" : "Years of experience *"}</span>
          <div className="grid min-h-11 grid-cols-3 overflow-hidden rounded-md border border-strong bg-canvas">
            <button type="button" aria-label={ar ? "تقليل سنوات الخبرة" : "Decrease years"} onClick={() => set("experience", (v) => Math.max(0, v - 1))} className="grid place-items-center border-e text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
              <MinusCircleIcon size={20} />
            </button>
            <output aria-label={ar ? "سنوات الخبرة" : "Years of experience"} className="grid place-items-center text-body-lg font-semibold tabular-nums text-fg">{form.experience}</output>
            <button type="button" aria-label={ar ? "زيادة سنوات الخبرة" : "Increase years"} onClick={() => set("experience", (v) => Math.min(70, v + 1))} className="grid place-items-center border-s text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
              <PlusIcon size={20} />
            </button>
          </div>
        </div>

        <div className="relative min-w-0 tablet:col-span-6">
          <span className="mb-1.5 block text-label font-medium text-fg-secondary">{ar ? "التخصص *" : "Specialties *"}</span>
          <div className="flex h-11 min-w-0 items-center gap-2 overflow-hidden rounded-md border border-strong bg-canvas p-1.5">
            <div className="scrollbar-chip-row flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5">
              {form.specialties.map((value) => {
                const specialty = SPECIALTIES.find((item) => item.value === value);
                return specialty ? <span key={value} className="shrink-0 whitespace-nowrap rounded-pill border bg-surface-2 px-2.5 py-1 text-label font-medium text-fg">{pick(locale, specialty)}</span> : null;
              })}
            </div>
            <button
              ref={trigger}
              type="button"
              aria-label={ar ? "اختيار التخصصات" : "Choose specialties"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronDownIcon size={18} />
            </button>
          </div>
          <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="dialog" placement="bottom-start" matchAnchorWidth>
            <div role="listbox" aria-label={ar ? "قائمة التخصصات" : "Specialties list"} aria-multiselectable="true" className="grid max-h-64 gap-1 overflow-y-auto p-2 tablet:grid-cols-2">
              {SPECIALTIES.map((specialty) => {
                const checked = form.specialties.includes(specialty.value);
                return (
                  <button key={specialty.value} type="button" role="option" aria-selected={checked} onClick={() => toggleSpecialty(specialty.value)} className={menuItemClass(checked, "min-h-10 rounded-sm text-label")}>
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-xs border border-strong", checked && "border-accent bg-accent-solid text-on-accent")}>{checked ? <CheckIcon size={13} /> : null}</span>
                    {pick(locale, specialty)}
                  </button>
                );
              })}
            </div>
          </FloatingMenu>
        </div>

        <div className="tablet:col-span-6">
          <ProfileSelect
            id="governorate"
            label={ar ? "المحافظة *" : "Governorate *"}
            value={form.governorate}
            placeholder={ar ? "اختر المحافظة" : "Choose a governorate"}
            onChange={(value) => {
              set("governorate", value);
              set("city", CITIES_BY_GOVERNORATE[value]?.[0]?.value ?? "other");
              set("customCity", "");
            }}
            options={GOVERNORATE_OPTIONS.map((option) => ({ value: option.value, label: pick(locale, option) }))}
            icon={<MapPinIcon size={19} />}
          />
        </div>
        <div className="tablet:col-span-6">
          <ProfileSelect
            id="city"
            label={ar ? "المدينة *" : "City *"}
            value={form.city}
            placeholder={ar ? "اختر المدينة" : "Choose a city"}
            onChange={(value) => {
              set("city", value);
              if (value !== "other") set("customCity", "");
            }}
            options={(CITIES_BY_GOVERNORATE[form.governorate] ?? []).map((option) => ({ value: option.value, label: pick(locale, option) }))}
            icon={<BuildingIcon size={19} />}
            customEntry={{
              optionValue: "other",
              value: form.customCity,
              onChange: (v) => set("customCity", v),
              inputLabel: ar ? "اسم المدينة *" : "City name *",
              placeholder: ar ? "اكتب اسم مدينتك" : "Enter your city",
              confirmLabel: ar ? "تأكيد" : "Confirm",
            }}
          />
        </div>
        <div className="tablet:col-span-12">
          <LabeledField label={ar ? "تعريف عني (اختياري)" : "About me (optional)"} htmlFor="installer-about">
            <div className="relative">
              <Textarea
                id="installer-about"
                value={form.about}
                onChange={(event) => {
                  const next = event.target.value;
                  set("about", next);
                  event.currentTarget.setCustomValidity(PHONE_LIKE_SEQUENCE.test(next) ? aboutPhoneError : "");
                }}
                placeholder={ar ? "اكتب نبذة قصيرة عن خبرتك وطريقة شغلك" : "Share a short introduction to your experience and how you work"}
                maxLength={250}
                aria-invalid={aboutHasPhoneNumber}
                aria-describedby="installer-about-counter installer-about-error"
                className="min-h-24 resize-y pb-8"
              />
              {aboutHasPhoneNumber ? <span id="installer-about-error" role="alert" className="pointer-events-none absolute bottom-2 start-3 text-caption text-danger">{aboutPhoneError}</span> : null}
              <span id="installer-about-counter" className="pointer-events-none absolute bottom-2 end-3 text-caption tabular-nums text-fg-secondary" aria-live="polite">
                {form.about.length}/250
              </span>
            </div>
          </LabeledField>
        </div>
      </div>
    </ProfileSection>
  );
}

function AvailabilitySection({ locale, value, onChange }: { locale: Locale; value: AvailabilityId | null; onChange: (value: AvailabilityId) => void }) {
  const ar = locale === "ar";
  return (
    <ProfileSection id="availability" step={2} title={ar ? "إتاحة العمل" : "Work availability"} description={ar ? "متى يمكنك بدء العمل؟" : "When can you start a new job?"}>
      <div className="grid gap-sm tablet:grid-cols-3">
        {AVAILABILITY_OPTIONS.map((option) => {
          const selected = value === option.id;
          return (
            <button key={option.id} type="button" aria-pressed={selected} onClick={() => onChange(option.id)} className={cn("relative flex min-h-24 flex-col items-center justify-center gap-xs rounded-md border px-md text-body-lg font-semibold transition-[box-shadow,border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", selected ? "border-primary bg-primary text-primary-foreground shadow-inset hover:ring-2 hover:ring-accent hover:shadow-raised" : "border-strong bg-canvas text-fg hover:border-accent hover:bg-accent-solid/10")}>
              {selected ? <span className="absolute end-3 top-3 grid h-5 w-5 place-items-center rounded-pill bg-bronze text-on-accent"><CheckIcon size={13} /></span> : null}
              <span className={cn("text-accent", selected && "text-primary-foreground")}>
                {option.id === "on-demand" ? <InfinityIcon size={27} /> : <CalendarIcon size={27} />}
              </span>
              <span>{pick(locale, option.label)}</span>
            </button>
          );
        })}
      </div>
    </ProfileSection>
  );
}

function CoverageSection({ locale, form, set }: { locale: Locale; form: FormState; set: SetField }) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const availableAreas = GOVERNORATE_OPTIONS.filter((option) => !form.areas.includes(option.value) && option.value !== form.governorate);

  return (
    <ProfileSection id="coverage" step={4} title={ar ? "نطاق العمل" : "Work coverage"} description={ar ? "هل تعمل في محافظات أخرى؟" : "Do you work in other governorates?"}>
      <div className="grid items-center gap-md tablet:grid-cols-3">
        <label className={cn("flex cursor-pointer items-center justify-between gap-md rounded-md border border-strong bg-canvas p-md", !form.otherAreas && "tablet:col-span-3")}>
          <span className="font-medium text-fg">{ar ? "أعمل في محافظات أخرى" : "I work in other governorates"}</span>
          <input type="checkbox" checked={form.otherAreas} onChange={(event) => { set("otherAreas", event.target.checked); setOpen(false); }} className="peer sr-only" />
          <span className={cn("relative h-7 w-12 shrink-0 rounded-pill border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-focus", form.otherAreas ? "border-accent bg-accent-solid" : "border-strong bg-surface-2")}>
            <span className={cn("absolute top-1 h-5 w-5 rounded-pill bg-canvas shadow-raised transition-[left,right]", form.otherAreas ? "right-1" : "left-1")} />
          </span>
        </label>
        {form.otherAreas ? (
          <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-strong bg-canvas p-2 tablet:col-span-2">
            <MapPinIcon size={18} className="text-bronze" />
            {form.areas.map((value) => {
              const area = GOVERNORATE_OPTIONS.find((option) => option.value === value);
              return area ? (
                <button key={value} type="button" onClick={() => set("areas", (current) => current.filter((a) => a !== value))} aria-label={ar ? `إزالة ${area.ar}` : `Remove ${area.en}`} className="inline-flex items-center gap-1.5 rounded-pill border bg-surface-2 px-3 py-1.5 text-label font-medium text-fg hover:border-danger">
                  {pick(locale, area)}<CheckIcon size={13} className="text-accent" />
                </button>
              ) : null;
            })}
            <div className="relative">
              <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="rounded-pill px-3 py-1.5 text-label font-semibold text-accent hover:bg-accent-solid/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {ar ? "+ إضافة محافظة" : "+ Add governorate"}
              </button>
              <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="listbox" aria-label={ar ? "اختر محافظة إضافية" : "Choose another governorate"} placement="top-start" className="w-56 max-h-72 overflow-y-auto p-1">
                {availableAreas.map((option) => (
                  <button key={option.value} type="button" role="option" aria-selected="false" className={menuItemClass(false, "min-h-10 rounded-sm")} onClick={() => { set("areas", (current) => [...current, option.value]); setOpen(false); }}>
                    <MapPinIcon size={16} className="text-accent" />
                    <span className="flex-1">{pick(locale, option)}</span>
                  </button>
                ))}
                {availableAreas.length === 0 ? <p className="px-3 py-2 text-label text-fg-secondary">{ar ? "تمت إضافة كل المحافظات" : "All governorates added"}</p> : null}
              </FloatingMenu>
            </div>
          </div>
        ) : null}
      </div>
    </ProfileSection>
  );
}

function ProfileSection({
  id,
  step,
  title,
  description,
  children,
}: {
  id: string;
  step: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="rounded-md border border-strong bg-surface p-md shadow-card tablet:p-lg">
      <div className="mb-md flex items-start gap-sm border-b pb-md">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-primary text-label font-semibold text-primary-foreground">
          {step}
        </span>
        <div>
          <h2 id={`${id}-title`} className="text-title text-fg">{title}</h2>
          <p className="mt-1 text-label text-fg-secondary">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}


function ProfileSelect({
  id,
  label,
  value,
  options,
  onChange,
  icon,
  customEntry,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  icon?: ReactNode;
  placeholder?: string;
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
  const displayedLabel = customEntryActive && customEntry.value.trim() ? customEntry.value.trim() : selected?.label ?? placeholder ?? "";

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
        aria-labelledby={`${id}-label ${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-sm rounded-md border border-strong bg-canvas px-3 text-start text-body-lg text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="flex min-w-0 items-center gap-sm">
          {icon ? <span className="shrink-0 text-fg-secondary">{icon}</span> : null}
          <span className="truncate">{displayedLabel}</span>
        </span>
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
                {active ? <CheckIcon size={16} className="text-accent" /> : null}
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
    </div>
  );
}


function ProfileProgress({ locale, percent, completedStepIds, name, avatarUrl }: { locale: Locale; percent: number; completedStepIds: Set<string>; name: string; avatarUrl: string | null }) {
  return (
    <>
      <MobileProfileSummary locale={locale} percent={percent} completedStepIds={completedStepIds} name={name} avatarUrl={avatarUrl} />
      <DesktopProfileProgress locale={locale} percent={percent} completedStepIds={completedStepIds} />
    </>
  );
}

/** Phones: who this profile is, how complete it is, and the four steps as one compact row. */


function MobileProfileSummary({ locale, percent, completedStepIds, name, avatarUrl }: { locale: Locale; percent: number; completedStepIds: Set<string>; name: string; avatarUrl: string | null }) {
  const ar = locale === "ar";
  const { t } = useI18n();
  return (
    <section aria-label={ar ? "ملخص اكتمال الملف" : "Profile completion summary"} className="rounded-md border border-strong bg-surface p-md shadow-card tablet:hidden">
      <div className="flex items-center gap-md">
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-pill border-2 border-accent-solid bg-surface-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-title font-bold text-fg">{Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?"}</span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body-lg font-bold text-fg"><bdi dir="auto">{name}</bdi></p>
          <p className="truncate text-label text-fg-secondary">{accountTypeLabel(t, "installer_technician", "person")}</p>
        </div>
      </div>
      <div className="mt-md flex items-baseline justify-between gap-sm">
        <span className="text-label font-medium text-fg-secondary">{ar ? "اكتمال الملف الشخصي" : "Profile completion"}</span>
        <strong data-testid="profile-page-percent" className="text-headline font-bold tabular-nums text-fg">{percent}%</strong>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={ar ? "اكتمال الملف الشخصي" : "Profile completion"} className="mt-1.5 h-2.5 overflow-hidden rounded-pill bg-surface-2">
        <div className="h-full rounded-pill bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <ol className="mt-md grid grid-cols-4 gap-xs">
        {PROFILE_STEPS.map((step) => (
          <li key={step.id}>
            <a href={`#${step.id}`} className={cn("flex min-h-12 flex-col items-center gap-1 text-center text-caption leading-tight transition-colors hover:text-fg", completedStepIds.has(step.id) ? "font-semibold text-fg" : "text-fg-secondary")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-pill text-caption font-semibold", completedStepIds.has(step.id) ? "bg-primary text-primary-foreground" : "bg-surface-2 text-fg-muted")}>{step.number}</span>
              <span className="line-clamp-2">{pick(locale, step.label)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}


function DesktopProfileProgress({ locale, percent, completedStepIds }: { locale: Locale; percent: number; completedStepIds: Set<string> }) {
  const ar = locale === "ar";
  const circumference = 251;
  const progressLength = circumference * (percent / 100);
  const segmentSpan = circumference / 4;
  const segmentGap = 5;
  const segmentColors = ["var(--primary)", "var(--accent-solid)", "var(--bronze-sem)", "var(--surface-2)"];
  return (
    <section aria-label={ar ? "تقدم إكمال الملف" : "Profile completion progress"} className="@container hidden rounded-md border border-strong bg-surface p-md shadow-card tablet:block">
      <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-sm">
        <h2 className="whitespace-nowrap text-caption font-semibold text-fg @[13rem]:text-label">{ar ? "مستوى إكمال الملف" : "Profile completion"}</h2>
        <div className="relative grid h-16 w-16 shrink-0 place-items-center">
          <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90 text-bronze" aria-hidden="true">
            <circle cx="48" cy="48" r="40" fill="none" stroke="var(--border-strong)" strokeWidth="10" opacity="0.28" />
            {segmentColors.map((color, index) => {
              const start = index * segmentSpan;
              const length = segmentSpan - segmentGap;
              const completedLength = Math.min(Math.max(progressLength - start, 0), length);
              return (
                <g key={color}>
                  <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" opacity="0.22" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} />
                  {completedLength > 0 ? <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${completedLength} ${circumference - completedLength}`} strokeDashoffset={-start} /> : null}
                </g>
              );
            })}
          </svg>
          <strong data-testid="profile-page-percent" className="absolute text-body-lg font-bold tabular-nums text-fg">{percent}%</strong>
        </div>
      </div>
      <ol className="relative mt-lg space-y-1">
        {PROFILE_STEPS.map((step, index) => (
          <li key={step.id} className="relative">
            {index < PROFILE_STEPS.length - 1 ? <span aria-hidden="true" className={cn("absolute top-7 z-0 h-4 w-px bg-[var(--border)]", ar ? "right-3.5" : "left-3.5")} /> : null}
            <a href={`#${step.id}`} className={cn("flex min-h-10 items-center gap-sm whitespace-nowrap px-0 text-caption transition-colors hover:text-fg @[13rem]:text-label", completedStepIds.has(step.id) ? "font-semibold text-fg" : "text-fg-secondary opacity-50")}>
              <span className={cn("relative z-raised grid h-7 w-7 shrink-0 place-items-center rounded-pill text-caption font-semibold", completedStepIds.has(step.id) ? "bg-primary text-primary-foreground" : "bg-surface-2 text-fg-muted")}>{step.number}</span>
              <span className="min-w-0 origin-right scale-100">{pick(locale, step.label)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}


function PremiumProfileCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section className="relative hidden min-h-52 overflow-hidden rounded-md border border-strong bg-primary text-primary-foreground shadow-card tablet:block">
      <Image src="/assets/installer-account/profile-completion-hero-2026.png" alt="" fill sizes="(min-width: 1024px) 20vw, 100vw" className="object-cover object-left" />
      <div className="absolute inset-0 bg-primary/45" />
      <div className="relative flex min-h-52 flex-col items-center justify-center p-md text-center">
        <span className="mb-md grid h-12 w-12 place-items-center rounded-pill border border-primary-foreground/60 bg-primary-foreground/15"><CrownIcon size={27} /></span>
        <h2 className="text-title">{ar ? "ملفك المميز" : "Your standout profile"}</h2>
        <p className="mt-1 text-body leading-relaxed text-primary-foreground/90">{ar ? "يوصلك لمزيد من الفرص المناسبة" : "Connects you with more relevant opportunities"}</p>
      </div>
    </section>
  );
}


function QuickTipsCard({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section className="hidden rounded-md border border-strong bg-surface p-lg shadow-card tablet:block">
      <h2 className="flex items-center gap-sm text-title text-bronze"><LightbulbIcon size={24} />{ar ? "نصائح سريعة" : "Quick tips"}</h2>
      <ul className="mt-md space-y-sm">
        {QUICK_TIPS.map((tip) => <li key={tip.en} className="flex items-start gap-sm text-label leading-relaxed text-fg-secondary"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-pill border border-bronze text-bronze"><CheckIcon size={12} /></span>{pick(locale, tip)}</li>)}
      </ul>
    </section>
  );
}
