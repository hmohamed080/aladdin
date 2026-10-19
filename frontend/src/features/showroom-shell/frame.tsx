import { SHOWROOM_PENDING_MARKER } from "./navigation";
import { PendingApprovalBanner } from "./pending-banner";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { createTranslator } from "@/lib/i18n/translate";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import { loadAccountIdentity } from "@/server/queries/identity";
import { loadBusinessCreationAccess } from "@/server/queries/business-creation-access";
import { listNotifications, countUnread } from "@/server/queries/notifications";
import { toNotificationViews } from "@/features/notifications/view-model";
import { ChatMenu, NotificationsMenu } from "@/components/layout/header-panels";
import { countUnreadConversations, listConversations, resolveConversationDisplayContext } from "@/server/queries/chat";
import { toConversationViews } from "@/features/chat/view-model";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { ShowroomShell } from "@/features/showroom-shell/shell";
import { BranchSwitcher } from "@/components/layout/context-switchers";
import { ShowroomWorkspaceMenu } from "@/features/showroom-shell/workspace-menu";

/**
 * The ONE Showroom frame. The suite routes and the finished commerce modules that still live under /b2b
 * (Direct RFQs, quotations, orders, projects, reports, team...) are rendered inside it, so a Showroom user
 * only ever sees one shell, one navigation and one visual language.
 */
export async function ShowroomFrame({ children }: { children: ReactNode }) {
  const { supabase, workspace, org } = await requireShowroomContext();
  const [store, identity, access, rows, unread, branch, conversationRows, chatUnread] = await Promise.all([
    cookies(), loadAccountIdentity(), loadBusinessCreationAccess(),
    listNotifications(supabase, { orgId: org.organizationId }),
    countUnread(supabase, { orgId: org.organizationId }),
    org.activeBranchId
      ? supabase.from("branches").select("address_ar, address_en").eq("organization_id", org.organizationId).eq("id", org.activeBranchId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Transaction-linked chat: RFQ, quotation and order pages ask THIS panel to show their conversation.
    listConversations(supabase),
    countUnreadConversations(supabase),
  ]);
  const chatContexts = conversationRows.length ? await resolveConversationDisplayContext(supabase, conversationRows) : new Map();
  if (branch.error) throw branch.error;
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const displayName = (locale === "ar" ? identity?.displayNameAr : identity?.displayNameEn) || identity?.displayName || (locale === "ar" ? "حسابي" : "My account");
  const location = (locale === "ar" ? branch.data?.address_ar : branch.data?.address_en) || branch.data?.address_ar || branch.data?.address_en || null;
  return <I18nProvider locale={locale} dir={directionFor(locale)}>
    <ShowroomShell key={org.organizationId} theme={resolveTheme(resolveThemePreference(store.get(THEME_COOKIE)?.value))} sidebarMode={resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value)} displayName={displayName} location={location} capabilities={org.isApproved === true ? org.capabilities : [...org.capabilities, SHOWROOM_PENDING_MARKER]}
      banner={org.isApproved === true ? undefined : <PendingApprovalBanner title={createTranslator(locale)("showroomPending.title")} body={createTranslator(locale)("showroomPending.body")} linkLabel={createTranslator(locale)("showroomPending.link")} />}
      workspaceSwitch={<ShowroomWorkspaceMenu entries={workspace.entries} activeKey={org.organizationId} canCreate={access.allowed} />}
      branchSwitch={org.branches.length > 1 ? (
        <BranchSwitcher branches={org.branches} activeId={org.activeBranchId} orgWide={org.canManageSales || org.capabilities.includes("branch.manage")} />
      ) : undefined}
      chat={<ChatMenu
        items={toConversationViews(conversationRows, chatContexts, createTranslator(locale), locale, org.organizationId)}
        unreadCount={chatUnread}
        activeOrgId={org.organizationId}
        activeOrgName={org.organizationName}
        currentUserId={identity?.userId ?? null}
      />}
      notifications={<NotificationsMenu items={toNotificationViews(rows, createTranslator(locale), locale)} unreadCount={unread} orgId={org.organizationId} />}>
      {children}
    </ShowroomShell>
  </I18nProvider>;
}
