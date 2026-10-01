"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { FactoryIcon, GiftIcon, PackageIcon, ScrollIcon, VideoIcon } from "@/components/ui/icons";
import { ModuleCard } from "./module-card";
import { pick } from "./mock-data";
import type { InstallerBrandItemVM } from "./view-model";

/**
 * "From the factories and brands" — the one section whose entire job is to
 * make the ecosystem visible. No `factories`/`brand_ecosystem` domain exists
 * in the backend yet (see `docs/operations/staging-demo-accounts.md`'s
 * uncovered-domains note), so production always renders the empty state below
 * rather than inventing a brand feed.
 */
export function BrandEcosystemSection({ items }: { items: readonly InstallerBrandItemVM[] }) {
  const { locale } = useI18n();
  const orderedItems = locale === "ar" ? [...items].reverse() : items;

  return (
    <ModuleCard
      id="ecosystem"
      icon={FactoryIcon}
      iconClassName="text-bronze"
      title={locale === "ar" ? "من المصانع والعلامات التجارية" : "From factories & brands"}
      headerAction={items.length > 0 ? <HeaderAction label={locale === "ar" ? "عرض الكل" : "View all"} /> : undefined}
    >
      {items.length === 0 ? (
        <Empty
          text={
            locale === "ar"
              ? "لسه معندناش تحديثات من المصانع والعلامات التجارية."
              : "No factory or brand updates yet."
          }
        />
      ) : (
        <ul className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden rounded-md border border-strong desktop:grid-cols-4">
          {orderedItems.map((item) => (
            <BrandColumn key={item.id} item={item} />
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}

const KIND_ICON = {
  "تدريب جديد": ScrollIcon,
  "منتج جديد": PackageIcon,
  "فيديو تعليمي": VideoIcon,
  "مسابقة أفضل تركيب": GiftIcon,
} as const;

function BrandColumn({ item }: { item: InstallerBrandItemVM }) {
  const { locale } = useI18n();
  const localizedKind = pick(locale, item.kindLabel);
  const Icon = locale === "ar" && localizedKind in KIND_ICON
    ? KIND_ICON[localizedKind as keyof typeof KIND_ICON]
    : item.brand === "WPC Factory"
      ? PackageIcon
      : item.brand === "SPC Academy"
        ? VideoIcon
        : item.brand === "MarbleX"
          ? GiftIcon
          : ScrollIcon;
  const action = locale === "ar" ? `اكتشف ${item.brand}` : `Explore ${item.brand}`;
  const status = item.brand === "MarbleX"
    ? { label: locale === "ar" ? "مسابقة" : "Contest", className: "bg-warning/10 text-warning" }
    : item.brand === "SPC Academy"
      ? { label: locale === "ar" ? "جديد" : "New", className: "bg-info/10 text-info" }
      : { label: locale === "ar" ? "جديد" : "New", className: "bg-success/10 text-success" };

  return (
    <li className="flex min-w-0 flex-col items-center border-e border-strong px-2 pt-2 last:border-e-0">
      <span className={`mb-1 self-start rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none ${status.className}`}>
        {status.label}
      </span>
      <span className="grid h-12 w-full place-items-center px-1">
        <Image src={item.logo} alt={item.brand} width={90} height={42} className="h-auto max-h-9 w-full object-contain" />
      </span>
      <div className="mt-1 flex w-full flex-1 flex-col gap-2 text-start">
        <p className="flex items-start gap-1 text-caption font-medium leading-snug text-fg">
          <Icon size={14} className="mt-0.5 shrink-0 text-iris" />
          <span>{localizedKind}</span>
        </p>
        <p className="flex items-start gap-1 text-caption leading-snug text-fg-secondary">
          <PackageIcon size={14} className="mt-0.5 shrink-0 text-success" />
          <span>{pick(locale, item.title)}</span>
        </p>
        {item.tag ? (
          <p className="flex items-center gap-1 text-caption font-semibold text-bronze">
            <GiftIcon size={14} />
            {pick(locale, item.tag)}
          </p>
        ) : null}
      </div>
      <button type="button" className="mt-2 inline-flex min-h-14 w-full items-center justify-center rounded-sm border border-strong px-2 py-2 text-center text-[10px] font-medium leading-snug text-iris hover:bg-surface-2 hover:underline">
        {action}
      </button>
    </li>
  );
}

function HeaderAction({ label }: { label: string }) {
  return <button type="button" className="shrink-0 text-label font-medium text-iris hover:underline">{label}</button>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed bg-surface-2/30 p-4 text-center text-body text-fg-muted">
      {text}
    </div>
  );
}
