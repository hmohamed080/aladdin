"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Area } from "react-easy-crop";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { ImageCropDialog } from "@/components/ui/image-crop-dialog";
import { menuItemClass, menuSurfaceClass } from "@/components/ui/menu";
import {
  BookmarkIcon,
  BuildingIcon,
  CameraIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CrownIcon,
  InfinityIcon,
  LightbulbIcon,
  MapPinIcon,
  MinusCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@/components/ui/icons";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import {
  INSTALLER_CONTENT_FRAME_CLASS,
  INSTALLER_SHELL_GUTTER_CLASS,
} from "@/features/installer-dashboard-preview/installer-layout";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cropImageToBlob } from "@/lib/media/crop-image";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { cn } from "@/lib/ui/cn";
import {
  AVAILABILITY_OPTIONS,
  CITIES_BY_GOVERNORATE,
  DEFAULT_SPECIALTIES,
  GOVERNORATE_OPTIONS,
  MAX_PORTFOLIO_IMAGES,
  MAX_PORTFOLIO_PROJECTS,
  PORTFOLIO_PROJECTS,
  PROFILE_STEPS,
  QUICK_TIPS,
  SPECIALTIES,
} from "./profile-completion-data";

export function InstallerProfileCompletionPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="account"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-4 pb-8 pt-2 tablet:pb-10 tablet:pt-3`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-md`}>
          <ProfileHero locale={locale} />
          <ProfileCompletionWorkspace locale={locale} />
        </main>
      </div>
    </div>
  );
}

