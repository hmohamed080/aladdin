import { ActivityFeed } from "@/features/activity/activity-feed";
import { ActivityIcon } from "@/components/ui/icons";
import { StatePanel } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/workspace-layout";
import { normalizeActivityFilters } from "@/lib/activity";
import { getMessages } from "@/lib/i18n/translate";
import { organizationActivity } from "@/server/queries/activity";
import { getPageContext } from "@/server/queries/page-context";

export const dynamic = "force-dynamic";

type ActivitySearchParams = {
  before?: string | string[];
  family?: string | string[];
  from?: string | string[];
  to?: string | string[];
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The URL owns validated filters and an opaque two-column keyset cursor. This
 * keeps the route server-rendered while every read remains explicitly org
 * scoped; RLS independently enforces the exact `activity.read` capability.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivitySearchParams>;
}) {
  const [ctx, params] = await Promise.all([getPageContext(), searchParams]);
  if (!ctx) return null;

  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const canRead = org.capabilities.includes("activity.read");
  const header = (
    <PageHeader
      locale={locale}
      Icon={ActivityIcon}
      title={m.activity.title}
      subtitle={m.activity.subtitle}
    />
  );

  if (!canRead) {
    return (
      <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
        {header}
        <StatePanel
          tone="warning"
          icon={<ActivityIcon size={22} />}
          title={m.activity.noAccess.title}
          body={m.activity.noAccess.body}
        />
      </div>
    );
  }

  const before = firstValue(params.before);
  const filters = normalizeActivityFilters({
    family: firstValue(params.family),
    from: firstValue(params.from),
    to: firstValue(params.to),
  });

  try {
    const [page, auth] = await Promise.all([
      organizationActivity(supabase, org.organizationId, before, filters),
      supabase.auth.getUser(),
    ]);

    return (
      <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
        {header}
        <ActivityFeed
          page={page}
          filters={filters}
          before={before}
          currentUserId={auth.data.user?.id ?? null}
          locale={locale}
        />
      </div>
    );
  } catch {
    return (
      <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
        {header}
        <StatePanel
          tone="danger"
          icon={<ActivityIcon size={22} />}
          title={m.activity.error.title}
          body={m.activity.error.body}
        />
      </div>
    );
  }
}
