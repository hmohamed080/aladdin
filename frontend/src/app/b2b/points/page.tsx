import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Points — the SHELL, ahead of the model.
 *
 * This route exists so the feature has a settled home in the navigation before
 * it has data: the sidebar entry, the section it belongs to (Business — it is
 * about this account's standing, not about a record), the page title and the
 * empty state are all decided here, and the persistence sprint changes the BODY
 * and nothing else.
 *
 * WHAT IS NOT ON THIS PAGE, ON PURPOSE
 * No balance. No tier, no rewards catalogue, no transaction history, no
 * leaderboard. There is no points table, no query and no RPC behind any of it,
 * so every one of those numbers would be invented — and an invented balance is
 * the single worst thing this page could show, because people would act on it.
 * The page says what is true: the programme is not running yet.
 *
 * There is no gate on it either (`NAV_CAPS.points` is null). Points are the
 * caller's own standing on the platform, not an organization record, so no
 * capability could sensibly decide who may look.
 */
export default async function PointsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const m = getMessages(ctx.locale);

  return (
    <div className="flex flex-col gap-lg">
      <PageHeader
        locale={ctx.locale}
        Icon={GaugeIcon}
        title={m.points.title}
        subtitle={m.points.subtitle}
      />
      <StatePanel
        icon={<GaugeIcon size={22} />}
        title={m.points.empty.title}
        body={m.points.empty.body}
      />
    </div>
  );
}