function ProfileHero({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [coverUrl, setCoverUrl] = useState("/assets/installer-account/profile-completion-hero-2026.png");
  const [avatarUrl, setAvatarUrl] = useState("/assets/installer-account/profile-ahmed.png");
  const [activeCrop, setActiveCrop] = useState<{ kind: "cover" | "avatar"; source: string; owned: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
  }, [coverUrl]);

  useEffect(() => () => {
    if (avatarUrl.startsWith("blob:")) URL.revokeObjectURL(avatarUrl);
  }, [avatarUrl]);

  useEffect(() => () => {
    if (activeCrop?.owned) URL.revokeObjectURL(activeCrop.source);
  }, [activeCrop]);

  const closeCropper = () => {
    setActiveCrop(null);
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const onPickImage = (kind: "cover" | "avatar", event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!(["image/jpeg", "image/png", "image/webp"] as const).includes(file.type as "image/jpeg" | "image/png" | "image/webp") || file.size > 10 * 1024 * 1024) {
      setError(ar ? "اختر صورة JPG أو PNG أو WebP بحجم لا يزيد عن 10 ميجابايت." : "Choose a JPG, PNG, or WebP image up to 10 MB.");
      event.target.value = "";
      return;
    }
    setActiveCrop({ kind, source: URL.createObjectURL(file), owned: true });
  };

  const saveImage = async (area: Area) => {
    if (!activeCrop) return;
    setBusy(true);
    try {
      const isCover = activeCrop.kind === "cover";
      const blob = await cropImageToBlob(activeCrop.source, area, {
        width: isCover ? 1800 : 512,
        height: isCover ? 300 : 512,
        type: "image/jpeg",
        quality: 0.92,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      });
      const nextUrl = URL.createObjectURL(blob);
      if (isCover) setCoverUrl(nextUrl);
      else setAvatarUrl(nextUrl);
      closeCropper();
    } catch {
      setError(ar ? "تعذر تجهيز الصورة. جرّب صورة أخرى." : "The image could not be prepared. Try another image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="relative isolate overflow-hidden rounded-md border border-strong bg-surface shadow-card tablet:min-h-60">
      {/* Phones: the cover is a short strip the avatar overlaps, so the title
          and actions sit on a solid surface instead of over the photograph. */}
      <div className="absolute inset-x-0 top-0 -z-20 h-28 tablet:inset-0 tablet:h-auto">
        <Image
          src={coverUrl}
          alt=""
          fill
          priority
          unoptimized={coverUrl.startsWith("blob:")}
          sizes="(min-width: 1024px) 80vw, 100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 hidden bg-gradient-to-l from-canvas/45 via-canvas/10 to-transparent tablet:block ltr:tablet:bg-gradient-to-r" />
      </div>
      <div className="flex flex-col items-start gap-md px-md pb-sm pt-[4.5rem] tablet:min-h-60 tablet:flex-row tablet:items-center tablet:justify-start tablet:gap-lg tablet:px-xl tablet:py-xl">
        <div className="order-2 max-w-xl text-start">
          <h1 className="text-title font-bold text-fg tablet:text-headline">{ar ? "كمّل ملفك الشخصي" : "Complete your profile"}</h1>
          <p className="mt-1 text-body text-fg-secondary tablet:mt-2 tablet:text-body-lg">{ar ? "خلّي شغلك يوصل للناس المناسبة" : "Help your work reach the right people"}</p>
        </div>

        <div className="relative order-1 shrink-0 tablet:me-sm">
          <span className="relative block h-24 w-24 overflow-hidden rounded-pill border-4 border-canvas bg-surface-2 shadow-raised tablet:h-28 tablet:w-28">
            <Image src={avatarUrl} alt={ar ? "صورة أحمد محمود" : "Ahmed Mahmoud profile"} fill sizes="112px" unoptimized={avatarUrl.startsWith("blob:")} className="object-cover" />
          </span>
          <button type="button" onClick={() => avatarInputRef.current?.click()} aria-label={ar ? "تغيير صورة الملف" : "Change profile photo"} className="absolute -bottom-1 -start-1 grid h-10 w-10 place-items-center rounded-pill border-2 border-canvas bg-accent-solid text-on-accent shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><CameraIcon size={18} /></button>
          <button type="button" onClick={() => setActiveCrop({ kind: "avatar", source: avatarUrl, owned: false })} aria-label={ar ? "ضبط صورة الملف الحالية" : "Adjust current profile photo"} className="absolute -end-1 -top-1 grid h-9 w-9 place-items-center rounded-pill border-2 border-canvas bg-surface text-accent shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><PencilIcon size={16} /></button>
        </div>
      </div>
      <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label={ar ? "رفع صورة الغلاف" : "Upload cover photo"} className="sr-only" onChange={(event) => onPickImage("cover", event)} />
      <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label={ar ? "رفع صورة الملف" : "Upload profile photo"} className="sr-only" onChange={(event) => onPickImage("avatar", event)} />
      <div className="relative z-raised flex flex-wrap gap-sm px-md pb-md tablet:absolute tablet:bottom-md tablet:end-md tablet:p-0">
        <button type="button" onClick={() => coverInputRef.current?.click()} className="flex min-h-11 items-center gap-xs rounded-md border border-accent bg-accent-solid px-md text-label font-bold text-on-accent shadow-raised transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <CameraIcon size={17} />
          {ar ? "تغيير صورة الغلاف" : "Change cover photo"}
        </button>
        <button type="button" onClick={() => setActiveCrop({ kind: "cover", source: coverUrl, owned: false })} className="flex min-h-11 items-center gap-xs rounded-md border border-strong bg-surface px-md text-label font-bold text-fg shadow-raised transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <PencilIcon size={16} />
          {ar ? "ضبط الصورة الحالية" : "Adjust current photo"}
        </button>
      </div>
      {error && !activeCrop ? <p role="alert" className="relative z-raised mx-md mb-md rounded-md bg-surface px-sm py-xs text-label text-danger shadow-raised tablet:absolute tablet:bottom-md tablet:start-md tablet:m-0">{error}</p> : null}
      {activeCrop ? (
        <ImageCropDialog
          image={activeCrop.source}
          title={activeCrop.kind === "cover" ? (ar ? "اضبط صورة الغلاف" : "Adjust cover photo") : (ar ? "اضبط صورة الملف" : "Adjust profile photo")}
          zoomLabel={ar ? "حجم الصورة" : "Image size"}
          cancelLabel={ar ? "إلغاء" : "Cancel"}
          saveLabel={ar ? "استخدام الصورة" : "Use photo"}
          savingLabel={ar ? "جارٍ التجهيز…" : "Preparing…"}
          aspect={activeCrop.kind === "cover" ? 6 : 1}
          cropShape={activeCrop.kind === "avatar" ? "round" : "rect"}
          showGrid={activeCrop.kind === "cover"}
          busy={busy}
          error={error}
          onCancel={closeCropper}
          onConfirm={saveImage}
        />
      ) : null}
    </header>
  );
}

type ProfileStepId = (typeof PROFILE_STEPS)[number]["id"];
type CompletionReport = { completed: number; total: number };

const PHONE_LIKE_SEQUENCE = /(?:[+\d٠-٩][\s().-]*){8,}/u;

const INITIAL_COMPLETION: Record<ProfileStepId, CompletionReport> = {
  basic: { completed: 5, total: 5 },
  availability: { completed: 1, total: 1 },
  portfolio: { completed: 1, total: 1 },
  coverage: { completed: 1, total: 1 },
};

function ProfileCompletionWorkspace({ locale }: { locale: Locale }) {
  const [completion, setCompletion] = useState(INITIAL_COMPLETION);
  const reportCompletion = useCallback((stepId: ProfileStepId, report: CompletionReport) => {
    setCompletion((current) => {
      const previous = current[stepId];
      if (previous.completed === report.completed && previous.total === report.total) return current;
      return { ...current, [stepId]: report };
    });
  }, []);
  const reportBasicCompletion = useCallback((report: CompletionReport) => reportCompletion("basic", report), [reportCompletion]);
  const reportAvailabilityCompletion = useCallback((report: CompletionReport) => reportCompletion("availability", report), [reportCompletion]);
  const reportPortfolioCompletion = useCallback((report: CompletionReport) => reportCompletion("portfolio", report), [reportCompletion]);
  const reportCoverageCompletion = useCallback((report: CompletionReport) => reportCompletion("coverage", report), [reportCompletion]);
  const completedRecords = 2 + Object.values(completion).reduce((sum, report) => sum + report.completed, 0);
  const totalRecords = 2 + Object.values(completion).reduce((sum, report) => sum + report.total, 0);
  const completionPercent = Math.round((completedRecords / totalRecords) * 100);
  const completedStepIds = new Set(
    PROFILE_STEPS.filter((step) => completion[step.id].completed === completion[step.id].total).map((step) => step.id),
  );

  return (
    <div className="grid min-w-0 gap-md desktop:grid-cols-5">
      <aside className="order-1 flex min-w-0 flex-col gap-md desktop:order-2">
        <ProfileProgress locale={locale} percent={completionPercent} completedStepIds={completedStepIds} />
        <PremiumProfileCard locale={locale} />
        <QuickTipsCard locale={locale} />
      </aside>

      <form className="order-2 min-w-0 space-y-md desktop:order-1 desktop:col-span-4">
        <BasicInformationSection locale={locale} onCompletionChange={reportBasicCompletion} />
        <AvailabilitySection locale={locale} onCompletionChange={reportAvailabilityCompletion} />
        <PortfolioSection locale={locale} onCompletionChange={reportPortfolioCompletion} />
        <CoverageSection locale={locale} onCompletionChange={reportCoverageCompletion} />
        <ProfileActions locale={locale} />
      </form>
    </div>
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

function BasicInformationSection({ locale, onCompletionChange }: { locale: Locale; onCompletionChange: (report: CompletionReport) => void }) {
  const ar = locale === "ar";
  const [professionalName, setProfessionalName] = useState(ar ? "أحمد محمود" : "Ahmed Mahmoud");
  const [experience, setExperience] = useState(8);
  const [selected, setSelected] = useState<string[]>([...DEFAULT_SPECIALTIES]);
  const [open, setOpen] = useState(false);
  const [governorate, setGovernorate] = useState("cairo");
  const [city, setCity] = useState("new-cairo");
  const [customCity, setCustomCity] = useState("");
  const [about, setAbout] = useState("");
  const aboutHasPhoneNumber = PHONE_LIKE_SEQUENCE.test(about);
  const aboutPhoneError = ar ? "لا تضع أرقام تليفونات في تعريف عنك." : "Do not include phone numbers in your introduction.";
  const specialtiesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const completed = [
      professionalName.trim().length > 0,
      experience > 0,
      selected.length > 0,
      governorate.length > 0,
      city.length > 0 && (city !== "other" || customCity.trim().length > 0),
    ].filter(Boolean).length;
    onCompletionChange({ completed, total: 5 });
  }, [city, customCity, experience, governorate, onCompletionChange, professionalName, selected]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!specialtiesRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  function toggleSpecialty(value: string) {
    setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
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
              <Input id="professional-name" className="ps-11" value={professionalName} onChange={(event) => setProfessionalName(event.target.value)} />
            </div>
          </LabeledField>
        </div>

        <div className="flex flex-col gap-1.5 tablet:col-span-2">
          <span className="text-label font-medium text-fg-secondary">{ar ? "سنوات الخبرة *" : "Years of experience *"}</span>
          <div className="grid min-h-11 grid-cols-3 overflow-hidden rounded-md border border-strong bg-canvas">
            <button type="button" aria-label={ar ? "تقليل سنوات الخبرة" : "Decrease years"} onClick={() => setExperience((value) => Math.max(0, value - 1))} className="grid place-items-center border-e text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
              <MinusCircleIcon size={20} />
            </button>
            <output aria-label={ar ? "سنوات الخبرة" : "Years of experience"} className="grid place-items-center text-body-lg font-semibold tabular-nums text-fg">{experience}</output>
            <button type="button" aria-label={ar ? "زيادة سنوات الخبرة" : "Increase years"} onClick={() => setExperience((value) => value + 1)} className="grid place-items-center border-s text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
              <PlusIcon size={20} />
            </button>
          </div>
        </div>

        <div ref={specialtiesRef} className="relative min-w-0 tablet:col-span-6">
          <span className="mb-1.5 block text-label font-medium text-fg-secondary">{ar ? "التخصص *" : "Specialties *"}</span>
          <div className="flex h-11 min-w-0 items-center gap-2 overflow-hidden rounded-md border border-strong bg-canvas p-1.5">
            <div className="scrollbar-chip-row flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5">
              {selected.map((value) => {
                const specialty = SPECIALTIES.find((item) => item.value === value);
                return specialty ? <span key={value} className="shrink-0 whitespace-nowrap rounded-pill border bg-surface-2 px-2.5 py-1 text-label font-medium text-fg">{pick(locale, specialty)}</span> : null;
              })}
            </div>
            <button
              type="button"
              aria-label={ar ? "اختيار التخصصات" : "Choose specialties"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronDownIcon size={18} />
            </button>
          </div>
          {open ? (
            <div className={cn(menuSurfaceClass, "absolute inset-x-0 top-full z-popover mt-2")}>
              <div role="listbox" aria-label={ar ? "قائمة التخصصات" : "Specialties list"} aria-multiselectable="true" className="grid max-h-64 gap-1 overflow-y-auto p-2 tablet:grid-cols-2">
                {SPECIALTIES.map((specialty) => {
                  const checked = selected.includes(specialty.value);
                  return (
                    <button
                      key={specialty.value}
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => toggleSpecialty(specialty.value)}
                      className={menuItemClass(checked, "min-h-10 rounded-sm text-label")}
                    >
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-xs border border-strong", checked && "border-accent bg-accent-solid text-on-accent")}>{checked ? <CheckIcon size={13} /> : null}</span>
                      {pick(locale, specialty)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="tablet:col-span-6">
          <ProfileSelect
            id="governorate"
            label={ar ? "المحافظة *" : "Governorate *"}
            value={governorate}
            onChange={(value) => {
              setGovernorate(value);
              setCity(CITIES_BY_GOVERNORATE[value]?.[0]?.value ?? "other");
              setCustomCity("");
            }}
            options={GOVERNORATE_OPTIONS.map((option) => ({ value: option.value, label: pick(locale, option) }))}
            icon={<MapPinIcon size={19} />}
          />
        </div>
        <div className="tablet:col-span-6">
          <ProfileSelect
            id="city"
            label={ar ? "المدينة *" : "City *"}
            value={city}
            onChange={(value) => {
              setCity(value);
              if (value !== "other") setCustomCity("");
            }}
            options={(CITIES_BY_GOVERNORATE[governorate] ?? []).map((option) => ({ value: option.value, label: pick(locale, option) }))}
            icon={<BuildingIcon size={19} />}
            customEntry={{
              optionValue: "other",
              value: customCity,
              onChange: setCustomCity,
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
                value={about}
                onChange={(event) => {
                  const next = event.target.value;
                  setAbout(next);
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
                {about.length}/250
              </span>
            </div>
          </LabeledField>
        </div>
      </div>
    </ProfileSection>
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
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  icon?: ReactNode;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const customEntryActive = customEntry?.optionValue === value;
  const displayedLabel = customEntryActive && customEntry.value.trim() ? customEntry.value.trim() : selected?.label ?? "";

  useEffect(() => {
    if (open && customEntryActive) customInputRef.current?.focus();
  }, [customEntryActive, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label font-medium text-fg-secondary">{label}</span>
      <button
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
      {open ? (
        <div className={cn(menuSurfaceClass, "absolute inset-x-0 top-full z-popover mt-2 max-h-72 overflow-y-auto p-1")} role="listbox" aria-labelledby={`${id}-label`}>
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
        </div>
      ) : null}
    </div>
  );
}

function AvailabilitySection({ locale, onCompletionChange }: { locale: Locale; onCompletionChange: (report: CompletionReport) => void }) {
  const ar = locale === "ar";
  const [availability, setAvailability] = useState("week");

  useEffect(() => {
    onCompletionChange({ completed: availability ? 1 : 0, total: 1 });
  }, [availability, onCompletionChange]);

  return (
    <ProfileSection id="availability" step={2} title={ar ? "إتاحة العمل" : "Work availability"} description={ar ? "متى يمكنك بدء العمل؟" : "When can you start a new job?"}>
      <div className="grid gap-sm tablet:grid-cols-3">
        {AVAILABILITY_OPTIONS.map((option) => {
          const selected = availability === option.id;
          return (
            <button key={option.id} type="button" aria-pressed={selected} onClick={() => setAvailability(option.id)} className={cn("relative flex min-h-24 flex-col items-center justify-center gap-xs rounded-md border px-md text-body-lg font-semibold transition-[box-shadow,border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", selected ? "border-primary bg-primary text-primary-foreground shadow-inset hover:ring-2 hover:ring-accent hover:shadow-raised" : "border-strong bg-canvas text-fg hover:border-accent hover:bg-accent-solid/10") }>
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

function PortfolioSection({ locale, onCompletionChange }: { locale: Locale; onCompletionChange: (report: CompletionReport) => void }) {
  const ar = locale === "ar";
  const [projects, setProjects] = useState(() => [...PORTFOLIO_PROJECTS]);

  useEffect(() => {
    onCompletionChange({ completed: projects.length > 0 ? 1 : 0, total: 1 });
  }, [onCompletionChange, projects.length]);

  const restoreProject = () => {
    const missingProject = PORTFOLIO_PROJECTS.find((project) => !projects.some((current) => current.id === project.id));
    if (missingProject) setProjects((current) => [...current, missingProject]);
  };

  return (
    <ProfileSection id="portfolio" step={3} title={ar ? "سابقة الأعمال" : "Work history"} description={ar ? "أضف مشاريعك السابقة ليتمكن العملاء من التعرّف على خبرتك وأعمالك." : "Add past projects so clients can understand your experience."}>
      <div className="grid gap-xs wide:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(11rem,0.7fr)]">
        {projects.map((project) => (
          <article key={project.id} className="relative grid overflow-hidden rounded-md border border-strong bg-canvas tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <button type="button" aria-label={ar ? "المزيد من الخيارات" : "More project options"} className="absolute end-2 top-2 z-raised grid h-8 w-8 place-items-center rounded-sm border bg-canvas/90 text-fg shadow-sm"><MoreHorizontalIcon size={18} /></button>
            <div className="flex min-w-0 flex-col p-sm pe-xl">
              <h3 className="text-label font-semibold leading-snug text-fg">{pick(locale, project.title)}</h3>
              <p className="mt-2 flex min-w-0 items-center gap-1 text-caption leading-snug text-fg-secondary"><MapPinIcon size={13} className="shrink-0" /><span>{pick(locale, project.location)}</span></p>
              <p className="mt-2 text-pretty text-caption leading-relaxed text-fg-secondary">{pick(locale, project.description)}</p>
              <div className="mt-auto flex gap-1.5 pt-sm">
                <Button type="button" variant="ghost" size="sm" aria-label={ar ? "تعديل المشروع" : "Edit project"} className="h-9 min-h-0 px-2.5"><PencilIcon size={16} /></Button>
                <Button type="button" variant="danger" size="sm" onClick={() => setProjects((current) => current.filter((item) => item.id !== project.id))} aria-label={ar ? "حذف المشروع" : "Delete project"} className="h-9 min-h-0 px-2.5"><TrashIcon size={16} /></Button>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 p-2">
              <div className="relative h-28 w-full overflow-hidden rounded-sm">
                <Image src={project.cover} alt="" fill sizes="(min-width: 1440px) 16vw, 50vw" className="object-cover" />
              </div>
              <div className="grid h-12 grid-cols-4 gap-1.5">
                {project.thumbnails.map((src, index) => (
                  <span key={`${src}-${index}`} className="relative overflow-hidden rounded-sm border"><Image src={src} alt="" fill sizes="64px" className="object-cover" /></span>
                ))}
                <span className="relative overflow-hidden rounded-sm border"><Image src={project.cover} alt="" fill sizes="64px" className="object-cover" /><span className="absolute inset-0 grid place-items-center bg-primary/70 text-label font-semibold text-primary-foreground">+{project.extraCount}</span></span>
              </div>
            </div>
          </article>
        ))}

        <button type="button" disabled={projects.length >= MAX_PORTFOLIO_PROJECTS} onClick={restoreProject} data-max-projects={MAX_PORTFOLIO_PROJECTS} data-max-images={MAX_PORTFOLIO_IMAGES} className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-strong bg-canvas p-md text-center text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50">
          <span className="grid h-14 w-14 place-items-center rounded-pill border border-bronze/50 text-bronze"><PlusIcon size={26} /></span>
          <strong className="mt-md text-body-lg">{ar ? "إضافة مشروع جديد" : "Add a new project"}</strong>
          <span className="mt-1 text-label text-fg-secondary">{ar ? "أضف صورًا ومعلومات عن مشروعك" : "Add photos and project details"}</span>
        </button>
      </div>
    </ProfileSection>
  );
}

function CoverageSection({ locale, onCompletionChange }: { locale: Locale; onCompletionChange: (report: CompletionReport) => void }) {
  const ar = locale === "ar";
  const [otherAreas, setOtherAreas] = useState(true);
  const [areas, setAreas] = useState(["cairo", "giza", "qalyubia"]);
  const [open, setOpen] = useState(false);
  const addAreaRef = useRef<HTMLDivElement>(null);
  const availableAreas = GOVERNORATE_OPTIONS.filter((option) => !areas.includes(option.value));

  useEffect(() => {
    onCompletionChange({ completed: !otherAreas || areas.length > 0 ? 1 : 0, total: 1 });
  }, [areas.length, onCompletionChange, otherAreas]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!addAreaRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <ProfileSection id="coverage" step={4} title={ar ? "نطاق العمل" : "Work coverage"} description={ar ? "هل تعمل في محافظات أخرى؟" : "Do you work in other governorates?"}>
      <div className="grid items-center gap-md tablet:grid-cols-3">
        <label className={cn("flex cursor-pointer items-center justify-between gap-md rounded-md border border-strong bg-canvas p-md", !otherAreas && "tablet:col-span-3")}>
          <span className="font-medium text-fg">{ar ? "أعمل في محافظات أخرى" : "I work in other governorates"}</span>
          <input type="checkbox" checked={otherAreas} onChange={(event) => { setOtherAreas(event.target.checked); setOpen(false); }} className="peer sr-only" />
          <span className={cn("relative h-7 w-12 shrink-0 rounded-pill border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-focus", otherAreas ? "border-accent bg-accent-solid" : "border-strong bg-surface-2")}>
            <span className={cn("absolute top-1 h-5 w-5 rounded-pill bg-canvas shadow-raised transition-[left,right]", otherAreas ? "right-1" : "left-1")} />
          </span>
        </label>
        {otherAreas ? <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-strong bg-canvas p-2 tablet:col-span-2">
          <MapPinIcon size={18} className="text-bronze" />
          {areas.map((value) => {
            const area = GOVERNORATE_OPTIONS.find((option) => option.value === value);
            return area ? <span key={value} className="inline-flex items-center gap-1.5 rounded-pill border bg-surface-2 px-3 py-1.5 text-label font-medium text-fg">{pick(locale, area)}<CheckIcon size={13} className="text-accent" /></span> : null;
          })}
          <div ref={addAreaRef} className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="rounded-pill px-3 py-1.5 text-label font-semibold text-accent hover:bg-accent-solid/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {ar ? "+ إضافة محافظة" : "+ Add governorate"}
            </button>
            {open ? (
              <div className={cn(menuSurfaceClass, "absolute bottom-full start-0 z-popover mb-2 w-56 max-h-72 overflow-y-auto p-1")} role="listbox" aria-label={ar ? "اختر محافظة إضافية" : "Choose another governorate"}>
                {availableAreas.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={menuItemClass(false, "min-h-10 rounded-sm")}
                    onClick={() => {
                      setAreas((current) => [...current, option.value]);
                      setOpen(false);
                    }}
                  >
                    <MapPinIcon size={16} className="text-accent" />
                    <span className="flex-1">{pick(locale, option)}</span>
                  </button>
                ))}
                {availableAreas.length === 0 ? <p className="px-3 py-2 text-label text-fg-secondary">{ar ? "تمت إضافة كل المحافظات" : "All governorates added"}</p> : null}
              </div>
            ) : null}
          </div>
        </div> : null}
      </div>
    </ProfileSection>
  );
}

function ProfileActions({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <div className="flex flex-col-reverse gap-sm rounded-md border border-strong bg-surface p-md shadow-card tablet:flex-row tablet:justify-end">
      <Button type="button" variant="outline" className="min-w-44 gap-sm"><BookmarkIcon size={18} />{ar ? "حفظ كمسودة" : "Save as draft"}</Button>
      <Button type="submit" className="min-w-44 gap-sm">{ar ? "حفظ ومتابعة" : "Save and continue"}<CheckIcon size={18} /></Button>
    </div>
  );
}

function ProfileProgress({ locale, percent, completedStepIds }: { locale: Locale; percent: number; completedStepIds: Set<string> }) {
  return (
    <>
      <MobileProfileSummary locale={locale} percent={percent} completedStepIds={completedStepIds} />
      <DesktopProfileProgress locale={locale} percent={percent} completedStepIds={completedStepIds} />
    </>
  );
}

/** Phones: who this profile is, how complete it is, and the four steps as one compact row. */
function MobileProfileSummary({ locale, percent, completedStepIds }: { locale: Locale; percent: number; completedStepIds: Set<string> }) {
  const ar = locale === "ar";
  const { t } = useI18n();
  return (
    <section aria-label={ar ? "ملخص اكتمال الملف" : "Profile completion summary"} className="rounded-md border border-strong bg-surface p-md shadow-card tablet:hidden">
      <div className="flex items-center gap-md">
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-pill border-2 border-accent-solid bg-surface-2">
          <Image src="/assets/installer-account/profile-ahmed.png" alt="" fill sizes="56px" className="object-cover" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-body-lg font-bold text-fg">{ar ? "أحمد محمود" : "Ahmed Mahmoud"}</p>
          <p className="truncate text-label text-fg-secondary">{t("accountType.installer_technician")}</p>
        </div>
      </div>
      <div className="mt-md flex items-baseline justify-between gap-sm">
        <span className="text-label font-medium text-fg-secondary">{ar ? "اكتمال الملف الشخصي" : "Profile completion"}</span>
        <strong className="text-headline font-bold tabular-nums text-fg">{percent}%</strong>
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
          <strong className="absolute text-body-lg font-bold tabular-nums text-fg">{percent}%</strong>
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
