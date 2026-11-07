import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero, MY_PRODUCTS_HERO_ART } from "@/features/showroom-shell/page-hero";
import { ProductForm } from "@/features/showroom-shell/products/product-form";
import { TipsCard } from "@/features/showroom-shell/products/tips-card";
import { PackageIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export default async function ShowroomNewProductPage() {
  const { org } = await requireShowroomContext();
  // Creating needs catalog.write (or ownership); the database enforces it again.
  if (!org.capabilities.includes("catalog.write") && !org.capabilities.includes("org.manage")) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  return (
    <div className="flex flex-col gap-md" data-testid="new-product">
      <ShowroomPageHero
        locale={locale}
        titleId="new-product-title"
        Icon={PackageIcon}
        art={MY_PRODUCTS_HERO_ART}
        title={t("showroomProducts.createTitle")}
        subtitle={t("showroomProducts.createHeroSubtitle")}
        back={
          <Link href={`${SHOWROOM_ROOT}/my-products`} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span aria-hidden="true" className="rtl:rotate-180">←</span>
            {t("showroomProducts.backToList")}
          </Link>
        }
      />
      {/* Form first (the wide track), tips second: in RTL that puts the form on the right and the tips panel on the left, as in the reference. */}
      <div className="grid min-w-0 items-start gap-md desktop:grid-cols-[minmax(0,78fr)_minmax(0,22fr)]">
        <ProductForm orgId={org.organizationId} />
        <TipsCard
          title={t("showroomProducts.tipsTitle")}
          tips={["photos", "name", "category", "colors", "later"].map((k) => t(`showroomProducts.tips.${k}`))}
        />
      </div>
    </div>
  );
}
