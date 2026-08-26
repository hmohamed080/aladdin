import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { WorkspaceContext } from "@/server/queries/context";
import { BranchSwitcher } from "@/components/layout/context-switchers";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { AppHeader, HeaderSeparator } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/workspace-nav";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { SalesRealtime } from "@/features/sales/sales-realtime";
import { SIDEBAR_MODE_COOKIE, resolveSidebarMode } from "@/lib/ui/sidebar-mode";
import { commerceStance } from "@/lib/workspace/supply-side";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

/**
 * The B2B workspace chrome.
 *
 * TWO MATERIALS AND A FIELD, AND THE RELATIONSHIP IS THE WHOLE DESIGN
 * A full-height sidebar in saturated architectural blue standing on the far
 * side; a light, cool-mineral ATMOSPHERE filling everything else; and the cards
 * — header, boards, panels — as the only surfaces raised onto it.
 *
 * The sidebar carries the ink and the workspace is light, not the other way
 * round: a large expanse of low-luminance colour was tried twice and read as
 * heavy both times. What ties the two together is the atmosphere's own seam
 * pool, which is the SIDEBAR'S hue diluted by the room — so the join reads as
 * one designed transition rather than as a dark rectangle and a light rectangle
 * touching.
 *
 * NOTHING BETWEEN THEM IS A PANEL. This element and the body below it paint no
 * fill, no border and no shadow (see globals.css); their transparency is what
 * makes the atmosphere visible in every gutter. Any visible edge drawn around
 * the whole dashboard reads as "the dashboard sits inside a container", which is
 * the one claim this composition must not make.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 * The header used to span the viewport with the sidebar tucked underneath it,
 * which made the shell two stacked bands: chrome on top, everything else below.
 * That arrangement cannot produce the approved composition, and not for a
 * reason a border-radius could fix — a header that crosses the sidebar makes the
 * sidebar a REGION OF THE PAGE, and the whole carve mechanic depends on the
 * opposite claim: that the sidebar is the room and the page is a surface
 * arriving into it. So the sidebar is now the outermost thing on its side, full
 * height, brand included, and the header is one of the two cards floating in the
 * column beside it.
 *
 * THE GUTTER IS THE SIDEBAR'S, NOT THE CONTENT COLUMN'S
 * The strip between the shell and the header card is owned by `SidebarShell`
 * (see its `--shell-gutter-w`). It has to be, because the carve crosses it: the
 * active module's surface starts inside the navigation column, passes through
 * the sidebar's trailing edge and ends flush with the cards. A gutter that
 * belonged to this element instead would clip it at the shell's edge and the
 * carve would become a pill again.
 *
 * BELOW `tablet` NONE OF THIS APPLIES. The sidebar is not rendered, the cards
 * lose their margins and the header goes back to being a plain bar, because 390
 * points of width has none to spend on a frame around a frame. The bottom
 * navigation is the primary navigation there.
 *
 * Navigation reflects ONLY implemented modules; access is still enforced
 * server-side on every page.
 */
