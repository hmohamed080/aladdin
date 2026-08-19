import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { cn } from "@/lib/ui/cn";
import { Brand } from "@/components/layout/brand";
import { GlobalSearch } from "@/components/layout/global-search";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { loadAccountIdentity, initialsOf } from "@/server/queries/identity";
import { canSearchAdmin } from "@/server/actions/search";
import { THEME_COOKIE, resolveTheme, resolveThemePreference } from "@/lib/theme/config";
import type { CommerceStance } from "@/lib/workspace/supply-side";

/**
 * THE SHARED AUTHENTICATED HEADER.
 *
 * One header for every authenticated product surface — the B2B workspace, the
 * personal `/home` workspace, and the Admin console. Before this there were
 * three near-identical bars that had already drifted (different paddings,
 * different control order, three copies of the language/theme/sign-out trio),
 * and a fourth was one persona away.
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
 * WHAT IS ABSENT
 * There is no notification bell. The reference set shows one with a red count on
 * it, and this repository has no notification model — a bell that opens nothing,
 * or a badge showing a number nobody computed, is a lie in the chrome. When a
 * real notification surface exists it belongs in `actions`.
 *
 * RESPONSIVE
 * Below `tablet` the brand appears (the sidebar that normally carries it is
 * hidden), the search field collapses to its icon, and any `context` slot moves
 * to its own second row so the top row never wraps on a 393px screen.
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
  brand = "sidebar",
  width = "full",
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
   * Who draws the wordmark at desktop width. `"sidebar"` (the default) is right
   * wherever a persistent rail or aside already carries it — the B2B workspace
   * and the Admin console — and the header then shows it only on a phone, where
   * that rail is hidden. `"header"` is for a surface with no rail at all: the
   * personal `/home` workspace, which would otherwise open with no Aladdin mark
   * anywhere on the page.
   */
  brand?: "sidebar" | "header";
  /**
   * `"content"` constrains the header row to the same column the page content
   * uses. It matters only where the page itself is a centred column with no
   * sidebar beside it — the personal `/home` workspace — because there a
   * full-bleed header puts the avatar and the switcher out at the window edges
   * while everything they belong to starts 170px inboard.
   */
  width?: "full" | "content";
}) {
  const [identity, canAdmin, store] = await Promise.all([
    loadAccountIdentity(),
    canSearchAdmin(),
    cookies(),
  ]);
  const themePreference = resolveThemePreference(store.get(THEME_COOKIE)?.value);

  return (
    <header className="sticky top-0 z-header border-b bg-surface/85 backdrop-blur" style={{ zIndex: 200 }}>
      <div
        className={cn(
          "flex min-w-0 items-center gap-sm px-md py-2 tablet:gap-md",
          width === "content" && "mx-auto w-full max-w-[1120px]",
        )}
      >
        <span className={cn("shrink-0", brand === "sidebar" && "tablet:hidden")}>
          <Brand name={appName} size="sm" />
        </span>

        {context ? <div className="hidden min-w-0 items-center gap-sm tablet:flex">{context}</div> : null}

        {/* Search sits at the START of the free space rather than centred: it is
            the most-used control in the bar, and centring it would make its
            position depend on how many context chips happen to be present. */}
        <div className="ms-auto flex min-w-0 items-center gap-sm tablet:ms-0">
          <GlobalSearch
            capabilities={capabilities}
            stance={stance}
            hasWorkspace={hasWorkspace}
            canAdmin={canAdmin}
          />
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-sm">
          {actions ? <div className="hidden items-center gap-sm tablet:flex">{actions}</div> : null}
          {/* Immediately before the avatar, and present at EVERY width. Appearance
              is the one preference people change often enough that burying it two
              clicks deep in the account menu was the complaint — and a phone in
              a dark room is exactly where it is needed most, so it does not get
              dropped at the tablet breakpoint the way `actions` does. */}
          <ThemeToggle initial={resolveTheme(themePreference)} />
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
        <div
          className={cn(
            "flex min-w-0 items-center gap-sm border-t px-md py-2 tablet:hidden",
            width === "content" && "mx-auto w-full max-w-[1120px]",
          )}
        >
          {context}
        </div>
      ) : null}
    </header>
  );
}
