"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { FactoryIcon } from "@/components/ui/icons";
import { ModuleCard, ModuleFooterLink } from "./module-card";
import { BRAND_ECOSYSTEM_ITEMS, pick, type BrandEcosystemItem } from "./mock-data";

/**
 * "From the factories and brands" — the one section whose entire job is to
 * make the ecosystem visible: craftsman, showroom, supplier, manufacturer,
 * and training, all reachable from one card. Each brand is identified by its
 * own supplied logo (never recreated as text) inside a fixed-size plate so
 * four differently-proportioned marks — Jotun's wide lockup, MarbleX's square
 * badge — still sit optically balanced in one row.
 */
export function BrandEcosystemSection() {
  const { locale } = useI18n();

  return (
    <ModuleCard
      id="ecosystem"
      icon={FactoryIcon}
      iconClassName="bg-bronze/10 text-bronze"
      title={locale === "ar" ? "من المصانع والعلامات التجارية" : "From factories & brands"}
      footer={<ModuleFooterLink>{locale === "ar" ? "عرض الكل" : "View all"}</ModuleFooterLink>}
    >
      <ul className="flex flex-col gap-0.5">
        {BRAND_ECOSYSTEM_ITEMS.map((item) => (
          <BrandRow key={item.id} item={item} />
        ))}
      </ul>
    </ModuleCard>
  );
}

function BrandRow({ item }: { item: BrandEcosystemItem }) {
  const { locale } = useI18n();

  return (
    <li className="flex items-center gap-2.5 rounded-md py-1.5">
      <span className="grid h-9 w-12 shrink-0 place-items-center rounded-sm border bg-surface p-1">
        <Image src={item.logo} alt={item.brand} width={80} height={32} className="h-auto max-h-7 w-full object-contain" />
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
