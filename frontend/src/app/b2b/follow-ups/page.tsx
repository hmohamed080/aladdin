import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listFollowUps, customerNameMap, memberNameMap } from "@/server/queries/sales";
import { canAssign } from "@/server/queries/context";
import { PageHeader, FlashSuccess } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { CalendarCheckIcon } from "@/components/ui/icons";
import { FollowUpsBoard } from "@/features/sales/follow-ups-board";

export const dynamic = "force-dynamic";

function bucketOf(due: string | null): "overdue" | "dueToday" | "upcoming" {
  if (!due) return "upcoming";
  const d = new Date(due);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  if (d < startOfToday) return "overdue";
  if (d < startOfTomorrow) return "dueToday";
  return "upcoming";
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { updated } = await searchParams;

  const branchId = org.activeBranchId ?? undefined;
  const [all, custNames, memberNames] = await Promise.all([
    listFollowUps(supabase, org.organizationId, branchId ?? undefined),
    customerNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
  ]);

  const open = all.filter((f) => f.status === "open");
  const completed = all.filter((f) => f.status === "completed");

  const groups = {
    overdue: open.filter((f) => bucketOf(f.due_at) === "overdue"),
    dueToday: open.filter((f) => bucketOf(f.due_at) === "dueToday"),
    upcoming: open.filter((f) => bucketOf(f.due_at) === "upcoming"),
    completed,
  };

  return (
    <div className="pb-16 tablet:pb-0">
      {updated ? <FlashSuccess messageKey="followUps.updated" /> : null}
      <PageHeader title={m.followUps.title} subtitle={m.followUps.subtitle} count={open.length} />
      {all.length === 0 ? (
        <StatePanel icon={<CalendarCheckIcon size={20} />} title={m.followUps.empty} body={m.followUps.noDue} />
      ) : (
        <FollowUpsBoard
          groups={groups}
          customerNames={Object.fromEntries(custNames)}
          memberNames={Object.fromEntries(memberNames)}
          canAssign={canAssign(org)}
        />
      )}
    </div>
  );
}
