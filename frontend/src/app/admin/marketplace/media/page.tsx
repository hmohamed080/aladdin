import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { MARKETPLACE_IMAGE_BUCKET } from "@/features/marketplace-seller/errors";
import { MediaModeration, type MediaItem, type MediaSettings } from "@/features/admin-marketplace/media-moderation";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;
const STATUSES = ["pending", "verified", "rejected"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Media moderation queue. Previews are short-lived signed URLs minted under the
 * MODERATOR'S OWN session (storage policy marketplace_images_select_moderator);
 * no service credential is involved and nothing here is public.
 */
export default async function AdminMarketplaceMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  // Console door for this route (the route table in lib/permissions/admin.ts); the page's RPCs still re-check
  // marketplace_sellers.* / marketplace_media.moderate and the refusal panel shows without them.
  await requireAdminRoute("/admin/marketplace/media");
  const sp = await searchParams;
  const status: Status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale).adminMarketplace;

  const [settingsRes, queueRes] = await Promise.all([
    supabase.rpc("admin_marketplace_media_settings"),
    supabase.rpc("admin_marketplace_media_queue", { p_status: status, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  if (settingsRes.error || queueRes.error) {
    const denied = settingsRes.error?.code === "42501" || queueRes.error?.code === "42501";
    return (
      <div className="flex flex-col gap-lg">
        <AdminHeader locale={locale} title={m.media.title} subtitle={m.media.subtitle} />
        <StatePanel tone="danger" title={denied ? m.errors.not_permitted : m.errors.unexpected} />
      </div>
    );
  }

  const settings = settingsRes.data as unknown as MediaSettings;
  const queue = queueRes.data as unknown as { total: number; items: Omit<MediaItem, "previewUrl">[] };
  const keys = queue.items.map((i) => i.object_key);
  const signed = keys.length
    ? (await supabase.storage.from(MARKETPLACE_IMAGE_BUCKET).createSignedUrls(keys, 600)).data ?? []
    : [];
  const urlByKey = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  const items: MediaItem[] = queue.items.map((i) => ({ ...i, previewUrl: urlByKey.get(i.object_key) ?? null }));

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.media.title} subtitle={m.media.subtitle} />
      <MediaModeration
        status={status}
        page={page}
        pages={Math.max(1, Math.ceil(Number(queue.total) / PAGE_SIZE))}
        settings={settings}
        items={items}
      />
    </div>
  );
}
