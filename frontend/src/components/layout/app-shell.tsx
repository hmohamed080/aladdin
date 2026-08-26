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
 * THREE PLANES, AND THE ORDER IS THE WHOLE DESIGN
 * A full-height navy sidebar standing on the far side; a light header card and a
 * light body surface FLOATING on a slightly darker frame; and white panels
 * raised again on top of the body. Each plane is a step lighter than the one
 * behind it, which is what lets the header read as a separate object rather than
 * as the top edge of the page.
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
 * The strip of frame between the navy and the header card is owned by
 * `SidebarShell` (see its `--shell-gutter-w`). It has to be, because the carve
 * crosses it: the active module's light surface starts inside the navigation
 * column, passes through the sidebar's trailing edge and ends flush with the
 * cards. A gutter that belonged to this element instead would clip it at the
 * navy edge and the carve would become a pill again.
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
  designLabAtmosphere = false,
}: {
  workspace: WorkspaceContext;
  children: ReactNode;
  /** DESIGN-LAB PROTOTYPE GATE — see `app/b2b/layout.tsx`. One account only. */
  designLabAtmosphere?: boolean;
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
    // when the page is shorter than the viewport — otherwise the navy stops
    // partway down on an empty route.
    // `workspace-frame` rather than `bg-frame`: the frame is a four-layer
    // gradient plane, not a fill — cool where the navy is, warm where it is not.
    // See globals.css. It is painted HERE, on the outermost box, because that is
    // the only element that is behind the sidebar's gutter, the header card and
    // the body card at once — which is the definition of the plane they float on.
    <div
      className="workspace-frame flex min-h-dvh items-stretch"
      data-design-lab={designLabAtmosphere ? "atmosphere" : undefined}
    >
      {/* THE DESIGN-LAB ATMOSPHERE MESH — fady@example.test only.
          A fixed, viewport-anchored layer (not sized off the document, so it
          never drifts as the body scrolls) painted BEHIND everything on this
          plane. It only exists so `.workspace-frame`'s own flat fill can be
          switched to `transparent` under the same gate — see globals.css —
          letting this show through the sidebar's gutter, the gap around the
          header card, and the translucent body. Inert and unannounced, same as
          `ShellAtmosphere`. */}
      {designLabAtmosphere ? (
        <div aria-hidden="true" className="design-lab-mesh pointer-events-none fixed inset-0 -z-10" />
      ) : null}

      {/* Persistent sidebar (desktop / tablet). Owns its own display modes, its
          own gutter, and now the brand lockup. */}
      <SidebarShell
        allowed={active.capabilities}
        mode={sidebarMode}
        stance={stance}
        appName={m.common.appName}
        orgName={active.organizationName}
        branchName={active.branches.find((b) => b.id === active.activeBranchId)?.name ?? null}
        designLabAtmosphere={designLabAtmosphere}
        /* No verification chip. The reference draws one, but `OrgContext` carries
           no verification state and inventing a backend read for a badge is the
           wrong trade — a chip that says "Verified" without asking anything is
           worse than no chip. */
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
          // doubling them puts the header card 80px off the navy.
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
          // DESIGN-LAB ONLY: the shared shell's apertures (16/13/16px) were
          // sized to show a bare tint of `--frame` — enough for a flat colour,
          // not enough for a mesh with real form to read as a mesh rather than
          // a hairline. Widened so the pools behind the header and down the
          // trailing edge are actually LEGIBLE, and so the body reads as an
          // object with real air around it rather than a page that happens to
          // have rounded top corners. This is normal padding on the scrolling
          // column, not a fixed footer or an inner scroll area — the mesh
          // behind it is what makes the gap read as "background", and it is
          // always there, at any scroll position, because it is a fixed
          // layer, not part of the document. Written as one or the other
          // (never both) so the atmosphere's wider apertures cannot collide
          // with the shared shell's own utility classes for the same
          // properties.
          // The END padding now MATCHES `--shell-gutter-w` (0.875rem) exactly
          // — the same aperture the sidebar's own gutter spends on the START
          // side, which `ps-0` above deliberately leaves this column to
          // supply nothing of. Before this it was `pe-8` (2rem) against an
          // effective start margin of 0.875rem: measurably asymmetric, not
          // an eyeballing error — the header card sat closer to the sidebar
          // than to the viewport's own trailing edge.
          designLabAtmosphere
            ? "tablet:gap-6 tablet:pt-8 tablet:pe-3.5 tablet:pb-10"
            : "tablet:gap-3 tablet:pt-4 tablet:pe-4",
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

        {/* The BODY plane — ONE CONTINUOUS WORKSPACE SURFACE. It opens below the
            header, it reaches the bottom of the viewport when the content is
            shorter than the screen, it grows with the content when it is
            longer, and in neither case does it close: `flex-1` claims the
            height, and the absence of a bottom margin, a bottom border and a
            bottom radius is what stops it drawing an edge across the page.

            `workspace-body` is its fill, and the fill is a RAMP IN ALPHA — see
            globals.css. The surface is barely present at its top edge, so the
            frame plane behind it is what shows through around the page heading,
            and it is fully opaque a screen down, where the panels need a flat
            ground. This is why the heading zone and the gutter beside it are the
            same colour: they are the same plane.

            The radius and border are TOP-ONLY for the same reason the margin is.
            A rounded bottom corner is a statement that the surface has ended,
            and it has not. */}
        <main
          className={cn(
            "workspace-body relative flex min-w-0 flex-1 flex-col",
            // DESIGN-LAB ONLY: round 3 gave this element its own visible
            // panel (rounded, bordered, a glass fill) — reviewed and
            // rejected: "one giant navy/glass body wrapping the dashboard"
            // was the single biggest mismatch against the Bitrix24 reference,
            // where content sits DIRECTLY on the workspace background and the
            // cards themselves are the only surfaces. So under the gate this
            // element now carries NO panel chrome at all — no radius, no
            // border, no shadow, no fill (see globals.css) — it is purely a
            // layout box. The mesh painted behind `.workspace-frame` is what
            // the reader sees here, in every gap the page's own content
            // doesn't cover.
            designLabAtmosphere
              ? null
              : "tablet:rounded-t-3xl tablet:border-x tablet:border-t tablet:border-workspace-line",
            // `shadow-[shadow:var(...)]` — the type hint is REQUIRED and its
            // absence is silent. Tailwind cannot infer whether a bare
            // `shadow-[var(--x)]` is a box-shadow or a shadow COLOUR, and when it
            // guesses colour it emits a rule that sets `--tw-shadow-color` and
            // leaves `box-shadow: none`. That is exactly what happened here: the
            // class was present in the markup, the token resolved correctly, and
            // the computed style still read `none`. (Design-lab skips this
            // entirely — a panel shadow implies a panel.)
            !designLabAtmosphere && "tablet:shadow-[shadow:var(--workspace-shadow)]",
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
