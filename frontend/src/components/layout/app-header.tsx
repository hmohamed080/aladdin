import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { Brand } from "@/components/layout/brand";
import { GlobalSearch } from "@/components/layout/global-search";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { ThemeSwitch } from "@/components/layout/switchers";
import { loadAccountIdentity, initialsOf } from "@/server/queries/identity";
import { canSearchAdmin } from "@/server/actions/search";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import { HelpIcon } from "@/components/ui/icons";
import { ChatMenu, FeedbackMenu, NotificationsMenu } from "@/components/layout/header-panels";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  countUnread,
  listNotifications,
} from "@/server/queries/notifications";
import {
  countUnreadConversations,
  listConversations,
  resolveConversationDisplayContext,
} from "@/server/queries/chat";
import { toNotificationViews } from "@/features/notifications/view-model";
import { toConversationViews } from "@/features/chat/view-model";
import { createTranslator } from "@/lib/i18n/translate";
import { HeaderSeparator, headerIconClass } from "@/components/layout/header-parts";
import type { CommerceStance } from "@/lib/workspace/supply-side";

/**
 * THE SHARED AUTHENTICATED HEADER — now the TOP BAR of the whole shell.
 *
 * One header for every authenticated product surface — the B2B workspace, the
 * personal `/home` workspace, and the Admin console. Before this there were
 * three near-identical bars that had already drifted (different paddings,
 * different control order, three copies of the language/theme/sign-out trio),
 * and a fourth was one persona away.
 *
 * IT SPANS THE VIEWPORT, AND THE SIDEBAR STARTS UNDER IT
 * The header used to be a child of the content column, sitting BESIDE the
 * sidebar and starting at its inner edge. That made the sidebar the top-level
 * element of the page and the header a component of one region inside it, which
 * is backwards: the header is global chrome and the sidebar is navigation for
 * the region below it. It also meant the brand lived in the sidebar, so a
 * collapsed rail reduced the product's own mark to a 26px glyph, and the header
 * had a `brand` prop just to decide who was drawing it. Now the header is a
 * sibling ABOVE the row that holds sidebar + main, it always carries the mark,
 * and the sidebar sticks to `--app-header-h` instead of to the top of the page.
 *
 * It is NOT applied to sign-in, sign-up, OTP or the onboarding forms. Those are
 * pre-workspace surfaces: there is no workspace to search, often no profile yet,
 * and a command palette on a one-field OTP screen is noise. They keep their own
 * minimal chrome and the standalone language/theme switches.
 *
 * WHAT VARIES, AND HOW
 * Everything role- or surface-specific arrives as a SLOT rather than a prop the
 * header interprets. `context` carries the workspace/branch switchers (B2B), the
 * personal switcher (`/home`), or the Admin badge; `actions` carries whatever
 * live control that surface genuinely owns. The header itself has no idea which
 * persona is looking at it, which is exactly why there is no reason to clone it.
 *
 * DENSITY
 * One row (`--app-header-h`: 68px from `tablet`, 48 below) with 28px controls,
 * breadcrumb-style `/` separators between the mark and the context it names —
 * the direction set by the supplied Supabase reference. Every colour, radius and
 * focus ring is still an Aladdin token; what was borrowed is the COMPACTNESS and
 * the hierarchy, not a palette.
 *
 * The row grew from 48 for the BRAND and for nothing else — see
 * `--app-header-h`. Everything to the far side of it is unchanged and still
 * 28px: search, the workspace and branch switchers, the three panel triggers,
 * Help, the theme switch and the avatar all keep their boxes and simply centre
 * in a taller band. That is the whole point of the split — one element needed
 * room, so one element got it, and the header did not become a toolbar.
 *
 * WHAT IS WIRED, AND WHAT IS STILL A SHELL
 * NOTIFICATIONS and CHAT are both real: each reads its own table through the
 * caller's own client, so RLS decides what the panel may contain, and each
 * trigger carries a counted badge. The rule the shells were built under has not
 * been relaxed — a badge is allowed precisely BECAUSE somebody counted it.
 *
 * Feedback is still a SHELL. There is no feedback model — no table, no queries —
 * and it carries no count, because a number nobody computed is a lie in the
 * chrome. It still opens something finished and honest: the composer it will be,
 * with sending plainly marked as not open.
 *
 * RESPONSIVE
 * Below `tablet` the search field collapses to its icon and any `context` slot
 * moves to its own second row, so the top row never wraps on a 393px screen.
 */
