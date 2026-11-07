import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getProduct } from "@/server/queries/commerce";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { Card, Field } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { ProductStatusBadge } from "@/features/commerce/badges";
import { ProductPublishToggle } from "@/features/commerce/product-publish-toggle";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;
  const sp = await searchParams;

  const product = await getProduct(supabase, id);
  if (!product || product.organization_id !== org.organizationId) notFound();

  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");

  return (
    <div className="mx-auto max-w-3xl pb-16 tablet:pb-0">
      <BackLink href="/b2b/products">{m.commerce.products.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="commerce.flash.productCreated" /> : null}
      {sp.updated ? <FlashSuccess messageKey="commerce.flash.productUpdated" /> : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{product.name}</h1>
              <ProductStatusBadge status={product.status} />
            </div>
            {product.brand ? <p className="mt-1 text-body text-fg-secondary">{product.brand}</p> : null}
          </div>
          {canWrite ? (
            <Link href={`/b2b/products/${product.id}/edit`}>
              <Button variant="outline" size="sm">
                {m.common.edit}
              </Button>
            </Link>
          ) : null}
        </div>

        {product.short_description ? (
          <p className="mt-md whitespace-pre-wrap text-body-lg text-fg-secondary">{product.short_description}</p>
        ) : null}

        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-3">
          <Field label={m.commerce.fields.category}>{m.commerce.categories[product.category]}</Field>
          <Field label={m.commerce.fields.unit}>{m.commerce.units[product.unit]}</Field>
          <Field label={m.commerce.fields.sku}>{product.sku ?? "—"}</Field>
        </dl>

        {canPublish ? (
          <div className="mt-lg border-t pt-md">
            <p className="mb-sm text-label text-fg-muted">
              {product.status === "published"
                ? m.commerce.products.publishedHint
                : m.commerce.products.draftHint}
            </p>
            <ProductPublishToggle
              productId={product.id}
              version={product.version}
              published={product.status === "published"}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
