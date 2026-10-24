import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { UploadIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ImportWizard, type RecentJob } from "@/features/marketplace-seller/import-wizard";

export const dynamic = "force-dynamic";

/**
 * /b2c/seller/imports — bulk import of Marketplace products from a spreadsheet
 * (XLSX / CSV) plus images (files or a ZIP). Everything runs under the SELLER'S
 * own session: parsing in the browser, images uploaded to the job's own storage
 * prefix (policy marketplace_import_assets_insert), and every database step
 * through `marketplace_seller_import_step`, which re-checks the seller on each
 * call. Imported products are always drafts; publishing stays a separate,
 * gated step.
 */
export default async function MarketplaceImportsPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller.imports;
  const [{ data: types }, { data: jobs }] = await Promise.all([
    supabase.from("marketplace_product_types").select("key, name_ar, name_en").eq("is_active", true).order("sort_order"),
    supabase
      .from("marketplace_import_jobs")
      .select(
        "id, mode, status, source_file_name, total_rows, total_assets, valid_rows, invalid_rows, applied_rows, failed_rows, created_at",
      )
      .eq("organization_id", org.organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={UploadIcon} title={t.title} subtitle={t.subtitle} />
      <ImportWizard
        organizationId={org.organizationId}
        types={(types ?? []).map((x) => ({ key: x.key, name: locale === "ar" ? x.name_ar : x.name_en }))}
        recentJobs={(jobs ?? []) as RecentJob[]}
      />
    </div>
  );
}
