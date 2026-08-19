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
import { ChatMenu, NotificationsMenu } from "@/components/layout/header-panels";
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
 * One 48px row (`--app-header-h`) with 28px controls, breadcrumb-style `/`
 * separators between the mark and the context it names — the direction set by
 * the supplied Supabase reference. Every colour, radius and focus ring is still
 * an Aladdin token; what was borrowed is the COMPACTNESS and the hierarchy, not
 * a palette.
 *
 * WHAT IS ABSENT, AND WHY
 * There is no notification bell and no chat entry. This repository has no
 * notification model and no messaging model — no tables, no queries, nothing in
 * the history to restore. A bell that opens nothing, or a badge showing a number
 * nobody computed, is a lie in the chrome. When either surface genuinely exists
 * it belongs in `actions`, which is why that slot is here.
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
}) {
  const [identity, canAdmin, store] = await Promise.all([
    loadAccountIdentity(),
    canSearchAdmin(),
    cookies(),
  ]);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

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
          className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Brand name={appName} size="sm" />
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

          {/* Chat and Notifications: the shell only. Both open a finished empty
              state and neither shows a count, because there is no messaging or
              notification data in this repository yet — see `header-panels`.
              They are here rather than in `actions` because they are not one
              surface's controls; every authenticated surface gets both. */}
          <ChatMenu />
          <NotificationsMenu />

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
