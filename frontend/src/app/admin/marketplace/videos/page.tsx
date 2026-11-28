import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { VideoReviewCard, type ReviewVideo } from "@/features/admin-marketplace/video-review";
import { privateVideoPlayback, videoEnabled } from "@/server/video/playback";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * Marketplace product video review. Lists the products with a finished video waiting for a decision. The videos
 * play under the reviewer's own session (the media Worker asks media_edge_video, which admits
 * marketplace_media.moderate). The RPCs re-check the permission; no service credential is used here.
 */
export default async function AdminMarketplaceVideosPage() {
  await requireAdminRoute("/admin/marketplace/videos");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale).adminMarketplace.videos;

  const queue = await supabase.rpc("admin_marketplace_pending_videos", { p_limit: 50 });
  if (queue.error) {
    return (
      <div className="flex flex-col gap-lg">
        <AdminHeader locale={locale} title={m.title} subtitle={m.subtitle} />
        <StatePanel tone="danger" title={queue.error.code === "42501" ? m.errors.not_permitted : m.errors.unexpected} />
      </div>
    );
  }
  const products = queue.data ?? [];
  const sections = await Promise.all(products.map(async (p) => {
    const { data } = await supabase.rpc("admin_marketplace_product_videos", { p_product_id: p.product_id });
    const videos: ReviewVideo[] = await Promise.all((data ?? []).map(async (v) => ({
      id: v.id, title: v.title, state: v.state, reviewStatus: v.review_status as ReviewVideo["reviewStatus"],
      width: v.width, height: v.height, reviewReason: v.review_reason,
      playback: v.state === "ready" && videoEnabled()
        ? await privateVideoPlayback(supabase, { id: v.id, title: v.title,
            durationSeconds: v.duration_seconds === null ? null : Number(v.duration_seconds),
            width: v.width, height: v.height, hasPoster: v.has_poster, position: v.slot, createdAt: v.created_at }).catch(() => null)
        : null,
    })));
    return { product: p, videos };
  }));

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.title} subtitle={m.subtitle} count={products.length} />
      {sections.length === 0 ? <StatePanel title={m.empty} /> : null}
      {sections.map(({ product, videos }) => (
        <section key={product.product_id} className="flex flex-col gap-sm" aria-label={locale === "ar" ? product.name_ar : product.name_en}>
          <h2 className="text-title text-fg">{locale === "ar" ? product.name_ar : product.name_en}</h2>
          <ul className="grid gap-lg sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => <li key={v.id}><VideoReviewCard video={v} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