export async function AppShell({
  workspace,
  children,
}: {
  workspace: WorkspaceContext;
  children: ReactNode;
}) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const active = workspace.active!;
  const orgWide = active.canManageSales || active.capabilities.includes("branch.manage");
  // Read on the server so the first paint already has the chosen width — the
  // preference is layout, and discovering it after hydration is a visible flash.
  const sidebarMode = resolveSidebarMode(store.get(SIDEBAR_MODE_COOKIE)?.value);
  // Which seat this organization leads from. Derived from the org's own
  // classification on the server, so the first paint is already correct — it is a
  // navigation ORDER, and rewriting the rail after hydration is a visible jump.
  const stance = commerceStance(active.orgType);

  return (
    // `items-stretch` rather than the default: the sidebar sizes itself and the
    // column beside it takes the rest, and both must reach the full height even
    // when the page is shorter than the viewport — otherwise the shell stops
    // partway down on an empty route.
    // `workspace-frame` is the outermost box — the only element behind the
    // sidebar's gutter, the header card and the body at once, which is the
    // definition of the plane they float on. It PAINTS NOTHING now (see
    // globals.css): its transparency is what makes the atmosphere below visible
    // in every aperture, and its `isolation: isolate` is what stops `<body>`'s
    // own fill covering that atmosphere up.
    <div className="workspace-frame flex min-h-dvh items-stretch">
      {/* THE WORKSPACE ATMOSPHERE — the field this whole application is composed
          on. A fixed, VIEWPORT-anchored layer (not sized off the document, so it
          never drifts or re-tiles as a long dashboard scrolls) painted behind
          everything on this plane: it shows through the sidebar's gutter, the
          gaps around the header card, and every space the page's own content
          does not cover. Inert and unannounced, same as `ShellAtmosphere`. */}
      <div aria-hidden="true" className="workspace-atmosphere pointer-events-none fixed inset-0 -z-10" />

      {/* Persistent sidebar (desktop / tablet). Owns its own display modes, its
          own gutter, and now the brand lockup. */}
      <SidebarShell
        allowed={active.capabilities}
        mode={sidebarMode}
        stance={stance}
        appName={m.common.appName}
        /* NO ORG/BRANCH CARD, so no `orgName`/`branchName`. The fixed
           Settings/Upgrade block took that space at the foot of the rail, and
           the header's own workspace switcher already carries both facts on the
           same screen — the card was stating one fact twice.

           No verification chip either. The reference draws one, but `OrgContext`
           carries no verification state and inventing a backend read for a badge
           is the wrong trade — a chip that says "Verified" without asking
           anything is worse than no chip. */
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          // THE FRAME MARGIN, AND EVERY NUMBER IS MEASURED OFF THE CONCEPT.
          // These are not spacing preferences — they are the only apertures
          // through which the frame plane is visible at all, so they are what
          // decides whether the composition reads as three planes or as one
          // page with a dark strip down its side. Sampled: 17px above the header
          // card, 13px between the header and the body, 16px down the far edge.
          // `pt-4`/`gap-3`/`pe-4` are those, to the nearest step. The START side
          // is zero because the sidebar's own gutter already supplies it —
          // doubling them puts the header card 80px off the shell.
          //
          // THERE IS NO BOTTOM MARGIN, AND THAT IS THE POINT.
          // It used to be `py-4`, which closed the body 16px above the viewport
          // and drew a strip of frame under it. On a short route that strip is
          // the last thing on the screen; on a long one you scroll to the end of
          // the page to find it. Either way it reads as a footer — a second,
          // detached region below the workspace — when nothing lives there and
          // nothing is meant to. The body is the workspace, so it runs off the
          // bottom of the page and simply does not end.
          "tablet:ps-0",
          // THE APERTURES. The earlier shell's were 16/13/16px, sized to show a
          // bare tint of a FLAT frame colour — enough for a fill, not enough for
          // an atmosphere with real form to read as anything but a hairline.
          // Widened so the pools behind the header and down the trailing edge
          // are actually LEGIBLE, and so the body reads as an object with real
          // air around it rather than a page that happens to have rounded top
          // corners. This is normal padding on the scrolling column — not a
          // fixed footer, not an inner scroll area — and what makes the gap read
          // as "background" is the atmosphere behind it, which is present at any
          // scroll position because it is a fixed layer rather than part of the
          // document.
          //
          // THE END PADDING MATCHES `--shell-gutter-w` (0.875rem) EXACTLY — the
          // same aperture the sidebar's own gutter spends on the START side,
          // which `ps-0` above deliberately leaves this column to supply nothing
          // of. It was `pe-8` (2rem) against an effective start margin of
          // 0.875rem: measurably asymmetric, not an eyeballing error — the
          // header card sat closer to the sidebar than to the viewport's own
          // trailing edge.
          "tablet:gap-6 tablet:pt-8 tablet:pe-3.5 tablet:pb-10",
        )}
      >
        <AppHeader
          appName={m.common.appName}
          capabilities={active.capabilities}
          stance={stance}
          hasWorkspace
          workspaceLabel={active.organizationName}
          orgId={active.organizationId}
          preferencesHref="/b2b/settings"
          /* The floating form. The brand is NOT drawn here in this variant —
             it lives at the head of the sidebar, where the reference puts it and
             where it only has to be drawn once. */
          variant="card"
          context={
            <>
              <WorkspaceSwitcher entries={workspace.entries} activeKey={active.organizationId} />
              {/* The branch is a scope INSIDE the organization, so it reads as the
                  next crumb rather than as a second, unrelated chip. */}
              <HeaderSeparator />
              <BranchSwitcher
                branches={active.branches}
                activeId={active.activeBranchId}
                orgWide={orgWide}
              />
            </>
          }
          actions={<SalesRealtime orgId={active.organizationId} branchId={active.activeBranchId} />}
        />

        {/* The BODY — A LAYOUT BOX, NOT A PANEL, AND THAT IS THE DECISION.
            An earlier round gave this element its own visible panel (rounded
            top, bordered, a translucent fill, an elevation shadow) and it was
            reviewed and rejected: one giant surface wrapping the dashboard was
            the single biggest mismatch against the approved reference, where
            content sits DIRECTLY on the workspace and the cards are the only
            surfaces. Any visible edge around the whole dashboard reads as "the
            dashboard sits inside a container", which is precisely the claim the
            composition is trying not to make.

            So it carries no radius, no border, no shadow and no fill (the
            no-paint is stated explicitly in globals.css). What the reader sees
            here is the atmosphere, unmodified, in every gap the page's own
            content does not cover.

            It still opens below the header, reaches the bottom of the viewport
            when the content is shorter than the screen, grows with the content
            when it is longer, and in neither case CLOSES: `flex-1` claims the
            height, and the absence of a bottom margin is what stops it drawing
            an edge across the page. */}
        <main
          className={cn(
            "workspace-body relative flex min-w-0 flex-1 flex-col",
            // The bottom padding is the LAST PANEL's clearance, not the body's
            // own margin — the surface continues past it either way. On mobile
            // it also has to clear the fixed bottom navigation.
            "pb-24 tablet:pb-12",
          )}
          id="main"
        >
          <div className={cn(contentColumnClass, "relative z-10 py-lg tablet:pb-8 tablet:pt-5")}>
            {children}
          </div>
        </main>

        <MobileNav allowed={active.capabilities} stance={stance} />
      </div>
    </div>
  );
}
