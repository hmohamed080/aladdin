import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getCatalogProduct } from "@/server/queries/commerce";
import { BackLink } from "@/features/sales/page-parts";
import { Card, Field, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";

export const dynamic = "force-dynamic";

export default async function CatalogProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { productId } = await params;

  const product = await getCatalogProduct(supabase, productId);
  // View columns are nullable in the generated types though logically non-null;
  // a row missing its core fields is treated as not found.
  if (!product || !product.id || !product.category || !product.unit || !product.organization_id) {
    notFound();
  }

  const isOwnOrg = product.organization_id === org.organizationId;
  const canRfq = org.canManageSales || org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");

  return (
    <div className="mx-auto max-w-3xl pb-16 tablet:pb-0">
      <BackLink href="/b2b/catalog">{m.commerce.catalog.backToCatalog}</BackLink>

      <Card>
        {/* The material itself, at the size a buyer can actually judge it — the
            card grid's thumbnail is for scanning, this is for deciding. */}
        <div className="grid gap-md tablet:grid-cols-[minmax(0,15rem)_1fr] tablet:items-start">
          <ProductMedia src={product.image_ref} alt={product.name ?? ""} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{product.name}</h1>
              <Badge tone="neutral">{m.commerce.categories[product.category]}</Badge>
            </div>
            {product.brand ? <p className="mt-1 text-body text-fg-secondary">{product.brand}</p> : null}
          </div>
        </div>

        {product.short_description ? (
          <p className="mt-md whitespace-pre-wrap text-body-lg text-fg-secondary">{product.short_description}</p>
        ) : null}

        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-3">
          <Field label={m.commerce.fields.unit}>{m.commerce.units[product.unit]}</Field>
          <Field label={m.commerce.fields.sku}>{product.sku ?? "—"}</Field>
          <Field label={m.commerce.catalog.supplier}>
            <span className="inline-flex items-center gap-1">
              {product.supplier_name}
              {product.supplier_verified ? (
                <span className="text-success" title={m.commerce.catalog.verifiedSupplier}>
                  <BadgeCheckIcon size={13} />
                </span>
              ) : null}
            </span>
          </Field>
        </dl>

        <div className="mt-lg border-t pt-md">
          {isOwnOrg ? (
            <p className="text-body text-fg-secondary">{m.commerce.catalog.ownProductNote}</p>
          ) : canRfq ? (
            <Link href={`/b2b/rfqs/new?product=${product.id}`}>
              <Button variant="accent">{m.commerce.catalog.requestQuote}</Button>
            </Link>
          ) : (
            <p className="text-body text-fg-muted">{m.commerce.catalog.rfqDenied}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
