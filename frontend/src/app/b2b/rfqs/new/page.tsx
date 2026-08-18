import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getCatalogProduct } from "@/server/queries/commerce";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { RfqForm } from "@/features/commerce/rfq-form";

export const dynamic = "force-dynamic";

export default async function NewRfqPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  // An RFQ is always seeded from a catalog product (it fixes the single supplier).
  if (!sp.product) {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href="/b2b/catalog">{m.commerce.catalog.title}</BackLink>
        <PageHeader title={m.commerce.rfq.newTitle} />
        <StatePanel title={m.commerce.rfq.startFromCatalogTitle} body={m.commerce.rfq.startFromCatalogBody} />
      </div>
    );
  }

  const product = await getCatalogProduct(supabase, sp.product);
  if (!product || !product.id || !product.name || !product.organization_id || !product.supplier_name) {
    notFound();
  }

  const canRfq = org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");
  const isOwnOrg = product.organization_id === org.organizationId;

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href={`/b2b/catalog/${product.id}`}>{product.name}</BackLink>
      <PageHeader title={m.commerce.rfq.newTitle} subtitle={m.commerce.rfq.newSubtitle} />
      {isOwnOrg ? (
        <StatePanel title={m.commerce.rfq.selfRfqTitle} body={m.commerce.rfq.selfRfqBody} />
      ) : !canRfq ? (
        <StatePanel tone="warning" title={m.commerce.rfq.deniedTitle} body={m.commerce.rfq.deniedBody} />
      ) : (
        <RfqForm
          requesterOrgId={org.organizationId}
          branchId={org.activeBranchId}
          supplier={{ id: product.organization_id, name: product.supplier_name }}
          product={{ id: product.id, name: product.name }}
        />
      )}
    </div>
  );
}
