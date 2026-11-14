import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { MoneyIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { PaymentSettingsEditor } from "@/features/marketplace-orders/payment-settings-editor";
import type { PaymentSettings } from "@/features/marketplace-orders/contract";

export const dynamic = "force-dynamic";

/**
 * /showroom/marketplace/payments - how Marketplace buyers can pay this showroom: cash on delivery, an
 * InstaPay deposit (with the share the showroom asks up front) and, later, online card payment.
 * Read and saved through the seller RPCs of Migration 14 under the seller's own session.
 */
export default async function MarketplacePaymentsPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller;
  const { data } = await supabase.rpc("marketplace_seller_payment_settings_get", { p_organization_id: org.organizationId });
  const settings = (data ?? {
    cod_enabled: false,
    instapay_enabled: false,
    instapay_address: null,
    instapay_account_name: null,
    instapay_deposit_percent: null,
    can_edit: false,
  }) as unknown as PaymentSettings;
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={MoneyIcon} title={t.payments.title} subtitle={t.payments.subtitle} />
      <PaymentSettingsEditor organizationId={org.organizationId} initial={settings} />
    </div>
  );
}
