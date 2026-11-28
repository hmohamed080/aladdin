"use client";
// Matches the production installer controls from main, shared by the engineer editor.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input, Button } from "@/components/ui/controls";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { menuItemClass } from "@/components/ui/menu";
import { CheckIcon, ChevronDownIcon, MapPinIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import { GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
const pick = (locale: Locale, text: {ar: string; en: string}) => text[locale];
type FormState = { governorate: string; otherAreas: boolean; areas: string[] };
type SetField = <K extends keyof FormState>(key: K, value: FormState[K] | ((previous: FormState[K]) => FormState[K])) => void;
function CoverageFrame({title, description, children}: {title: string; description: string; children: ReactNode}) {
 return <section className="space-y-md"><div><h3 className="font-semibold">{title}</h3><p className="text-label text-fg-secondary">{description}</p></div>{children}</section>;
}
export function ProfileSelect({
  id,
  label,
  value,
  options,
  onChange,
  icon,
  customEntry,
  placeholder,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  icon?: ReactNode;
  placeholder?: string;
  /** Not openable (e.g. City until a governorate is chosen). */
  disabled?: boolean;
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
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-canvas w-full items-center justify-between gap-sm rounded-md border border-strong bg-canvas px-3 text-start text-body-lg text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
                  maxLength={80}
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


export function CoverageSection({ locale, form, set }: { locale: Locale; form: FormState; set: SetField }) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const availableAreas = GOVERNORATE_OPTIONS.filter((option) => !form.areas.includes(option.value) && option.value !== form.governorate);

  return (
    <CoverageFrame title={ar ? "نطاق العمل" : "Work coverage"} description={ar ? "هل تعمل في محافظات أخرى؟" : "Do you work in other governorates?"}>
      <div className="grid items-center gap-md tablet:grid-cols-3">
        <label className={cn("flex cursor-pointer items-center justify-between gap-md rounded-md border border-strong bg-canvas p-md", !form.otherAreas && "tablet:col-span-3")}>
          <span className="font-medium text-fg">{ar ? "أعمل في محافظات أخرى" : "I work in other governorates"}</span>
          <input type="checkbox" checked={form.otherAreas} onChange={(event) => { set("otherAreas", event.target.checked); setOpen(false); }} className="peer sr-only" />
          <span className={cn("relative h-7 w-12 shrink-0 rounded-pill border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-focus", form.otherAreas ? "border-accent bg-accent-solid" : "border-strong bg-[var(--warm-sand)]")}>
            <span className={cn("absolute top-0.5 block h-5 w-5 rounded-pill bg-primary shadow-raised transition-[left,right]", form.otherAreas ? "right-0.5" : "left-0.5")} />
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
    </CoverageFrame>
  );
}
