"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { FactoryIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
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

  return (
    <ModuleCard
      id="ecosystem"
      icon={FactoryIcon}
      iconClassName="bg-bronze/10 text-bronze"
      title={locale === "ar" ? "من المصانع والعلامات التجارية" : "From factories & brands"}
      footer={
        items.length > 0 ? (
          <ModuleFooterLink>{locale === "ar" ? "عرض الكل" : "View all"}</ModuleFooterLink>
        ) : undefined
      }
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
        <ul className="flex flex-1 flex-col justify-between gap-0.5">
          {items.map((item) => (
            <BrandRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}

function BrandRow({ item }: { item: InstallerBrandItemVM }) {
  const { locale } = useI18n();

  return (
    <li className="flex items-center gap-2.5 rounded-md py-1.5">
      <span className="grid h-10 w-14 shrink-0 place-items-center rounded-sm border border-strong bg-surface p-1">
        <Image src={item.logo} alt={item.brand} width={80} height={32} className="h-auto max-h-8 w-full object-contain" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-caption leading-snug text-fg-secondary">
          {pick(locale, item.kindLabel)} · {pick(locale, item.title)}
        </p>
      </div>
      {item.tag ? (
        <span className="shrink-0 rounded-pill bg-accent-solid/10 px-2 py-0.5 text-label font-semibold text-accent">
          {pick(locale, item.tag)}
        </span>
      ) : null}
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 flex-1 items-center justify-center rounded-md border border-dashed border-strong bg-surface-2/30 p-4 text-center text-body text-fg-muted">
      {text}
    </div>
  );
}
