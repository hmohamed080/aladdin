import type { ReactNode } from "react";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

/**
 * THE ALADDIN APPLICATION SHELL — the ground every authenticated surface stands
 * on, and the reason a second surface can now look like the first.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * It owns the GROUND: the frame plane, the atmosphere, the apertures, the header
 * slot, the content measure, and the relationship between navigation and content.
 * It owns NO navigation. It does not know whether the thing in its `nav` slot
 * lists twenty capability-gated B2B modules or three personal destinations, and
 * it must not learn.
 *
 * That separation is the whole point of this file. The approved composition used
 * to live inside `AppShell`-for-B2B with `SidebarShell` hard-wired into it, so a
 * surface wanting the approved background had to import the B2B sidebar — and
 * therefore B2B capabilities and commerce stance. `/home`, `/admin`, `/business`
 * and `/onboarding` all declined that trade and wrote
 * `flex min-h-dvh flex-col bg-canvas` instead. Five hand-written copies of an
 * unnamed shell is what "different account types look like different products"
 * actually was, in code.
 *
 * TWO MATERIALS AND A FIELD, AND THE RELATIONSHIP IS THE WHOLE DESIGN
 * A full-height navigation panel in saturated architectural blue standing on the
 * far side; a light, cool-mineral ATMOSPHERE filling everything else; and the
 * cards — header, boards, panels — as the only surfaces raised onto it.
 *
 * The panel carries the ink and the workspace is light, not the other way round:
 * a large expanse of low-luminance colour was tried twice and read as heavy both
 * times. What ties the two together is the atmosphere's own seam pool, which is
 * the PANEL'S hue diluted by the room — so the join reads as one designed
 * transition rather than as a dark rectangle and a light rectangle touching.
 *
 * NOTHING BETWEEN THEM IS A PANEL. This element and the body below it paint no
 * fill, no border and no shadow (see globals.css); their transparency is what
 * makes the atmosphere visible in every gutter. Any visible edge drawn around the
 * whole page reads as "the page sits inside a container", which is the one claim
 * this composition must not make.
 *
 * THE HEADER DOES NOT CROSS THE NAVIGATION. A header spanning the viewport would
 * make the panel a REGION OF THE PAGE, and the carve mechanic depends on the
 * opposite claim: that the panel is the room and the page is a surface arriving
 * into it. So the nav is the outermost thing on its side, full height, and the
 * header is one of the cards floating in the column beside it.
 *
 * THE `workspace-*` CLASS NAMES ARE HISTORICAL. They date from when this ground
 * existed only under `/b2b`. They are the CSS hooks the approved direction is
 * written against in `globals.css` (~40 rules), so they were kept rather than
 * renamed — a rename would have been a large silent-breakage risk for zero visual
 * gain. Read them as "the app ground", not "the B2B ground".
 *
 * BELOW `tablet` NONE OF THE FRAME APPLIES. The panel is not rendered, the cards
 * lose their margins and the header goes back to being a plain bar, because 390
 * points of width has none to spend on a frame around a frame. Whatever the
 * caller passes as `mobileNav` is the primary navigation there.
 *
 * It grants nothing. Every destination re-checks access server-side.
 */
export function AppShell({
  nav,
  header,
  mobileNav,
  children,
}: {
  /**
   * The full-height navigation panel, already assembled by the caller. Omitted
   * on surfaces that genuinely have no navigation (a linear flow such as
   * onboarding), in which case the content column simply takes the full width
   * and the atmosphere still reads behind it.
   */
  nav?: ReactNode;
  /** The header card. Every surface has one; there is only one implementation. */
  header: ReactNode;
  /** Bottom navigation below `tablet`. Omitted where `nav` is. */
  mobileNav?: ReactNode;
  children: ReactNode;
}) {
  return (
    // `items-stretch` rather than the default: the panel sizes itself and the
    // column beside it takes the rest, and both must reach the full height even
    // when the page is shorter than the viewport — otherwise the shell stops
    // partway down on an empty route.
    //
    // `workspace-frame` is the outermost box — the only element behind the
    // panel's gutter, the header card and the body at once, which is the
    // definition of the plane they float on. It PAINTS NOTHING (see globals.css):
    // its transparency is what makes the atmosphere below visible in every
    // aperture, and its `isolation: isolate` is what stops `<body>`'s own fill
    // covering that atmosphere up.
    <div className="workspace-frame flex min-h-dvh items-stretch">
      {/* THE ATMOSPHERE — the field the application is composed on. A fixed,
          VIEWPORT-anchored layer (not sized off the document, so it never drifts
          or re-tiles as a long page scrolls) painted behind everything on this
          plane: it shows through the panel's gutter, the gaps around the header
          card, and every space the page's own content does not cover. Inert and
          unannounced. */}
      <div aria-hidden="true" className="workspace-atmosphere pointer-events-none fixed inset-0 -z-10" />

      {nav}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          // THE FRAME MARGIN, AND EVERY NUMBER IS MEASURED OFF THE CONCEPT.
          // These are not spacing preferences — they are the only apertures
          // through which the frame plane is visible at all, so they are what
          // decides whether the composition reads as three planes or as one page
          // with a dark strip down its side.
          //
          // THERE IS NO BOTTOM MARGIN, AND THAT IS THE POINT. It used to be
          // `py-4`, which closed the body above the viewport and drew a strip of
          // frame under it. On a short route that strip is the last thing on the
          // screen; on a long one you scroll to the end to find it. Either way it
          // reads as a footer — a second, detached region below the page — when
          // nothing lives there and nothing is meant to.
          //
          // THE END PADDING MATCHES `--shell-gutter-w` EXACTLY — the same
          // aperture the panel's own gutter spends on the START side, which
          // `ps-0` leaves this column to supply nothing of.
          "tablet:ps-0",
          "tablet:gap-6 tablet:pt-8 tablet:pe-3.5 tablet:pb-10",
        )}
      >
        {header}

        {/* THE BODY — A LAYOUT BOX, NOT A PANEL, AND THAT IS THE DECISION.
            An earlier round gave this element its own visible panel (rounded top,
            bordered, a translucent fill, an elevation shadow) and it was reviewed
            and rejected: one giant surface wrapping the page was the single
            biggest mismatch against the approved reference, where content sits
            DIRECTLY on the ground and the cards are the only surfaces.

            So it carries no radius, no border, no shadow and no fill. What the
            reader sees here is the atmosphere, unmodified, in every gap the
            page's own content does not cover.

            `workspace-body` is also the hook the operational-card elevation is
            scoped to (globals.css), which is precisely why every surface should
            carry it: the shared card treatment follows the ground. */}
        <main
          className={cn(
            "workspace-body relative flex min-w-0 flex-1 flex-col",
            // The bottom padding is the LAST PANEL's clearance, not the body's
            // own margin. On mobile it also has to clear a fixed bottom nav.
            mobileNav ? "pb-24 tablet:pb-12" : "pb-12",
          )}
          id="main"
        >
          <div className={cn(contentColumnClass, "relative z-10 py-lg tablet:pb-8 tablet:pt-5")}>
            {children}
          </div>
        </main>

        {mobileNav}
      </div>
    </div>
  );
}
