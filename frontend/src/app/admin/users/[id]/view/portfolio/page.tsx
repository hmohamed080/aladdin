import { requireAdminRoute } from "@/server/authorization/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireViewAs } from "@/server/view-as/guard";
import { craftsmanViewAsReader } from "@/server/view-as/readers";
import { PortfolioSection } from "@/features/admin-view-as/craftsman-sections";
import { viewAsMediaUrl } from "@/server/view-as/media-ticket";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Admin View-As — craftsman portfolio (read-only). The gate is re-established here: layouts are not re-run on soft navigation. */
export default async function ViewAsPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminRoute("/admin/users");
  const { id } = await params;
  const session = await requireViewAs(id);
  const supabase = await getServerSupabase();
  const reader = craftsmanViewAsReader(supabase, session.subjectUserId);
  const data = await reader.portfolio();
  // Private media (Stage 4): a short-lived link per READY record; empty (placeholders) while the media switch or edge delivery is off.
  // The ticket names the record and the viewed account, never a storage key; the Worker's database call re-validates every request.
  const media: Record<string, string> = {};
  const links: Promise<void>[] = [];
  const add = (kind: "portfolio_item" | "certificate", id: string) =>
    links.push(viewAsMediaUrl(supabase, session.subjectUserId, kind, id).then((url) => { if (url) media[id] = url; }));
  for (const p of data.projects) for (const i of p.items) if (i.kind === "image" && i.state === "ready") add("portfolio_item", i.id);
  for (const c of data.certificates) if (c.state === "ready") add("certificate", c.id);
  await Promise.all(links);
  return <PortfolioSection data={data} media={media} />;
}
