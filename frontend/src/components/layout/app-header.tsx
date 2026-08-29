import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
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
  variant = "bar",
}: {
  appName: string;
  /**
   * Which shell is rendering this header.
   *
   * `bar` is the original and the default: a full-width band across the top of
   * the viewport, with the brand at its head. It is what `/home` and `/admin`
   * still are.
   *
   * `card` is the B2B workspace, where the header is one of two objects
   * floating beside a full-height sidebar. Three things follow from that and all
   * three are consequences of the same fact rather than independent style
   * choices: it is rounded and detached instead of edged and stuck; it does NOT
   * draw the brand, because the sidebar beside it already does; and search moves
   * to the head of the card, because with the lockup gone that position is free
   * and search is the thing that deserves it.
   *
   * The DIFFERENCE IS ONLY CHROME. Every control, every panel and every piece of
   * data is identical in both — this switch must never become a place where one
   * surface quietly gets a feature another does not.
   */
  variant?: "bar" | "card";
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

  const card = variant === "card";

  /* Declared once and placed twice. In the bar it follows the brand, on the
     left, where a crumb trail belongs. In the card the left is spent on search,
     so the workspace and branch move over to sit with the account controls they
     are a scope for. Same element either way — the alternative is two copies
     that drift. */
  const contextBlock = context ? (
    <div
      className={cn(
        "hidden min-w-0 items-center gap-2",
        // THE CARD SHOWS IT LATER THAN THE BAR DOES, and the reason is that the
        // card is not the full viewport: the sidebar takes 280px before it
        // starts. At 834pt that leaves ~540pt for a command field, an
        // organization crumb, a branch crumb and seven controls, and they do not
        // fit — the crumbs rendered straight over the search field.
        //
        // Hiding the crumbs rather than the controls is the right half to drop,
        // because in this shell they are the one piece of the header that is
        // duplicated: the workspace card at the foot of the sidebar carries the
        // same organization and the same branch, on screen at the same time. The
        // bar variant has no sidebar and therefore no duplicate, so it keeps the
        // crumbs from `tablet` exactly as before.
        card ? "desktop:flex" : "tablet:flex",
      )}
    >
      {context}
    </div>
  ) : null;

  return (
    <header
      /* Identifies THIS header uniquely, AND WHICH VARIANT IT IS, for CSS that
         must reach only the shell's own bar — never another `<header>` a page
         happens to render further down (a dashboard board, an article, ...),
         and never a different shell's bar.

         Both halves are load-bearing and both were learned the expensive way:
           — WITHOUT the attribute, a bare `header` selector caught every
             dashboard board's own title row, freezing each card's header to the
             viewport while the card scrolled under it.
           — WITHOUT the VALUE, promoting the card's translucent material would
             reach the Personal home and the Admin console too. Those two render
             the `bar` variant on `bg-canvas` with no workspace atmosphere behind
             them, so a translucent bar there composites over nothing and reads
             as a washed-out strip.

         See the canonical chrome rules in globals.css, which key entirely off
         `header[data-app-header="card"]`. */
      data-app-header={card ? "card" : "bar"}
      /* A DISTINCT SHELL SURFACE, not a translucent strip over the page.
         It used to be `bg-surface/85 backdrop-blur`, which let the workspace
         scroll through it as a smear. That was survivable against flat white;
         against the navy shell and the body's ambient wash it is not — the
         header picked up whatever tint happened to be under it and its boundary
         with the body dissolved exactly where the design needs three separate
         planes (shell, header, body) to read as three. So: opaque, with a
         hairline and a short shadow that sits the header ABOVE the page rather
         than in it. The blur goes with the transparency; there is nothing left
         to blur. */
      className={cn(
        "bg-surface",
        card
          ? /* A CARD, and therefore NOT STICKY. It is an object on the page with
               air on all four sides, and an object that detaches and follows the
               scroll while the body it was paired with slides underneath reads as
               a rendering fault rather than as persistence. Below `tablet` there
               is no frame and no sidebar, so it reverts to the bar in every
               respect — edge, shadow, stickiness and all. */
            "sticky top-0 border-b shadow-raised tablet:static tablet:rounded-[1.25rem] tablet:border tablet:shadow-card"
          : "sticky top-0 border-b shadow-raised",
      )}
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
          className={cn(
            "flex shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            // In the card the sidebar draws the lockup, so drawing it here too
            // would put two Aladdin marks 40px apart. It stays below `tablet`,
            // where the sidebar is not rendered at all and this is once again the
            // only place the product is named.
            card && "tablet:hidden",
          )}
        >
          {/* `md`, the header lockup — see `Brand`. The pre-workspace screens
              keep `sm`; this is the only surface that grew. */}
          <Brand name={appName} size="md" />
        </Link>

        {!card && context ? (
          <>
            <HeaderSeparator />
            {contextBlock}
          </>
        ) : null}

        <div
          className={cn(
            // `min-w-0` so this can actually give width back under pressure. A
            // flex item defaults to `min-width: auto`, which refuses to shrink
            // below its content and is how a "flexible" field ends up pushing
            // its siblings off the end of the row instead of narrowing.
            "flex min-w-0 items-center",
            card
              ? // The card's lead. `me-auto` rather than a fixed width so the
                // field grows with the shell and the controls stay hard right;
                // capped, because a 900px command field on a wide display is not
                // a better search, just a longer one.
                "ms-auto tablet:ms-1 tablet:me-auto tablet:max-w-[30rem] tablet:flex-1"
              : "ms-auto",
          )}
        >
          <GlobalSearch
            capabilities={capabilities}
            stance={stance}
            hasWorkspace={hasWorkspace}
            canAdmin={canAdmin}
            size={card ? "lead" : "compact"}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1 tablet:gap-2">
          {card ? contextBlock : null}

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
