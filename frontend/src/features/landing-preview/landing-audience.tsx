"use client";

import { Reveal } from "@/components/ui/reveal";
import {
  UserIcon,
  BriefcaseIcon,
  WrenchIcon,
  PencilIcon,
  BuildingIcon,
  PackageIcon,
  LayersIcon,
  TruckIcon,
  StorefrontIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-audience.module.css";

/**
 * The locked 9-category audience taxonomy (see PRODUCT_DIRECTION_GUIDE.md) —
 * this strip is a navigational/marketing surface, not a taxonomy definition;
 * it must never invent or drop a category. Order is fixed physical order,
 * matching the approved reference, for both locales (ordinary reading
 * content, not fixed UI chrome — but the reference draws the same 9 tiles in
 * the same order regardless of language, so this list is written once and
 * only the labels swap).
 */
const items = [
  { icon: UserIcon, ar: "حساب شخصي", en: "Personal Account", comingSoon: true },
  { icon: BriefcaseIcon, ar: "فريق المبيعات", en: "Sales Team", comingSoon: false },
  { icon: WrenchIcon, ar: "الصنايعية والفنيون", en: "Technicians & Installers", comingSoon: false },
  { icon: PencilIcon, ar: "المهندسون", en: "Engineers", comingSoon: true },
  { icon: BuildingIcon, ar: "المقاولون", en: "Contractors", comingSoon: true },
  { icon: PackageIcon, ar: "المستوردون", en: "Importers", comingSoon: false },
  { icon: LayersIcon, ar: "المصنّعون", en: "Manufacturers", comingSoon: false },
  { icon: TruckIcon, ar: "الموردون", en: "Suppliers", comingSoon: false },
  { icon: StorefrontIcon, ar: "المعارض", en: "Showrooms", comingSoon: false },
] as const;

const comingSoonLabel = { ar: "قريباً", en: "Coming Soon" } as const;
const sectionLabel = { ar: "لمن علاء الدين", en: "Who Aladdin is for" } as const;

export function LandingAudience() {
  const { locale, dir } = useI18n();

  return (
    <section
      id="audience"
      className={styles.section}
      aria-label={sectionLabel[locale]}
      data-landing-preview-part="AudienceStrip"
    >
      <Reveal>
        <ul className={styles.row}>
          {items.map(({ icon: Icon, ar, en, comingSoon }) => (
            <li key={en} className={styles.item}>
              <span className={styles.iconWrap} aria-hidden="true">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <span className={styles.label} dir={dir}>{locale === "ar" ? ar : en}</span>
              {comingSoon ? <span className={styles.badge} dir={dir}>{comingSoonLabel[locale]}</span> : null}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
