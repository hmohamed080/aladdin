import { CollectionButton } from "./collection-controls";
import Image from "next/image";
import { loadEngineerInspiration } from "@/server/queries/engineer";
import { loadEngineerCollections } from "@/server/queries/engineer-collections";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  signProductImageUrls,
  resolveProductImage,
} from "@/server/queries/product-images";
import type { ReactNode } from "react";
import {
  Card,
  SectionTitle,
  StatePanel,
  Badge,
} from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import {
  BuildingIcon,
  UserIcon,
  PackageIcon,
  ArrowUpRightIcon,
} from "@/components/ui/icons";
import type {
  OrgDirectoryRow,
  ProfileDirectoryRow,
} from "@/server/queries/directory";
import type { CatalogRow } from "@/server/queries/commerce";
import type { Locale } from "@/lib/i18n/locales";

export async function InspirationCards({
  locale,
  limit = 24,
  search,
}: {
  locale: Locale;
  limit?: number;
  search?: string;
}) {
  const [rows, collections] = await Promise.all([
    loadEngineerInspiration(search),
    loadEngineerCollections(),
  ]);
  const saved = collections.find((c) => c.kind === "saved")?.entries ?? [];
  if (!rows.length) return <EngineerEmpty locale={locale} />;
  return (
    <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
      {rows.slice(0, limit).map((p) => (
        <Card key={p.id} pad="sm">
          <Image
            src={`/p/media/${p.id}`}
            alt={p.title}
            width={400}
            height={260}
            unoptimized
            className="aspect-video w-full rounded-sm object-cover"
          />
          <h3 className="mt-3 text-title">{p.title}</h3>
          <p className="mt-2 line-clamp-2 text-body text-fg-secondary">
            {p.description}
          </p>
          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <CollectionButton
              entityType="portfolio"
              entityId={p.id}
              saved={saved.some((e) => e.type === "portfolio" && e.id === p.id)}
            />
            <ButtonLink href={`/p/${p.profileId}`} variant="ghost" size="sm">
              {locale === "ar" ? "ملف المصمم" : "Designer profile"}
            </ButtonLink>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function EngineerSection({
  title,
  href,
  locale,
  children,
}: {
  title: string;
  href?: string;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-md">
      <SectionTitle
        action={
          href ? (
            <ButtonLink href={href} variant="ghost" size="sm">
              {locale === "ar" ? "عرض الكل" : "View all"}
              <ArrowUpRightIcon size={15} />
            </ButtonLink>
          ) : undefined
        }
      >
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}
export function EngineerEmpty({
  locale,
  href,
  action,
  title,
  description,
}: {
  locale: Locale;
  href?: string;
  action?: string;
  title?: string;
  description?: string;
}) {
  return (
    <StatePanel
      title={
        title ??
        (locale === "ar" ? "لا توجد نتائج حتى الآن" : "Nothing here yet")
      }
      body={
        description ??
        (locale === "ar"
          ? "ستظهر المعلومات هنا عندما تصبح متاحة."
          : "Available information will appear here.")
      }
      action={
        href && action ? (
          <ButtonLink href={href}>{action}</ButtonLink>
        ) : undefined
      }
    />
  );
}
export async function ShowroomCards({
  rows,
  locale,
}: {
  rows: OrgDirectoryRow[];
  locale: Locale;
}) {
  if (!rows.length) return <EngineerEmpty locale={locale} />;
  const saved =
    (await loadEngineerCollections()).find((c) => c.kind === "saved")
      ?.entries ?? [];
  return (
    <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
      {rows.map((row) => (
        <Card key={row.id} pad="sm" className="flex flex-col gap-3">
          <div className="grid aspect-video place-items-center rounded-sm bg-surface-2 text-fg-secondary">
            <BuildingIcon size={48} />
          </div>
          <h3 className="text-title">
            <bdi>{row.name}</bdi>
          </h3>
          {row.id && (
            <CollectionButton
              entityType="organization"
              entityId={row.id}
              saved={saved.some(
                (e) => e.type === "organization" && e.id === row.id,
              )}
            />
          )}
          {row.is_verified && (
            <Badge tone="success">
              {locale === "ar" ? "معرض موثق" : "Verified showroom"}
            </Badge>
          )}
          <ButtonLink
            href={`/home/engineer/products?supplier=${row.id}`}
            variant="outline"
          >
            {locale === "ar" ? "اكتشف المنتجات" : "Explore products"}
          </ButtonLink>
          <ButtonLink href={`/home/engineer/requests/new?supplier=${row.id}`}>
            {locale === "ar" ? "طلب عرض سعر" : "Request a quote"}
          </ButtonLink>
        </Card>
      ))}
    </div>
  );
}
export async function ProfessionalCards({
  rows,
  locale,
}: {
  rows: ProfileDirectoryRow[];
  locale: Locale;
}) {
  if (!rows.length) return <EngineerEmpty locale={locale} />;
  const saved =
    (await loadEngineerCollections()).find((c) => c.kind === "saved")
      ?.entries ?? [];
  return (
    <div className="grid gap-3 tablet:grid-cols-2">
      {rows.map((row) => (
        <Card key={row.id} pad="sm" className="flex items-center gap-md">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-surface-2">
            <UserIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-body font-medium">
              <bdi>{row.display_name}</bdi>
            </h3>
            <p className="text-label text-fg-secondary">
              <bdi>{row.headline || row.specialization}</bdi>
            </p>
            {row.id && (
              <CollectionButton
                entityType="profile"
                entityId={row.id}
                saved={saved.some(
                  (e) => e.type === "profile" && e.id === row.id,
                )}
              />
            )}
          </div>
          <ButtonLink href={`/p/${row.id}`} variant="outline" size="sm">
            {locale === "ar" ? "الملف" : "Profile"}
          </ButtonLink>
        </Card>
      ))}
    </div>
  );
}
export async function ProductCards({
  rows,
  locale,
}: {
  rows: CatalogRow[];
  locale: Locale;
}) {
  if (!rows.length) return <EngineerEmpty locale={locale} />;
  const saved =
    (await loadEngineerCollections()).find((c) => c.kind === "saved")
      ?.entries ?? [];
  const signed = await signProductImageUrls(
    await getServerSupabase(),
    rows.map((r) => r.primary_image_key),
    { orgId: null },
  );
  return (
    <div className="grid grid-cols-2 gap-md desktop:grid-cols-5">
      {rows.map((row) => (
        <Card key={row.id} pad="sm" className="flex flex-col gap-3">
          <div className="grid aspect-square place-items-center rounded-sm bg-surface-2">
            {resolveProductImage(row, signed) ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={resolveProductImage(row, signed)!}
                alt={row.name ?? ""}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <PackageIcon size={40} />
            )}
          </div>
          <h3 className="text-body font-medium">
            <bdi>{row.name}</bdi>
          </h3>
          {row.id && (
            <CollectionButton
              entityType="product"
              entityId={row.id}
              saved={saved.some((e) => e.type === "product" && e.id === row.id)}
            />
          )}
          <p className="text-label text-fg-secondary">
            <bdi>{row.supplier_name}</bdi>
          </p>
          {row.short_description && (
            <p className="line-clamp-2 text-label text-fg-secondary">
              {row.short_description}
            </p>
          )}
          <ButtonLink
            href={`/home/engineer/requests/new?product=${row.id}`}
            variant="outline"
            size="sm"
          >
            {locale === "ar" ? "اطلب عرض سعر" : "Request quote"}
          </ButtonLink>
        </Card>
      ))}
    </div>
  );
}
