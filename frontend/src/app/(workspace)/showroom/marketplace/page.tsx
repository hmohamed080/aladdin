import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { loadMarketplaceSellerStanding } from "@/server/queries/marketplace-seller";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ButtonLink } from "@/components/ui/controls";
import { StorefrontIcon } from "@/components/ui/icons";
import { SellerStandingPanel } from "@/features/marketplace-seller/standing-panel";

export const dynamic = "force-dynamic";

/**
 * /showroom/marketplace — where the showroom stands with the Marketplace and, for its owner, the place to ask for approval
 * (first time, or again after a rejection). It exists only while the Marketplace preview is open and only for a showroom;
 * every other organization gets the ordinary not-found. Approval itself is an admin decision: this page never grants it.
 */
export default async function MarketplaceApprovalPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  if (!isMarketplacePreviewEnabled() || org.orgType !== "showroom_dealer") notFound();
  const t = getMessages(locale).marketplaceSeller.approval;
  const standing = await loadMarketplaceSellerStanding(supabase, org.organizationId);

  return (
    <div className="flex flex-col gap-lg">
      <PageHeader locale={locale} Icon={StorefrontIcon} title={t.title} subtitle={t.subtitle} />
      <SellerStandingPanel
        standing={standing}
        copy={t}
        locale={locale}
        organizationId={org.organizationId}
        canRequest={org.capabilities.includes("org.manage")}
        extra={
          standing?.status === "approved" ? (
            <div>
              <ButtonLink href="/showroom/marketplace/products" variant="accent">{t.openProducts}</ButtonLink>
            </div>
          ) : null
        }
      />
    </div>
  );
}