export async function AppHeader({
  appName,
  context,
  actions,
  capabilities = [],
  stance = "buyer",
  hasWorkspace,
  workspaceLabel,
  preferencesHref,
  orgId,
}: {
  appName: string;
  /** Workspace/branch switchers, an Admin badge — whatever names the context. */
  context?: ReactNode;
  /** Surface-owned live controls (e.g. the sales realtime indicator). */
  actions?: ReactNode;
  /** Membership capabilities, for the palette's navigation results. */
  capabilities?: readonly string[];
  stance?: CommerceStance;
  /** False on a personal account: the palette offers no record search. */
  hasWorkspace: boolean;
  /** Localized name of the active work context, shown in the profile menu. */
  workspaceLabel?: string | null;
  preferencesHref?: string;
  /**
   * The active organization, for scoping the notification list to the work
   * context the reader is actually in. UX ONLY — `notifications` is governed by
   * a recipient-only RLS policy, so this can narrow what is shown and can never
   * widen it. A personal surface passes nothing and gets the whole inbox.
   */
  orgId?: string | null;
}) {
  const supabase = await getServerSupabase();
  const [identity, canAdmin, store, notificationRows, unreadCount, conversationRows, chatUnread] =
    await Promise.all([
      loadAccountIdentity(),
      canSearchAdmin(),
      cookies(),
      listNotifications(supabase, { orgId }),
      // Counted rather than derived from the list: the badge must be right even
      // when there are more unread notices than the list's cap. `head: true`, so
      // this costs a count and no rows.
      countUnread(supabase, { orgId }),
      listConversations(supabase),
      // The same arithmetic as the bell's count: conversations whose activity
      // postdates this reader's position — computed from the approved columns,
      // never from the bounded list below.
      countUnreadConversations(supabase),
    ]);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  /* Rendered on the SERVER, in the reader's locale, before the panel is ever
     opened. The client component receives finished sentences and never sees a
     `title_key` — which is what keeps the i18n catalog out of the browser bundle
     for a panel most page views never open. */
  const translator = createTranslator(locale);
  const notifications = toNotificationViews(notificationRows, translator, locale);

  /* Conversation rows carry ids; names and titles are resolved through the
     commerce `_list` projections (the same path every commerce list uses) and
     only when there is something to resolve. */
  const chatContexts = conversationRows.length
    ? await resolveConversationDisplayContext(supabase, conversationRows)
    : new Map();
  const conversations = toConversationViews(
    conversationRows,
    chatContexts,
    translator,
    locale,
    orgId,
  );

  return (
    <header
      className="sticky top-0 border-b bg-surface/85 backdrop-blur"
      // Above the page, below the sidebar's hover reveal (300) so that reveal can
      // float over the header rather than sliding under it.
      style={{ zIndex: 200 }}
    >
      <div
        className="flex min-w-0 items-center gap-sm px-md tablet:gap-2"
        style={{ height: "var(--app-header-h)" }}
      >
        {/* The product's mark, in the product's chrome. It is here at EVERY
            width and on every surface now — a collapsed sidebar or a phone can
            no longer be a state in which Aladdin is unnamed. */}
        <Link
          href="/"
          /* `flex`, and it is load-bearing rather than tidiness. An <a> is
             inline, so the inline-flex lockup inside it sat in a LINE BOX whose
             height carried the font's descender space — the anchor measured
             ~46px around a 40px lockup, and centring the anchor in the row left
             the mark three pixels high of true centre. Making the anchor a flex
             container removes the line box, so the mark centres on the row and
             not on a phantom text baseline. */
          className="flex shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {/* `md`, the header lockup — see `Brand`. The pre-workspace screens
              keep `sm`; this is the only surface that grew. */}
          <Brand name={appName} size="md" />
        </Link>

        {context ? (
          <>
            <HeaderSeparator />
            <div className="hidden min-w-0 items-center gap-2 tablet:flex">{context}</div>
          </>
        ) : null}

        <div className="ms-auto flex shrink-0 items-center gap-1 tablet:gap-2">
          <GlobalSearch
            capabilities={capabilities}
            stance={stance}
            hasWorkspace={hasWorkspace}
            canAdmin={canAdmin}
          />

          {actions ? <div className="hidden items-center gap-sm tablet:flex">{actions}</div> : null}

          {/* Chat, Notifications and Feedback: one shell each. Chat and
              Notifications read real, RLS-scoped data; Feedback is still the
              composer shell it honestly is. They sit here rather than in
              `actions` because they are not one surface's controls; every
              authenticated surface gets all three. */}
          <ChatMenu
            items={conversations}
            unreadCount={chatUnread}
            activeOrgId={orgId}
            activeOrgName={workspaceLabel}
            currentUserId={identity?.userId ?? null}
          />
          <NotificationsMenu
            items={notifications}
            unreadCount={unreadCount}
            orgId={orgId}
          />
          <FeedbackMenu />

          {/* Help points at the support surface that already exists and stays
              reachable while signed in. It is a real destination with a real
              (or honestly absent) support contact behind it — not a placeholder
              that opens a modal we have not built. */}
          <Link
            href="/auth/support"
            aria-label={m.nav.help}
            title={m.nav.help}
            data-testid="header-help"
            className={headerIconClass}
          >
            <HelpIcon size={16} />
          </Link>

          {/* One icon, one press. See `ThemeSwitch` — this is the product's
              existing binary switch, not a new species of control. */}
          <ThemeSwitch current={resolveTheme(themePreference)} compact />

          <ProfileMenu
            displayName={identity?.displayName ?? null}
            contact={identity?.contact ?? null}
            workspaceLabel={workspaceLabel}
            initials={initialsOf(identity?.displayName, identity?.contact)}
            profileHref="/onboarding/profile"
            preferencesHref={preferencesHref}
            themePreference={themePreference}
          />
        </div>
      </div>

      {/* The context row on mobile. Kept out of the flow entirely when there is
          no context to show, so a personal account does not carry an empty bar. */}
      {context ? (
        <div className="flex min-w-0 items-center gap-sm border-t px-md py-2 tablet:hidden">
          {context}
        </div>
      ) : null}
    </header>
  );
}

export { HeaderSeparator } from "@/components/layout/header-parts";
