import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import {
  loadEngineerCollections,
  resolveCollectionEntries,
} from "@/server/queries/engineer-collections";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { CollectionButton } from "@/features/engineer/collection-controls";
import { EngineerEmpty } from "@/features/engineer/sections";
const categories = [
  { type: "all", ar: "الكل", en: "All" },
  { type: "portfolio", ar: "المشاريع", en: "Projects" },
  { type: "organization", ar: "المعارض", en: "Showrooms" },
  { type: "product", ar: "المنتجات", en: "Products" },
  { type: "profile", ar: "المتخصصون", en: "Professionals" },
] as const;

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireEngineer();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const ar = locale === "ar";
  const saved = (await loadEngineerCollections()).find(
    (c) => c.kind === "saved",
  );
  const entries = await resolveCollectionEntries(saved?.entries ?? []);
  const requested = (await searchParams).type;
  const active =
    categories.find((category) => category.type === requested)?.type ?? "all";
  const filtered =
    active === "all"
      ? entries
      : entries.filter((entry) => entry.type === active);
  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline">
        {ar ? "أفكاري المحفوظة" : "Saved ideas"}
      </h1>
      <p className="text-body text-fg-secondary">
        {ar
          ? "ارجع إلى المشاريع والخامات والمتخصصين الذين اخترتهم لمشروعك القادم."
          : "Return to the projects, materials, and professionals you selected for your next project."}
      </p>
      <nav
        aria-label={ar ? "تصنيف المفضلة" : "Saved categories"}
        className="flex flex-wrap gap-2"
      >
        {categories.map((category) => (
          <ButtonLink
            key={category.type}
            href={
              category.type === "all"
                ? "/home/engineer/saved"
                : `/home/engineer/saved?type=${category.type}`
            }
            variant={active === category.type ? "primary" : "outline"}
            aria-current={active === category.type ? "page" : undefined}
            size="sm"
          >
            {ar ? category.ar : category.en}
            <span className="tabular-nums">
              {category.type === "all"
                ? entries.length
                : entries.filter((entry) => entry.type === category.type)
                    .length}
            </span>
          </ButtonLink>
        ))}
      </nav>
      {!filtered.length ? (
        <EngineerEmpty
          locale={locale}
          title={ar ? "لم تحفظ عناصر هنا بعد" : "No saved items here yet"}
          description={
            ar
              ? "اضغط على حفظ أثناء التصفح لتجمع اختياراتك وتعود إليها بسهولة."
              : "Choose Save while browsing to collect your ideas and find them here later."
          }
          href="/home/engineer/products"
          action={ar ? "اكتشف المنتجات" : "Explore products"}
        />
      ) : (
        <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">
          {filtered.map((e) => (
            <Card key={`${e.type}-${e.id}`}>
              <h2 className="mb-3 text-title">
                {e.title ??
                  (ar
                    ? "لم يعد هذا العنصر متاحاً"
                    : "This entry is no longer available")}
              </h2>
              {e.title && (
                <ButtonLink href={e.href} variant="outline">
                  {ar ? "عرض" : "Open"}
                </ButtonLink>
              )}
              <CollectionButton
                saved
                entityId={e.id}
                entityType={
                  e.type as "profile" | "organization" | "product" | "portfolio"
                }
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
