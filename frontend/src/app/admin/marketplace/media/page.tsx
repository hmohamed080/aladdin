import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { marketplacePrivateImageUrls } from "@/server/media/marketplace-public-images";
import { ProductReview, type ReviewCounts, type ReviewProduct, type ReviewTab } from "@/features/admin-marketplace/product-review";
import type { ReviewPreset } from "@/features/admin-marketplace/review-preset-manager";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const TABS = ["pending", "approved", "rejected"] as const;

type QueuedImage = Omit<ReviewProduct["images"][number], "previewUrl"> & { object_key: string };
type QueuedProduct = Omit<ReviewProduct, "images"> & { images: QueuedImage[] };

/**
 * Product review (admin). One card per product with all its images side by side. Previews are /api/media URLs read
 * under the MODERATOR'S OWN session (the marketplace media resolver admits marketplace_media.moderate); no service
 * credential is involved and nothing here is public.
 */
export default async function AdminProductReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  // Console door for this route (the route table in lib/permissions/admin.ts); the page's RPCs still re-check
  // marketplace_media.moderate and the refusal panel shows without it.
  await requireAdminRoute("/admin/marketplace/media");
  const sp = await searchParams;
  const tab: ReviewTab = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as ReviewTab) : "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale).adminMarketplace;

  const [summaryRes, queueRes, presetsRes] = await Promise.all([
    supabase.rpc("admin_marketplace_product_review_summary"),
    supabase.rpc("admin_marketplace_product_review_queue", { p_tab: tab, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    supabase.rpc("admin_marketplace_review_presets"),
  ]);
  if (summaryRes.error || queueRes.error || presetsRes.error) {
    const denied = [summaryRes.error, queueRes.error, presetsRes.error].some((e) => e?.code === "42501");
    return (
      <div className="flex flex-col gap-lg">
        <AdminHeader locale={locale} title={m.media.title} subtitle={m.media.subtitle} />
        <StatePanel tone="danger" title={denied ? m.errors.not_permitted : m.errors.unexpected} />
      </div>
    );
  }

  const counts = summaryRes.data as unknown as ReviewCounts;
  const queue = queueRes.data as unknown as { total: number; items: QueuedProduct[] };
  const presets = presetsRes.data as unknown as { can_manage: boolean; items: ReviewPreset[] };
  // Card-size previews through the media Worker (or /api/media), re-checking the moderator permission on every read.
  const keys = queue.items.flatMap((p) => p.images.map((i) => i.object_key));
  const previews = await marketplacePrivateImageUrls(supabase, keys, "card");
  const products: ReviewProduct[] = queue.items.map((p) => ({
    ...p,
    images: p.images.map((i) => ({ ...i, previewUrl: previews.get(i.object_key) ?? null })),
  }));

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.media.title} subtitle={m.media.subtitle} />
      <ProductReview
        tab={tab}
        page={page}
        pages={Math.max(1, Math.ceil(Number(queue.total) / PAGE_SIZE))}
        counts={counts}
        products={products}
        presets={presets.items}
        canManagePresets={presets.can_manage}
      />
    </div>
  );
}
